alter table ds_accounting.pos_events add column source_kind text not null default 'pos' check(source_kind in ('pos','purchase','supplier_payment','customer_payment','expense','drawing'));
create index accounting_event_source_kind_idx on ds_accounting.pos_events(store_id,source_kind,source_id,id desc);
create or replace function ds_accounting.balanced(p_lines jsonb) returns boolean language sql immutable set search_path='' as $$
select case when jsonb_typeof(p_lines)='array' then
 (select count(*)>=2 and coalesce(sum((x->>'debit')::numeric),0)=coalesce(sum((x->>'credit')::numeric),0)
 and coalesce(bool_and(jsonb_typeof(x->'debit')='number' and jsonb_typeof(x->'credit')='number'
 and (x->>'debit')::numeric>=0 and (x->>'credit')::numeric>=0
 and ((x->>'debit')::numeric>0) <> ((x->>'credit')::numeric>0)
 and round((x->>'debit')::numeric,2)=(x->>'debit')::numeric and round((x->>'credit')::numeric,2)=(x->>'credit')::numeric
 and x->>'account' in ('Cash','Online payment clearing','Collected payments clearing','Customer receivables','Sales revenue','Tax payable','Cost of goods sold','Inventory','Supplier payables','Inventory purchases (gross)','Operating expenses','Owner drawings','Cheque clearing')),false) from jsonb_array_elements(p_lines) x)
 else false end $$;
revoke all on function ds_accounting.balanced(jsonb) from public,anon,authenticated;
do $patch$
declare f text;
begin
 f:=pg_get_functiondef('ds_accounting.reconcile_pos(uuid,uuid,uuid)'::regprocedure);
 if position('where store_id=p_store and source_id=p_sale order by id desc limit 1' in f)=0 then raise exception 'POS source lookup changed';end if;
 execute replace(f,'where store_id=p_store and source_id=p_sale order by id desc limit 1','where store_id=p_store and source_kind=''pos'' and source_id=p_sale order by id desc limit 1');
end $patch$;
create function ds_accounting.payment_account(p_method text) returns text language sql immutable set search_path='' as $$
select case lower(btrim(p_method)) when 'cash' then 'Cash' when 'upi' then 'Online payment clearing' when 'card' then 'Online payment clearing' when 'bank transfer' then 'Online payment clearing' when 'online' then 'Online payment clearing' when 'cheque' then 'Cheque clearing' else null end
$$;
revoke all on function ds_accounting.payment_account(text) from public,anon,authenticated;
create function ds_accounting.reconcile_transaction(p_store uuid,p_kind text,p_id uuid,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_amount numeric;v_when timestamptz;v_method text;v_ref text;v_debit text;v_credit text;v_sum numeric;v_count bigint;v_bad bigint;v_lines jsonb;v_reverse jsonb;prev ds_accounting.pos_events%rowtype;v_day date;v_events int:=0;
begin
 if p_store is null or p_id is null or p_actor is null or p_kind is null or p_kind not in ('purchase','supplier_payment','customer_payment','expense','drawing') then raise exception 'invalid source';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||':'||p_kind||':'||p_id::text,0));
 case p_kind
 when 'purchase' then
 select total,created_at,payment_status,coalesce(nullif(invoice_ref,''),id::text) into v_amount,v_when,v_method,v_ref from public.purchases where store_id=p_store and id=p_id for share;
 if found then
 select count(*),count(*) filter(where quantity is null or quantity<=0 or purchase_price is null or purchase_price<0 or quantity::text in ('NaN','Infinity','-Infinity') or purchase_price::text in ('NaN','Infinity','-Infinity')),round(coalesce(sum(quantity*purchase_price),0),2) into v_count,v_bad,v_sum from public.purchase_items where purchase_id=p_id;
 if v_count=0 or v_bad>0 or v_sum<>round(v_amount,2) then return jsonb_build_object('status','review','reason','Purchase lines or amount incomplete');end if;
 v_debit:='Inventory purchases (gross)';v_credit:=case v_method when 'Paid Cash' then 'Cash' when 'Paid Online' then 'Online payment clearing' when 'Purchased on Credit (Udhaar)' then 'Supplier payables' else null end;
 end if;
 when 'supplier_payment' then
 select amount,created_at,method,id::text into v_amount,v_when,v_method,v_ref from public.supplier_transactions where store_id=p_store and id=p_id and type='payment' and exists(select 1 from public.suppliers s where s.id=supplier_id and s.store_id=p_store) for share;
 v_debit:='Supplier payables';v_credit:=ds_accounting.payment_account(v_method);
 when 'customer_payment' then
 select amount,created_at,method,id::text into v_amount,v_when,v_method,v_ref from public.customer_payments where store_id=p_store and id=p_id and exists(select 1 from public.customers c where c.id=customer_id and c.store_id=p_store) for share;
 v_debit:=ds_accounting.payment_account(v_method);v_credit:='Customer receivables';
 when 'expense' then
 select amount,created_at,method,id::text into v_amount,v_when,v_method,v_ref from public.expenses where store_id=p_store and id=p_id and coalesce(lower(category),'') not in ('personal','drawing','owner drawings') for share;
 v_debit:='Operating expenses';v_credit:=ds_accounting.payment_account(v_method);
 when 'drawing' then
 select amount,created_at,method,id::text into v_amount,v_when,v_method,v_ref from public.personal_drawings where store_id=p_store and id=p_id for share;
 v_debit:='Owner drawings';v_credit:=ds_accounting.payment_account(v_method);
 end case;
 if v_when is null then return jsonb_build_object('status','review','reason','Source missing or requires manual classification');end if;
 if v_amount is null or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<=0 or round(v_amount,2)<>v_amount or v_debit is null or v_credit is null then return jsonb_build_object('status','review','reason','Invalid amount or unverified payment method');end if;
 v_day:=(v_when at time zone 'Asia/Kolkata')::date;
 v_lines:=jsonb_build_array(jsonb_build_object('account',v_debit,'debit',v_amount,'credit',0),jsonb_build_object('account',v_credit,'debit',0,'credit',v_amount));
 select * into prev from ds_accounting.pos_events where store_id=p_store and source_kind=p_kind and source_id=p_id order by id desc limit 1;
 if prev.id is not null and prev.event_kind='posting' then
 if prev.lines=v_lines and prev.invoice_no=v_ref and prev.effective_date=v_day then return jsonb_build_object('status','unchanged','events',0);end if;
 select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric) order by n) into v_reverse from jsonb_array_elements(prev.lines) with ordinality q(x,n);
 insert into ds_accounting.pos_events(store_id,source_kind,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_by,lines) values(p_store,p_kind,p_id,prev.invoice_no,'reversal',prev.id,(now() at time zone 'Asia/Kolkata')::date,p_actor,v_reverse);
 v_events:=1;
 end if;
 insert into ds_accounting.pos_events(store_id,source_kind,source_id,invoice_no,event_kind,effective_date,recorded_by,lines) values(p_store,p_kind,p_id,v_ref,'posting',v_day,p_actor,v_lines);
 return jsonb_build_object('status','posted','events',v_events+1);
