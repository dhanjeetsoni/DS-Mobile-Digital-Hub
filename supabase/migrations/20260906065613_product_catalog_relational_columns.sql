-- Phase 1 (continued) — full catalog fields relationally, not just the
-- scalar transactional ones (sku/brand/model/category/prices/stock).
-- barcode already existed; everything else the Add/Edit Product forms
-- capture (photo, MRP, confidential price, warranty, notes, compatible
-- models, screen size, etc.) gets a real column here so it's queryable
-- and durable independent of the JSON store_state blob.
alter table public.products
  add column if not exists photo text,
  add column if not exists mrp numeric,
  add column if not exists confidential_price numeric,
  add column if not exists pending_cost boolean not null default false,
  add column if not exists warranty_enabled boolean not null default false,
  add column if not exists warranty_months integer not null default 0,
  add column if not exists require_customer_details boolean not null default false,
  add column if not exists supplier text,
  add column if not exists notes text,
  add column if not exists compatible_models jsonb not null default '[]'::jsonb,
  add column if not exists screen_size_inches numeric,
  add column if not exists screen_size_max_inches numeric,
  add column if not exists is_mobile_phone boolean not null default false,
  add column if not exists is_spare_part boolean not null default false,
  add column if not exists out_of_stock_since timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Full-catalog upsert, called by Add/Edit Product going forward (in
-- addition to resolve_product_for_sale, which still exists for the sale/
-- adjustment/purchase find-or-create path and only ever writes the
-- minimal scalar fields it has on hand). Owner/manager only — matches the
-- "staff cannot add or delete products" decision; editing is also kept to
-- owner/manager here since the in-app Edit Product screen is itself owner-
-- only today.
create or replace function public.upsert_product_catalog(
  p_store_id uuid,
  p_local_id text,
  p_sku text,
  p_name text,
  p_brand text,
  p_category text,
  p_barcode text,
  p_photo text,
  p_cost_price numeric,
  p_confidential_price numeric,
  p_selling_price numeric,
  p_mrp numeric,
  p_pending_cost boolean,
  p_min_stock numeric,
  p_warranty_enabled boolean,
  p_warranty_months integer,
  p_require_customer_details boolean,
  p_supplier text,
  p_notes text,
  p_compatible_models jsonb,
  p_screen_size_inches numeric,
  p_screen_size_max_inches numeric,
  p_is_mobile_phone boolean,
  p_is_spare_part boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_id uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'not authorized';
  end if;

  -- Same resolution order as resolve_product_for_sale: exact uuid, then
  -- client_id, then sku — so editing an already-resolved product (one
  -- that's been sold/adjusted before) updates the SAME row rather than
  -- creating a duplicate.
  if p_local_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select id into v_id from public.products where id = p_local_id::uuid and store_id = p_store_id;
  end if;
  if v_id is null and p_local_id is not null and trim(p_local_id) <> '' then
    select id into v_id from public.products where store_id = p_store_id and client_id = p_local_id;
  end if;
  if v_id is null and p_sku is not null and trim(p_sku) <> '' then
    select id into v_id from public.products where store_id = p_store_id and sku = p_sku;
  end if;

  if v_id is not null then
    update public.products set
      sku = coalesce(nullif(trim(coalesce(p_sku,'')),''), sku),
      brand = p_brand, model = p_name, category = p_category, barcode = p_barcode,
      photo = p_photo, cost_price = coalesce(p_cost_price,0), confidential_price = p_confidential_price,
      selling_price = coalesce(p_selling_price,0), mrp = p_mrp, pending_cost = coalesce(p_pending_cost,false),
      min_stock = coalesce(p_min_stock,0), warranty_enabled = coalesce(p_warranty_enabled,false),
      warranty_months = coalesce(p_warranty_months,0), require_customer_details = coalesce(p_require_customer_details,false),
      supplier = p_supplier, notes = p_notes, compatible_models = coalesce(p_compatible_models,'[]'::jsonb),
      screen_size_inches = p_screen_size_inches, screen_size_max_inches = p_screen_size_max_inches,
      is_mobile_phone = coalesce(p_is_mobile_phone,false), is_spare_part = coalesce(p_is_spare_part,false),
      client_id = coalesce(nullif(trim(coalesce(client_id,'')),''), nullif(trim(coalesce(p_local_id,'')),'')),
      updated_at = now()
    where id = v_id;
    return v_id;
  end if;

  insert into public.products(
    store_id, sku, barcode, brand, model, category, cost_price, confidential_price, selling_price, mrp,
    pending_cost, stock_qty, min_stock, warranty_enabled, warranty_months, require_customer_details,
    supplier, notes, compatible_models, screen_size_inches, screen_size_max_inches, is_mobile_phone,
    is_spare_part, photo, client_id
  ) values (
    p_store_id, nullif(trim(coalesce(p_sku,'')),''), p_barcode, p_brand, p_name, p_category,
    coalesce(p_cost_price,0), p_confidential_price, coalesce(p_selling_price,0), p_mrp,
    coalesce(p_pending_cost,false), 0, coalesce(p_min_stock,0), coalesce(p_warranty_enabled,false),
    coalesce(p_warranty_months,0), coalesce(p_require_customer_details,false), p_supplier, p_notes,
    coalesce(p_compatible_models,'[]'::jsonb), p_screen_size_inches, p_screen_size_max_inches,
    coalesce(p_is_mobile_phone,false), coalesce(p_is_spare_part,false), p_photo,
    nullif(trim(coalesce(p_local_id,'')),'')
  )
  on conflict (store_id, sku) where sku is not null and sku <> '' do update set
    brand = excluded.brand, model = excluded.model, category = excluded.category
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.upsert_product_catalog from public, anon;
grant execute on function public.upsert_product_catalog to authenticated;
