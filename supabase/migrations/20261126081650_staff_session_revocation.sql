create schema ds_device;
revoke all on schema ds_device from public,anon,authenticated;
create table ds_device.staff_sessions(
 session_id uuid primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 installation_id text not null check(length(installation_id) between 1 and 150),
 first_seen timestamptz not null default now(),
 last_seen timestamptz not null default now(),
 revoked_at timestamptz,
 revoked_by uuid
);
alter table ds_device.staff_sessions enable row level security;
revoke all on table ds_device.staff_sessions from public,anon,authenticated;
create index staff_sessions_store_idx on ds_device.staff_sessions(store_id,last_seen desc);
do $patch$
declare f text; a text;
begin
 f:=pg_get_functiondef('public.current_account_allowed()'::regprocedure);
 a:='IF pr.role=''owner'' THEN RETURN true; END IF;';
 if position(a in f)=0 then raise exception 'access guard anchor missing';end if;
 execute replace(f,a,a||'
 IF EXISTS(SELECT 1 FROM ds_device.staff_sessions d WHERE d.profile_id=pr.id AND d.store_id=pr.store_id AND d.session_id::text=auth.jwt()->>''session_id'' AND d.revoked_at IS NOT NULL) THEN RETURN false; END IF;');
end $patch$;
create function public.register_staff_session(p_installation_id text) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype;v_session uuid;
begin
 select * into p from public.profiles where id=auth.uid();
 if p.id is null or p.role not in ('staff','manager') or not public.current_account_allowed() then return false;end if;
 if p_installation_id is null or length(btrim(p_installation_id)) not between 1 and 150 then raise exception 'invalid installation';end if;
 select s.id into v_session from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=p.id and (s.not_after is null or s.not_after>now());
 if v_session is null then return false;end if;
 insert into ds_device.staff_sessions(session_id,profile_id,store_id,installation_id) values(v_session,p.id,p.store_id,btrim(p_installation_id))
 on conflict(session_id) do update set last_seen=now() where ds_device.staff_sessions.profile_id=p.id and ds_device.staff_sessions.store_id=p.store_id and ds_device.staff_sessions.revoked_at is null;
 return found;
end $$;
revoke all on function public.register_staff_session(text) from public,anon,authenticated;
grant execute on function public.register_staff_session(text) to authenticated;
create function public.list_staff_sessions() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_store uuid:=ds_accounting.owner_store();v_result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc),'[]'::jsonb) into v_result from
 (select d.session_id,d.installation_id,d.first_seen,d.last_seen,d.revoked_at,coalesce(p.staff_name,p.full_name,'Staff') account_name,p.role,
 exists(select 1 from auth.sessions s where s.id=d.session_id and s.user_id=d.profile_id and (s.not_after is null or s.not_after>now())) session_exists
 from ds_device.staff_sessions d join public.profiles p on p.id=d.profile_id and p.store_id=d.store_id
 where d.store_id=v_store and p.role in ('staff','manager') order by d.last_seen desc limit 200) x;
 return v_result;
end $$;
revoke all on function public.list_staff_sessions() from public,anon,authenticated;
grant execute on function public.list_staff_sessions() to authenticated;
create function public.revoke_staff_session(p_session_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_store uuid:=ds_accounting.owner_store();
begin
 update ds_device.staff_sessions d set revoked_at=now(),revoked_by=auth.uid() where d.session_id=p_session_id and d.store_id=v_store and d.revoked_at is null and exists(select 1 from public.profiles p where p.id=d.profile_id and p.store_id=v_store and p.role in ('staff','manager'));
 return found;
end $$;
revoke all on function public.revoke_staff_session(uuid) from public,anon,authenticated;
grant execute on function public.revoke_staff_session(uuid) to authenticated;
