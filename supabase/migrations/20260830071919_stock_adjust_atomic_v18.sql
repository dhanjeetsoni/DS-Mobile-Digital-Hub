-- Inventory / Stock Adjust -> normalized tables (Improvement #3)
-- Manual corrections (damage, mismatch, recount) now also write to
-- stock_movements (audit trail) and consume/open stock_batches lots (FIFO),
-- atomically, mirroring atomic_complete_sale / atomic_complete_purchase.

alter table public.stock_movements
  add column if not exists idempotency_key text;

create unique index if not exists stock_movements_store_idempotency_idx
  on public.stock_movements(store_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.atomic_apply_stock_adjustment(
  p_store_id uuid,
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_movement_id uuid;
  v_existing_id uuid;
  v_product public.products%rowtype;
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

  select id into v_existing_id from public.stock_movements
    where store_id = p_store_id and idempotency_key = p_idempotency_key;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'invalid quantity: zero adjustment';
  end if;

  select * into v_product from public.products
    where id = p_product_id and store_id = p_store_id for update;
  if v_product.id is null then
    raise exception 'invalid quantity: unknown product';
  end if;

  if p_delta > 0 then
    -- Found extra / recount up: open a new FIFO lot at the product's last known cost.
    insert into public.stock_batches(store_id, product_id, qty, remaining_qty, purchase_price, source, ref)
    values (p_store_id, p_product_id, p_delta, p_delta, coalesce(v_product.cost_price, 0), 'adjustment', coalesce(p_reason, 'Stock Adjustment'));
  else
    -- Damage/loss/recount down: consume oldest lots first. If batches don't
    -- fully cover it (pre-existing desync), still apply the correction —
    -- an audit count overrides whatever the batches say.
    v_remaining := abs(p_delta);
    for v_batch in
      select * from public.stock_batches
      where product_id = p_product_id and store_id = p_store_id and remaining_qty > 0
      order by created_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.remaining_qty);
      update public.stock_batches set remaining_qty = remaining_qty - v_take where id = v_batch.id;
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  update public.products
    set stock_qty = greatest(0, stock_qty + p_delta)
    where id = p_product_id and store_id = p_store_id;

  v_movement_id := gen_random_uuid();
  insert into public.stock_movements(id, store_id, product_id, movement_type, quantity, reference, created_by, idempotency_key)
  values (v_movement_id, p_store_id, p_product_id, 'adjustment', p_delta, coalesce(p_reason, 'Stock Adjustment'), auth.uid(), p_idempotency_key);

  return v_movement_id;
exception
  when unique_violation then
    select id into v_existing_id from public.stock_movements
      where store_id = p_store_id and idempotency_key = p_idempotency_key;
    if v_existing_id is not null then return v_existing_id; end if;
    raise;
end;
$function$;

revoke all on function public.atomic_apply_stock_adjustment(uuid,uuid,numeric,text,text) from public;
revoke execute on function public.atomic_apply_stock_adjustment(uuid,uuid,numeric,text,text) from anon;
grant execute on function public.atomic_apply_stock_adjustment(uuid,uuid,numeric,text,text) to authenticated;
