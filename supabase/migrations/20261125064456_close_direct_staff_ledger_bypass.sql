-- A staff sale must go through the atomic, price-checked RPC, not direct ledger insertion.
CREATE POLICY staff_sales_atomic_only ON public.sales AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.can_manage_store_profiles(store_id));
CREATE POLICY staff_sale_items_atomic_only ON public.sale_items AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale_id AND public.can_manage_store_profiles(s.store_id)));
CREATE POLICY staff_customer_payments_rpc_only ON public.customer_payments AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.can_manage_store_profiles(store_id));
-- Extra sensitive tables were not included in the original core-table gate.
CREATE POLICY hardening_active_account ON public.confidential_price_requests AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.return_approval_requests AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.exchange_items AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
