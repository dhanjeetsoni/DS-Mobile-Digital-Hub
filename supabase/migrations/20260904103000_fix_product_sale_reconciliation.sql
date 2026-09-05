-- Root-cause fix: products created in the app only ever lived in the JSON
-- store_state blob (client-generated ids like "p_<uuid>"), but
-- atomic_complete_sale/atomic_complete_purchase require a REAL row in the
-- relational public.products table with a real uuid id. Since nothing ever
-- inserted into public.products, every sale failed with
-- "invalid input syntax for type uuid" and therefore never created an
-- invoice, so Telegram had nothing to send.
--
-- This adds an idempotent resolver: given either an already-real product
-- uuid (pass-through) or a local product's descriptive fields (sku etc.),
-- it finds-or-creates the matching row in public.products and returns its
-- real id, which the client then uses for the sale/purchase.

create unique index if not exists products_store_sku_uidx
  on public.products(store_id, sku)
  where sku is not null and sku <> '';

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

  -- Already a real relational product id (from a store where this fix has
  -- already run once for this item) — just confirm it belongs to this store.
  if p_local_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select id into v_id from public.products where id = p_local_id::uuid and store_id = p_store_id;
    if v_id is not null then return v_id; end if;
  end if;

  if p_sku is not null and trim(p_sku) <> '' then
    select id into v_id from public.products where store_id = p_store_id and sku = p_sku;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.products(store_id, sku, barcode, brand, model, category, cost_price, selling_price, stock_qty, min_stock)
  values (p_store_id, nullif(trim(coalesce(p_sku,'')),''), null, p_brand, p_model, p_category, coalesce(p_cost_price,0), coalesce(p_selling_price,0), coalesce(p_stock_qty,0), coalesce(p_min_stock,0))
  on conflict (store_id, sku) where sku is not null and sku <> '' do update set model = excluded.model
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.resolve_product_for_sale(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.resolve_product_for_sale(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric) to authenticated;
