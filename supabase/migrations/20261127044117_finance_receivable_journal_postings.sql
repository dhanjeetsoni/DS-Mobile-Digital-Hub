-- Finance origination only; bank settlement needs independently verified evidence.
CREATE OR REPLACE FUNCTION ds_accounting.balanced(p_lines jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
select case when jsonb_typeof(p_lines)='array' then
 (select count(*)>=2 and coalesce(sum((x->>'debit')::numeric),0)=coalesce(sum((x->>'credit')::numeric),0)
 and coalesce(bool_and(jsonb_typeof(x->'debit')='number' and jsonb_typeof(x->'credit')='number'
 and (x->>'debit')::numeric>=0 and (x->>'credit')::numeric>=0
 and ((x->>'debit')::numeric>0) <> ((x->>'credit')::numeric>0)
 and round((x->>'debit')::numeric,2)=(x->>'debit')::numeric and round((x->>'credit')::numeric,2)=(x->>'credit')::numeric
 and x->>'account' in ('Cash','Online payment clearing','Collected payments clearing','Customer receivables','Sales revenue','Tax payable','Cost of goods sold','Inventory','Supplier payables','Inventory purchases (gross)','Operating expenses','Owner drawings','Cheque clearing','Finance receivable','Finance dealer subvention')),false) from jsonb_array_elements(p_lines) x)
 else false end $function$
;
CREATE OR REPLACE FUNCTION ds_accounting.reconcile_pos(p_store uuid, p_sale uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.sales%rowtype; prev ds_accounting.pos_events%rowtype; v_lines jsonb; v_reverse jsonb; v_cost numeric; v_gross numeric; v_paid numeric; v_due numeric; v_tax numeric; v_revenue numeric; v_channel text; v_bad bigint; v_count bigint; v_day date; v_events integer:=0; v_finance boolean; v_net numeric:=0; v_dbd numeric:=0;
begin
 if p_store is null or p_sale is null or p_actor is null then raise exception 'missing scope'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||':'||p_sale::text,0));
 select * into s from public.sales where id=p_sale and store_id=p_store for share;
 if not found then return jsonb_build_object('status','review','reason','Synchronized invoice not found'); end if;
 select * into prev from ds_accounting.pos_events where store_id=p_store and source_kind='pos' and source_id=p_sale order by id desc limit 1;
 v_day:=(s.created_at at time zone 'Asia/Kolkata')::date;
 if s.status='Cancelled' then
  v_lines:=null;
 else
  if exists(select 1 from public.returns r where r.store_id=p_store and r.sale_id=p_sale) or exists(select 1 from public.exchanges e where e.store_id=p_store and e.sale_id=p_sale) then return jsonb_build_object('status','review','reason','Return or exchange requires separate verified accounting');end if;
  v_finance:=coalesce(s.payment_method ilike 'Finance%',false) or s.finance_loan_amount is not null or s.finance_net_receivable is not null;
  if v_finance then
   if not coalesce(s.payment_method ilike 'Finance%',false) or s.finance_loan_amount is null or s.finance_net_receivable is null or s.amount_paid is null or s.due_amount is distinct from 0::numeric or s.finance_loan_amount<0 or s.finance_net_receivable<0 or s.finance_net_receivable>s.finance_loan_amount or round(s.amount_paid+s.finance_loan_amount,2)<>round(s.total,2) then return jsonb_build_object('status','review','reason','Incomplete finance allocation');end if;
   v_net:=round(s.finance_net_receivable,2);v_dbd:=round(s.finance_loan_amount,2)-v_net;
  end if;
  if s.amount_paid is null or s.due_amount is null or s.amount_paid<0 or s.due_amount<0 or s.total<0 or s.tax<0 or s.tax>s.total or round(s.total,2)<>round(s.amount_paid,2)+round(s.due_amount,2)+v_net+v_dbd then return jsonb_build_object('status','review','reason','Missing or inconsistent payment allocation');end if;
  v_paid:=round(s.amount_paid,2);v_due:=round(s.due_amount,2);v_tax:=round(s.tax,2);v_revenue:=round(s.total,2)-v_tax;
  v_channel:=case when v_finance then 'Collected payments clearing' when s.payment_method='Cash' then 'Cash' when s.payment_method in ('UPI','Card','Bank Transfer') then 'Online payment clearing' when s.payment_method in ('Split Payment','Split Payment (Multi-Mode)') then 'Collected payments clearing' else null end;
  if v_paid>0 and v_channel is null then return jsonb_build_object('status','review','reason','Unknown payment channel');end if;
  select count(*),count(*) filter(where cost_price is null or cost_price<0 or quantity<=0 or unit_price<0),round(coalesce(sum(quantity*cost_price),0),2),round(coalesce(sum(quantity*unit_price),0),2) into v_count,v_bad,v_cost,v_gross from public.sale_items where sale_id=p_sale;
  if v_count=0 or v_bad>0 or v_gross<>round(s.subtotal,2) or round(s.subtotal-s.discount+s.tax,2)<>round(s.total,2) then return jsonb_build_object('status','review','reason','Invoice items or FIFO cost incomplete');end if;
  select jsonb_agg(jsonb_build_object('account',a,'debit',d,'credit',c) order by n) into v_lines from (values (1,v_channel,v_paid,0::numeric),(2,'Customer receivables',v_due,0::numeric),(3,'Sales revenue',0::numeric,v_revenue),(4,'Tax payable',0::numeric,v_tax),(5,'Cost of goods sold',v_cost,0::numeric),(6,'Inventory',0::numeric,v_cost),(7,'Finance receivable',v_net,0::numeric),(8,'Finance dealer subvention',v_dbd,0::numeric)) x(n,a,d,c) where d<>0 or c<>0;
  if v_lines is null then return jsonb_build_object('status','review','reason','No nonzero journal amounts');end if;
  if not ds_accounting.balanced(v_lines) then return jsonb_build_object('status','review','reason','Journal is not balanced');end if;
 end if;
 if prev.id is not null and prev.event_kind='posting' then
  if v_lines=prev.lines and s.invoice_no=prev.invoice_no and v_day=prev.effective_date then return jsonb_build_object('status','unchanged','events',0);end if;
  select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric) order by n) into v_reverse from jsonb_array_elements(prev.lines) with ordinality q(x,n);
  insert into ds_accounting.pos_events(store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_by,lines) values(p_store,p_sale,prev.invoice_no,'reversal',prev.id,(now() at time zone 'Asia/Kolkata')::date,p_actor,v_reverse);
  v_events:=v_events+1;
 end if;
 if v_lines is not null then
  insert into ds_accounting.pos_events(store_id,source_id,invoice_no,event_kind,effective_date,recorded_by,lines) values(p_store,p_sale,s.invoice_no,'posting',v_day,p_actor,v_lines);
  v_events:=v_events+1;
 end if;
 return jsonb_build_object('status',case when v_events=0 then 'unchanged' else 'posted' end,'events',v_events);
end $function$
;
