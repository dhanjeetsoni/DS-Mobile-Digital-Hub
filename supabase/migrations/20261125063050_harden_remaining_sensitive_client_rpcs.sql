-- Apply the active-account gate to remaining sensitive legacy client RPCs.
DO $migration$
DECLARE r record; orig text; patched text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('admin_clear_pin','admin_reset_pin','admin_reset_staff_pin','admin_force_logout_profile','approve_return_approval','request_return_approval','set_product_photos','upsert_staff_access_policy','update_warranty_claim_status','remind_warranty_claim_now','set_my_pin','set_ai_digest_enabled','save_gemini_api_key','publish_app_version','set_app_version_live') AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') LOOP
 orig:=pg_get_functiondef(r.oid);
 patched:=regexp_replace(orig,E'\\nbegin[ \\t]*\\n',E'\nbegin\n  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id=auth.uid() AND (caller.role=''owner'' OR (caller.role IN (''staff'',''manager'') AND caller.access_enabled IS TRUE AND (caller.access_mode=''no_restriction'' OR caller.access_expires_at>now())))) THEN RAISE EXCEPTION ''not authorized: account disabled or expired''; END IF;\n','i');
 IF patched=orig THEN RAISE EXCEPTION 'Missing body anchor for %',r.proname; END IF;
 EXECUTE patched;
 END LOOP;
END $migration$;
-- The current client uses the server-verified PIN APIs, not client-supplied hashes.
REVOKE EXECUTE ON FUNCTION public.set_my_pin(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reset_pin(uuid,text,text) FROM PUBLIC,anon,authenticated;
