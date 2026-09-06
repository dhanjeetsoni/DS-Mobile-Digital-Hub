-- Phase 1 (continued) — fix a real bug found while deep-verifying the
-- previous session's work per PROJECT_PLAN.md's ground rule ("never accept
-- an already-marked-complete step at face value").
--
-- upsert_product_catalog()'s INSERT branch (brand-new product, first save)
-- hardcoded stock_qty to 0, ignoring whatever opening stock the owner
-- actually typed into the Add Product form. Since Phase 1's earlier work
-- made relational stock_qty the live, authoritative number every screen
-- reads via stockOf() (not the JSON blob), every newly-added product would
-- have shown 0 stock everywhere — including on the very device that just
-- added it — until some unrelated sale/adjustment/purchase happened to
-- touch that product and correct it via resolve_product_for_sale (which
-- already accepts and correctly uses a real p_stock_qty).
--
-- Fix: add the same p_stock_qty parameter here, used ONLY in the INSERT
-- values list — never added to the UPDATE branch's SET list, so editing an
-- already-existing product still can never touch stock_qty through this
-- function. Stock changes for existing products remain exclusively the job
-- of resolve_product_for_sale / stock adjustment / purchase paths, per
-- Phase 1's original design.
--
-- Adding a new parameter makes Postgres register this as a distinct
-- overload rather than truly replacing the old one, so the old 24-arg
-- signature is dropped explicitly first (confirmed live: only one
-- overload — the new 25-arg one — exists after this runs).
drop function if exists public.upsert_product_catalog(uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,boolean,numeric,boolean,integer,boolean,text,text,jsonb,numeric,numeric,boolean,boolean);

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
  p_is_spare_part boolean,
  p_stock_qty numeric default 0
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
    -- Existing row: catalog fields only. stock_qty is deliberately absent
    -- from this SET list — it must stay exclusively under
    -- resolve_product_for_sale/adjustment/purchase control, or two devices
    -- editing catalog details and completing a sale at the same moment
    -- could clobber a real, concurrently-updated stock count.
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

  -- Brand-new product: this is the ONLY path that ever sets stock_qty from
  -- this function, and only once, at creation — using the real opening
  -- stock the owner entered, not a hardcoded 0.
  insert into public.products(
    store_id, sku, barcode, brand, model, category, cost_price, confidential_price, selling_price, mrp,
    pending_cost, stock_qty, min_stock, warranty_enabled, warranty_months, require_customer_details,
    supplier, notes, compatible_models, screen_size_inches, screen_size_max_inches, is_mobile_phone,
    is_spare_part, photo, client_id
  ) values (
    p_store_id, nullif(trim(coalesce(p_sku,'')),''), p_barcode, p_brand, p_name, p_category,
    coalesce(p_cost_price,0), p_confidential_price, coalesce(p_selling_price,0), p_mrp,
    coalesce(p_pending_cost,false), coalesce(p_stock_qty,0), coalesce(p_min_stock,0), coalesce(p_warranty_enabled,false),
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

revoke all on function public.upsert_product_catalog(uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,boolean,numeric,boolean,integer,boolean,text,text,jsonb,numeric,numeric,boolean,boolean,numeric) from public, anon;
grant execute on function public.upsert_product_catalog(uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,boolean,numeric,boolean,integer,boolean,text,text,jsonb,numeric,numeric,boolean,boolean,numeric) to authenticated;
