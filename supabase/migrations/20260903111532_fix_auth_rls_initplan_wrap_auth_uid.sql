-- Wrap auth.uid() as (select auth.uid()) in each flagged policy so Postgres
-- evaluates it once per query instead of once per row.

ALTER POLICY audit_logs_owner_manager ON public.audit_logs
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = audit_logs.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY cpr_select_own_or_store_owner ON public.confidential_price_requests
  USING (
    (requested_by = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = confidential_price_requests.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text]))
  );

ALTER POLICY exchange_items_owner_manager ON public.exchange_items
  USING (EXISTS (SELECT 1 FROM exchanges e JOIN profiles p ON p.store_id = e.store_id WHERE e.id = exchange_items.exchange_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM exchanges e JOIN profiles p ON p.store_id = e.store_id WHERE e.id = exchange_items.exchange_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY exchanges_owner_manager ON public.exchanges
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = exchanges.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = exchanges.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY expenses_owner_manager ON public.expenses
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = expenses.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = expenses.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY ocr_scans_owner_manager_select ON public.ocr_scans
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = ocr_scans.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY personal_drawings_owner_manager ON public.personal_drawings
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = personal_drawings.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = personal_drawings.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY products_owner_manager_write ON public.products
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = products.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = products.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY profiles_owner_manager_select ON public.profiles
  USING (
    (id = (select auth.uid()))
    OR (store_id = current_profile_store_id() AND current_profile_role() = ANY (ARRAY['owner'::text,'manager'::text]))
  );

ALTER POLICY purchase_items_owner_manager ON public.purchase_items
  USING (EXISTS (SELECT 1 FROM purchases pu JOIN profiles p ON p.store_id = pu.store_id WHERE pu.id = purchase_items.purchase_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM purchases pu JOIN profiles p ON p.store_id = pu.store_id WHERE pu.id = purchase_items.purchase_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY purchases_owner_manager ON public.purchases
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = purchases.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = purchases.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY returns_owner_manager ON public.returns
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = returns.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = returns.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY sales_owner_manager_select ON public.sales
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = sales.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY sales_owner_manager_update ON public.sales
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = sales.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = sales.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY sales_store_write ON public.sales
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = sales.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text,'staff'::text])));

ALTER POLICY stock_batches_owner_manager ON public.stock_batches
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = stock_batches.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = stock_batches.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY stock_movements_owner_manager_select ON public.stock_movements
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = stock_movements.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY store_state_owner_manager_select ON public.store_state
  USING (store_id = my_store_id() AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY supplier_transactions_owner_manager ON public.supplier_transactions
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = supplier_transactions.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = supplier_transactions.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY telegram_outbox_owner_manager ON public.telegram_outbox
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = telegram_outbox.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = telegram_outbox.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

ALTER POLICY warranty_claims_owner_manager ON public.warranty_claims
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = warranty_claims.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = warranty_claims.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));
