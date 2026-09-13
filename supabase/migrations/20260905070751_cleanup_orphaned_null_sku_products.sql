delete from public.products p
where (p.sku is null or trim(p.sku) = '')
  and not exists (select 1 from public.stock_batches x where x.product_id = p.id)
  and not exists (select 1 from public.stock_movements x where x.product_id = p.id)
  and not exists (select 1 from public.sale_items x where x.product_id = p.id)
  and not exists (select 1 from public.purchase_items x where x.product_id = p.id)
  and not exists (select 1 from public.returns x where x.product_id = p.id)
  and not exists (select 1 from public.exchange_items x where x.product_id = p.id)
  and not exists (select 1 from public.warranty_claims x where x.product_id = p.id);
