-- Phase 16 (2026-09-17): the staff-safe projection was never updated when the
-- newer feature modules landed (Smart Restock purchase orders, Staff Incentive
-- tracker, Security Audit Log, LAPU wallets, Extra Income). Two real gaps:
--
--   1. LEAK: `purchaseOrders` items carry `purchasePrice` / `totalCost`, so every
--      staff device was receiving real purchase-cost data -- exactly what this
--      projection exists to prevent. `staffIncentives` exposed one staff member's
--      commission to another; `securityAlerts` exposed the alerts raised about
--      staff to staff; `lapuWallets` / `extraIncome` are owner money records.
--   2. LEAK: `settings.ownerPasscode` (the Owner Confidential Area PIN) was
--      shipped verbatim inside the staff snapshot. Empty on this store at the
--      time of the fix, so nothing was exposed yet -- but the moment the owner
--      sets one it would propagate to every staff device in plaintext.
--
-- Fix mirrors the existing moneyLenders/lenderTransactions pattern exactly:
-- blanked on the staff read projection, and restored from the owner's current
-- state on a staff write so a staff device can never blank the owner's records.
--
-- Verified live after applying: project_staff_state() called with a synthetic
-- payload (passcode '7391', a purchase order carrying purchasePrice 450 /
-- totalCost 9000, incentives, alerts, lapu, extraIncome) returned '' for the
-- passcode and [] for all five collections, while settings.shopName survived.

create or replace function public.project_staff_state(p_state jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare v_state jsonb;
begin
  v_state := coalesce(p_state, '{}'::jsonb);
  v_state := jsonb_set(v_state,'{products}',coalesce((select jsonb_agg(p-'purchasePrice'-'pendingCost'-'supplier'-'units'-'confidentialPrice') from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) p),'[]'::jsonb),true);
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

  -- Phase 16 additions -- newer owner-only collections.
  v_state := jsonb_set(v_state,'{purchaseOrders}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{staffIncentives}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{securityAlerts}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{lapuWallets}','[]'::jsonb,true);
  v_state := jsonb_set(v_state,'{extraIncome}','[]'::jsonb,true);

  -- Phase 16: never ship the Owner Confidential Area passcode to a staff device.
  if v_state ? 'settings' and jsonb_typeof(v_state->'settings') = 'object' then
    v_state := jsonb_set(v_state,'{settings}', (v_state->'settings') || jsonb_build_object('ownerPasscode',''::text), true);
  end if;

  return v_state;
end;
$function$;

create or replace function public.save_store_state_for_user(p_state jsonb, p_expected_version bigint default null::bigint)
returns store_state
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Phase 16: same restore-from-owner treatment for the newer owner-only
  -- collections now blanked in project_staff_state(). Without this, a staff
  -- device saving its (blanked) snapshot would wipe the owner's real records.
  v_state:=jsonb_set(v_state,'{purchaseOrders}',coalesce(v_current->'purchaseOrders','[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{staffIncentives}',coalesce(v_current->'staffIncentives','[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{securityAlerts}',coalesce(v_current->'securityAlerts','[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{lapuWallets}',coalesce(v_current->'lapuWallets','[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{extraIncome}',coalesce(v_current->'extraIncome','[]'::jsonb),true);

  -- Phase 16: the staff copy of settings.ownerPasscode is always blanked, so a
  -- staff save must never be allowed to overwrite the owner's real passcode.
  if v_state ? 'settings' and jsonb_typeof(v_state->'settings') = 'object' then
    v_state := jsonb_set(v_state,'{settings}', (v_state->'settings') ||
      jsonb_build_object('ownerPasscode', coalesce(v_current->'settings'->'ownerPasscode', '""'::jsonb)), true);
  end if;

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
$function$;

-- The staff snapshot table is only refreshed by the trigger on store_state, so
-- the already-materialised row still held the leaky projection. Re-project it.
update public.store_state_staff_view v
set state = public.project_staff_state(s.state), updated_at = now()
from public.store_state s
where s.store_id = v.store_id;
