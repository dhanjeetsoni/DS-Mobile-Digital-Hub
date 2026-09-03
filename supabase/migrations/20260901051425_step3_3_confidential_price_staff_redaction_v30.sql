-- Step 3.3 — 4-Tier Pricing System: staff-side redaction fix.
--
-- Reconciliation note: this migration was applied LIVE in the Step 3.3
-- session (verified via MCP at the time) but the .sql file was never saved
-- back into this ZIP's supabase/migrations folder — a drift caught and
-- fixed while working on Step 3.4. This file now matches, line-for-line,
-- `pg_get_functiondef()` read back from the live project
-- (vjimgnmbgghtsfafamye) to confirm they're identical.
--
-- What it does: `project_staff_state()` builds the sanitized JSON blob sent
-- to STAFF sessions (via `load_store_state_for_user()` and the realtime
-- `store_state_staff_view` mirror). Before this fix it already stripped
-- `purchasePrice` (Original price) from every product, but did not know
-- about the new `confidentialPrice` field added in Step 3.3 — meaning any
-- Confidential Price the owner set would leak straight to staff. This adds
-- `-'confidentialPrice'` to the products projection alongside the existing
-- strips.

create or replace function public.project_staff_state(p_state jsonb)
 returns jsonb
 language plpgsql
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
  return v_state;
end;
$function$
;
