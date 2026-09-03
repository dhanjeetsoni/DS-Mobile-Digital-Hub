create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  client_id text,
  name text not null,
  phone text,
  category text,
  address text,
  gstin text,
  opening_payable numeric not null default 0,
  repayment_frequency text,
  next_repayment_due_date date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists suppliers_store_id_idx on public.suppliers(store_id);
create unique index if not exists suppliers_store_name_uidx on public.suppliers(store_id, lower(name));

alter table public.supplier_transactions
  add constraint supplier_transactions_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers(id) on delete set null
  not valid;

alter table public.supplier_transactions validate constraint supplier_transactions_supplier_id_fkey;

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_store_select" on public.suppliers;
create policy "suppliers_store_select" on public.suppliers for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists "suppliers_store_insert" on public.suppliers;
create policy "suppliers_store_insert" on public.suppliers for insert to authenticated
  with check (store_id = public.my_store_id());

drop policy if exists "suppliers_store_update" on public.suppliers;
create policy "suppliers_store_update" on public.suppliers for update to authenticated
  using (store_id = public.my_store_id());

create or replace function public.upsert_supplier(
  p_store_id uuid,
  p_client_id text,
  p_name text,
  p_phone text default null,
  p_category text default null,
  p_address text default null,
  p_gstin text default null,
  p_opening_payable numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_store_id <> public.my_store_id() then
    raise exception 'store_mismatch';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'supplier_name_required';
  end if;

  select id into v_id from public.suppliers
    where store_id = p_store_id and lower(name) = lower(trim(p_name))
    limit 1;

  if v_id is null then
    insert into public.suppliers (store_id, client_id, name, phone, category, address, gstin, opening_payable, created_by)
    values (p_store_id, p_client_id, trim(p_name), p_phone, p_category, p_address, p_gstin, coalesce(p_opening_payable, 0), auth.uid())
    returning id into v_id;
  else
    update public.suppliers set
      phone = coalesce(nullif(p_phone, ''), phone),
      category = coalesce(nullif(p_category, ''), category),
      address = coalesce(nullif(p_address, ''), address),
      gstin = coalesce(nullif(p_gstin, ''), gstin)
    where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.record_supplier_payment(
  p_store_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_method text default null,
  p_invoice_ref text default null,
  p_notes text default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_store_id <> public.my_store_id() then
    raise exception 'store_mismatch';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
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
    p_store_id, p_supplier_id, p_amount, 'payment', p_method,
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

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  client_id text,
  name text not null,
  phone text,
  address text,
  email text,
  opening_due numeric not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists customers_store_id_idx on public.customers(store_id);
create unique index if not exists customers_store_phone_uidx on public.customers(store_id, phone) where phone is not null and phone <> '';

alter table public.customers enable row level security;

drop policy if exists "customers_store_select" on public.customers;
create policy "customers_store_select" on public.customers for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists "customers_store_insert" on public.customers;
create policy "customers_store_insert" on public.customers for insert to authenticated
  with check (store_id = public.my_store_id());

drop policy if exists "customers_store_update" on public.customers;
create policy "customers_store_update" on public.customers for update to authenticated
  using (store_id = public.my_store_id());

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric not null,
  method text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists customer_payments_store_id_idx on public.customer_payments(store_id);
create index if not exists customer_payments_customer_id_idx on public.customer_payments(customer_id);

alter table public.customer_payments enable row level security;

drop policy if exists "customer_payments_store_select" on public.customer_payments;
create policy "customer_payments_store_select" on public.customer_payments for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists "customer_payments_store_insert" on public.customer_payments;
create policy "customer_payments_store_insert" on public.customer_payments for insert to authenticated
  with check (store_id = public.my_store_id());

create or replace function public.upsert_customer(
  p_store_id uuid,
  p_client_id text,
  p_name text,
  p_phone text default null,
  p_address text default null,
  p_email text default null,
  p_opening_due numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_store_id <> public.my_store_id() then
    raise exception 'store_mismatch';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'customer_name_required';
  end if;

  if p_phone is not null and p_phone <> '' then
    select id into v_id from public.customers
      where store_id = p_store_id and phone = p_phone
      limit 1;
  end if;

  if v_id is null then
    insert into public.customers (store_id, client_id, name, phone, address, email, opening_due, created_by)
    values (p_store_id, p_client_id, trim(p_name), nullif(p_phone, ''), p_address, p_email, coalesce(p_opening_due, 0), auth.uid())
    returning id into v_id;
  else
    update public.customers set
      name = trim(p_name),
      address = coalesce(nullif(p_address, ''), address),
      email = coalesce(nullif(p_email, ''), email)
    where id = v_id;
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
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_store_id <> public.my_store_id() then
    raise exception 'store_mismatch';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
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
    p_store_id, p_customer_id, p_amount, p_method,
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
