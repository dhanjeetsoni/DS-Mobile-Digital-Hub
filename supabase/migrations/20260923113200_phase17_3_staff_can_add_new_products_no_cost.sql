-- Phase 17.3 (DS Mobile Unified App §3): staff's fixed "Add Stock / Add
-- Product" screen needs to actually be able to call this RPC — it was
-- 'owner'/'manager' only. Widening the role check to include 'staff', but
-- structurally preventing a staff caller from ever setting or seeing a
-- real cost/confidential price, at the DB layer (not just hidden in the
-- UI) -- matching this app's existing "staff should not see profit,
-- margin, cost price, or expenses" principle (PROJECT_PLAN.md) and its
-- general pattern of enforcing that server-side, not just client-side.
--
-- For a staff caller:
--   * INSERT (brand-new product): cost_price forced to 0, confidential_price
--     forced to null, pending_cost forced to true -- regardless of whatever
--     the client sent (defense in depth even if the UI were bypassed).
--   * UPDATE (an existing product happened to match by id/client_id/sku --
--     practically near-impossible since sku is a random UUID fragment, but
--     guarded anyway): cost_price/confidential_price are left completely
--     UNTOUCHED rather than zeroed, so a staff call can never destroy an
--     owner-set cost price even in that edge case. Every other field
--     (selling price, stock, photos, etc.) behaves exactly as it already
--     does for owner/manager -- unchanged.
--
-- Applied directly to production via the Supabase MCP on 2026-09-23 (5
-- products existed live at the time, verified -- no data migration
-- needed, this is a pure function-body change); this file mirrors that
-- change so the repo and live schema stay in sync.
create or replace function public.upsert_product_catalog(
  p_store_id uuid, p_local_id text, p_sku text, p_name text, p_brand text,
  p_category text, p_barcode text, p_photo text, p_cost_price numeric,
  p_confidential_price numeric, p_selling_price numeric, p_mrp numeric,
  p_pending_cost boolean, p_min_stock numeric, p_warranty_enabled boolean,
  p_warranty_months integer, p_require_customer_details boolean,
  p_supplier text, p_notes text, p_compatible_models jsonb,
  p_screen_size_inches numeric, p_screen_size_max_inches numeric,
  p_is_mobile_phone boolean, p_is_spare_part boolean,
  p_stock_qty numeric default 0, p_photos jsonb default null::jsonb,
  p_specifications jsonb default null::jsonb, p_feature_highlights jsonb default null::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_id uuid;
  v_is_staff boolean;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;
  v_is_staff := (v_role = 'staff');

  if p_photos is not null and jsonb_typeof(p_photos) != 'array' then
    raise exception 'photos must be an array';
  end if;
  if p_specifications is not null and jsonb_typeof(p_specifications) != 'array' then
    raise exception 'specifications must be an array';
  end if;
  if p_feature_highlights is not null and jsonb_typeof(p_feature_highlights) != 'array' then
    raise exception 'feature_highlights must be an array';
  end if;

  if p_local_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select id into v_id from public.products where id = p_local_id::uuid and store_id = p_store_id;
  end if;
  if v_id is null and p_local_id is not null and trim(p_local_id) != '' then
    select id into v_id from public.products where store_id = p_store_id and client_id = p_local_id;
  end if;
  if v_id is null and p_sku is not null and trim(p_sku) != '' then
    select id into v_id from public.products where store_id = p_store_id and sku = p_sku;
  end if;

  if v_id is not null then
    update public.products set
      sku = coalesce(nullif(trim(coalesce(p_sku,'')),''), sku),
      brand = p_brand, model = p_name, category = p_category, barcode = p_barcode,
      photo = coalesce(nullif(p_photos->>0,''), p_photo),
      photos = coalesce(p_photos, photos),
      specifications = coalesce(p_specifications, specifications),
      feature_highlights = coalesce(p_feature_highlights, feature_highlights),
      cost_price = case when v_is_staff then cost_price else coalesce(p_cost_price,0) end,
      confidential_price = case when v_is_staff then confidential_price else p_confidential_price end,
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
    is_spare_part, photo, photos, specifications, feature_highlights, client_id
  ) values (
    p_store_id, nullif(trim(coalesce(p_sku,'')),''), p_barcode, p_brand, p_name, p_category,
    case when v_is_staff then 0 else coalesce(p_cost_price,0) end,
    case when v_is_staff then null else p_confidential_price end,
    coalesce(p_selling_price,0), p_mrp,
    case when v_is_staff then true else coalesce(p_pending_cost,false) end,
    coalesce(p_stock_qty,0), coalesce(p_min_stock,0), coalesce(p_warranty_enabled,false),
    coalesce(p_warranty_months,0), coalesce(p_require_customer_details,false), p_supplier, p_notes,
    coalesce(p_compatible_models,'[]'::jsonb), p_screen_size_inches, p_screen_size_max_inches,
    coalesce(p_is_mobile_phone,false), coalesce(p_is_spare_part,false),
    coalesce(nullif(p_photos->>0,''), p_photo),
    coalesce(p_photos, case when p_photo is not null and p_photo != '' then jsonb_build_array(p_photo) else '[]'::jsonb end),
    p_specifications, p_feature_highlights,
    nullif(trim(coalesce(p_local_id,'')),'')
  )
  on conflict (store_id, sku) where sku is not null and sku != '' do update set
    brand = excluded.brand, model = excluded.model, category = excluded.category
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.upsert_product_catalog to authenticated;
