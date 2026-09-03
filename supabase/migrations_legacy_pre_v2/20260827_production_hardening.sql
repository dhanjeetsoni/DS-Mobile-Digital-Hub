alter function public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,jsonb) security invoker;
alter function public.save_store_state(jsonb,bigint) security invoker;
create index if not exists audit_logs_user_id_idx on public.audit_logs(user_id);
create index if not exists expenses_created_by_idx on public.expenses(created_by);
create index if not exists ocr_scans_store_id_idx on public.ocr_scans(store_id);
create index if not exists ocr_scans_user_id_idx on public.ocr_scans(user_id);
create index if not exists pending_orders_user_id_idx on public.pending_orders(user_id);
create index if not exists personal_drawings_created_by_idx on public.personal_drawings(created_by);
create index if not exists purchase_items_product_id_idx on public.purchase_items(product_id);
create index if not exists purchase_items_purchase_id_idx on public.purchase_items(purchase_id);
create index if not exists purchases_created_by_idx on public.purchases(created_by);
create index if not exists returns_created_by_idx on public.returns(created_by);
create index if not exists returns_product_id_idx on public.returns(product_id);
create index if not exists returns_sale_id_idx on public.returns(sale_id);
create index if not exists sale_items_product_id_idx on public.sale_items(product_id);
create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists sales_created_by_idx on public.sales(created_by);
create index if not exists stock_movements_created_by_idx on public.stock_movements(created_by);
create index if not exists store_state_updated_by_idx on public.store_state(updated_by);
create index if not exists supplier_transactions_created_by_idx on public.supplier_transactions(created_by);
create index if not exists telegram_connect_sessions_store_id_idx on public.telegram_connect_sessions(store_id);
create index if not exists telegram_connect_sessions_user_id_idx on public.telegram_connect_sessions(user_id);
create index if not exists telegram_outbox_store_id_idx on public.telegram_outbox(store_id);
drop index if exists public.telegram_retry_idx;
revoke execute on function public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,jsonb) from anon;
revoke execute on function public.save_store_state(jsonb,bigint) from anon;


