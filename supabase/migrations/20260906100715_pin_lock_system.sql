alter table public.profiles
  add column if not exists pin_hash text,
  add column if not exists pin_fail_count integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

create or replace function public.set_own_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.verify_own_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.has_own_pin()
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  select pin_hash is not null from public.profiles where id = auth.uid();
$$;

create or replace function public.get_own_pin_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.admin_reset_staff_pin(p_staff_id uuid, p_new_pin text)
returns void
language plpgsql
security definer
set search_path to 'public'
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
  if v_target_role != 'staff' then
    raise exception 'Target account is not a staff account';
  end if;

  update public.profiles
    set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
        pin_fail_count = 0,
        pin_locked_until = null
    where id = p_staff_id;
end;
$$;

revoke all on function public.set_own_pin(text) from public, anon;
revoke all on function public.verify_own_pin(text) from public, anon;
revoke all on function public.has_own_pin() from public, anon;
revoke all on function public.get_own_pin_status() from public, anon;
revoke all on function public.admin_reset_staff_pin(uuid, text) from public, anon;

grant execute on function public.set_own_pin(text) to authenticated;
grant execute on function public.verify_own_pin(text) to authenticated;
grant execute on function public.has_own_pin() to authenticated;
grant execute on function public.get_own_pin_status() to authenticated;
grant execute on function public.admin_reset_staff_pin(uuid, text) to authenticated;
