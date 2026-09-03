-- Step 1.5 / 1.8: real-time cross-device sync was silently broken for
-- EVERYONE, not just staff.
--
-- App.tsx already had a Supabase Realtime channel listening for
-- postgres_changes on public.store_state (this is the "instant, no-refresh"
-- sync the plan calls "bahut zaroori"). But public.store_state was never
-- added to the supabase_realtime publication -- exactly the same class of
-- bug already found and fixed for public.profiles in Step 1.7. That means
-- the owner-side channel has never actually received a single event in
-- production: Owner Windows <-> Owner Android (Step 1.8) would NOT sync in
-- real time, only on next manual save/reload.
--
-- For staff it's worse than a missed publication entry: store_state's raw
-- row contains confidential fields (purchasePrice, supplier cost,
-- financeDetails, moneyLenders, etc.) that staff must never receive -- which
-- is exactly why staff already reads via the load_store_state_for_user()
-- RPC instead of the table directly (see 20260827_staff_safe_state_write_v4
-- and 20260828_lender_owner_projection_v12). Simply publishing store_state
-- and pointing staff at it would leak that data straight into the browser
-- over the realtime socket, bypassing the RPC's redaction entirely.
--
-- Fix, in two parts:
--   1. Publish store_state -> fixes owner/manager <-> owner/manager
--      real-time sync (Step 1.8).
--   2. Add a sanitized mirror table, store_state_staff_view, kept in sync
--      by a trigger, carrying the *exact same* redaction logic
--      load_store_state_for_user() already uses -- extracted here into one
--      shared function (project_staff_state) so the RPC and the realtime
--      mirror can never drift apart. Staff subscribe to this table instead
--      (Step 1.5). Only the SECURITY DEFINER trigger function may write to
--      it; no client role gets INSERT/UPDATE/DELETE.

-- 1) Shared projection logic, extracted from the current live
--    load_store_state_for_user() body so both the RPC and the new realtime
--    mirror trigger use one definition, not two copies that can drift.
create or replace function public.project_staff_state(p_state jsonb)
returns jsonb language plpgsql as $$
declare v_state jsonb;
begin
  v_state := coalesce(p_state, '{}'::jsonb);
  v_state := jsonb_set(v_state,'{products}',coalesce((select jsonb_agg(p-'purchasePrice'-'pendingCost'-'supplier'-'units') from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) p),'[]'::jsonb),true);
  v_state := jsonb_set(v_state,'{stockBatches}',coalesce((select jsonb_agg(b-'purchasePrice') from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b),'[]'::jsonb),true);
  v_state := jsonb_set(v_state,'{sales}',coalesce((select jsonb_agg((s-'items'-'financeDetails') || jsonb_build_object('items',coalesce((select jsonb_agg(i-'purchasePrice'-'cost'-'batchConsumption') from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i),'[]'::jsonb))) from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s),'[]'::jsonb),true);
  v_state := jsonb_set(v_state,'{purchases}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{suppliers}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{supplierPayments}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{expenses}',jsonb_build_object('shop','[]'::jsonb,'personal','[]'::jsonb,'other','[]'::jsonb),true);
  v_state := jsonb_set(v_state,'{secondHandKYCs}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{imeiRegistry}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{gallaClosings}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{moneyLenders}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{lenderTransactions}','[]'::jsonb,true);
  return v_state;
end;
$$;

-- load_store_state_for_user() now just calls the shared function instead of
-- carrying its own copy of the same redaction logic.
create or replace function public.load_store_state_for_user()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_role text; v_state jsonb;
begin
  v_store := public.my_store_id();
  select role into v_role from public.profiles where id = auth.uid() and store_id = v_store;
  select state into v_state from public.store_state where store_id = v_store;
  if v_role in ('owner','manager') then return v_state; end if;
  return public.project_staff_state(v_state);
end;
$$;

-- 2) Sanitized realtime mirror table for staff.
create table if not exists public.store_state_staff_view (
  store_id uuid primary key references public.store_state(store_id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.store_state_staff_view enable row level security;

drop policy if exists store_state_staff_view_select on public.store_state_staff_view;
create policy store_state_staff_view_select on public.store_state_staff_view
  for select to authenticated
  using (store_id = public.my_store_id());

-- Deliberately no insert/update/delete policy for any client role (owner,
-- manager, or staff) -- this table is only ever written by the trigger
-- below, which runs SECURITY DEFINER as the table owner.
revoke insert, update, delete on public.store_state_staff_view from authenticated, anon;
grant select on public.store_state_staff_view to authenticated;

create or replace function public.sync_store_state_staff_view()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.store_state_staff_view (store_id, state, version, updated_at)
  values (new.store_id, public.project_staff_state(new.state), new.version, now())
  on conflict (store_id) do update
    set state = excluded.state, version = excluded.version, updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists trg_sync_store_state_staff_view on public.store_state;
create trigger trg_sync_store_state_staff_view
  after insert or update on public.store_state
  for each row execute function public.sync_store_state_staff_view();

-- Backfill: make sure every existing store already has a projected row
-- (new stores get one automatically from here on via the trigger above).
insert into public.store_state_staff_view (store_id, state, version, updated_at)
select store_id, public.project_staff_state(state), version, now()
from public.store_state
on conflict (store_id) do update
  set state = excluded.state, version = excluded.version, updated_at = excluded.updated_at;

-- 3) Publish both tables so the realtime channels actually fire.
--    store_state              -> owner/manager <-> owner/manager (Step 1.8)
--    store_state_staff_view   -> staff <-> everyone, confidential-safe (Step 1.5)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_state'
  ) then
    alter publication supabase_realtime add table public.store_state;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_state_staff_view'
  ) then
    alter publication supabase_realtime add table public.store_state_staff_view;
  end if;
end;
$$;
