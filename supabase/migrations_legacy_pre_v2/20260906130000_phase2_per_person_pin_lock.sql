-- Phase 2: Login & session redesign — per-person 4-digit PIN lock on top of
-- the already-permanent background Supabase session (persistSession +
-- autoRefreshToken were already true before this — verified, not rebuilt).
--
-- SECURITY DESIGN NOTE (why this is a separate table, not columns on
-- `profiles`): `profiles` has an owner/manager SELECT policy that returns
-- the FULL ROW for every staff member in the store (RLS is row-level in
-- Postgres, not column-level) — today's code always lists explicit columns
-- in every .select(), but that's a convention, not a guarantee. A 4-digit
-- PIN has only 10,000 possible values, so even a bcrypt HASH of one reaching
-- a client is an instant offline brute-force away from the real PIN. Putting
-- pin data in its own table with RLS enabled and ZERO policies (deny-all)
-- makes that leak structurally impossible regardless of future `profiles`
-- query changes — the only way in or out is the SECURITY DEFINER RPCs below.

create table if not exists public.profile_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profile_pins enable row level security;
-- Intentionally NO policies created — default-deny. All access goes through
-- the SECURITY DEFINER functions below, which run as the table owner and
-- bypass RLS internally while still checking auth.uid()/role themselves.

revoke all on public.profile_pins from anon, authenticated;

-- ---------------------------------------------------------------------
-- get_own_pin_status(): does the currently-signed-in user have a PIN set
-- yet, and are they currently locked out? Used by the app at startup to
-- decide "show set-a-PIN screen" vs "show enter-your-PIN screen" vs
-- "show locked-out screen" — never returns the hash itself.
-- ---------------------------------------------------------------------
create or replace function public.get_own_pin_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_found boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select failed_attempts, locked_until into v_row from public.profile_pins where profile_id = auth.uid();
  -- NOTE: deliberately using FOUND here, not "v_row is null" -- a bare
  -- `record` variable's IS NULL check does not reliably behave like the
  -- documented whole-row NULL test in every case; this was caught live
  -- during this migration's own verification (get_own_pin_status kept
  -- reporting hasPin:false immediately after set_own_pin had genuinely
  -- inserted the row, confirmed by a direct query in the same
  -- transaction). FOUND is the standard, unambiguous way to check whether
  -- a SELECT INTO matched a row in PL/pgSQL.
  v_found := found;
  return jsonb_build_object(
    'hasPin', v_found,
    'lockedUntil', case when v_found then v_row.locked_until else null end,
    'failedAttempts', case when v_found then v_row.failed_attempts else 0 end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- set_own_pin(): the signed-in user sets/changes their own 4-digit PIN.
-- Staff use this to change their own PIN (per the locked-in decision);
-- owner uses it for their own PIN too. Always allowed — this is not the
-- "forgot PIN" path (that's reset_staff_pin below, owner/manager only,
-- targeting someone ELSE's PIN).
-- ---------------------------------------------------------------------
create or replace function public.set_own_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path to 'public, extensions'
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  insert into public.profile_pins (profile_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')), 0, null, now())
  on conflict (profile_id) do update set
    pin_hash = excluded.pin_hash,
    failed_attempts = 0,
    locked_until = null,
    updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- verify_own_pin(): checks the PIN the app just asked for. Handles the
-- "3-4 wrong attempts -> lock" decision itself, server-side, so it can't
-- be bypassed by a modified client (a client-side-only attempt counter
-- would be trivial to reset by clearing local storage).
-- ---------------------------------------------------------------------
create or replace function public.verify_own_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public, extensions'
as $$
declare
  v_row record;
  v_ok boolean;
  v_new_attempts int;
  v_lock_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.profile_pins where profile_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pin_set');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', v_row.locked_until);
  end if;

  v_ok := (extensions.crypt(p_pin, v_row.pin_hash) = v_row.pin_hash);

  if v_ok then
    update public.profile_pins set failed_attempts = 0, locked_until = null where profile_id = auth.uid();
    return jsonb_build_object('ok', true);
  end if;

  v_new_attempts := v_row.failed_attempts + 1;
  -- 4 wrong attempts -> 5 minute lock, per the locked-in "3-4 wrong PIN
  -- attempts -> app locks / shows a warning" decision.
  if v_new_attempts >= 4 then
    v_lock_until := now() + interval '5 minutes';
    update public.profile_pins set failed_attempts = 0, locked_until = v_lock_until where profile_id = auth.uid();
    return jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', v_lock_until);
  else
    update public.profile_pins set failed_attempts = v_new_attempts where profile_id = auth.uid();
    return jsonb_build_object('ok', false, 'reason', 'wrong_pin', 'attemptsLeft', 4 - v_new_attempts);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- reset_staff_pin(): owner/manager clears ANOTHER profile's PIN (their own
-- staff/manager, same store only) — that person is then prompted to set a
-- brand new PIN next time they unlock, exactly like a first-time setup.
-- Cannot be used on an owner account, and cannot be used across stores.
-- ---------------------------------------------------------------------
create or replace function public.reset_staff_pin(p_target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_role text;
  v_caller_store uuid;
  v_target_role text;
  v_target_store uuid;
begin
  select role, store_id into v_caller_role, v_caller_store from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('owner', 'manager') then
    raise exception 'not authorized';
  end if;

  select role, store_id into v_target_role, v_target_store from public.profiles where id = p_target_profile_id;
  if v_target_store is null or v_target_store <> v_caller_store then
    raise exception 'not authorized';
  end if;
  if v_target_role not in ('staff', 'manager') then
    raise exception 'can only reset a staff or manager PIN';
  end if;

  delete from public.profile_pins where profile_id = p_target_profile_id;
end;
$$;

revoke all on function public.get_own_pin_status() from public;
revoke all on function public.set_own_pin(text) from public;
revoke all on function public.verify_own_pin(text) from public;
revoke all on function public.reset_staff_pin(uuid) from public;
grant execute on function public.get_own_pin_status() to authenticated;
grant execute on function public.set_own_pin(text) to authenticated;
grant execute on function public.verify_own_pin(text) to authenticated;
grant execute on function public.reset_staff_pin(uuid) to authenticated;
