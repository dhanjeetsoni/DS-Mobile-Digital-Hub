-- Phase 19: Owner "Fast Stock Add" on DS Mobile + a Windows "Stock Review
-- Queue" to verify AI-filled details before the item becomes sellable.
--
-- New column: review_status. Defaults to 'live' for every existing row and
-- every existing write path (Windows's own Add New Item, staff's Phase
-- 17.3 Add Stock) -- nothing already in production changes behaviour.
-- Only the owner's new Fast Stock Add flow ever writes 'pending_review'.
--
-- Applied directly to production via the Supabase MCP on 2026-09-29 (first
-- attempt failed atomically -- Postgres treats a new parameter as a new
-- overload of upsert_product_catalog rather than a replacement, so the
-- unqualified GRANT afterward became ambiguous; the whole transaction
-- rolled back cleanly and was redone here with an explicit DROP FUNCTION
-- of the exact old signature first, and a fully-qualified GRANT on the new
-- one). Re-queried pg_proc afterward to confirm exactly one overload of
-- each function exists. This file mirrors the successful attempt so the
-- repo and live schema stay in sync.
alter table public.products
  add column if not exists review_status text not null default 'live';
alter table public.products
  add constraint products_review_status_check check (review_status in ('live','pending_review'));

-- Adding a new parameter changes this function's signature, so the old
-- 27-arg overload must be dropped explicitly first -- otherwise Postgres
-- keeps both as separate overloads (exactly the ambiguous-overload bug
-- migration 20260910081856 already had to fix once for this same
-- function).
drop function if exists public.upsert_product_catalog(
  uuid, text, text, text, text, text, text, text, numeric, numeric, numeric,
  numeric, boolean, numeric, boolean, integer, boolean, text, text, jsonb,
  numeric, numeric, boolean, boolean, numeric, jsonb, jsonb, jsonb
);

create function public.upsert_product_catalog(
  p_store_id uuid, p_local_id text, p_sku text, p_name text, p_brand text,
  p_category text, p_barcode text, p_photo text, p_cost_price numeric,
  p_confidential_price numeric, p_selling_price numeric, p_mrp numeric,
  p_pending_cost boolean, p_min_stock numeric, p_warranty_enabled boolean,
  p_warranty_months integer, p_require_customer_details boolean,
  p_supplier text, p_notes text, p_compatible_models jsonb,
  p_screen_size_inches numeric, p_screen_size_max_inches numeric,
  p_is_mobile_phone boolean, p_is_spare_part boolean,
  p_stock_qty numeric default 0, p_photos jsonb default null::jsonb,
  p_specifications jsonb default null::jsonb, p_feature_highlights jsonb default null::jsonb,
  p_review_status text default 'live'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_id uuid;
  v_is_staff boolean;
  v_review_status text;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;
  v_is_staff := (v_role = 'staff');
  v_review_status := case when (not v_is_staff) and p_review_status = 'pending_review' then 'pending_review' else 'live' end;

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
    is_spare_part, photo, photos, specifications, feature_highlights, client_id, review_status
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
    nullif(trim(coalesce(p_local_id,'')),''),
    v_review_status
  )
  on conflict (store_id, sku) where sku is not null and sku != '' do update set
    brand = excluded.brand, model = excluded.model, category = excluded.category
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.upsert_product_catalog(
  uuid, text, text, text, text, text, text, text, numeric, numeric, numeric,
  numeric, boolean, numeric, boolean, integer, boolean, text, text, jsonb,
  numeric, numeric, boolean, boolean, numeric, jsonb, jsonb, jsonb, text
) to authenticated;

-- Dedicated function for the Windows Stock Review Queue's two actions.
-- Owner/manager only. Approve just flips the flag; reject deletes the row
-- outright (and only if it's still pending -- can never be used to delete
-- an already-verified/live product, even by accident).
create or replace function public.set_product_review_status(p_store_id uuid, p_product_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'not authorized';
  end if;
  if p_approve then
    update public.products set review_status = 'live', updated_at = now()
      where id = p_product_id and store_id = p_store_id and review_status = 'pending_review';
  else
    delete from public.products
      where id = p_product_id and store_id = p_store_id and review_status = 'pending_review';
  end if;
end;
$$;

grant execute on function public.set_product_review_status to authenticated;
