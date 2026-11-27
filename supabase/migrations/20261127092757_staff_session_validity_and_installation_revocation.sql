CREATE OR REPLACE FUNCTION public.current_account_allowed()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE pr public.profiles%ROWTYPE; pol public.staff_access_policies%ROWTYPE; clock_time time;
BEGIN
 SELECT * INTO pr FROM public.profiles WHERE id=auth.uid();
 IF pr.id IS NULL THEN RETURN false; END IF;
 IF pr.role='owner' THEN RETURN true; END IF;
 IF pr.role IN ('staff','manager') AND NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id::text=auth.jwt()->>'session_id' AND s.user_id=pr.id AND (s.not_after IS NULL OR s.not_after>now())) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM ds_device.staff_sessions d WHERE d.profile_id=pr.id AND d.store_id=pr.store_id AND d.session_id::text=auth.jwt()->>'session_id' AND (d.revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=d.session_id AND s.user_id=pr.id AND (s.not_after IS NULL OR s.not_after>now())))) THEN RETURN false; END IF;
 IF pr.force_logout_at IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id::text=(auth.jwt()->>'session_id') AND s.user_id=pr.id AND s.created_at>pr.force_logout_at AND (s.not_after IS NULL OR s.not_after>now())) THEN RETURN false; END IF;
 END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.revoke_staff_installation_sessions(p_installation_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();n integer;
begin
 if p_installation_id is null or length(btrim(p_installation_id)) not between 1 and 150 then raise exception 'invalid installation';end if;
 update ds_device.staff_sessions d set revoked_at=now(),revoked_by=auth.uid() where d.store_id=st and d.installation_id=btrim(p_installation_id) and d.revoked_at is null and exists(select 1 from public.profiles p where p.id=d.profile_id and p.store_id=st and p.role in ('staff','manager'));
 get diagnostics n=row_count;
 return n;
end $function$
;
revoke all on function public.revoke_staff_installation_sessions(text) from public,anon,authenticated;
grant execute on function public.revoke_staff_installation_sessions(text) to authenticated;
