-- The local app only has a client-generated id ("sup_xxx"/"cust_xxx") for a
-- supplier/customer, not the server uuid, when it queues a PAYMENT (as
-- opposed to the upsert call, which returns the real uuid but the caller
-- doesn't wait for/store it back locally yet). Without this, a payment
-- queued right after creating a brand-new supplier/customer would have no
-- way to resolve p_..._id and would insert with a null link.
--
-- Fix: accept an optional name and resolve/create via the same
-- find-or-create-by-name lookup used by upsert_supplier/upsert_customer
-- whenever the id wasn't resolvable client-side.

create or replace function public.record_supplier_payment(
  p_store_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_method text default null,
  p_invoice_ref text default null,
  p_notes text default null,
  p_idempotency_key text default null,
  p_supplier_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_supplier_id uuid := p_supplier_id;
begin
  if p_store_id <> public.my_store_id() then
    raise exception 'store_mismatch';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if v_supplier_id is null and p_supplier_name is not null and trim(p_supplier_name) <> '' then
    v_supplier_id := public.upsert_supplier(p_store_id, null, p_supplier_name);
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.supplier_transactions
      where store_id = p_store_id and notes = ('idem:' || p_idempotency_key)
      limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.supplier_transactions (store_id, supplier_id, amount, type, method, notes, created_by)
  values (
    p_store_id, v_supplier_id, p_amount, 'payment', p_method,
    case when p_idempotency_key is not null then 'idem:' || p_idempotency_key
         else coalesce(p_notes, '') end,
    auth.uid()
  )
  returning id into v_id;

  if p_idempotency_key is not null and p_notes is not null and p_notes <> '' then
    update public.supplier_transactions set notes = notes || ' | ' || p_notes where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.record_customer_payment(
  p_store_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_customer_name text default null,
  p_customer_phone text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_customer_id uuid := p_customer_id;
begin
  if p_store_id <> public.my_store_id() then
    raise exception 'store_mismatch';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if v_customer_id is null and p_customer_name is not null and trim(p_customer_name) <> '' then
    v_customer_id := public.upsert_customer(p_store_id, null, p_customer_name, p_customer_phone);
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.customer_payments
      where store_id = p_store_id and note = ('idem:' || p_idempotency_key)
      limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.customer_payments (store_id, customer_id, amount, method, note, created_by)
  values (
    p_store_id, v_customer_id, p_amount, p_method,
    case when p_idempotency_key is not null then 'idem:' || p_idempotency_key
         else coalesce(p_note, '') end,
    auth.uid()
  )
  returning id into v_id;

  if p_idempotency_key is not null and p_note is not null and p_note <> '' then
    update public.customer_payments set note = note || ' | ' || p_note where id = v_id;
  end if;

  return v_id;
end;
$$;
