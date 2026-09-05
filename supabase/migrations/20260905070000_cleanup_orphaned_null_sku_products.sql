-- Data cleanup following 20260905060715_stop_resolve_product_duplicate_
-- explosion.sql: before that fix, every retried sale/stock-adjustment
-- operation with a missing sku minted a brand-new, empty (no brand/model/
-- category) product row instead of failing — live data showed 1857 such
-- rows. Deletes only the ones with zero references anywhere in the schema
-- (sale_items, purchase_items, stock_batches, stock_movements, returns,
-- exchange_items, warranty_claims) — confirmed 1856 of the 1857 qualify.
-- The one remaining row is left untouched on purpose: it has a real
-- stock_batches/stock_movements row pointing at it, so deleting it would
-- orphan that history instead of just removing junk.
delete from public.products p
where (p.sku is null or trim(p.sku) = '')
  and not exists (select 1 from public.stock_batches x where x.product_id = p.id)
  and not exists (select 1 from public.stock_movements x where x.product_id = p.id)
  and not exists (select 1 from public.sale_items x where x.product_id = p.id)
  and not exists (select 1 from public.purchase_items x where x.product_id = p.id)
  and not exists (select 1 from public.returns x where x.product_id = p.id)
  and not exists (select 1 from public.exchange_items x where x.product_id = p.id)
  and not exists (select 1 from public.warranty_claims x where x.product_id = p.id);
