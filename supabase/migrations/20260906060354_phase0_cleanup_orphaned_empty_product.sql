-- Phase 0 cleanup: remove the one orphaned/garbage product row (all fields
-- NULL — no sku, brand, model, category) along with its associated
-- stock_movements and stock_batches rows created at the same moment. This
-- product had zero sale_items referencing it, confirmed before deletion.
DELETE FROM stock_movements WHERE product_id = 'e28fcb03-5795-4e64-bcaf-c1fcf9eafe00';
DELETE FROM stock_batches WHERE product_id = 'e28fcb03-5795-4e64-bcaf-c1fcf9eafe00';
DELETE FROM products WHERE id = 'e28fcb03-5795-4e64-bcaf-c1fcf9eafe00';
