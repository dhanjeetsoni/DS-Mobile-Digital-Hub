-- 2026-09-06: found while verifying the Phase 1 relational-stock migration
-- against staff sessions. fetchLiveStock/subscribeToLiveStock and
-- fetchLiveCatalog/subscribeToLiveCatalog (src/services/repository.ts) were
-- wired unconditionally for every role, but they query the `products` table
-- directly -- which has only ONE RLS policy (products_owner_manager_write,
-- owner/manager only). For a staff session every one of those reads/
-- subscriptions silently fails RLS (caught, logged, "falling back to blob
-- stock") and Realtime never delivers postgres_changes for a table the
-- subscriber can't SELECT -- so staff devices got NONE of the Phase 1
-- instant-stock benefit and stayed on the slower/staler store_state blob
-- the whole migration was written to move away from.
--
-- Same pattern already used for `store_state_staff_view`: a physical mirror
-- table (not a SQL view -- logical replication/Realtime needs a real table)
-- holding only the non-confidential columns the existing client code
-- already restricts itself to (fetchLiveStock: id+stock_qty only;
-- fetchLiveCatalog: LIVE_CATALOG_COLUMNS, explicitly excluding cost_price/
-- confidential_price already). A trigger keeps it in lockstep with
-- `products` on every insert/update/delete; RLS lets ANY authenticated
-- store member (owner, manager, or staff) read it, since it never carries
-- a confidential field to begin with.

create table if not exists public.products_staff_view (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  client_id text,
  sku text,
  barcode text,
  brand text,
  model text,
  category text,
  mrp numeric,
  stock_qty numeric,
  min_stock numeric,
  photo text,
  warranty_enabled boolean,
  warranty_months integer,
  require_customer_details boolean,
  supplier text,
  notes text,
  compatible_models jsonb,
  screen_size_inches numeric,
  screen_size_max_inches numeric,
  is_mobile_phone boolean,
  is_spare_part boolean,
  updated_at timestamptz not null default now()
);

create index if not exists products_staff_view_store_idx on public.products_staff_view(store_id);

alter table public.products_staff_view enable row level security;

drop policy if exists products_staff_view_select on public.products_staff_view;
create policy products_staff_view_select on public.products_staff_view
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = products_staff_view.store_id
    )
  );

create or replace function public.sync_products_staff_view()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.products_staff_view where id = old.id;
    return old;
  end if;

  insert into public.products_staff_view (
    id, store_id, client_id, sku, barcode, brand, model, category, mrp,
    stock_qty, min_stock, photo, warranty_enabled, warranty_months,
    require_customer_details, supplier, notes, compatible_models,
    screen_size_inches, screen_size_max_inches, is_mobile_phone, is_spare_part,
    updated_at
  ) values (
    new.id, new.store_id, new.client_id, new.sku, new.barcode, new.brand, new.model, new.category, new.mrp,
    new.stock_qty, new.min_stock, new.photo, new.warranty_enabled, new.warranty_months,
    new.require_customer_details, new.supplier, new.notes, new.compatible_models,
    new.screen_size_inches, new.screen_size_max_inches, new.is_mobile_phone, new.is_spare_part,
    now()
  )
  on conflict (id) do update set
    store_id = excluded.store_id, client_id = excluded.client_id, sku = excluded.sku,
    barcode = excluded.barcode, brand = excluded.brand, model = excluded.model, category = excluded.category,
    mrp = excluded.mrp, stock_qty = excluded.stock_qty, min_stock = excluded.min_stock, photo = excluded.photo,
    warranty_enabled = excluded.warranty_enabled, warranty_months = excluded.warranty_months,
    require_customer_details = excluded.require_customer_details, supplier = excluded.supplier,
    notes = excluded.notes, compatible_models = excluded.compatible_models,
    screen_size_inches = excluded.screen_size_inches, screen_size_max_inches = excluded.screen_size_max_inches,
    is_mobile_phone = excluded.is_mobile_phone, is_spare_part = excluded.is_spare_part,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_staff_view_sync on public.products;
create trigger products_staff_view_sync
  after insert or update or delete on public.products
  for each row execute function public.sync_products_staff_view();

-- One-time backfill for every existing product row.
insert into public.products_staff_view (
  id, store_id, client_id, sku, barcode, brand, model, category, mrp,
  stock_qty, min_stock, photo, warranty_enabled, warranty_months,
  require_customer_details, supplier, notes, compatible_models,
  screen_size_inches, screen_size_max_inches, is_mobile_phone, is_spare_part, updated_at
)
select
  id, store_id, client_id, sku, barcode, brand, model, category, mrp,
  stock_qty, min_stock, photo, warranty_enabled, warranty_months,
  require_customer_details, supplier, notes, compatible_models,
  screen_size_inches, screen_size_max_inches, is_mobile_phone, is_spare_part, now()
from public.products
on conflict (id) do nothing;

alter publication supabase_realtime add table public.products_staff_view;
