-- Part 1 fix: owner deletions of append-only staff-merged collections could
-- reappear after the next staff device sync.
--
-- Root cause: save_store_state_for_user() unions the server's current
-- purchases/suppliers/supplierPayments/secondHandKYCs/imeiRegistry/
-- gallaClosings/exchanges/expenses.* records with whatever a staff device
-- still has cached locally. Staff devices never see these collections
-- shrink (load_store_state_for_user() blanks them to [] for role='staff'),
-- so a staff device's local copy only ever grows across a session/app
-- lifetime. If the owner deletes one of those records and a staff device
-- later syncs (even without adding anything new), the union brings the
-- deleted record back.
--
-- Fix: a tombstone ledger, maintained by a trigger on store_state itself
-- (so it works no matter which function performed the write -- the owner's
-- full-replace save_store_state(), the staff merge path below, or any
-- future write path -- without needing to touch save_store_state()).
-- save_store_state_for_user() then filters its merged output against the
-- ledger so a tombstoned id can never come back from a stale staff device.
-- If a record with the same id legitimately reappears in the store's true
-- state (owner recreates it), its tombstone is cleared automatically.

create table if not exists public.store_state_tombstones (
  store_id uuid not null references public.stores(id) on delete cascade,
  collection text not null,
  record_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (store_id, collection, record_id)
);

alter table public.store_state_tombstones enable row level security;
-- No direct client access by design -- only the SECURITY DEFINER functions
-- below ever touch this table, so no RLS policy is added and all client
-- roles are revoked.
revoke all on public.store_state_tombstones from public, anon, authenticated;

create index if not exists store_state_tombstones_lookup_idx
  on public.store_state_tombstones (store_id, collection, record_id);

-- Reconciles one collection's tombstones against an old/new pair of arrays:
-- ids present in p_old but missing from p_new get tombstoned; ids present
-- in p_new have any existing tombstone cleared (so a deliberately recreated
-- record with the same id is never blocked again).
create or replace function public.reconcile_store_state_tombstones(
  p_store uuid, p_collection text, p_old jsonb, p_new jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.store_state_tombstones (store_id, collection, record_id, deleted_at)
  select p_store, p_collection, removed_id, now()
  from (
    select (e->>'id') as removed_id from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) e where e ? 'id'
    except
    select (e->>'id') from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) e where e ? 'id'
  ) removed
  where removed_id is not null
  on conflict (store_id, collection, record_id) do update set deleted_at = excluded.deleted_at;

  delete from public.store_state_tombstones t
  where t.store_id = p_store and t.collection = p_collection
    and t.record_id in (
      select (e->>'id') from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) e where e ? 'id'
    );
end;
$$;
revoke all on function public.reconcile_store_state_tombstones(uuid, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.store_state_tombstone_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb;
begin
  v_old := old.state; v_new := new.state;
  if v_old is null or v_new is null then return new; end if;

  perform public.reconcile_store_state_tombstones(new.store_id, 'purchases', v_old->'purchases', v_new->'purchases');
  perform public.reconcile_store_state_tombstones(new.store_id, 'suppliers', v_old->'suppliers', v_new->'suppliers');
  perform public.reconcile_store_state_tombstones(new.store_id, 'supplierPayments', v_old->'supplierPayments', v_new->'supplierPayments');
  perform public.reconcile_store_state_tombstones(new.store_id, 'secondHandKYCs', v_old->'secondHandKYCs', v_new->'secondHandKYCs');
  perform public.reconcile_store_state_tombstones(new.store_id, 'imeiRegistry', v_old->'imeiRegistry', v_new->'imeiRegistry');
  perform public.reconcile_store_state_tombstones(new.store_id, 'gallaClosings', v_old->'gallaClosings', v_new->'gallaClosings');
  perform public.reconcile_store_state_tombstones(new.store_id, 'exchanges', v_old->'exchanges', v_new->'exchanges');
  perform public.reconcile_store_state_tombstones(new.store_id, 'expenses.shop', v_old->'expenses'->'shop', v_new->'expenses'->'shop');
  perform public.reconcile_store_state_tombstones(new.store_id, 'expenses.personal', v_old->'expenses'->'personal', v_new->'expenses'->'personal');
  perform public.reconcile_store_state_tombstones(new.store_id, 'expenses.other', v_old->'expenses'->'other', v_new->'expenses'->'other');

  return new;
end;
$$;

drop trigger if exists store_state_tombstone_trg on public.store_state;
create trigger store_state_tombstone_trg
  after update on public.store_state
  for each row execute function public.store_state_tombstone_trigger();

-- Filters a merged array against the tombstone ledger for one collection.
create or replace function public.filter_store_state_tombstones(
  p_store uuid, p_collection text, p_arr jsonb
) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_arr, '[]'::jsonb)) e
  where not (e ? 'id') or not exists (
    select 1 from public.store_state_tombstones t
    where t.store_id = p_store and t.collection = p_collection and t.record_id = e->>'id'
  );
$$;
revoke all on function public.filter_store_state_tombstones(uuid, text, jsonb) from public, anon, authenticated;

-- save_store_state_for_user(): identical body to the currently-deployed
-- version, except every merge_staff_json_array(...) result for the affected
-- collections is now piped through filter_store_state_tombstones(...) before
-- being written back.
create or replace function public.save_store_state_for_user(p_state jsonb,p_expected_version bigint default null)
returns public.store_state language plpgsql security definer set search_path=public as $$
declare
  v_store uuid; v_role text; v_current jsonb; v_state jsonb;
  v_products jsonb; v_batches jsonb; v_sales jsonb; v_row public.store_state;
