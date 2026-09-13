-- Phase 2: Login & session redesign -- per-person 4-digit PIN lock on top of
-- the already-permanent background Supabase session (persistSession +
-- autoRefreshToken were already true before this -- verified, not rebuilt).
--
-- SECURITY DESIGN NOTE (why this is a separate table, not columns on
-- `profiles`): `profiles` has an owner/manager SELECT policy that returns
-- the FULL ROW for every staff member in the store (RLS is row-level in
-- Postgres, not column-level) -- today's code always lists explicit columns
-- in every .select(), but that's a convention, not a guarantee. A 4-digit
-- PIN has only 10,000 possible values, so even a bcrypt HASH of one reaching
-- a client is an instant offline brute-force away from the real PIN. Putting
-- pin data in its own table with RLS enabled and ZERO policies (deny-all)
-- makes that leak structurally impossible regardless of future `profiles`
-- query changes -- the only way in or out is the SECURITY DEFINER RPCs below.

create table if not exists public.profile_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profile_pins enable row level security;
-- Intentionally NO policies created -- default-deny. All access goes through
-- the SECURITY DEFINER functions below, which run as the table owner and
-- bypass RLS internally while still checking auth.uid()/role themselves.

revoke all on public.profile_pins from anon, authenticated;

create or replace function public.get_own_pin_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select failed_attempts, locked_until into v_row from public.profile_pins where profile_id = auth.uid();
  return jsonb_build_object(
    'hasPin', v_row is not null,
    'lockedUntil', v_row.locked_until,
    'failedAttempts', coalesce(v_row.failed_attempts, 0)
  );
end;
$$;

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
  if v_row is null then
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
