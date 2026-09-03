-- Purchase UI -> normalized tables (Improvement #2)
-- Adds idempotency support to public.purchases and an atomic RPC
-- (mirrors atomic_complete_sale) that inserts a purchase + its line items,
-- restocks products, and opens a FIFO stock_batches lot in one transaction.

alter table public.purchases
  add column if not exists idempotency_key text;

create unique index if not exists purchases_store_idempotency_idx
  on public.purchases(store_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists stock_batches_product_remaining_idx
  on public.stock_batches(product_id, remaining_qty)
  where remaining_qty > 0;

create or replace function public.atomic_complete_purchase(
  p_store_id uuid,
  p_supplier text,
  p_supplier_id uuid,
  p_invoice_ref text,
  p_notes text,
  p_payment_status text,
  p_idempotency_key text,
  p_items jsonb -- [{product_id, quantity, purchase_price}]
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_purchase_id uuid;
  v_existing_id uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_price numeric;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;

  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency key required';
  end if;

  select id into v_existing_id from public.purchases
    where store_id = p_store_id and idempotency_key = p_idempotency_key;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid quantity: no items';
  end if;

  -- Validate every line before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'purchase_price')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid quantity';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'purchase price invalid';
    end if;

    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id for update;
    if v_product.id is null then
      raise exception 'invalid quantity: unknown product';
    end if;

    v_total := v_total + (v_qty * v_price);
  end loop;

  v_purchase_id := gen_random_uuid();

  insert into public.purchases(
    id, store_id, supplier, supplier_id, invoice_ref, notes, payment_status,
    total, created_by, idempotency_key
  ) values (
    v_purchase_id, p_store_id, nullif(trim(coalesce(p_supplier,'')), ''), p_supplier_id,
    nullif(trim(coalesce(p_invoice_ref,'')), ''), nullif(trim(coalesce(p_notes,'')), ''),
    p_payment_status, v_total, auth.uid(), p_idempotency_key
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'purchase_price')::numeric;

    insert into public.purchase_items(purchase_id, product_id, quantity, purchase_price)
    values (v_purchase_id, (v_item->>'product_id')::uuid, v_qty, v_price);

    -- New FIFO lot for this inward stock, consumed oldest-first on future sales.
    insert into public.stock_batches(store_id, product_id, qty, remaining_qty, purchase_price, source, ref)
    values (
      p_store_id, (v_item->>'product_id')::uuid, v_qty, v_qty, v_price,
      'purchase', coalesce(nullif(trim(coalesce(p_invoice_ref,'')), ''), v_purchase_id::text)
    );

    update public.products
      set stock_qty = stock_qty + v_qty, cost_price = v_price
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id;

    insert into public.stock_movements(store_id, product_id, movement_type, quantity, reference, created_by)
    values (p_store_id, (v_item->>'product_id')::uuid, 'purchase', v_qty, p_invoice_ref, auth.uid());
  end loop;

  return v_purchase_id;
exception
  when unique_violation then
    select id into v_existing_id from public.purchases
      where store_id = p_store_id and idempotency_key = p_idempotency_key;
    if v_existing_id is not null then return v_existing_id; end if;
    raise;
end;
$function$;

revoke all on function public.atomic_complete_purchase(uuid,text,uuid,text,text,text,text,jsonb) from public;
revoke execute on function public.atomic_complete_purchase(uuid,text,uuid,text,text,text,text,jsonb) from anon;
grant execute on function public.atomic_complete_purchase(uuid,text,uuid,text,text,text,text,jsonb) to authenticated;
