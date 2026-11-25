-- Server-only PIN verifier and revision marker. No hashes are returned to clients.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_revision uuid NOT NULL DEFAULT gen_random_uuid();
CREATE OR REPLACE FUNCTION public.rotate_pin_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash OR NEW.pin_salt IS DISTINCT FROM OLD.pin_salt THEN
   NEW.pin_revision := gen_random_uuid();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.rotate_pin_revision() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hardening_rotate_pin_revision BEFORE UPDATE OF pin_hash,pin_salt ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.rotate_pin_revision();

CREATE OR REPLACE FUNCTION public.get_own_pin_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF p.id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
 RETURN jsonb_build_object('hasPin',p.pin_hash IS NOT NULL,'revision',p.pin_revision,
   'lockedUntil',CASE WHEN p.pin_locked_until > now() THEN p.pin_locked_until ELSE NULL END,
   'failedAttempts',coalesce(p.pin_fail_count,0));
END $$;

CREATE OR REPLACE FUNCTION public.verify_own_pin(p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE; v_ok boolean := false; v_fail integer;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
 IF p.role <> 'owner' AND (p.access_enabled IS NOT TRUE OR (p.access_mode IS DISTINCT FROM 'no_restriction' AND (p.access_expires_at IS NULL OR p.access_expires_at <= now()))) THEN
   RAISE EXCEPTION 'not authorized';
 END IF;
 IF p.pin_hash IS NULL THEN RETURN jsonb_build_object('ok',false,'no_pin_set',true,'locked',false); END IF;
 IF p.pin_locked_until > now() THEN
   RETURN jsonb_build_object('ok',false,'locked',true,'lock_remaining_seconds',ceil(extract(epoch FROM (p.pin_locked_until-now())))::int);
 END IF;
 IF p_pin ~ '^[0-9]{4}$' THEN
   IF p.pin_hash ~ '^\$2[aby]\$' THEN
     v_ok := extensions.crypt(p_pin,p.pin_hash)=p.pin_hash;
   ELSIF p.pin_salt IS NOT NULL AND p.pin_hash ~ '^[a-f0-9]{64}$' THEN
     v_ok := encode(extensions.digest(p.pin_salt || p_pin,'sha256'),'hex')=p.pin_hash;
   END IF;
 END IF;
 IF v_ok IS TRUE THEN
   UPDATE public.profiles SET pin_fail_count=0,pin_locked_until=NULL WHERE id=p.id;
   RETURN jsonb_build_object('ok',true,'locked',false,'revision',p.pin_revision);
 END IF;
 v_fail := coalesce(p.pin_fail_count,0)+1;
 IF v_fail>=3 THEN
   UPDATE public.profiles SET pin_fail_count=0,pin_locked_until=now()+interval '2 minutes' WHERE id=p.id;
   RETURN jsonb_build_object('ok',false,'locked',true,'lock_remaining_seconds',120);
 END IF;
 UPDATE public.profiles SET pin_fail_count=v_fail,pin_locked_until=NULL WHERE id=p.id;
 RETURN jsonb_build_object('ok',false,'locked',false,'attempts_left',3-v_fail);
END $$;

CREATE OR REPLACE FUNCTION public.change_my_pin(p_new_pin text,p_current_pin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE; v_check jsonb; v_revision uuid;
BEGIN
 IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'PIN must be exactly 4 digits'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
 IF p.role <> 'owner' AND (p.access_enabled IS NOT TRUE OR (p.access_mode IS DISTINCT FROM 'no_restriction' AND (p.access_expires_at IS NULL OR p.access_expires_at <= now()))) THEN
   RAISE EXCEPTION 'not authorized';
 END IF;
 IF p.pin_hash IS NOT NULL THEN
   v_check := public.verify_own_pin(p_current_pin);
   IF coalesce((v_check->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_check; END IF;
 END IF;
 UPDATE public.profiles SET pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',10)),
   pin_salt=NULL,pin_fail_count=0,pin_locked_until=NULL WHERE id=p.id RETURNING pin_revision INTO v_revision;
 RETURN jsonb_build_object('ok',true,'revision',v_revision);
END $$;

CREATE OR REPLACE FUNCTION public.admin_reset_account_pin(p_target_id uuid,p_new_pin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
 IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'PIN must be exactly 4 digits'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF p.id IS NULL OR p.role NOT IN ('owner','manager') OR (p.role='manager' AND (p.access_enabled IS NOT TRUE OR (p.access_mode IS DISTINCT FROM 'no_restriction' AND (p.access_expires_at IS NULL OR p.access_expires_at <= now())))) THEN RAISE EXCEPTION 'not authorized'; END IF;
 UPDATE public.profiles SET pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',10)),pin_salt=NULL,pin_fail_count=0,pin_locked_until=NULL
 WHERE id=p_target_id AND store_id=p.store_id AND role IN ('staff','manager');
 IF NOT FOUND THEN RAISE EXCEPTION 'target not found in your store'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.change_my_pin(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_reset_account_pin(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.change_my_pin(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_account_pin(uuid,text) TO authenticated;
-- The obsolete one-argument setter bypassed current-PIN verification.
REVOKE EXECUTE ON FUNCTION public.set_own_pin(text) FROM PUBLIC,anon,authenticated;
