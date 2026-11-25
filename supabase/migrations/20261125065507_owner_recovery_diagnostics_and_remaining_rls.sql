-- Apply active-session gate to remaining business tables.
CREATE POLICY hardening_active_account ON public.audit_logs AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.crash_reports AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.expenses AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.personal_drawings AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.ocr_scans AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.pending_orders AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.product_price_history AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.staff_access_policies AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.telegram_outbox AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.invoice_sequences AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.invoice_reservations AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
CREATE POLICY hardening_active_account ON public.stores AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()));
-- Customer history: a different customer with the same name must not match if a phone exists.
DO $migration$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.get_customer_purchase_history(uuid,uuid)'::regprocedure) INTO original;
 patched:=replace(original,$old$((v_phone is not null and trim(coalesce(s.customer_phone,''))=trim(v_phone)) or (v_name is not null and lower(trim(coalesce(s.customer_name,'')))=lower(trim(v_name))))$old$,$new$((nullif(trim(v_phone),'') is not null and trim(coalesce(s.customer_phone,''))=trim(v_phone)) or (nullif(trim(v_phone),'') is null and nullif(trim(coalesce(s.customer_phone,'')),'') is null and nullif(trim(v_name),'') is not null and lower(trim(coalesce(s.customer_name,'')))=lower(trim(v_name))))$new$);
 IF patched=original THEN RAISE EXCEPTION 'history match anchor missing'; END IF;
 patched:=replace(patched,'''product_name'',coalesce(nullif(trim(coalesce(p.brand,'''')||'' ''||coalesce(p.model,'''')),''''),''Item'')','''product_name'',coalesce(si.service_name,nullif(trim(coalesce(p.brand,'''')||'' ''||coalesce(p.model,'''')),''''),''Item'')');
 EXECUTE patched;
 SELECT pg_get_functiondef('public.get_staff_performance(uuid,date,date)'::regprocedure) INTO original;
 patched:=replace(original,'where p.store_id = p_store_id','where public.current_account_allowed() AND p.store_id = p_store_id');
 IF patched=original THEN RAISE EXCEPTION 'staff performance anchor missing'; END IF;
 EXECUTE patched;
END $migration$;
-- Owner-only health dashboard; returns aggregate metadata, never backup contents.
CREATE OR REPLACE FUNCTION public.get_shop_recovery_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE shop uuid; latest jsonb;
BEGIN
 SELECT store_id INTO shop FROM public.profiles WHERE id=auth.uid() AND role='owner';
 IF shop IS NULL OR NOT public.current_account_allowed() THEN RAISE EXCEPTION 'owner required'; END IF;
 SELECT jsonb_build_object('id',id,'createdAt',created_at,'verified',sha256=encode(extensions.digest(payload::text,'sha256'),'hex')) INTO latest FROM ds_recovery.business_backups WHERE store_id=shop ORDER BY created_at DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('backup',latest,
 'fifoMismatches',(SELECT count(*) FROM public.products p WHERE p.store_id=shop AND p.stock_qty<>coalesce((SELECT sum(b.remaining_qty) FROM public.stock_batches b WHERE b.product_id=p.id AND b.store_id=shop),0)),
 'unknownCostLines',(SELECT count(*) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.store_id=shop AND i.cost_price IS NULL),
 'pendingOperations',(SELECT count(*) FROM public.sync_queue WHERE store_id=shop AND status IN ('pending','failed','syncing')),
 'abandonedOperations',(SELECT count(*) FROM public.sync_queue WHERE store_id=shop AND status='abandoned'),
 'pendingMessages',(SELECT count(*) FROM public.telegram_outbox WHERE store_id=shop AND status IN ('pending','sending','failed')));
END $$;
CREATE OR REPLACE FUNCTION public.create_shop_checkpoint() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE shop uuid; b uuid;
BEGIN
 SELECT store_id INTO shop FROM public.profiles WHERE id=auth.uid() AND role='owner';
 IF shop IS NULL OR NOT public.current_account_allowed() THEN RAISE EXCEPTION 'owner required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(shop::text||':checkpoint',0));
 SELECT id INTO b FROM ds_recovery.business_backups WHERE store_id=shop AND created_at>=now()-interval '30 minutes' ORDER BY created_at DESC LIMIT 1;
 IF b IS NULL THEN b:=ds_recovery.capture_business(shop,'owner checkpoint'); END IF;
 RETURN ds_recovery.verify_business_backup(b);
END $$;
REVOKE ALL ON FUNCTION public.get_shop_recovery_status(),public.create_shop_checkpoint() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shop_recovery_status(),public.create_shop_checkpoint() TO authenticated;
