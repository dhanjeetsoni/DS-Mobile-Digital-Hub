-- Fix for the previous migration: profiles has a blanket table-level
-- GRANT SELECT/UPDATE to anon+authenticated (Supabase's default), which
-- fully supersedes a column-level REVOKE — Postgres has no way to "carve
-- an exception out of" a broader table-wide grant via REVOKE. The only way
-- to actually hide specific columns is to REVOKE the table-wide grant and
-- re-GRANT an explicit column allow-list that excludes the PIN columns.
revoke select on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;

grant select (
  id, email, full_name, store_id, role, staff_login_id, staff_name,
  access_enabled, access_mode, access_expires_at, access_granted_at,
  visibility_from, created_by, created_at, last_active_at,
  last_offline_download_at
) on public.profiles to anon, authenticated;

grant update (
  id, email, full_name, store_id, role, staff_login_id, staff_name,
  access_enabled, access_mode, access_expires_at, access_granted_at,
  visibility_from, created_by, created_at, last_active_at,
  last_offline_download_at
) on public.profiles to authenticated;
