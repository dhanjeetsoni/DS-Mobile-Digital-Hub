-- EMERGENCY FIX: resolve_product_for_sale's insert had no dedup path when
-- sku was null/empty (the partial unique index only covers non-null skus),
-- so every call with a missing sku created a brand-new row, unconditionally.
-- Old (pre-fix) queued sale/stock-adjustment operations never carried a sku
-- at all, and the background queue flush retries them every ~15s — this
-- was silently minting a fresh garbage product row on every single retry
-- (observed live: ~20/minute, 1858 rows accumulated). Fail loudly instead
-- of ever inserting a row with no sku to dedupe against.
create or replace function public.resolve_product_for_sale(
  p_store_id uuid,
  p_local_id text,
  p_sku text,
  p_model text,
  p_brand text,
  p_category text,
  p_cost_price numeric,
  p_selling_price numeric,
  p_stock_qty numeric,
  p_min_stock numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_id uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;

  if p_local_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select id into v_id from public.products where id = p_local_id::uuid and store_id = p_store_id;
    if v_id is not null then return v_id; end if;
  end if;

  if p_sku is not null and trim(p_sku) <> '' then
    select id into v_id from public.products where store_id = p_store_id and sku = p_sku;
    if v_id is not null then return v_id; end if;

    insert into public.products(store_id, sku, barcode, brand, model, category, cost_price, selling_price, stock_qty, min_stock)
    values (p_store_id, trim(p_sku), null, p_brand, p_model, p_category, coalesce(p_cost_price,0), coalesce(p_selling_price,0), coalesce(p_stock_qty,0), coalesce(p_min_stock,0))
    on conflict (store_id, sku) where sku is not null and sku <> '' do update set model = excluded.model
    returning id into v_id;
    return v_id;
  end if;

  -- No sku and no already-real id to fall back on — this is stale data
  -- from before products carried a sku with every sale. Refuse instead of
  -- minting an untraceable duplicate row.
  raise exception 'invalid quantity: product missing sku, cannot resolve safely (stale offline record)';
end;
$$;
