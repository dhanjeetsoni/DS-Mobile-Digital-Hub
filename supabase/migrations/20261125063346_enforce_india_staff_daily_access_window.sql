-- Shop schedules are interpreted in India Standard Time (Asia/Kolkata).
-- Enforce the daily window in the database, not just in the browser.
CREATE OR REPLACE FUNCTION public.current_account_allowed() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pr public.profiles%ROWTYPE; pol public.staff_access_policies%ROWTYPE; clock_time time;
BEGIN
 SELECT * INTO pr FROM public.profiles WHERE id=auth.uid();
 IF pr.id IS NULL THEN RETURN false; END IF;
 IF pr.role='owner' THEN RETURN true; END IF;
 IF pr.role NOT IN ('staff','manager') OR pr.access_enabled IS NOT TRUE OR (pr.access_mode IS DISTINCT FROM 'no_restriction' AND (pr.access_expires_at IS NULL OR pr.access_expires_at<=now())) THEN RETURN false; END IF;
 IF pr.role='staff' THEN
  SELECT * INTO pol FROM public.staff_access_policies WHERE staff_profile_id=pr.id AND store_id=pr.store_id;
  IF pol.daily_start IS NOT NULL AND pol.daily_end IS NOT NULL THEN
   clock_time:=(now() AT TIME ZONE 'Asia/Kolkata')::time;
   IF pol.daily_start<pol.daily_end AND (clock_time<pol.daily_start OR clock_time>=pol.daily_end) THEN RETURN false; END IF;
   IF pol.daily_start>pol.daily_end AND (clock_time<pol.daily_start AND clock_time>=pol.daily_end) THEN RETURN false; END IF;
  END IF;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.current_account_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_account_allowed() TO authenticated;
-- Preserve existing shop/role checks; add the server schedule check before mutations.
DO $migration$
DECLARE r record; original text; patched text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.proname IN ('atomic_complete_sale','atomic_complete_sale_v2','atomic_complete_purchase','atomic_apply_stock_adjustment','record_return','record_exchange','resolve_product_for_sale','reserve_invoice_number','load_store_state_for_user','save_store_state_for_user','save_store_state','save_store_state_scoped','upsert_product_catalog','set_product_review_status','record_customer_payment','record_supplier_payment','upsert_customer','upsert_supplier','record_warranty_claim','update_warranty_claim_status_by_no','request_return_approval','approve_return_approval','set_product_photos','resolve_transaction_refs','verify_own_pin','change_my_pin','admin_reset_account_pin') LOOP
 original:=pg_get_functiondef(r.oid);
 patched:=regexp_replace(original,E'\\nbegin[ \\t]*\\n',E'\nbegin\n  IF NOT public.current_account_allowed() THEN RAISE EXCEPTION ''not authorized: account outside access window''; END IF;\n','i');
 IF original=patched THEN RAISE EXCEPTION 'Missing begin: %',r.proname; END IF;
 EXECUTE patched;
 END LOOP;
 FOR r IN SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='hardening_active_account' LOOP
 EXECUTE format('ALTER POLICY hardening_active_account ON public.%I USING ((SELECT public.current_account_allowed())) WITH CHECK ((SELECT public.current_account_allowed()))',r.tablename);
 END LOOP;
END $migration$;
