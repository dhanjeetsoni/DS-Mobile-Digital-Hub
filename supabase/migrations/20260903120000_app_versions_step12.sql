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
  -- R2 object path (kind="app", see r2Client.ts / r2-storage Edge Function),
  -- NOT a full URL — the client builds the download URL itself so a bucket
  -- rename never breaks old rows.
  download_path text not null,
  -- Only meaningful for platform='windows': the Tauri Updater signature
  -- (.sig file contents from `tauri signer sign`) that the Tauri Updater
  -- plugin verifies before installing. Null for the two Android platforms
  -- (they install via a plain APK download, not the Tauri Updater).
  signature text,
  release_notes text,
  is_live boolean not null default false,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Only one "live" row per platform at a time — this is what every device
-- checks against, so it must be unambiguous.
create unique index if not exists app_versions_one_live_per_platform
  on public.app_versions (platform)
  where is_live;

create index if not exists app_versions_platform_created_idx
  on public.app_versions (platform, created_at desc);

alter table public.app_versions enable row level security;
-- Same pattern as gemini_api_keys: RLS + zero policies = deny-all via
-- PostgREST. All access goes through the SECURITY DEFINER RPCs below.

-- ---------------------------------------------------------------------
-- get_live_app_versions() — the actual "is there an update" check every
-- device runs (Step 12.1/12.2). Public on purpose: Step 12.1 says the
-- check happens "app khulte hi" (app open), which can be before a Staff ID
-- or Owner login resolves — this must never depend on being signed in.
-- Never exposes anything sensitive (no owner IDs, no internal history,
-- just the current live version per platform).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Owner-only RPCs for the "App Versions" panel (Step 12.3). Same
-- owner/manager role check every other owner-only RPC in this project
-- uses (gemini key pool, staff manager, etc).
-- ---------------------------------------------------------------------
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

-- Publishes a newly-uploaded build as a new (not-yet-live) row. The
-- Owner still has to press "Make this version Live" separately
-- (set_app_version_live below) — matches the plan's 2-step flow exactly:
-- "file upload + 'Make this version Live' button".
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

-- Marks one existing row "live" for its platform (unmarking whatever else
-- was live for that platform first) — also doubles as an instant rollback:
-- Owner can pick an older row from the history table and re-publish it.
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
