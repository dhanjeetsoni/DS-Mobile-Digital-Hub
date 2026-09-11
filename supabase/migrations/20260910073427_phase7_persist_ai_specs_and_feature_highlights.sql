-- 2026-09-10: closes migration drift — two migrations
-- (phase7_persist_ai_specs_and_feature_highlights,
-- phase7_staff_view_sync_photos_specs_highlights, applied live on Supabase
-- per `list_migrations`) were never saved as .sql files in this repo, same
-- class of gap the existing `close_drift_*`/`sync_drift_*` migrations in
-- this folder already exist to fix. This file reconstructs the resulting
-- schema state (idempotent — every statement is safe to run again even
-- though it's already live) so a fresh environment ends up with the same
-- structure, and so the repo's migration history actually reflects what's
-- running in production.
--
-- Deliberately does NOT touch upsert_product_catalog's signature — see the
-- separate fix_upsert_product_catalog_ambiguous_overload_v40 migration for
-- why re-adding parameters via CREATE OR REPLACE with a different
-- signature is exactly the mistake that needs to be avoided here (it
-- silently registers a second overload rather than truly replacing the
-- first, which is exactly what made every Add/Edit Product save fail
-- outright once this drift's own CREATE OR REPLACE landed live).

alter table public.products add column if not exists specifications jsonb;
alter table public.products add column if not exists feature_highlights jsonb;

alter table public.products_staff_view add column if not exists specifications jsonb;
alter table public.products_staff_view add column if not exists feature_highlights jsonb;

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
    id, store_id, client_id, sku, barcode, brand, model, category, mrp, selling_price,
    stock_qty, min_stock, photo, photos, specifications, feature_highlights,
    warranty_enabled, warranty_months,
    require_customer_details, supplier, notes, compatible_models,
    screen_size_inches, screen_size_max_inches, is_mobile_phone, is_spare_part,
    updated_at
  ) values (
    new.id, new.store_id, new.client_id, new.sku, new.barcode, new.brand, new.model, new.category, new.mrp, new.selling_price,
    new.stock_qty, new.min_stock, new.photo, new.photos, new.specifications, new.feature_highlights,
    new.warranty_enabled, new.warranty_months,
    new.require_customer_details, new.supplier, new.notes, new.compatible_models,
    new.screen_size_inches, new.screen_size_max_inches, new.is_mobile_phone, new.is_spare_part,
    now()
  )
  on conflict (id) do update set
    store_id = excluded.store_id, client_id = excluded.client_id, sku = excluded.sku,
    barcode = excluded.barcode, brand = excluded.brand, model = excluded.model, category = excluded.category,
    mrp = excluded.mrp, selling_price = excluded.selling_price, stock_qty = excluded.stock_qty, min_stock = excluded.min_stock,
    photo = excluded.photo, photos = excluded.photos,
    specifications = excluded.specifications, feature_highlights = excluded.feature_highlights,
    warranty_enabled = excluded.warranty_enabled, warranty_months = excluded.warranty_months,
    require_customer_details = excluded.require_customer_details, supplier = excluded.supplier,
    notes = excluded.notes, compatible_models = excluded.compatible_models,
    screen_size_inches = excluded.screen_size_inches, screen_size_max_inches = excluded.screen_size_max_inches,
    is_mobile_phone = excluded.is_mobile_phone, is_spare_part = excluded.is_spare_part,
    updated_at = now();
  return new;
end;
$$;

-- One-time backfill for the two new columns on the mirror, for any product
-- rows written between when the base table gained these columns and when
-- the trigger above started copying them across.
update public.products_staff_view v
set specifications = p.specifications, feature_highlights = p.feature_highlights
from public.products p
where p.id = v.id
  and (v.specifications is distinct from p.specifications
       or v.feature_highlights is distinct from p.feature_highlights);
