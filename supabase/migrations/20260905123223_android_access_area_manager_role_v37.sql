-- 2026-09-05: "Staff Access Manager" is being renamed to "Android Access
-- Area" and extended so the owner can generate a Login ID/Password for
-- EITHER a limited "staff" account OR a full owner-level "manager" account
-- (so the owner never has to type their real Gmail-tied cloud email/password
-- on a shared/Android device). The existing RLS update policy on `profiles`
-- only ever allowed an owner/manager to update rows with role = 'staff' --
-- extend it to also cover role = 'manager', so Turn OFF/ON, access resets,
-- etc. work the same way for both account types created from this screen.
-- (Only an existing owner/manager can update these rows at all -- the
-- `using` clause is unchanged in that respect.)

drop policy if exists profiles_owner_manager_update_staff on public.profiles;
create policy profiles_owner_manager_update_staff on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = profiles.store_id and p.role in ('owner','manager')
    )
    and profiles.role in ('staff','manager')
  )
  with check (
    role in ('staff','manager')
    and store_id = (select p.store_id from public.profiles p where p.id = auth.uid())
  );
