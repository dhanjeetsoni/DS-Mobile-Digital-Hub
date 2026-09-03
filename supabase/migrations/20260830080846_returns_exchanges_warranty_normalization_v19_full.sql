-- v19: Returns / Exchanges / Warranty Claims normalization
--
-- Follows the exact same pattern already established by purchases,
-- atomic_apply_stock_adjustment and the supplier/customer migration:
--   * client (db.returns[] / db.exchanges[] / db.warrantyClaims[] JSON)
--     stays authoritative and always writes locally first;
--   * these tables + RPCs are the cloud mirror + real inventory ledger,
--     called cloud-first with an offline-queue fallback (see repository.ts);
--   * atomic, SECURITY DEFINER, idempotency-key guarded, same as
--     atomic_complete_sale / atomic_complete_purchase / atomic_apply_stock_adjustment;
--   * RLS: owner/manager can read/write the table directly, staff can only
--     go through the RPC (same shape as the existing returns_owner_manager
--     / sale_items_owner_manager policies).

-- ---------------------------------------------------------------------
-- 1) RETURNS — the table already existed (product_id/quantity/refund_amount
--    per row) but had no header identity (return_no), no customer link, and
--    no idempotency guard. Additive columns only — 0 existing rows.
-- ---------------------------------------------------------------------

alter table public.returns
  add column if not exists return_no text,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists refund_method text,
  add column if not exists notes text,
  add column if not exists return_type text,
  add column if not exists idempotency_key text;

create index if not exists returns_customer_id_idx on public.returns(customer_id);
create index if not exists returns_idempotency_idx on public.returns(store_id, idempotency_key) where idempotency_key is not null;

