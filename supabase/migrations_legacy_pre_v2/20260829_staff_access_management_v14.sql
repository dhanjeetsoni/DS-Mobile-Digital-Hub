-- Staff Access Management (Part 1 of 3): owner-issued staff login IDs +
-- passwords, and an owner-controlled ON/OFF access switch, on top of the
-- existing profiles(id, store_id, role) table.
--
-- Part 2 (next) will add: access_mode (no_restriction / full_day / timed),
-- access_expires_at enforcement + auto-logout, and visibility_from (hides
-- galla/sales history recorded before the staff member's current access
-- grant). The columns are added now so Part 2 does not need another
-- destructive migration, but the app does not yet enforce them.
-- Part 3 (later) will add the correction/edit-window (default 10 days,
-- owner-configurable) for sales edited after the fact.

alter table public.profiles
  add column if not exists staff_login_id text,
  add column if not exists staff_name text,
  add column if not exists access_enabled boolean not null default true,
  add column if not exists access_mode text not null default 'no_restriction',
  add column if not exists access_expires_at timestamptz,
  add column if not exists access_granted_at timestamptz,
  add column if not exists visibility_from timestamptz,
  add column if not exists created_by uuid references auth.users(id);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_access_mode_check'
  ) then
    alter table public.profiles
      add constraint profiles_access_mode_check
      check (access_mode in ('no_restriction','full_day','timed'));
  end if;
end $$;

-- Login IDs are how a staff member signs in on the Android app (owner picks
-- the ID + password when creating the account). Must be unique across the
-- whole product, not just the store, because the staff login screen has no
-- separate "select your shop" step.
create unique index if not exists profiles_staff_login_id_key
  on public.profiles (lower(staff_login_id))
  where staff_login_id is not null;

alter table public.profiles enable row level security;

-- Owner/manager can see every profile (incl. staff) in their own store —
-- needed to render the Staff Access Manager list.
drop policy if exists profiles_owner_manager_select on public.profiles;
create policy profiles_owner_manager_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = profiles.store_id and p.role in ('owner','manager')
    )
  );

-- Owner/manager can toggle access_enabled / access_mode / access_expires_at /
-- visibility_from for staff rows in their own store, but cannot use this
-- policy to promote a staff member to owner/manager or move them to a
-- different store — role and store_id are pinned to their existing values.
drop policy if exists profiles_owner_manager_update_staff on public.profiles;
create policy profiles_owner_manager_update_staff on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = profiles.store_id and p.role in ('owner','manager')
    )
    and profiles.role = 'staff'
  )
  with check (
    role = 'staff'
    and store_id = (select p.store_id from public.profiles p where p.id = auth.uid())
  );

comment on column public.profiles.access_enabled is 'Owner ON/OFF switch. false = staff app shows "Contact Shop Owner for Access" and cannot log in / stays logged out.';
comment on column public.profiles.access_mode is 'no_restriction = no time limit, full_day = expires end of day, timed = expires at access_expires_at (enforced client-side even while offline).';
comment on column public.profiles.visibility_from is 'Sales/galla before this timestamp are hidden from this staff member; product catalog (A-Z) is never hidden.';
