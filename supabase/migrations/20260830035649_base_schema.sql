-- ============================================================================
-- DS Mobile & Digital Hub — consolidated base schema for the NEW Supabase
-- project. The original project's base schema was never captured in the
-- zip (only later incremental hardening patches were), so this file
-- reconstructs the full foundation directly in its final, hardened form
-- from the application's contracts (types.ts, repository.ts, staffAuth.ts,
-- the three edge functions, and the 9 patch migration files).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CORE TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Shop',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  store_id uuid references public.stores(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff')),
  staff_login_id text,
  staff_name text,
  access_enabled boolean not null default true,
  access_mode text not null default 'no_restriction' check (access_mode in ('no_restriction','full_day','timed')),
  access_expires_at timestamptz,
  access_granted_at timestamptz,
  visibility_from timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_staff_login_id_key
  on public.profiles (lower(staff_login_id))
  where staff_login_id is not null;

create table if not exists public.store_state (
  store_id uuid primary key references public.stores(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sku text,
  barcode text,
  brand text,
  model text,
  category text,
  cost_price numeric,
  selling_price numeric not null default 0,
  stock_qty numeric not null default 0,
  min_stock numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists products_store_id_idx on public.products(store_id);

create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric not null,
  remaining_qty numeric not null,
  purchase_price numeric,
  source text,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists stock_batches_product_id_idx on public.stock_batches(product_id);
create index if not exists stock_batches_store_id_idx on public.stock_batches(store_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  movement_type text not null,
  quantity numeric not null,
  reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  invoice_no text not null,
  customer_name text,
  customer_phone text,
  payment_method text,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'Paid' check (status in ('Paid','Partial','Due','Cancelled')),
  idempotency_key text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (store_id, invoice_no),
  unique (store_id, idempotency_key)
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  quantity numeric not null,
  unit_price numeric not null,
  cost_price numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete cascade,
  invoice_no text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  idempotency_key text not null,
  prefix text not null,
  invoice_no text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(store_id,idempotency_key),
  unique(store_id,invoice_no)
);

create table if not exists public.invoice_sequences (
  store_id uuid not null references public.stores(id) on delete cascade,
  prefix text not null,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(store_id,prefix)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier text,
  supplier_id uuid,
  invoice_ref text,
  notes text,
  payment_status text,
  total numeric not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  quantity numeric not null,
  purchase_price numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category text,
  description text,
  amount numeric not null default 0,
  method text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.personal_drawings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  description text,
  amount numeric not null default 0,
  method text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  quantity numeric,
  refund_amount numeric,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid,
  amount numeric not null default 0,
  type text,
  method text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ocr_scans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id),
  scan_type text,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pending_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id),
  payload jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.sync_queue (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  client_id text,
  device_id text,
  operation text,
  operation_id text not null,
  operation_type text,
  entity text,
  payload jsonb,
  status text not null default 'pending',
  retry_count int not null default 0,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  server_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, operation_id)
);

create table if not exists public.telegram_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  chat_id text,
  username text,
  first_name text,
  connected_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.telegram_connect_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  nonce text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  chat_id text not null,
  message text not null,
  status text not null default 'pending',
  attempts int not null default 0,
  sale_id uuid references public.sales(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  telegram_message_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists telegram_outbox_sale_id_key
  on public.telegram_outbox(sale_id) where sale_id is not null;

-- Indexes from the original production_hardening + telegram_and_sync_hardening patches
create index if not exists audit_logs_user_id_idx on public.audit_logs(user_id);
create index if not exists expenses_created_by_idx on public.expenses(created_by);
create index if not exists ocr_scans_store_id_idx on public.ocr_scans(store_id);
create index if not exists ocr_scans_user_id_idx on public.ocr_scans(user_id);
create index if not exists pending_orders_user_id_idx on public.pending_orders(user_id);
create index if not exists personal_drawings_created_by_idx on public.personal_drawings(created_by);
create index if not exists purchase_items_product_id_idx on public.purchase_items(product_id);
create index if not exists purchase_items_purchase_id_idx on public.purchase_items(purchase_id);
create index if not exists purchases_created_by_idx on public.purchases(created_by);
create index if not exists returns_created_by_idx on public.returns(created_by);
create index if not exists returns_product_id_idx on public.returns(product_id);
create index if not exists returns_sale_id_idx on public.returns(sale_id);
create index if not exists sale_items_product_id_idx on public.sale_items(product_id);
create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists sales_created_by_idx on public.sales(created_by);
create index if not exists stock_movements_created_by_idx on public.stock_movements(created_by);
create index if not exists store_state_updated_by_idx on public.store_state(updated_by);
create index if not exists supplier_transactions_created_by_idx on public.supplier_transactions(created_by);
create index if not exists telegram_connect_sessions_store_id_idx on public.telegram_connect_sessions(store_id);
create index if not exists telegram_connect_sessions_user_id_idx on public.telegram_connect_sessions(user_id);
create index if not exists telegram_outbox_store_id_idx on public.telegram_outbox(store_id);
create index if not exists invoice_reservations_store_prefix_idx on public.invoice_reservations(store_id,prefix,created_at);
create index if not exists sync_queue_store_status_created_idx on public.sync_queue(store_id,status,created_at);