begin
  v_store:=public.my_store_id();
  select role into v_role from public.profiles where id=auth.uid() and store_id=v_store;
  if v_store is null or v_role <> 'staff' then raise exception 'Not authorized'; end if;

  select state into v_current from public.store_state where store_id=v_store for update;
  v_state:=coalesce(p_state,'{}'::jsonb);

  select coalesce(jsonb_agg(
    (incoming-'purchasePrice'-'pendingCost'-'supplier'-'units') ||
    jsonb_build_object(
      'purchasePrice',coalesce(oldp->'purchasePrice','null'::jsonb),
      'pendingCost',coalesce(oldp->'pendingCost','null'::jsonb),
      'supplier',coalesce(oldp->'supplier','null'::jsonb),
      'units',coalesce(oldp->'units','[]'::jsonb)
    )
  ),'[]'::jsonb)
  into v_products
  from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) incoming
  left join lateral (
    select p as oldp from jsonb_array_elements(coalesce(v_current->'products','[]'::jsonb)) p
    where p->>'id'=incoming->>'id' limit 1
  ) x on true;

  select coalesce(jsonb_agg(b-'purchasePrice'),'[]'::jsonb)
  into v_batches from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b;

  select coalesce(jsonb_agg(
    (s-'items'-'financeDetails') ||
    jsonb_build_object('items',coalesce((
      select jsonb_agg(i-'purchasePrice'-'cost'-'batchConsumption')
      from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i
    ),'[]'::jsonb))
  ),'[]'::jsonb)
  into v_sales from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s;

  v_state:=jsonb_set(v_state,'{products}',v_products,true);
  v_state:=jsonb_set(v_state,'{stockBatches}',v_batches,true);
  v_state:=jsonb_set(v_state,'{sales}',v_sales,true);

  -- Staff reads these collections as empty/sanitized projections. Merge instead of
  -- replacing the owner's existing records, so a staff purchase/expense/KYC/IMEI
  -- cannot silently disappear on the next snapshot -- then filter the merged
  -- result against the tombstone ledger above so an owner-deleted record can
  -- never be resurrected by a stale staff device that still has it cached.
  v_state:=jsonb_set(v_state,'{purchases}',public.filter_store_state_tombstones(v_store,'purchases',public.merge_staff_json_array(v_current->'purchases',v_state->'purchases')),true);
  v_state:=jsonb_set(v_state,'{suppliers}',public.filter_store_state_tombstones(v_store,'suppliers',public.merge_staff_json_array(v_current->'suppliers',v_state->'suppliers')),true);
  v_state:=jsonb_set(v_state,'{supplierPayments}',public.filter_store_state_tombstones(v_store,'supplierPayments',public.merge_staff_json_array(v_current->'supplierPayments',v_state->'supplierPayments')),true);
  v_state:=jsonb_set(v_state,'{secondHandKYCs}',public.filter_store_state_tombstones(v_store,'secondHandKYCs',public.merge_staff_json_array(v_current->'secondHandKYCs',v_state->'secondHandKYCs')),true);
  v_state:=jsonb_set(v_state,'{imeiRegistry}',public.filter_store_state_tombstones(v_store,'imeiRegistry',public.merge_staff_json_array(v_current->'imeiRegistry',v_state->'imeiRegistry')),true);
  v_state:=jsonb_set(v_state,'{gallaClosings}',public.filter_store_state_tombstones(v_store,'gallaClosings',public.merge_staff_json_array(v_current->'gallaClosings',v_state->'gallaClosings')),true);
  v_state:=jsonb_set(v_state,'{exchanges}',public.filter_store_state_tombstones(v_store,'exchanges',public.merge_staff_json_array(v_current->'exchanges',v_state->'exchanges')),true);

  v_state:=jsonb_set(v_state,'{expenses}',jsonb_build_object(
    'shop',public.filter_store_state_tombstones(v_store,'expenses.shop',public.merge_staff_json_array(v_current->'expenses'->'shop',v_state->'expenses'->'shop')),
    'personal',public.filter_store_state_tombstones(v_store,'expenses.personal',public.merge_staff_json_array(v_current->'expenses'->'personal',v_state->'expenses'->'personal')),
    'other',public.filter_store_state_tombstones(v_store,'expenses.other',public.merge_staff_json_array(v_current->'expenses'->'other',v_state->'expenses'->'other'))
  ),true);

  -- Owner-only byaj/loan lender ledger: staff never receive real data for these (blanked on
  -- load), so always restore the owner's existing records untouched rather than trusting
  -- whatever empty/stale value came back from a staff device.
  v_state:=jsonb_set(v_state,'{moneyLenders}',coalesce(v_current->'moneyLenders','[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{lenderTransactions}',coalesce(v_current->'lenderTransactions','[]'::jsonb),true);

  if p_expected_version is null then
    update public.store_state set state=v_state,updated_by=auth.uid(),version=version+1,updated_at=now()
    where store_id=v_store returning * into v_row;
  else
    update public.store_state set state=v_state,updated_by=auth.uid(),version=version+1,updated_at=now()
    where store_id=v_store and version=p_expected_version returning * into v_row;
  end if;

  if v_row.store_id is null then raise exception 'VERSION_CONFLICT'; end if;
  return v_row;
end;
$$;

revoke all on function public.save_store_state_for_user(jsonb,bigint) from anon;
grant execute on function public.save_store_state_for_user(jsonb,bigint) to authenticated;
