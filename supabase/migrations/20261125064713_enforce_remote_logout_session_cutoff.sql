-- Remote logout is enforced against the Auth session creation time, not
-- merely a timestamp observed by an already-running client.
DO $migration$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.current_account_allowed()'::regprocedure) INTO original;
 patched:=replace(original,'IF pr.role=''owner'' THEN RETURN true; END IF;',$body$IF pr.role='owner' THEN RETURN true; END IF;
 IF pr.force_logout_at IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id::text=(auth.jwt()->>'session_id') AND s.user_id=pr.id AND s.created_at>pr.force_logout_at AND (s.not_after IS NULL OR s.not_after>now())) THEN RETURN false; END IF;
 END IF;$body$);
 IF patched=original THEN RAISE EXCEPTION 'missing account guard anchor'; END IF;
 EXECUTE patched;
 SELECT pg_get_functiondef('public.admin_force_logout_profile(uuid)'::regprocedure) INTO original;
 patched:=replace(original,'t.role = ''staff''','t.role IN (''staff'',''manager'')');
 IF patched=original THEN RAISE EXCEPTION 'missing logout target anchor'; END IF;
 EXECUTE patched;
END $migration$;
CREATE OR REPLACE FUNCTION public.mark_profile_access_revoked() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.access_enabled IS TRUE AND NEW.access_enabled IS FALSE AND NEW.role IN ('staff','manager') THEN
  NEW.force_logout_at:=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mark_profile_access_revoked() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hardening_mark_access_revoked BEFORE UPDATE OF access_enabled ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.mark_profile_access_revoked();
