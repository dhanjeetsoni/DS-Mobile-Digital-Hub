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
 and x->>'account' in ('Cash','Online payment clearing','Collected payments clearing','Customer receivables','Sales revenue','Tax payable','Cost of goods sold','Inventory','Supplier payables','Inventory purchases (gross)','Operating expenses','Owner drawings','Cheque clearing','Finance receivable','Finance dealer subvention','Bank (owner-confirmed)','Opening owner equity','Opening loans payable','Opening fixed assets')),false) from jsonb_array_elements(p_lines) x)
 else false end $function$
;

CREATE OR REPLACE FUNCTION ds_accounting.guard_opening_cutoff()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d date;
begin
 perform 1 from public.stores where id=new.store_id for share;
 select effective_date into d from ds_accounting.pos_events where store_id=new.store_id and source_kind='opening';
 if new.source_kind<>'opening' and d is not null and new.effective_date<=d then raise exception 'Posting date must follow verified opening balance date %',d;end if;
 if new.source_kind='opening' and exists(select 1 from ds_accounting.pos_events where store_id=new.store_id and effective_date<=new.effective_date) then raise exception 'Opening balance must precede all existing posted events';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_journal_opening(p_date date, p_reference text, p_lines jsonb, p_confirmation text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();v_id bigint;v_lines jsonb;
begin
 if p_date is null or p_date>=(now() at time zone 'Asia/Kolkata')::date or p_confirmation is distinct from 'OPENING:'||p_date::text or length(btrim(coalesce(p_reference,''))) not between 5 and 120 then raise exception 'Provide completed opening date, evidence reference and explicit confirmation';end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 2 and 11 then raise exception 'Provide 2–11 reviewed opening accounts';end if;
 if not ds_accounting.balanced(p_lines) or exists(select 1 from jsonb_array_elements(p_lines) x where x->>'account' not in ('Cash','Bank (owner-confirmed)','Inventory','Customer receivables','Finance receivable','Opening fixed assets','Supplier payables','Tax payable','Opening loans payable','Opening owner equity') or (x->>'debit')::numeric>1000000000000 or (x->>'credit')::numeric>1000000000000 or (x->>'account' in ('Cash','Bank (owner-confirmed)','Inventory','Customer receivables','Finance receivable','Opening fixed assets') and (x->>'credit')::numeric<>0) or (x->>'account' in ('Supplier payables','Tax payable','Opening loans payable') and (x->>'debit')::numeric<>0)) or (select count(distinct x->>'account') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'Opening accounts must be unique, approved, valid and balanced';end if;
 perform 1 from public.stores where id=st for update;
 select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'debit')::numeric,'credit',(x->>'credit')::numeric) order by x->>'account') into v_lines from jsonb_array_elements(p_lines) x;
 select id into v_id from ds_accounting.pos_events where store_id=st and source_kind='opening' and effective_date=p_date and invoice_no='OPENING: '||btrim(p_reference) and lines=v_lines;
 if v_id is not null then return v_id;end if;
 if exists(select 1 from ds_accounting.pos_events where store_id=st and source_kind='opening') then raise exception 'Opening journal already exists; do not duplicate or overwrite';end if;
 insert into ds_accounting.pos_events(store_id,source_kind,source_id,invoice_no,event_kind,effective_date,recorded_by,lines) values(st,'opening',gen_random_uuid(),'OPENING: '||btrim(p_reference),'posting',p_date,auth.uid(),v_lines) returning id into v_id;
 return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.read_journal_opening()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();r jsonb; earliest date;
begin
 select to_jsonb(e) into r from (select id,effective_date,invoice_no,lines,recorded_at from ds_accounting.pos_events where store_id=st and source_kind='opening') e;
 select min(effective_date) into earliest from ds_accounting.pos_events where store_id=st and source_kind<>'opening';
 return jsonb_build_object('opening',r,'earliest_posted',earliest,'closed_through',(select journal_closed_through from public.stores where id=st));
end $function$
;
alter table ds_accounting.pos_events drop constraint pos_events_source_kind_check;
alter table ds_accounting.pos_events add constraint pos_events_source_kind_check check(source_kind in ('pos','purchase','supplier_payment','customer_payment','expense','drawing','return','exchange','finance_settlement','opening'));
create unique index one_opening_journal_per_store on ds_accounting.pos_events(store_id) where source_kind='opening';
revoke all on function ds_accounting.guard_opening_cutoff() from public,anon,authenticated;
create trigger journal_opening_cutoff_guard before insert on ds_accounting.pos_events for each row execute function ds_accounting.guard_opening_cutoff();
revoke all on function public.read_journal_opening(),public.post_journal_opening(date,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.read_journal_opening(),public.post_journal_opening(date,text,jsonb,text) to authenticated;
