-- Close two advisor warnings introduced by the previous migration
-- (20260831_realtime_store_state_sync_v23):
--   1. project_staff_state() had a mutable search_path (linter WARN).
--   2. sync_store_state_staff_view() is a trigger function; it should never
--      be callable directly as an RPC by anon/authenticated, only fired by
--      the trigger itself.

create or replace function public.project_staff_state(p_state jsonb)
returns jsonb language plpgsql set search_path=public as $$
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

revoke execute on function public.sync_store_state_staff_view() from public, anon, authenticated;
