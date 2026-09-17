-- Step 3.5: Offline-First Data Sync ("Download Area"). The Owner's Staff
-- Access Manager already shows "Last active" (last_active_at, v21). This
-- adds a parallel "Last downloaded for offline" timestamp so the Owner can
-- see which staff devices actually have a local offline copy ready, not
-- just who signed in most recently. Same pattern as touch_staff_last_active:
-- a narrow security-definer RPC lets staff stamp only their own row, since
-- ordinary RLS only lets owner/manager UPDATE profiles.

alter table public.profiles
  add column if not exists last_offline_download_at timestamptz;

comment on column public.profiles.last_offline_download_at is 'Stamped via touch_staff_offline_download() whenever staff completes a "Download Area" offline sync on their device. Shown to the Owner in Staff Access Manager. Null = never downloaded.';

create or replace function public.touch_staff_offline_download()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_offline_download_at = now()
   where id = auth.uid()
     and role = 'staff';
end;
$$;

revoke all on function public.touch_staff_offline_download() from public;
grant execute on function public.touch_staff_offline_download() to authenticated;