-- Records one full "Return" event (possibly multiple item lines) atomically:
-- writes one `returns` row per line AND re-opens FIFO stock (mirrors the
-- positive-delta branch of atomic_apply_stock_adjustment / the batch-open
-- logic of atomic_complete_purchase) so a return grows real cloud inventory,
-- not just an audit trail.
--
-- p_items: [{ "product_id": uuid, "quantity": numeric, "unit_price": numeric,
--              "purchase_price": numeric, "refund_amount": numeric }, ...]
create or replace function public.record_return(
  p_store_id uuid,
  p_sale_id uuid,
  p_return_no text,
  p_customer_id uuid,
  p_return_type text,
  p_reason text,
  p_refund_method text,
  p_notes text,
  p_items jsonb,
  p_idempotency_key text
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_existing text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_refund numeric;
  v_purchase_price numeric;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;

  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency key required';
  end if;

  select return_no into v_existing from public.returns
    where store_id = p_store_id and idempotency_key = p_idempotency_key
    limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid quantity: no return items';
  end if;

  -- Validate every line before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid quantity';
    end if;
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id for update;
    if v_product.id is null then
      raise exception 'invalid quantity: unknown product';
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_refund := coalesce((v_item->>'refund_amount')::numeric, 0);
    v_purchase_price := coalesce((v_item->>'purchase_price')::numeric, 0);

    -- Re-open a FIFO lot for the restocked qty at the item's original cost
    -- (not today's cost_price) so margin history stays accurate.
    insert into public.stock_batches(store_id, product_id, qty, remaining_qty, purchase_price, source, ref)
    values (p_store_id, (v_item->>'product_id')::uuid, v_qty, v_qty, v_purchase_price, 'return', coalesce(p_return_no, p_idempotency_key));

    update public.products
      set stock_qty = stock_qty + v_qty
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id;

    insert into public.stock_movements(store_id, product_id, movement_type, quantity, reference, created_by)
    values (p_store_id, (v_item->>'product_id')::uuid, 'return', v_qty, coalesce(p_return_no, p_idempotency_key), auth.uid());

    insert into public.returns(
      store_id, sale_id, product_id, quantity, refund_amount, reason,
      return_no, customer_id, refund_method, notes, return_type, idempotency_key, created_by
    ) values (
      p_store_id, p_sale_id, (v_item->>'product_id')::uuid, v_qty, v_refund, p_reason,
      p_return_no, p_customer_id, p_refund_method, p_notes, p_return_type, p_idempotency_key, auth.uid()
    );
  end loop;

  return p_return_no;
exception
  when unique_violation then
    select return_no into v_existing from public.returns
      where store_id = p_store_id and idempotency_key = p_idempotency_key limit 1;
    if v_existing is not null then return v_existing; end if;
    raise;
end;
$function$;

revoke execute on function public.record_return(uuid,uuid,text,uuid,text,text,text,text,jsonb,text) from anon;

-- ---------------------------------------------------------------------
-- 2) EXCHANGES — brand-new header + line-item pair, same shape as
--    purchases/purchase_items.
-- ---------------------------------------------------------------------

create table if not exists public.exchanges (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  exchange_no text,
  customer_id uuid references public.customers(id) on delete set null,
  returned_value numeric not null default 0,
  replacement_value numeric not null default 0,
  difference_amount numeric not null default 0,
  settlement_method text,
  reason text,
  idempotency_key text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists exchanges_store_id_idx on public.exchanges(store_id);
create index if not exists exchanges_sale_id_idx on public.exchanges(sale_id);
create index if not exists exchanges_customer_id_idx on public.exchanges(customer_id);
create index if not exists exchanges_idempotency_idx on public.exchanges(store_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.exchange_items (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.exchanges(id) on delete cascade,
  kind text not null check (kind in ('returned','replacement')),
  product_id uuid references public.products(id) on delete set null,
  quantity numeric not null,
  unit_price numeric not null default 0,
  purchase_price numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists exchange_items_exchange_id_idx on public.exchange_items(exchange_id);
create index if not exists exchange_items_product_id_idx on public.exchange_items(product_id);

alter table public.exchanges enable row level security;
alter table public.exchange_items enable row level security;

drop policy if exists "exchanges_owner_manager" on public.exchanges;
create policy "exchanges_owner_manager" on public.exchanges for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.store_id = exchanges.store_id and p.role in ('owner','manager')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.store_id = exchanges.store_id and p.role in ('owner','manager')));

drop policy if exists "exchange_items_owner_manager" on public.exchange_items;
create policy "exchange_items_owner_manager" on public.exchange_items for all to authenticated
  using (exists (select 1 from public.exchanges e join public.profiles p on p.store_id = e.store_id where e.id = exchange_items.exchange_id and p.id = auth.uid() and p.role in ('owner','manager')))
  with check (exists (select 1 from public.exchanges e join public.profiles p on p.store_id = e.store_id where e.id = exchange_items.exchange_id and p.id = auth.uid() and p.role in ('owner','manager')));

-- Records one full "Exchange" event atomically: restocks the returned
-- item(s) via a fresh FIFO lot (same as record_return above) AND consumes
-- FIFO stock for the replacement item(s) (same oldest-first logic as
-- atomic_complete_sale), all in one transaction.
--
-- p_returned_items / p_replacement_items:
--   [{ "product_id": uuid, "quantity": numeric, "unit_price": numeric, "purchase_price": numeric }, ...]
create or replace function public.record_exchange(
  p_store_id uuid,
  p_sale_id uuid,
  p_exchange_no text,
  p_customer_id uuid,
  p_returned_items jsonb,
  p_replacement_items jsonb,
  p_returned_value numeric,
  p_replacement_value numeric,
  p_difference_amount numeric,
  p_settlement_method text,
  p_reason text,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_exchange_id uuid;
  v_existing_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_price numeric;
  v_purchase_price numeric;
  v_remaining numeric;
  v_batch record;
  v_take numeric;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;

  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency key required';
  end if;

  select id into v_existing_id from public.exchanges
    where store_id = p_store_id and idempotency_key = p_idempotency_key limit 1;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if p_returned_items is null or jsonb_array_length(p_returned_items) = 0 then
    raise exception 'invalid quantity: no returned items';
  end if;
  if p_replacement_items is null or jsonb_array_length(p_replacement_items) = 0 then
    raise exception 'invalid quantity: no replacement items';
  end if;

  -- Validate every product referenced (both sides) exists in this store,
  -- and lock rows, before writing anything.
  for v_item in select * from jsonb_array_elements(p_returned_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and store_id = p_store_id for update;
    if v_product.id is null then raise exception 'invalid quantity: unknown product'; end if;
  end loop;

  for v_item in select * from jsonb_array_elements(p_replacement_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and store_id = p_store_id for update;
    if v_product.id is null then raise exception 'invalid quantity: unknown product'; end if;
    if v_product.stock_qty < v_qty then
      raise exception 'insufficient inventory for %', coalesce(v_product.model, v_product.brand, v_product.id::text);
    end if;
  end loop;

  v_exchange_id := gen_random_uuid();
  insert into public.exchanges(
    id, store_id, sale_id, exchange_no, customer_id, returned_value, replacement_value,
    difference_amount, settlement_method, reason, idempotency_key, created_by
  ) values (
    v_exchange_id, p_store_id, p_sale_id, p_exchange_no, p_customer_id,
    coalesce(p_returned_value,0), coalesce(p_replacement_value,0), coalesce(p_difference_amount,0),
    p_settlement_method, p_reason, p_idempotency_key, auth.uid()
  );

  -- Returned side: restock via a fresh FIFO lot, same as record_return.
  for v_item in select * from jsonb_array_elements(p_returned_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_purchase_price := coalesce((v_item->>'purchase_price')::numeric, 0);

    insert into public.exchange_items(exchange_id, kind, product_id, quantity, unit_price, purchase_price)
    values (v_exchange_id, 'returned', (v_item->>'product_id')::uuid, v_qty, v_price, v_purchase_price);

    insert into public.stock_batches(store_id, product_id, qty, remaining_qty, purchase_price, source, ref)
    values (p_store_id, (v_item->>'product_id')::uuid, v_qty, v_qty, v_purchase_price, 'exchange_return', coalesce(p_exchange_no, p_idempotency_key));

    update public.products set stock_qty = stock_qty + v_qty
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id;

    insert into public.stock_movements(store_id, product_id, movement_type, quantity, reference, created_by)
    values (p_store_id, (v_item->>'product_id')::uuid, 'exchange_return', v_qty, coalesce(p_exchange_no, p_idempotency_key), auth.uid());
  end loop;

  -- Replacement side: consume FIFO oldest-first, same as atomic_complete_sale.
  for v_item in select * from jsonb_array_elements(p_replacement_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_remaining := v_qty;
    v_purchase_price := 0;

    for v_batch in
      select * from public.stock_batches
      where product_id = (v_item->>'product_id')::uuid and store_id = p_store_id and remaining_qty > 0
      order by created_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.remaining_qty);
      update public.stock_batches set remaining_qty = remaining_qty - v_take where id = v_batch.id;
      v_purchase_price := v_purchase_price + (v_take * coalesce(v_batch.purchase_price,0));
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      -- Batches ran short (pre-existing desync) — fall back to current cost,
      -- same graceful-degrade behaviour as atomic_complete_sale.
      select cost_price into v_purchase_price from public.products where id = (v_item->>'product_id')::uuid;
      v_purchase_price := coalesce(v_purchase_price,0) * v_qty;
    end if;

    insert into public.exchange_items(exchange_id, kind, product_id, quantity, unit_price, purchase_price)
    values (v_exchange_id, 'replacement', (v_item->>'product_id')::uuid, v_qty, v_price,
      case when v_qty > 0 then v_purchase_price / v_qty else 0 end);

    update public.products set stock_qty = stock_qty - v_qty
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id;

    insert into public.stock_movements(store_id, product_id, movement_type, quantity, reference, created_by)
    values (p_store_id, (v_item->>'product_id')::uuid, 'exchange_out', -v_qty, coalesce(p_exchange_no, p_idempotency_key), auth.uid());
  end loop;

  return v_exchange_id;
exception
  when unique_violation then
    select id into v_existing_id from public.exchanges
      where store_id = p_store_id and idempotency_key = p_idempotency_key limit 1;
    if v_existing_id is not null then return v_existing_id; end if;
    raise;
end;
$function$;

revoke execute on function public.record_exchange(uuid,uuid,text,uuid,jsonb,jsonb,numeric,numeric,numeric,text,text,text) from anon;

-- ---------------------------------------------------------------------
-- 3) WARRANTY CLAIMS — sale_items already carries warranty_enabled /
--    warranty_months / warranty_start / warranty_end (added in an earlier
--    migration) so per-item warranty windows are already normalized and
--    queryable. What's missing is a claims/lookup table: a searchable log
--    of "customer brought this item back for a warranty issue on <date>,
--    here's what happened" — separate from a Return (which restocks +
--    refunds) since a warranty claim is usually repair/replace and may
--    stay open for days.
-- ---------------------------------------------------------------------

create table if not exists public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  sale_item_id uuid references public.sale_items(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  claim_no text,
  issue_description text,
  status text not null default 'Open' check (status in ('Open','In Progress','Resolved','Rejected')),
  resolution text,
  idempotency_key text,
  resolved_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists warranty_claims_store_id_idx on public.warranty_claims(store_id);
create index if not exists warranty_claims_sale_id_idx on public.warranty_claims(sale_id);
create index if not exists warranty_claims_customer_id_idx on public.warranty_claims(customer_id);
create index if not exists warranty_claims_status_idx on public.warranty_claims(store_id, status);
create index if not exists warranty_claims_idempotency_idx on public.warranty_claims(store_id, idempotency_key) where idempotency_key is not null;

alter table public.warranty_claims enable row level security;

drop policy if exists "warranty_claims_owner_manager" on public.warranty_claims;
create policy "warranty_claims_owner_manager" on public.warranty_claims for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.store_id = warranty_claims.store_id and p.role in ('owner','manager')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.store_id = warranty_claims.store_id and p.role in ('owner','manager')));

-- Opens a new warranty claim. Called at claim-creation time.
create or replace function public.record_warranty_claim(
  p_store_id uuid,
  p_sale_id uuid,
  p_product_id uuid,
  p_customer_id uuid,
  p_claim_no text,
  p_issue_description text,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_id uuid;
  v_sale_item_id uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;

  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency key required';
  end if;

  select id into v_id from public.warranty_claims
    where store_id = p_store_id and idempotency_key = p_idempotency_key limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select id into v_sale_item_id from public.sale_items
    where sale_id = p_sale_id and product_id = p_product_id
    order by created_at asc limit 1;

  insert into public.warranty_claims(
    store_id, sale_id, sale_item_id, product_id, customer_id, claim_no,
    issue_description, status, idempotency_key, created_by
  ) values (
    p_store_id, p_sale_id, v_sale_item_id, p_product_id, p_customer_id, p_claim_no,
    p_issue_description, 'Open', p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    select id into v_id from public.warranty_claims
      where store_id = p_store_id and idempotency_key = p_idempotency_key limit 1;
    if v_id is not null then return v_id; end if;
    raise;
end;
$function$;

revoke execute on function public.record_warranty_claim(uuid,uuid,uuid,uuid,text,text,text) from anon;

-- Updates claim status/resolution (e.g. marking Resolved once the repair
-- or replacement is done). Owner/manager only, matching who can update
-- returns/sales directly.
create or replace function public.update_warranty_claim_status(
  p_store_id uuid,
  p_claim_id uuid,
  p_status text,
  p_resolution text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'not authorized';
  end if;
  if p_status not in ('Open','In Progress','Resolved','Rejected') then
    raise exception 'invalid status';
  end if;

  update public.warranty_claims
    set status = p_status,
        resolution = coalesce(p_resolution, resolution),
        resolved_at = case when p_status in ('Resolved','Rejected') then now() else resolved_at end
    where id = p_claim_id and store_id = p_store_id;

  return p_claim_id;
end;
$function$;

revoke execute on function public.update_warranty_claim_status(uuid,uuid,text,text) from anon;
