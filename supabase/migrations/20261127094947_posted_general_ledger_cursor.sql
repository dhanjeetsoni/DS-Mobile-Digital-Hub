create index if not exists posted_events_store_date_id_idx on ds_accounting.pos_events(store_id,effective_date,id);
CREATE OR REPLACE FUNCTION public.read_posted_general_ledger(p_account text, p_from date, p_to date, p_snapshot bigint DEFAULT NULL::bigint, p_after_date date DEFAULT NULL::date, p_after_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();v_snapshot bigint;v_open numeric;v_close numeric;v_rows jsonb;v_total bigint;v_next boolean;
begin
 if p_account is null or length(btrim(p_account)) not between 1 and 120 or p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or (p_after_date is null)<>(p_after_id is null) or (p_after_date is not null and (p_after_date<p_from or p_after_date>p_to or p_after_id<1)) or (p_snapshot is not null and p_snapshot<0) then raise exception 'Invalid ledger request';end if;
 select coalesce(max(id),0) into v_snapshot from ds_accounting.pos_events where store_id=st;
 v_snapshot:=least(v_snapshot,coalesce(p_snapshot,v_snapshot));
 with entries as (
 select e.id,e.source_kind,e.invoice_no,e.event_kind,e.effective_date,e.recorded_at,e.reverses_id,sum((x->>'debit')::numeric) debit,sum((x->>'credit')::numeric) credit
 from ds_accounting.pos_events e cross join lateral jsonb_array_elements(e.lines) x where e.store_id=st and e.id<=v_snapshot and e.effective_date<=p_to and x->>'account'=p_account
 group by e.id,e.source_kind,e.invoice_no,e.event_kind,e.effective_date,e.recorded_at,e.reverses_id),
 balances as (select *,sum(debit-credit) over(order by effective_date,id rows between unbounded preceding and current row) balance from entries),
 page as (select * from balances where effective_date>=p_from and (p_after_date is null or (effective_date,id)>(p_after_date,p_after_id)) order by effective_date,id limit 101)
 select coalesce((select sum(debit-credit) from entries where effective_date<p_from),0),coalesce((select sum(debit-credit) from entries),0),(select count(*) from entries where effective_date>=p_from),(select coalesce(jsonb_agg(to_jsonb(q) order by q.effective_date,q.id),'[]'::jsonb) from (select * from page order by effective_date,id limit 100) q),(select count(*)>100 from page) into v_open,v_close,v_total,v_rows,v_next;
 return jsonb_build_object('account',p_account,'from',p_from,'to',p_to,'snapshot',v_snapshot,'opening',v_open,'closing',v_close,'total',v_total,'rows',v_rows,'hasMore',v_next);
end $function$
;
revoke all on function public.read_posted_general_ledger(text,date,date,bigint,date,bigint) from public,anon,authenticated;
grant execute on function public.read_posted_general_ledger(text,date,date,bigint,date,bigint) to authenticated;
