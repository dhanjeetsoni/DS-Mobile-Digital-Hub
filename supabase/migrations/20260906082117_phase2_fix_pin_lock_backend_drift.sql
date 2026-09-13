-- Phase 2: Per-person PIN lock — fix inconsistent/incomplete prior work.
--
-- A prior session had begun this feature directly against the live DB but
-- never finished or committed a migration for it (found via live audit,
-- 2026-09-06, no matching file existed in supabase/migrations/):
--   - profiles.pin_hash / pin_fail_count / pin_locked_until columns: EXIST,
--     correctly used by set_own_pin/verify_own_pin/has_own_pin/
--     admin_reset_staff_pin.
--   - BUT get_own_pin_status() and reset_staff_pin(uuid) were written
--     against a *different*, orphaned table `profile_pins` (0 rows, never
--     actually used by the working functions) — so calling
--     get_own_pin_status() after set_own_pin() would have incorrectly
--     reported "no PIN set", and reset_staff_pin() would have silently done
--     nothing. This migration closes that drift.
--   - Also found: profiles.pin_hash/pin_fail_count/pin_locked_until were
--     selectable/updatable by any authenticated user via plain PostgREST
--     access under the existing profiles RLS policies (which only restrict
--     *rows*, not columns) — a 4-digit PIN's hash is small enough to brute
--     force offline in seconds even as a bcrypt hash, so this is closed
--     with column-level REVOKEs, forcing every PIN read/write through the
--     SECURITY DEFINER functions below instead.

-- 1) Drop the orphaned, never-actually-used table + the broken function
--    that referenced it. admin_reset_staff_pin() already correctly covers
--    "owner resets a staff PIN" (with proper same-store + role checks), so
--    reset_staff_pin(uuid) is redundant as well as broken.
drop function if exists public.reset_staff_pin(uuid);
drop table if exists public.profile_pins;

-- 2) Fix get_own_pin_status() to read the *actual* live PIN columns on
--    profiles instead of the orphaned table.
create or replace function public.get_own_pin_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_pin boolean;
  v_fail_count integer;
  v_locked_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select (pin_hash is not null), coalesce(pin_fail_count, 0), pin_locked_until
    into v_has_pin, v_fail_count, v_locked_until
    from public.profiles
    where id = auth.uid();

  return jsonb_build_object(
    'hasPin', coalesce(v_has_pin, false),
    'lockedUntil', case when v_locked_until is not null and v_locked_until > now() then v_locked_until else null end,
    'failedAttempts', coalesce(v_fail_count, 0)
  );
end;
$$;

-- 3) Column-level lockdown: pin_hash/pin_fail_count/pin_locked_until must
--    never be readable or writable by ordinary client requests (even to
--    their own row, even for an owner looking at their own staff's row) —
--    only the SECURITY DEFINER functions above, which run as the function
--    owner and are unaffected by these REVOKEs, may touch them.
revoke select (pin_hash, pin_fail_count, pin_locked_until) on public.profiles from anon, authenticated;
revoke update (pin_hash, pin_fail_count, pin_locked_until) on public.profiles from anon, authenticated;

-- 4) Make sure the client-facing functions are actually callable (defensive
--    — CREATE FUNCTION defaults usually already grant this to PUBLIC, but
--    confirm explicitly rather than assume).
grant execute on function public.has_own_pin() to authenticated;
grant execute on function public.get_own_pin_status() to authenticated;
grant execute on function public.set_own_pin(text) to authenticated;
grant execute on function public.verify_own_pin(text) to authenticated;
grant execute on function public.admin_reset_staff_pin(uuid, text) to authenticated;
