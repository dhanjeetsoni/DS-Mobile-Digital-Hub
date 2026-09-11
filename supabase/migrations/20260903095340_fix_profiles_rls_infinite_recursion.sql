-- Bug fix: the profiles SELECT/UPDATE policies referenced "profiles" again
-- inside their own subquery (self-join) to check "is this caller an owner/
-- manager of the same store". Postgres has to re-apply RLS to that inner
-- reference too, which re-evaluates the very same policy, causing
-- "infinite recursion detected in policy for relation \"profiles\"".
-- The query then fails and the app's getCurrentProfile() silently returns
-- null (store_id never loads) -- breaking Staff Access Manager, App
-- Versions, cloud sync status, and any feature depending on store_id.
--
-- Fix: move the "look up caller's own store_id / role" lookup into a
-- SECURITY DEFINER function. Security definer functions run as their
-- owner (postgres), which bypasses RLS, so the lookup no longer re-
-- triggers the calling policy.

create or replace function public.current_profile_store_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select store_id from profiles where id = auth.uid()
$$;

create or replace function public.current_profile_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

grant execute on function public.current_profile_store_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;

drop policy if exists "profiles_owner_manager_select" on profiles;
create policy "profiles_owner_manager_select" on profiles
for select
to authenticated
using (
  id = auth.uid()
  or (
    store_id = public.current_profile_store_id()
    and public.current_profile_role() = any (array['owner','manager'])
  )
);

drop policy if exists "profiles_owner_manager_update_staff" on profiles;
create policy "profiles_owner_manager_update_staff" on profiles
for update
to authenticated
using (
  store_id = public.current_profile_store_id()
  and public.current_profile_role() = any (array['owner','manager'])
  and role = 'staff'
)
with check (
  role = 'staff'
  and store_id = public.current_profile_store_id()
);
