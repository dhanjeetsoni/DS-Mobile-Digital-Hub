-- Preserve compatibility for older clients; registered sessions require a live auth session.
do $patch$
declare f text;a text;
begin
 f:=pg_get_functiondef('public.current_account_allowed()'::regprocedure);
 a:='AND d.revoked_at IS NOT NULL) THEN RETURN false; END IF;';
 if position(a in f)=0 then raise exception 'registered session guard missing';end if;
 execute replace(f,a,'AND (d.revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=d.session_id AND s.user_id=pr.id AND (s.not_after IS NULL OR s.not_after>now())))) THEN RETURN false; END IF;');
end $patch$;
create or replace function public.touch_staff_last_active() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.current_account_allowed() then raise exception 'account access denied' using errcode='42501';end if;
 update public.profiles set last_active_at=now() where id=auth.uid() and role='staff';
end $$;
create or replace function public.touch_staff_offline_download() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.current_account_allowed() then raise exception 'account access denied' using errcode='42501';end if;
 update public.profiles set last_offline_download_at=now() where id=auth.uid() and role='staff';
end $$;
revoke all on function public.touch_staff_last_active(), public.touch_staff_offline_download() from public,anon,authenticated;
grant execute on function public.touch_staff_last_active(), public.touch_staff_offline_download() to authenticated;
