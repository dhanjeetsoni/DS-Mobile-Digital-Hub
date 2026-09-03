-- Owner-only projection for the Byaj/Loan Lender Tracker (moneyLenders, lenderTransactions).
-- Staff must never see private lender principal/interest data, even via the staff-safe
-- state RPCs. This mirrors the existing pattern used for purchases/suppliers/expenses.
-- Bodies below are the v4/v11 originals with only the two new blanked/restored fields added.

create or replace function public.load_store_state_for_user()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_role text; v_state jsonb;
begin
 v_store:=public.my_store_id(); select role into v_role from public.profiles where id=auth.uid() and store_id=v_store; select state into v_state from public.store_state where store_id=v_store;
 if v_role in ('owner','manager') then return v_state; end if;
 v_state:=jsonb_set(v_state,'{products}',coalesce((select jsonb_agg(p-'purchasePrice'-'pendingCost'-'supplier'-'units') from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) p),'[]'::jsonb),true);
 v_state:=jsonb_set(v_state,'{stockBatches}',coalesce((select jsonb_agg(b-'purchasePrice') from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b),'[]'::jsonb),true);
 v_state:=jsonb_set(v_state,'{sales}',coalesce((select jsonb_agg((s-'items'-'financeDetails') || jsonb_build_object('items',coalesce((select jsonb_agg(i-'purchasePrice'-'cost'-'batchConsumption') from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i),'[]'::jsonb))) from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s),'[]'::jsonb),true);
 v_state:=jsonb_set(v_state,'{purchases}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{suppliers}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{supplierPayments}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{expenses}',jsonb_build_object('shop','[]'::jsonb,'personal','[]'::jsonb,'other','[]'::jsonb),true); v_state:=jsonb_set(v_state,'{secondHandKYCs}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{imeiRegistry}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{gallaClosings}','[]'::jsonb,true);
 v_state:=jsonb_set(v_state,'{moneyLenders}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{lenderTransactions}','[]'::jsonb,true);
 return v_state;
end; $$;
revoke all on function public.load_store_state_for_user() from anon;
grant execute on function public.load_store_state_for_user() to authenticated;

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
  -- cannot silently disappear on the next snapshot.
  v_state:=jsonb_set(v_state,'{purchases}',public.merge_staff_json_array(v_current->'purchases',v_state->'purchases'),true);
  v_state:=jsonb_set(v_state,'{suppliers}',public.merge_staff_json_array(v_current->'suppliers',v_state->'suppliers'),true);
  v_state:=jsonb_set(v_state,'{supplierPayments}',public.merge_staff_json_array(v_current->'supplierPayments',v_state->'supplierPayments'),true);
  v_state:=jsonb_set(v_state,'{secondHandKYCs}',public.merge_staff_json_array(v_current->'secondHandKYCs',v_state->'secondHandKYCs'),true);
  v_state:=jsonb_set(v_state,'{imeiRegistry}',public.merge_staff_json_array(v_current->'imeiRegistry',v_state->'imeiRegistry'),true);
  v_state:=jsonb_set(v_state,'{gallaClosings}',public.merge_staff_json_array(v_current->'gallaClosings',v_state->'gallaClosings'),true);
  v_state:=jsonb_set(v_state,'{exchanges}',public.merge_staff_json_array(v_current->'exchanges',v_state->'exchanges'),true);

  v_state:=jsonb_set(v_state,'{expenses}',jsonb_build_object(
    'shop',public.merge_staff_json_array(v_current->'expenses'->'shop',v_state->'expenses'->'shop'),
    'personal',public.merge_staff_json_array(v_current->'expenses'->'personal',v_state->'expenses'->'personal'),
    'other',public.merge_staff_json_array(v_current->'expenses'->'other',v_state->'expenses'->'other')
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