end $$;
revoke all on function ds_accounting.reconcile_transaction(uuid,text,uuid,uuid) from public,anon,authenticated;
create function public.post_business_journal_source(p_kind text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_store uuid:=ds_accounting.owner_store();
begin return ds_accounting.reconcile_transaction(v_store,p_kind,p_id,auth.uid());end $$;
revoke all on function public.post_business_journal_source(text,uuid) from public,anon,authenticated;
grant execute on function public.post_business_journal_source(text,uuid) to authenticated;
create function public.list_business_journal_sources(p_kind text,p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_store uuid:=ds_accounting.owner_store();v_start timestamptz;v_end timestamptz;v_result jsonb;v_total bigint;
begin
 if p_kind is null or p_kind not in ('purchase','supplier_payment','customer_payment','expense','drawing') or p_day is null then raise exception 'invalid source or date';end if;
 v_start:=p_day::timestamp at time zone 'Asia/Kolkata';v_end:=(p_day+1)::timestamp at time zone 'Asia/Kolkata';
 with sources as (
 select id,created_at,total amount,coalesce(nullif(invoice_ref,''),id::text) reference,payment_status method from public.purchases where p_kind='purchase' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.supplier_transactions where p_kind='supplier_payment' and store_id=v_store and type='payment' and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.customer_payments where p_kind='customer_payment' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.expenses where p_kind='expense' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.personal_drawings where p_kind='drawing' and store_id=v_store and created_at>=v_start and created_at<v_end
 ), counted as (select *,count(*) over() total from sources order by created_at desc,id desc limit 200)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reference',c.reference,'amount',c.amount,'method',c.method,'recorded_at',c.created_at,'previously_posted',exists(select 1 from ds_accounting.pos_events e where e.store_id=v_store and e.source_kind=p_kind and e.source_id=c.id)) order by c.created_at desc,c.id desc),'[]'::jsonb),coalesce(max(c.total),0) into v_result,v_total from counted c;
 return jsonb_build_object('sources',v_result,'total',v_total,'truncated',v_total>200);
end $$;
revoke all on function public.list_business_journal_sources(text,date) from public,anon,authenticated;
grant execute on function public.list_business_journal_sources(text,date) to authenticated;
create function public.read_business_journal(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_store uuid:=ds_accounting.owner_store();v_count bigint;v_rows jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'choose a range of at most 93 days';end if;
 select count(*) into v_count from ds_accounting.pos_events where store_id=v_store and effective_date between p_from and p_to;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]'::jsonb) into v_rows from (select id,source_kind,invoice_no,event_kind,effective_date,recorded_at,reverses_id,lines from ds_accounting.pos_events where store_id=v_store and effective_date between p_from and p_to order by id desc limit 500) x;
 return jsonb_build_object('events',v_rows,'total',v_count,'truncated',v_count>500);
end $$;
revoke all on function public.read_business_journal(date,date) from public,anon,authenticated;
grant execute on function public.read_business_journal(date,date) to authenticated;
-- Keep the previous POS-only reader semantically unchanged.
do $patch$
declare f text;
begin
 f:=pg_get_functiondef('public.read_pos_journal(date,date)'::regprocedure);
 execute replace(f,'where store_id=v_store and effective_date','where store_id=v_store and source_kind=''pos'' and effective_date');
end $patch$;
