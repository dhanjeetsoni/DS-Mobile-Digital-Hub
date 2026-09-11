-- STEP 12 — App Update & OTA Push System (Windows + Staff Android + Owner
-- Android). One global table of published app releases, keyed by which of
-- the 3 native shells (see src-tauri/tauri.*.conf.json) the row is for.
--
-- Deliberately NOT store-scoped (unlike gemini_api_keys / staff profiles /
-- everything else in this project): the Windows/Staff-Android/Owner-Android
-- builds are one shared codebase (see package.json android:*:build scripts)
-- published by the single Owner of this software, not per-shop data. Every
-- device on every store checks the same 3 rows.

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('windows', 'staff-android', 'owner-android')),
  version text not null,
  build_number integer not null check (build_number > 0),
  download_path text not null,
  signature text,
  release_notes text,
  is_live boolean not null default false,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists app_versions_one_live_per_platform
  on public.app_versions (platform)
  where is_live;

create index if not exists app_versions_platform_created_idx
  on public.app_versions (platform, created_at desc);

alter table public.app_versions enable row level security;

create or replace function public.get_live_app_versions()
returns table (
  platform text,
  version text,
  build_number integer,
  download_path text,
  signature text,
  release_notes text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select v.platform, v.version, v.build_number, v.download_path, v.signature, v.release_notes, v.created_at
  from public.app_versions v
  where v.is_live;
$$;

revoke all on function public.get_live_app_versions() from public;
grant execute on function public.get_live_app_versions() to anon, authenticated;

create or replace function public.list_app_versions()
returns table (
  id uuid,
  platform text,
  version text,
  build_number integer,
  download_path text,
  release_notes text,
  is_live boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can view app versions.' using errcode = '42501';
  end if;

  return query
  select v.id, v.platform, v.version, v.build_number, v.download_path, v.release_notes, v.is_live, v.created_at
  from public.app_versions v
  order by v.platform, v.created_at desc;
end;
$$;

revoke all on function public.list_app_versions() from public;
grant execute on function public.list_app_versions() to authenticated;

create or replace function public.publish_app_version(
  p_platform text,
  p_version text,
  p_build_number integer,
  p_download_path text,
  p_signature text default null,
  p_release_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can publish app versions.' using errcode = '42501';
  end if;
  if p_platform not in ('windows', 'staff-android', 'owner-android') then
    raise exception 'Invalid platform.' using errcode = '22023';
  end if;
  if p_build_number is null or p_build_number < 1 then
    raise exception 'Build number must be a positive integer.' using errcode = '22023';
  end if;

  insert into public.app_versions (platform, version, build_number, download_path, signature, release_notes, is_live, published_by)
  values (p_platform, nullif(trim(p_version), ''), p_build_number, p_download_path, nullif(trim(coalesce(p_signature, '')), ''), nullif(trim(coalesce(p_release_notes, '')), ''), false, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.publish_app_version(text, text, integer, text, text, text) from public;
grant execute on function public.publish_app_version(text, text, integer, text, text, text) to authenticated;

create or replace function public.set_app_version_live(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_platform text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can publish app versions.' using errcode = '42501';
  end if;

  select platform into v_platform from public.app_versions where id = p_id;
  if v_platform is null then
    raise exception 'Version not found.' using errcode = '22023';
  end if;

  update public.app_versions set is_live = false where platform = v_platform and is_live;
  update public.app_versions set is_live = true where id = p_id;
end;
$$;

revoke all on function public.set_app_version_live(uuid) from public;
grant execute on function public.set_app_version_live(uuid) to authenticated;
