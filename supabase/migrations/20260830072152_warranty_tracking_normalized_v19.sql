-- Warranty tracking -> normalized (Improvement #4)
-- Warranty used to live only inside Sale.items[] in the store_state JSON
-- blob. Since sale_items is already written atomically on every sale (see
-- atomic_complete_sale), we extend it with warranty columns instead of a
-- separate table — one searchable, indexed record per sold+warrantied item.

alter table public.sale_items
  add column if not exists warranty_enabled boolean not null default false,
  add column if not exists warranty_months numeric,
  add column if not exists warranty_start date,
  add column if not exists warranty_end date;

create index if not exists sale_items_warranty_end_idx
  on public.sale_items(warranty_end)
  where warranty_enabled = true;

-- Convenience view for a future lookup/reminder screen: every warrantied
-- line item joined with its sale + product, with day-count already computed.
create or replace view public.warranty_lookup as
select
  si.id as sale_item_id,
  s.store_id,
  s.id as sale_id,
  s.invoice_no,
  s.customer_name,
  s.customer_phone,
  si.product_id,
  p.brand,
  p.model,
  si.quantity,
  si.warranty_months,
  si.warranty_start,
  si.warranty_end,
  (si.warranty_end - current_date) as days_remaining,
  case
    when si.warranty_end is null then 'unknown'
    when si.warranty_end < current_date then 'expired'
    when si.warranty_end <= current_date + interval '30 days' then 'expiring_soon'
    else 'active'
  end as warranty_status
from public.sale_items si
join public.sales s on s.id = si.sale_id
left join public.products p on p.id = si.product_id
where si.warranty_enabled = true;

-- RLS on the view follows the underlying tables' RLS (security_invoker),
-- so store-scoped access rules already in place on sales/sale_items apply.
alter view public.warranty_lookup set (security_invoker = true);

-- Extend atomic_complete_sale to persist per-item warranty fields (start/end
-- are computed client-side at sale time, same as before this migration).
create or replace function public.atomic_complete_sale(p_store_id uuid, p_invoice_no text, p_customer_name text, p_customer_phone text, p_payment_method text, p_discount numeric, p_tax numeric, p_idempotency_key text, p_items jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text;
  v_sale_id uuid;
  v_existing_sale_id uuid;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_unit_price numeric;
  v_line_cost numeric;
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

  select id into v_existing_sale_id from public.sales where store_id = p_store_id and idempotency_key = p_idempotency_key;
  if v_existing_sale_id is not null then
    return v_existing_sale_id;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid quantity: no items';
  end if;

  if exists (select 1 from public.sales where store_id = p_store_id and invoice_no = p_invoice_no) then
    raise exception 'invoice number already exists';
  end if;

  v_sale_id := gen_random_uuid();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'selling price invalid'; end if;

    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id for update;
    if v_product.id is null then raise exception 'invalid quantity: unknown product'; end if;
    if v_product.stock_qty < v_qty then
      raise exception 'insufficient inventory for %', coalesce(v_product.model, v_product.brand, v_product.id::text);
    end if;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  end loop;

  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_tax,0));

  insert into public.sales(id, store_id, invoice_no, customer_name, customer_phone, payment_method, subtotal, discount, tax, total, status, idempotency_key, created_by)
  values (v_sale_id, p_store_id, p_invoice_no, p_customer_name, p_customer_phone, p_payment_method, v_subtotal, coalesce(p_discount,0), coalesce(p_tax,0), v_total, 'Paid', p_idempotency_key, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_remaining := v_qty;
    v_line_cost := 0;

    for v_batch in
      select * from public.stock_batches
      where product_id = (v_item->>'product_id')::uuid and store_id = p_store_id and remaining_qty > 0
      order by created_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.remaining_qty);
      update public.stock_batches set remaining_qty = remaining_qty - v_take where id = v_batch.id;
      v_line_cost := v_line_cost + (v_take * coalesce(v_batch.purchase_price,0));
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      select cost_price into v_line_cost from public.products where id = (v_item->>'product_id')::uuid;
      v_line_cost := coalesce(v_line_cost,0) * v_qty;
    end if;

    update public.products set stock_qty = stock_qty - v_qty
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id;

    insert into public.stock_movements(store_id, product_id, movement_type, quantity, reference, created_by)
    values (p_store_id, (v_item->>'product_id')::uuid, 'sale', -v_qty, p_invoice_no, auth.uid());

    insert into public.sale_items(sale_id, product_id, quantity, unit_price, cost_price, warranty_enabled, warranty_months, warranty_start, warranty_end)
    values (
      v_sale_id, (v_item->>'product_id')::uuid, v_qty, v_unit_price,
      case when v_qty > 0 then v_line_cost / v_qty else 0 end,
      coalesce((v_item->>'warranty_enabled')::boolean, false),
      nullif(v_item->>'warranty_months','')::numeric,
      nullif(v_item->>'warranty_start','')::date,
      nullif(v_item->>'warranty_end','')::date
    );
  end loop;

  insert into public.invoices(store_id, sale_id, invoice_no) values (p_store_id, v_sale_id, p_invoice_no);

  return v_sale_id;
exception
  when unique_violation then
    select id into v_existing_sale_id from public.sales where store_id = p_store_id and idempotency_key = p_idempotency_key;
    if v_existing_sale_id is not null then return v_existing_sale_id; end if;
    raise;
end;
$function$;
