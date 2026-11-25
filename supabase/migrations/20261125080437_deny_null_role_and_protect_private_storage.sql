-- NULL in a PL/pgSQL IF condition is not true: a missing shop membership
-- must explicitly fail rather than fall through a NOT IN role check.
DO $migration$
DECLARE r record; orig text; patched text; n int:=0;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p WHERE pronamespace='public'::regnamespace AND prosecdef AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND prosrc~*'if[[:space:]]+(v_role|v_caller_role)[[:space:]]+not in' LOOP
  orig:=pg_get_functiondef(r.oid);
  patched:=regexp_replace(orig,'if[[:space:]]+(v_role|v_caller_role)[[:space:]]+not in','if \1 is null or \1 not in','gi');
  IF orig=patched THEN RAISE EXCEPTION 'role guard anchor missing: %',r.proname; END IF;
  EXECUTE patched;n:=n+1;
 END LOOP;
 IF n<6 THEN RAISE EXCEPTION 'Expected multiple nullable role checks, found %',n; END IF;
END $migration$;
-- Public catalog photos remain publicly readable. Private KYC files require
-- current owner/manager authorization for reads or deletion; staff may upload.
CREATE POLICY hardening_storage_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING (bucket_id<>'kyc-photos' OR ((SELECT public.current_account_allowed()) AND public.can_manage_store_profiles((storage.foldername(name))[1]::uuid)));
CREATE POLICY hardening_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (bucket_id NOT IN ('kyc-photos','product-photos') OR (SELECT public.current_account_allowed()));
CREATE POLICY hardening_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (bucket_id NOT IN ('kyc-photos','product-photos') OR (SELECT public.current_account_allowed()))
 WITH CHECK (bucket_id NOT IN ('kyc-photos','product-photos') OR (SELECT public.current_account_allowed()));
CREATE POLICY hardening_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (bucket_id NOT IN ('kyc-photos','product-photos') OR ((SELECT public.current_account_allowed()) AND public.can_manage_store_profiles((storage.foldername(name))[1]::uuid)));
