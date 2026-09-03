-- Step 1.7: Owner's Live Access Control Panel table needs "Last login /
-- Last active time" per staff row (Created date already exists as
-- profiles.created_at). Add the column and a security-definer RPC that lets
-- a signed-in staff member stamp *their own* row only -- staff cannot UPDATE
-- profiles directly under the existing RLS policies (only owner/manager can),
-- so a narrow RPC is the safe way to let them touch just this one field.

alter table public.profiles
  add column if not exists last_active_at timestamptz;

comment on column public.profiles.last_active_at is 'Stamped via touch_staff_last_active() on staff sign-in (and periodic heartbeat from the app). Shown to the Owner in Staff Access Manager as "Last active".';

create or replace function public.touch_staff_last_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_active_at = now()
   where id = auth.uid()
     and role = 'staff';
end;
$$;

revoke all on function public.touch_staff_last_active() from public;
grant execute on function public.touch_staff_last_active() to authenticated;
