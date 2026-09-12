alter table public.profiles
  add column if not exists pin_hash text,
  add column if not exists pin_fail_count integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

comment on column public.profiles.pin_hash is
  'bcrypt hash (pgcrypto crypt()/gen_salt(''bf'')) of this person''s 4-digit app-unlock PIN. Never selected by client code - only compared server-side inside verify_own_pin(). Null = PIN not set yet, client must prompt to set one.';
comment on column public.profiles.pin_fail_count is
  'Consecutive wrong-PIN attempts since the last success or lockout. Reset to 0 on a correct PIN or once pin_locked_until expires.';
comment on column public.profiles.pin_locked_until is
  'Set by verify_own_pin() after 3 consecutive wrong attempts. Null when not locked.';

create or replace function public.has_own_pin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select pin_hash is not null from public.profiles where id = auth.uid();
$$;

grant execute on function public.has_own_pin() to authenticated;

create or replace function public.set_own_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  update public.profiles
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
        pin_fail_count = 0,
        pin_locked_until = null
    where id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

grant execute on function public.set_own_pin(text) to authenticated;

create or replace function public.verify_own_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_fail_count integer;
  v_locked_until timestamptz;
  v_now timestamptz := now();
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select pin_hash, pin_fail_count, pin_locked_until
    into v_hash, v_fail_count, v_locked_until
    from public.profiles
    where id = auth.uid();

  if v_hash is null then
    return jsonb_build_object('ok', false, 'locked', false, 'lock_remaining_seconds', 0, 'no_pin_set', true);
  end if;

  if v_locked_until is not null and v_locked_until > v_now then
    return jsonb_build_object(
      'ok', false, 'locked', true,
      'lock_remaining_seconds', ceil(extract(epoch from (v_locked_until - v_now)))::int
    );
  end if;

  v_ok := (extensions.crypt(p_pin, v_hash) = v_hash);

  if v_ok then
    update public.profiles set pin_fail_count = 0, pin_locked_until = null where id = auth.uid();
    return jsonb_build_object('ok', true, 'locked', false, 'lock_remaining_seconds', 0);
  end if;

  v_fail_count := coalesce(v_fail_count, 0) + 1;
  if v_fail_count >= 3 then
    update public.profiles
      set pin_fail_count = 0, pin_locked_until = v_now + interval '2 minutes'
      where id = auth.uid();
    return jsonb_build_object('ok', false, 'locked', true, 'lock_remaining_seconds', 120);
  end if;

  update public.profiles set pin_fail_count = v_fail_count where id = auth.uid();
  return jsonb_build_object('ok', false, 'locked', false, 'lock_remaining_seconds', 0, 'attempts_left', 3 - v_fail_count);
end;
$$;

grant execute on function public.verify_own_pin(text) to authenticated;

create or replace function public.admin_reset_staff_pin(p_staff_id uuid, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_store uuid;
  v_target_store uuid;
  v_target_role text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  select role, store_id into v_caller_role, v_caller_store
    from public.profiles where id = auth.uid();

  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Only the owner/manager can reset another PIN';
  end if;

  select store_id, role into v_target_store, v_target_role
    from public.profiles where id = p_staff_id;

  if v_target_store is null or v_target_store is distinct from v_caller_store then
    raise exception 'Staff account not found in your store';
  end if;
  if v_target_role <> 'staff' then
    raise exception 'Target account is not a staff account';
  end if;

  update public.profiles
    set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
        pin_fail_count = 0,
        pin_locked_until = null
    where id = p_staff_id;
end;
$$;

grant execute on function public.admin_reset_staff_pin(uuid, text) to authenticated;
