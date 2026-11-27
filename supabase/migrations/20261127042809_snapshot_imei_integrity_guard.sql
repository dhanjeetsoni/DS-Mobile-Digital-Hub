-- Reject cross-device and cross-slot identifier collisions in canonical snapshots.
CREATE OR REPLACE FUNCTION ds_recovery.assert_snapshot_imei_integrity(p_state jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_bad boolean;
begin
 with units as (
  select u from jsonb_array_elements(case when jsonb_typeof(p_state->'imeiRegistry')='array' then p_state->'imeiRegistry' else '[]'::jsonb end) u
  union all
  select u from jsonb_array_elements(case when jsonb_typeof(p_state->'products')='array' then p_state->'products' else '[]'::jsonb end) p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p->'units')='array' then p->'units' else '[]'::jsonb end) u
 ), slots as (
  select btrim(coalesce(u->>'id','')) unit_id,btrim(coalesce(u->>'productId','')) product_id,s.slot,btrim(s.imei) imei
  from units cross join lateral (values ('1',u->>'imei1'),('2',u->>'imei2')) s(slot,imei)
  where nullif(btrim(s.imei),'') is not null
 )
 select exists(select 1 from slots where unit_id='' or imei !~ '^[0-9]{15}$')
 or exists(select 1 from slots group by imei having count(distinct unit_id)>1 or count(distinct slot)>1 or count(distinct nullif(product_id,''))>1)
 or exists(select 1 from slots group by unit_id,slot having count(distinct imei)>1)
 into v_bad;
 if v_bad then raise exception 'IMEI registry conflict: review device identifiers before synchronization' using errcode='23514';end if;
end $function$
;
revoke all on function ds_recovery.assert_snapshot_imei_integrity(jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION ds_recovery.guard_snapshot_imei_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if tg_op='UPDATE' and new.state->'imeiRegistry' is not distinct from old.state->'imeiRegistry' and new.state->'products' is not distinct from old.state->'products' then return new;end if;
 perform ds_recovery.assert_snapshot_imei_integrity(new.state);
 return new;
end $function$
;
revoke all on function ds_recovery.guard_snapshot_imei_integrity() from public,anon,authenticated;
CREATE TRIGGER guard_snapshot_imei_integrity BEFORE INSERT OR UPDATE OF state ON public.store_state FOR EACH ROW EXECUTE FUNCTION ds_recovery.guard_snapshot_imei_integrity();
