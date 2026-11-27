alter table public.sales add column finance_settlement_ref text,add column finance_settlement_date date,add column finance_settlement_amount numeric;
alter table public.sales add constraint finance_settlement_evidence_complete check ((finance_settlement_ref is null and finance_settlement_date is null and finance_settlement_amount is null) or (finance_settlement_ref is not null and length(finance_settlement_ref) between 1 and 120 and finance_settlement_date is not null and finance_settlement_amount is not null and finance_settlement_amount>0 and finance_settlement_amount=finance_net_receivable and finance_settlement_amount::text not in ('NaN','Infinity','-Infinity')));
create unique index sales_finance_settlement_ref_unique on public.sales(store_id,upper(btrim(finance_settlement_ref))) where finance_settlement_ref is not null;
alter table ds_accounting.pos_events drop constraint pos_events_source_kind_check;
alter table ds_accounting.pos_events add constraint pos_events_source_kind_check check(source_kind in ('pos','purchase','supplier_payment','customer_payment','expense','drawing','return','exchange','finance_settlement'));
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
 and x->>'account' in ('Cash','Online payment clearing','Collected payments clearing','Customer receivables','Sales revenue','Tax payable','Cost of goods sold','Inventory','Supplier payables','Inventory purchases (gross)','Operating expenses','Owner drawings','Cheque clearing','Finance receivable','Finance dealer subvention','Bank (owner-confirmed)')),false) from jsonb_array_elements(p_lines) x)
 else false end $function$
;

CREATE OR REPLACE FUNCTION ds_accounting.guard_finance_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='INSERT' then
  if current_user in ('anon','authenticated') and new.finance_settlement_ref is not null then raise exception 'Finance settlement requires owner journal RPC';end if;
  return new;
 end if;
 if old.finance_settlement_ref is not null and (new.finance_settlement_ref is distinct from old.finance_settlement_ref or new.finance_settlement_date is distinct from old.finance_settlement_date or new.finance_settlement_amount is distinct from old.finance_settlement_amount or new.status is distinct from old.status or new.total is distinct from old.total or new.finance_loan_amount is distinct from old.finance_loan_amount or new.finance_net_receivable is distinct from old.finance_net_receivable or new.payment_method is distinct from old.payment_method or new.amount_paid is distinct from old.amount_paid or new.due_amount is distinct from old.due_amount) then raise exception 'Posted finance settlement requires separate clawback/reversal review';end if;
 if current_user in ('anon','authenticated') and (new.finance_settlement_ref is distinct from old.finance_settlement_ref or new.finance_settlement_date is distinct from old.finance_settlement_date or new.finance_settlement_amount is distinct from old.finance_settlement_amount) then raise exception 'Finance settlement requires owner journal RPC';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_finance_settlement(p_invoice_no text, p_reference text, p_date date, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();s public.sales%rowtype;ref text:=upper(btrim(p_reference));v jsonb;f jsonb;ans jsonb;lines jsonb;orig ds_accounting.pos_events%rowtype;v_state jsonb;
begin
 if p_invoice_no is null or length(p_invoice_no)>150 or ref is null or length(ref) not between 1 and 120 or ref~'^BANK-UTR-[0-9]+$' or p_date is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<>p_amount then return jsonb_build_object('status','review','reason','Invalid settlement evidence');end if;
 select state into v_state from public.store_state where store_id=st for share;
 select * into s from public.sales where store_id=st and invoice_no=btrim(p_invoice_no);
 if not found then return jsonb_build_object('status','review','reason','Sync original invoice first');end if;
 perform pg_advisory_xact_lock(hashtextextended(st::text||':'||s.id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(st::text||':finance-ref:'||ref,0));
 select * into s from public.sales where id=s.id and store_id=st for update;
 if s.finance_settlement_ref is not null then
  if s.finance_settlement_ref=ref and s.finance_settlement_date=p_date and s.finance_settlement_amount=p_amount and exists(select 1 from ds_accounting.pos_events where store_id=st and source_kind='finance_settlement' and source_id=s.id and event_kind='posting') then return jsonb_build_object('status','unchanged','events',0);end if;
  return jsonb_build_object('status','review','reason','Invoice already has different posted settlement evidence');
 end if;
 if s.status<>'Paid' or not coalesce(s.payment_method ilike 'Finance%',false) or s.finance_net_receivable is distinct from p_amount or p_date<(s.created_at at time zone 'Asia/Kolkata')::date or p_date>(now() at time zone 'Asia/Kolkata')::date then return jsonb_build_object('status','review','reason','Settlement differs from original invoice or date range');end if;
 if exists(select 1 from public.sales where store_id=st and upper(btrim(finance_settlement_ref))=ref and id<>s.id) then return jsonb_build_object('status','review','reason','Reference already posted to another invoice');end if;
 if exists(select 1 from public.returns where sale_id=s.id) or exists(select 1 from public.exchanges where sale_id=s.id) then return jsonb_build_object('status','review','reason','Finance return/exchange requires manual allocation');end if;
 if jsonb_typeof(v_state->'sales') is distinct from 'array' then return jsonb_build_object('status','review','reason','Sync owner-confirmed finance settlement first');end if;
 if (select count(*) from jsonb_array_elements(v_state->'sales') x where x->>'invoiceNo'=s.invoice_no)<>1 then return jsonb_build_object('status','review','reason','Unique synchronized invoice required');end if;
 select x into v from jsonb_array_elements(v_state->'sales') x where x->>'invoiceNo'=s.invoice_no;
 f:=v->'financeDetails';
 if f->>'payoutStatus' is distinct from 'Settled in Bank' or upper(btrim(f->>'utrRef')) is distinct from ref or f->>'settlementDate' is distinct from p_date::text or jsonb_typeof(f->'netBankReceivable') is distinct from 'number' or (f->>'netBankReceivable')::numeric is distinct from p_amount then return jsonb_build_object('status','review','reason','Save and sync matching owner-confirmed evidence first');end if;
 ans:=ds_accounting.reconcile_pos(st,s.id,auth.uid());
 if ans->>'status' not in ('posted','unchanged') then return ans;end if;
 select * into orig from ds_accounting.pos_events where store_id=st and source_kind='pos' and source_id=s.id order by id desc limit 1;
 if orig.event_kind is distinct from 'posting' or not exists(select 1 from jsonb_array_elements(orig.lines) x where x->>'account'='Finance receivable' and (x->>'debit')::numeric=p_amount) then raise exception 'Original receivable not posted';end if;
 lines:=jsonb_build_array(jsonb_build_object('account','Bank (owner-confirmed)','debit',p_amount,'credit',0),jsonb_build_object('account','Finance receivable','debit',0,'credit',p_amount));
 insert into ds_accounting.pos_events(store_id,source_kind,source_id,invoice_no,event_kind,effective_date,recorded_by,lines) values(st,'finance_settlement',s.id,s.invoice_no,'posting',p_date,auth.uid(),lines);
 update public.sales set finance_settlement_ref=ref,finance_settlement_date=p_date,finance_settlement_amount=p_amount where id=s.id;
 return jsonb_build_object('status','posted','events',1+coalesce((ans->>'events')::int,0));
end $function$
;
revoke all on function ds_accounting.guard_finance_settlement() from public,anon,authenticated;
create trigger finance_settlement_guard before insert or update on public.sales for each row execute function ds_accounting.guard_finance_settlement();
revoke all on function public.post_finance_settlement(text,text,date,numeric) from public,anon,authenticated;
grant execute on function public.post_finance_settlement(text,text,date,numeric) to authenticated;
