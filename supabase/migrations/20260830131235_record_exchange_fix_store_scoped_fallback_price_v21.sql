-- v21 bug fix: the FIFO-shortfall fallback price lookup inside
-- record_exchange() queried products by id only, without the store_id
-- filter every other query in this function uses. Harmless in practice
-- since product ids are globally unique uuids, but inconsistent with the
-- rest of the function's defense-in-depth store scoping — fixed to match.
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
      -- BUG FIX (v21): this lookup was missing "and store_id = p_store_id",
      -- inconsistent with every other query in this function.
      select cost_price into v_purchase_price from public.products
        where id = (v_item->>'product_id')::uuid and store_id = p_store_id;
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
