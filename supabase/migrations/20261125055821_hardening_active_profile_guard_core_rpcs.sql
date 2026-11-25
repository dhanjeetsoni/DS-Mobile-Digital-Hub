-- Enforce active profiles on core client RPCs, before existing store/role checks.
-- Owner access remains unchanged; staff and managers must be enabled and unexpired.
-- Keep existing signatures, grants, bodies, and transaction semantics.
DO $migration$
DECLARE r record; original text; patched text; n integer := 0;
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.proname IN (
      'atomic_complete_sale','atomic_complete_purchase','atomic_apply_stock_adjustment',
      'record_return','record_exchange','resolve_product_for_sale','reserve_invoice_number',
      'load_store_state_for_user','save_store_state_for_user','save_store_state','upsert_product_catalog',
      'set_product_review_status')
  LOOP
    original := pg_get_functiondef(r.oid);
    patched := regexp_replace(original, E'\\nbegin\\n', E'\nbegin\n  -- hardening_active_profile_guard\n  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id = auth.uid() AND (caller.role = ''owner'' OR (caller.role IN (''staff'', ''manager'') AND caller.access_enabled IS TRUE AND (caller.access_mode = ''no_restriction'' OR caller.access_expires_at > now())))) THEN\n    RAISE EXCEPTION ''not authorized: account disabled or expired'';\n  END IF;\n', 'i');
    IF patched = original THEN RAISE EXCEPTION 'Cannot locate function body for %', r.proname; END IF;
    EXECUTE patched;
    n := n + 1;
  END LOOP;
  IF n <> 12 THEN RAISE EXCEPTION 'Expected 12 core RPCs, found %', n; END IF;
END
$migration$;
