-- Phase 1 (data architecture fix): the client now subscribes directly to
-- `products` (stock reflects instantly on every device after a sale/
-- adjustment/purchase via the atomic RPCs) and `sales` (new-invoice
-- notice on other devices) instead of relying solely on the slower,
-- version-conflict-prone full store_state blob snapshot path.
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
