CREATE OR REPLACE FUNCTION public.read_telegram_coverage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store(); result jsonb;
begin
 with snapshot as (select state from public.store_state where store_id=st), sources as (
 select 'POS' kind,'pos:'||id::text key,id sale_id from public.sales where store_id=st
 union all select 'Cybercafe','xerox:'||(x->>'id'),null::uuid from snapshot cross join lateral jsonb_array_elements(case when jsonb_typeof(state->'xeroxEntries')='array' then state->'xeroxEntries' else '[]'::jsonb end) x
 union all select 'Other income','income:'||(x->>'id'),null::uuid from snapshot cross join lateral jsonb_array_elements(case when jsonb_typeof(state->'extraIncome')='array' then state->'extraIncome' else '[]'::jsonb end) x where jsonb_typeof(x->'amount')='number' and (x->>'amount')::numeric>=0
 union all select 'SIM plan record','sim:'||(x->>'id'),null::uuid from snapshot cross join lateral jsonb_array_elements(case when jsonb_typeof(state->'simActivations')='array' then state->'simActivations' else '[]'::jsonb end) x where jsonb_typeof(x->'frcAmount')='number' and (x->>'frcAmount')::numeric>=0
 union all select 'Repair advance','repair-advance:'||(x->>'id'),null::uuid from snapshot cross join lateral jsonb_array_elements(case when jsonb_typeof(state->'jobs')='array' then state->'jobs' else '[]'::jsonb end) x where jsonb_typeof(x->'advance')='number' and (x->>'advance')::numeric>0
 union all select 'Repair delivery','repair-delivery:'||(x->>'id'),null::uuid from snapshot cross join lateral jsonb_array_elements(case when jsonb_typeof(state->'jobs')='array' then state->'jobs' else '[]'::jsonb end) x where x->>'status'='Delivered' and (jsonb_typeof(x->'finalCharge')='number' or jsonb_typeof(x->'estCost')='number')
 union all select 'Exchange','exchange:'||id::text,null::uuid from public.exchanges where store_id=st
 union select 'Return','return:'||coalesce(nullif(idempotency_key,''),id::text),null::uuid from public.returns where store_id=st
 ), coverage as (select distinct s.kind,s.key,s.sale_id,exists(select 1 from public.telegram_outbox o where o.store_id=st and (o.bill_source_key=s.key or (s.sale_id is not null and o.sale_id=s.sale_id))) queued,exists(select 1 from public.telegram_outbox o where o.store_id=st and (o.bill_source_key=s.key or (s.sale_id is not null and o.sale_id=s.sale_id)) and o.status='sent' and o.telegram_message_id is not null and o.telegram_document_id is not null) delivered from sources s), counts as (select kind,count(*) records,count(*) filter(where queued) queued,count(*) filter(where delivered) delivered,count(*) filter(where not queued) missing from coverage group by kind)
 select jsonb_build_object('sources',coalesce(jsonb_agg(to_jsonb(counts) order by kind),'[]'::jsonb),'scope','synchronized records; excludes historical correction events and unsynced devices') into result from counts;
 return result;
end $function$
;
revoke all on function public.read_telegram_coverage() from public,anon,authenticated;
grant execute on function public.read_telegram_coverage() to authenticated;
