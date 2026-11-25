-- Privileged client operations must respect the current session cutoff.
DO $migration$
DECLARE r record; orig text; patched text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p WHERE pronamespace='public'::regnamespace AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND proname IN ('admin_clear_pin','admin_force_logout_profile','admin_reset_staff_pin','get_ai_digest_enabled','get_customer_purchase_history','get_gemini_key_status','get_my_weekly_report_payload','get_product_price_history','get_staff_sales_performance','get_storage_usage_summary','list_app_versions','list_return_approval_requests','publish_app_version','remind_warranty_claim_now','save_gemini_api_key','set_ai_digest_enabled','set_app_version_live','update_warranty_claim_status','upsert_staff_access_policy') LOOP
 orig:=pg_get_functiondef(r.oid);
 patched:=regexp_replace(orig,E'\\mbegin\\M[ \\t]*\\n',E'begin\n  IF NOT public.current_account_allowed() THEN RAISE EXCEPTION ''not authorized: inactive session''; END IF;\n','i');
 IF patched=orig THEN RAISE EXCEPTION 'missing function anchor: %',r.proname; END IF;
 EXECUTE patched;
 END LOOP;
END $migration$;
CREATE OR REPLACE FUNCTION public.can_manage_store_profiles(p_store_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.current_account_allowed() AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.store_id=p_store_id AND p.role IN ('owner','manager'));
$$;
-- Background workers and cache writes are service-only.
REVOKE EXECUTE ON FUNCTION public.dispatch_due_warranty_reminders() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.record_gemini_key_usage(uuid,smallint,boolean,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_screen_size_cache(text,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_due_warranty_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_gemini_key_usage(uuid,smallint,boolean,text,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_screen_size_cache(text,text,numeric) TO service_role;
-- Global release administration is separate from ownership of a single shop.
CREATE SCHEMA IF NOT EXISTS ds_recovery;
REVOKE ALL ON SCHEMA ds_recovery FROM PUBLIC,anon,authenticated;
CREATE TABLE ds_recovery.release_admins(profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE);
ALTER TABLE ds_recovery.release_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ds_recovery.release_admins FROM PUBLIC,anon,authenticated;
DO $seed$ BEGIN
 IF (SELECT count(*) FROM public.profiles WHERE role='owner')=1 THEN
  INSERT INTO ds_recovery.release_admins SELECT id FROM public.profiles WHERE role='owner';
 ELSE RAISE EXCEPTION 'Release admin must be selected explicitly when multiple owners exist'; END IF;
END $seed$;
DO $migration$
DECLARE r record; orig text; patched text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname IN ('publish_app_version','set_app_version_live') LOOP
 orig:=pg_get_functiondef(r.oid);
 patched:=regexp_replace(orig,E'\\mbegin\\M[ \\t]*\\n',E'begin\n  IF NOT EXISTS(SELECT 1 FROM ds_recovery.release_admins WHERE profile_id=auth.uid()) THEN RAISE EXCEPTION ''not authorized: release administrator required''; END IF;\n','i');
 IF patched=orig THEN RAISE EXCEPTION 'missing release anchor'; END IF;
 EXECUTE patched;
 END LOOP;
END $migration$;
