alter table ds_accounting.pos_events drop constraint pos_events_source_kind_check;
alter table ds_accounting.pos_events add constraint pos_events_source_kind_check check(source_kind in ('pos','purchase','supplier_payment','customer_payment','expense','drawing','return','exchange'));
CREATE OR REPLACE FUNCTION public.list_business_journal_sources(p_kind text, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_store uuid:=ds_accounting.owner_store();v_start timestamptz;v_end timestamptz;v_result jsonb;v_total bigint;
begin
 if p_kind is null or p_kind not in ('purchase','supplier_payment','customer_payment','expense','drawing','return','exchange') or p_day is null then raise exception 'invalid source or date';end if;
 v_start:=p_day::timestamp at time zone 'Asia/Kolkata';v_end:=(p_day+1)::timestamp at time zone 'Asia/Kolkata';
 with sources as (
 select id,created_at,total amount,coalesce(nullif(invoice_ref,''),id::text) reference,payment_status method from public.purchases where p_kind='purchase' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.supplier_transactions where p_kind='supplier_payment' and store_id=v_store and type='payment' and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.customer_payments where p_kind='customer_payment' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.expenses where p_kind='expense' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,amount,id::text,method from public.personal_drawings where p_kind='drawing' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,refund_amount,coalesce(nullif(return_no,''),id::text),refund_method from public.returns where p_kind='return' and store_id=v_store and created_at>=v_start and created_at<v_end
 union all select id,created_at,difference_amount,coalesce(nullif(exchange_no,''),id::text),settlement_method from public.exchanges where p_kind='exchange' and store_id=v_store and created_at>=v_start and created_at<v_end
 ), counted as (select *,count(*) over() total from sources order by created_at desc,id desc limit 200)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reference',c.reference,'amount',c.amount,'method',c.method,'recorded_at',c.created_at,'previously_posted',exists(select 1 from ds_accounting.pos_events e where e.store_id=v_store and e.source_kind=p_kind and e.source_id=c.id)) order by c.created_at desc,c.id desc),'[]'::jsonb),coalesce(max(c.total),0) into v_result,v_total from counted c;
 return jsonb_build_object('sources',v_result,'total',v_total,'truncated',v_total>200);
end $function$
;

CREATE OR REPLACE FUNCTION public.post_business_journal_source(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_store uuid:=ds_accounting.owner_store();
begin
 if p_kind in ('return','exchange') then return ds_accounting.reconcile_trade_adjustment(v_store,p_kind,p_id,auth.uid());end if;
 return ds_accounting.reconcile_transaction(v_store,p_kind,p_id,auth.uid());
end $function$
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
 if (exists(select 1 from public.returns r where r.store_id=p_store and r.sale_id=p_sale) or exists(select 1 from public.exchanges e where e.store_id=p_store and e.sale_id=p_sale)) and (s.status='Cancelled' or (prev.id is not null and (prev.lines is distinct from v_lines or prev.invoice_no is distinct from s.invoice_no or prev.effective_date is distinct from v_day))) then return jsonb_build_object('status','review','reason','Original invoice changed after return/exchange; reconcile adjustments first');end if;
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

CREATE OR REPLACE FUNCTION ds_accounting.reconcile_trade_adjustment(p_store uuid, p_kind text, p_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.returns%rowtype;e public.exchanges%rowtype;s public.sales%rowtype;v_sale uuid;v_ref text;v_when timestamptz;v_method text;v_channel text;v_refund numeric:=0;v_replacement numeric:=0;v_returncost numeric:=0;v_newcost numeric:=0;v_delta numeric;v_lines jsonb;prev ds_accounting.pos_events%rowtype;v_reverse jsonb;v_events int:=0;v_day date;v_count bigint;v_price numeric;v_cost numeric;v_qty numeric;v_bad bigint;
begin
 if p_kind not in ('return','exchange') or p_store is null or p_id is null or p_actor is null then raise exception 'invalid adjustment source';end if;
 if p_kind='return' then
  select * into r from public.returns where store_id=p_store and id=p_id;
  if not found then return jsonb_build_object('status','review','reason','Return not found');end if;
  v_sale:=r.sale_id;v_ref:=coalesce(nullif(r.return_no,''),r.id::text);v_when:=r.created_at;v_method:=r.refund_method;v_refund:=r.refund_amount;
 else
  select * into e from public.exchanges where store_id=p_store and id=p_id;
  if not found then return jsonb_build_object('status','review','reason','Exchange not found');end if;
  v_sale:=e.sale_id;v_ref:=coalesce(nullif(e.exchange_no,''),e.id::text);v_when:=e.created_at;v_method:=e.settlement_method;v_refund:=e.returned_value;v_replacement:=e.replacement_value;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||':'||v_sale::text,0));
 select * into s from public.sales where store_id=p_store and id=v_sale for share;
 if not found or s.status<>'Paid' or s.amount_paid is distinct from s.total or s.due_amount is distinct from 0::numeric or s.tax<>0 or s.discount<>0 or s.finance_loan_amount is not null or coalesce(s.payment_method ilike 'Finance%',false) then return jsonb_build_object('status','review','reason','Original sale requires tax, finance or payment allocation review');end if;
 if not exists(select 1 from ds_accounting.pos_events where store_id=p_store and source_kind='pos' and source_id=v_sale and id=(select max(id) from ds_accounting.pos_events where store_id=p_store and source_kind='pos' and source_id=v_sale) and event_kind='posting') then return jsonb_build_object('status','review','reason','Post original invoice first');end if;
 if v_refund is null or v_replacement is null or v_refund<0 or v_replacement<0 or v_refund::text in ('NaN','Infinity','-Infinity') or v_replacement::text in ('NaN','Infinity','-Infinity') or round(v_refund,2)<>v_refund or round(v_replacement,2)<>v_replacement then return jsonb_build_object('status','review','reason','Invalid adjustment amounts');end if;
 if exists(with q as (select product_id,quantity from public.returns where store_id=p_store and sale_id=v_sale union all select i.product_id,i.quantity from public.exchange_items i join public.exchanges x on x.id=i.exchange_id where x.store_id=p_store and x.sale_id=v_sale and i.kind='returned') select 1 from q group by product_id having product_id is null or sum(quantity)>(select coalesce(sum(si.quantity),0) from public.sale_items si where si.sale_id=v_sale and si.product_id=q.product_id)) then return jsonb_build_object('status','review','reason','Combined returned quantities exceed sale');end if;
 if p_kind='return' then
  select count(*),max(unit_price),max(cost_price),max(quantity) into v_count,v_price,v_cost,v_qty from public.sale_items where sale_id=v_sale and product_id=r.product_id;
  if v_count<>1 or r.quantity is null or r.quantity<=0 or r.quantity>v_qty or v_cost is null or v_cost<0 or v_cost::text in ('NaN','Infinity','-Infinity') or round(r.quantity*v_price,2) is distinct from v_refund then return jsonb_build_object('status','review','reason','Return line does not match original sale');end if;
  v_returncost:=round(r.quantity*v_cost,2);
 else
  select count(*),count(*) filter(where i.product_id is null or i.quantity<=0 or i.unit_price<0 or i.purchase_price<0 or i.quantity::text in ('NaN','Infinity','-Infinity') or i.unit_price::text in ('NaN','Infinity','-Infinity') or i.purchase_price::text in ('NaN','Infinity','-Infinity') or i.kind not in ('returned','replacement') or (i.kind='returned' and not exists(select 1 from public.sale_items si where si.sale_id=v_sale and si.product_id=i.product_id and si.unit_price=i.unit_price and si.cost_price=i.purchase_price and si.quantity>=i.quantity and (select count(*) from public.sale_items sx where sx.sale_id=v_sale and sx.product_id=i.product_id)=1))),round(coalesce(sum(i.quantity*i.purchase_price) filter(where i.kind='returned'),0),2),round(coalesce(sum(i.quantity*i.purchase_price) filter(where i.kind='replacement'),0),2),round(coalesce(sum(i.quantity*i.unit_price) filter(where i.kind='returned'),0),2),round(coalesce(sum(i.quantity*i.unit_price) filter(where i.kind='replacement'),0),2) into v_count,v_bad,v_returncost,v_newcost,v_price,v_cost from public.exchange_items i where i.exchange_id=e.id;
  if v_count<2 or v_bad>0 or v_price<>v_refund or v_cost<>v_replacement or e.difference_amount is distinct from v_replacement-v_refund then return jsonb_build_object('status','review','reason','Exchange lines or original cost do not reconcile');end if;
 end if;
 v_delta:=v_replacement-v_refund;
 v_channel:=case when v_method='Cash (From Counter Galla)' then 'Cash' else ds_accounting.payment_account(v_method) end;
 if v_delta<>0 and v_channel is null then return jsonb_build_object('status','review','reason','Unverified refund or collection channel');end if;
 select jsonb_agg(jsonb_build_object('account',a,'debit',d,'credit',c) order by n) into v_lines from (values(1,'Sales revenue',v_refund,0::numeric),(2,'Sales revenue',0::numeric,v_replacement),(3,v_channel,greatest(v_delta,0),greatest(-v_delta,0)),(4,'Inventory',v_returncost,0::numeric),(5,'Cost of goods sold',0::numeric,v_returncost),(6,'Cost of goods sold',v_newcost,0::numeric),(7,'Inventory',0::numeric,v_newcost)) q(n,a,d,c) where d<>0 or c<>0;
 if not coalesce(ds_accounting.balanced(v_lines),false) then return jsonb_build_object('status','review','reason','No balanced adjustment to post');end if;
 v_day:=(v_when at time zone 'Asia/Kolkata')::date;
 select * into prev from ds_accounting.pos_events where store_id=p_store and source_kind=p_kind and source_id=p_id order by id desc limit 1;
 if prev.id is not null and prev.event_kind='posting' then
 if prev.lines=v_lines and prev.invoice_no=v_ref and prev.effective_date=v_day then return jsonb_build_object('status','unchanged','events',0);end if;
 select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric) order by n) into v_reverse from jsonb_array_elements(prev.lines) with ordinality q(x,n);
 insert into ds_accounting.pos_events(store_id,source_kind,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_by,lines) values(p_store,p_kind,p_id,prev.invoice_no,'reversal',prev.id,(now() at time zone 'Asia/Kolkata')::date,p_actor,v_reverse);v_events:=1;
 end if;
 insert into ds_accounting.pos_events(store_id,source_kind,source_id,invoice_no,event_kind,effective_date,recorded_by,lines) values(p_store,p_kind,p_id,v_ref,'posting',v_day,p_actor,v_lines);
 return jsonb_build_object('status','posted','events',v_events+1);
end $function$
;
revoke all on function ds_accounting.reconcile_trade_adjustment(uuid,text,uuid,uuid) from public,anon,authenticated;
