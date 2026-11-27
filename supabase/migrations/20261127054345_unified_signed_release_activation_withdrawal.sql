alter table public.app_versions add column first_live_at timestamptz;
update public.app_versions set first_live_at=created_at where is_live;
create unique index app_versions_platform_build_unique on public.app_versions(platform,build_number);
CREATE OR REPLACE FUNCTION public.publish_app_version(p_platform text, p_version text, p_build_number integer, p_download_path text, p_signature text DEFAULT NULL::text, p_release_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_id uuid;
begin
  IF NOT EXISTS(SELECT 1 FROM ds_recovery.release_admins WHERE profile_id=auth.uid()) THEN RAISE EXCEPTION 'not authorized: release administrator required'; END IF;
  IF NOT public.current_account_allowed() THEN RAISE EXCEPTION 'not authorized: inactive session'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id=auth.uid() AND (caller.role='owner' OR (caller.role IN ('staff','manager') AND caller.access_enabled IS TRUE AND (caller.access_mode='no_restriction' OR caller.access_expires_at>now())))) THEN RAISE EXCEPTION 'not authorized: account disabled or expired'; END IF;
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can publish app versions.' using errcode = '42501';
  end if;
  if p_platform not in ('windows', 'mobile-android') then
    raise exception 'Invalid platform.' using errcode = '22023';
  end if;
  if p_build_number is null or p_build_number < 1 then
    raise exception 'Build number must be a positive integer.' using errcode = '22023';
  end if;

  IF p_version IS NULL OR p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Use a stable numeric release version, e.g. 1.4.0';END IF;
  IF p_download_path IS NULL OR split_part(p_download_path,'/',1) IS DISTINCT FROM (SELECT store_id::text FROM public.profiles WHERE id=auth.uid()) OR p_download_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,240}$' OR (p_platform='windows' AND p_download_path !~* '\.(exe|msi)$') OR (p_platform='mobile-android' AND p_download_path !~* '\.apk$') THEN RAISE EXCEPTION 'Invalid release artifact path';END IF;
  IF p_platform='windows' AND (nullif(btrim(p_signature),'') IS NULL OR length(btrim(p_signature))>8192) THEN RAISE EXCEPTION 'Windows updater signature required';END IF;
  insert into public.app_versions (platform, version, build_number, download_path, signature, release_notes, is_live, published_by)
  values (p_platform, nullif(trim(p_version), ''), p_build_number, p_download_path, nullif(trim(coalesce(p_signature, '')), ''), nullif(trim(coalesce(p_release_notes, '')), ''), false, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_app_version_live(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_platform text;
begin
  IF NOT EXISTS(SELECT 1 FROM ds_recovery.release_admins WHERE profile_id=auth.uid()) THEN RAISE EXCEPTION 'not authorized: release administrator required'; END IF;
  IF NOT public.current_account_allowed() THEN RAISE EXCEPTION 'not authorized: inactive session'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id=auth.uid() AND (caller.role='owner' OR (caller.role IN ('staff','manager') AND caller.access_enabled IS TRUE AND (caller.access_mode='no_restriction' OR caller.access_expires_at>now())))) THEN RAISE EXCEPTION 'not authorized: account disabled or expired'; END IF;
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can publish app versions.' using errcode = '42501';
  end if;

  select platform into v_platform from public.app_versions where id = p_id;
  if v_platform is null then
    raise exception 'Version not found.' using errcode = '22023';
  end if;

  PERFORM pg_advisory_xact_lock(hashtextextended('app-release:'||v_platform,0));
  IF EXISTS(SELECT 1 FROM public.app_versions target JOIN public.app_versions previous ON previous.platform=target.platform AND previous.first_live_at IS NOT NULL WHERE target.id=p_id AND previous.build_number>target.build_number) THEN RAISE EXCEPTION 'Older builds cannot be pushed as OTA rollback; rebuild known-good source with a higher version/build';END IF;
  IF EXISTS(SELECT 1 FROM public.app_versions WHERE id=p_id AND platform='windows' AND nullif(btrim(signature),'') IS NULL) THEN RAISE EXCEPTION 'Windows updater signature required';END IF;
  update public.app_versions set is_live = false where platform = v_platform and is_live;
  update public.app_versions set is_live = true,first_live_at=coalesce(first_live_at,now()) where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_live_app_version(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_platform text;
begin
 if not public.current_account_allowed() or not exists(select 1 from ds_recovery.release_admins where profile_id=auth.uid()) or not exists(select 1 from public.profiles where id=auth.uid() and role in ('owner','manager')) then raise exception 'not authorized: release administrator required' using errcode='42501';end if;
 select platform into v_platform from public.app_versions where id=p_id;
 if v_platform is null then raise exception 'Version not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('app-release:'||v_platform,0));
 update public.app_versions set is_live=false where id=p_id and is_live;
end $function$
;
revoke all on function public.withdraw_live_app_version(uuid) from public,anon,authenticated;
grant execute on function public.withdraw_live_app_version(uuid) to authenticated;
