create or replace function public.save_store_state_scoped(p_store_id uuid,p_profile_id uuid,p_state jsonb,p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_version bigint;
begin
  if auth.uid() is null or auth.uid() is distinct from p_profile_id or p_store_id is null then raise exception 'ACCOUNT_SCOPE_MISMATCH'; end if;
  select role into v_role from public.profiles where id=p_profile_id and store_id=p_store_id for share;
  if v_role is null then raise exception 'ACCOUNT_SCOPE_MISMATCH'; end if;
  if v_role='staff' then
    select s.version into v_version from public.save_store_state_for_user(p_state,p_expected_version) s;
  elsif v_role in ('owner','manager') then
    v_version := public.save_store_state(p_state,p_expected_version);
  else raise exception 'ACCOUNT_SCOPE_MISMATCH'; end if;
  return v_version;
end;
$$;
revoke all on function public.save_store_state_scoped(uuid,uuid,jsonb,bigint) from public,anon;
grant execute on function public.save_store_state_scoped(uuid,uuid,jsonb,bigint) to authenticated;
