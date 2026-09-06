-- Phase 1 (Data architecture fix) — permanent client-id <-> real-row link.
alter table public.products add column if not exists client_id text;

create unique index if not exists products_store_client_id_uidx
  on public.products (store_id, client_id)
  where client_id is not null and client_id <> '';

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
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if p_local_id is not null and trim(p_local_id) <> '' then
    select id into v_id from public.products where store_id = p_store_id and client_id = p_local_id;
    if v_id is not null then return v_id; end if;
  end if;

  if p_sku is not null and trim(p_sku) <> '' then
    select id into v_id from public.products where store_id = p_store_id and sku = p_sku;
    if v_id is not null then
      if p_local_id is not null and trim(p_local_id) <> '' then
        update public.products set client_id = p_local_id
          where id = v_id and (client_id is null or client_id = '');
      end if;
      return v_id;
    end if;

    insert into public.products(store_id, sku, barcode, brand, model, category, cost_price, selling_price, stock_qty, min_stock, client_id)
    values (p_store_id, trim(p_sku), null, p_brand, p_model, p_category, coalesce(p_cost_price,0), coalesce(p_selling_price,0), coalesce(p_stock_qty,0), coalesce(p_min_stock,0), nullif(trim(coalesce(p_local_id,'')),''))
    on conflict (store_id, sku) where sku is not null and sku <> '' do update set model = excluded.model
    returning id into v_id;
    return v_id;
  end if;

  raise exception 'invalid quantity: product missing sku, cannot resolve safely (stale offline record)';
end;
$function$;
