-- 2026-09-06: closing the "selling_price still JSON-blob-only on the read
-- side" gap flagged in PROJECT_PLAN.md's JSON-vs-relational status table.
-- selling_price was already relational (upsert_product_catalog writes it on
-- both INSERT and UPDATE, confirmed via pg_proc) but never made it into
-- LIVE_CATALOG_COLUMNS / products_staff_view, so every device still only
-- ever saw it via the slower/staler store_state blob. Non-confidential (it's
-- the customer-facing price shown on every screen, staff included) — same
-- safety class as every other column already in this mirror.

alter table public.products_staff_view add column if not exists selling_price numeric;

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
    stock_qty, min_stock, photo, warranty_enabled, warranty_months,
    require_customer_details, supplier, notes, compatible_models,
    screen_size_inches, screen_size_max_inches, is_mobile_phone, is_spare_part,
    updated_at
  ) values (
    new.id, new.store_id, new.client_id, new.sku, new.barcode, new.brand, new.model, new.category, new.mrp, new.selling_price,
    new.stock_qty, new.min_stock, new.photo, new.warranty_enabled, new.warranty_months,
    new.require_customer_details, new.supplier, new.notes, new.compatible_models,
    new.screen_size_inches, new.screen_size_max_inches, new.is_mobile_phone, new.is_spare_part,
    now()
  )
  on conflict (id) do update set
    store_id = excluded.store_id, client_id = excluded.client_id, sku = excluded.sku,
    barcode = excluded.barcode, brand = excluded.brand, model = excluded.model, category = excluded.category,
    mrp = excluded.mrp, selling_price = excluded.selling_price, stock_qty = excluded.stock_qty, min_stock = excluded.min_stock, photo = excluded.photo,
    warranty_enabled = excluded.warranty_enabled, warranty_months = excluded.warranty_months,
    require_customer_details = excluded.require_customer_details, supplier = excluded.supplier,
    notes = excluded.notes, compatible_models = excluded.compatible_models,
    screen_size_inches = excluded.screen_size_inches, screen_size_max_inches = excluded.screen_size_max_inches,
    is_mobile_phone = excluded.is_mobile_phone, is_spare_part = excluded.is_spare_part,
    updated_at = now();
  return new;
end;
$$;

-- Backfill selling_price for every existing row (trigger only fires on
-- future writes; existing mirror rows need a one-time catch-up).
update public.products_staff_view v
set selling_price = p.selling_price
from public.products p
where p.id = v.id and v.selling_price is distinct from p.selling_price;
