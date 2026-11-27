create unique index app_versions_platform_version_unique on public.app_versions(platform,version);
CREATE OR REPLACE FUNCTION public.can_upload_release_artifact(p_store_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.current_account_allowed() and exists(select 1 from ds_recovery.release_admins a join public.profiles p on p.id=a.profile_id where a.profile_id=auth.uid() and p.store_id=p_store_id and p.role in ('owner','manager'))
$function$
;

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
  IF length(p_version)>32 OR p_version !~ '^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$' OR split_part(p_download_path,'/',2) NOT LIKE p_platform||'-v'||p_version||'-b'||p_build_number::text||'-%' THEN RAISE EXCEPTION 'Release filename must match platform, version and build'; END IF;
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
  IF EXISTS(SELECT 1 FROM public.app_versions target JOIN public.app_versions previous ON previous.platform=target.platform AND previous.first_live_at IS NOT NULL AND previous.id<>target.id WHERE target.id=p_id AND (string_to_array(previous.version,'.')::bigint[] >= string_to_array(target.version,'.')::bigint[] OR previous.build_number>=target.build_number)) THEN RAISE EXCEPTION 'New release must have a higher semantic version AND build number';END IF;
  IF EXISTS(SELECT 1 FROM public.app_versions WHERE id=p_id AND platform='windows' AND nullif(btrim(signature),'') IS NULL) THEN RAISE EXCEPTION 'Windows updater signature required';END IF;
  update public.app_versions set is_live = false where platform = v_platform and is_live;
  update public.app_versions set is_live = true,first_live_at=coalesce(first_live_at,now()) where id = p_id;
end;
$function$
;
revoke all on function public.can_upload_release_artifact(uuid) from public,anon,authenticated;
grant execute on function public.can_upload_release_artifact(uuid) to authenticated;
