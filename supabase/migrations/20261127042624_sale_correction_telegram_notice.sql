-- Owner/manager financial changes generate separate correction notices, not additional sales.
CREATE OR REPLACE FUNCTION public.enqueue_sale_correction_bill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor text;v_chat text;v_key text;v_payload jsonb;
begin
 if auth.uid() is null or not public.current_account_allowed() then return new;end if;
 if new.store_id is distinct from old.store_id or new.id is distinct from old.id then return new;end if;
 if row(new.status,new.total,new.amount_paid,new.due_amount,new.payment_method,new.discount,new.tax,new.finance_loan_amount,new.finance_net_receivable) is not distinct from row(old.status,old.total,old.amount_paid,old.due_amount,old.payment_method,old.discount,old.tax,old.finance_loan_amount,old.finance_net_receivable) then return new;end if;
 select coalesce(nullif(p.staff_name,''),nullif(p.full_name,''),p.role) into v_actor from public.profiles p where p.id=auth.uid() and p.store_id=new.store_id and p.role in ('owner','manager');
 if v_actor is null then return new;end if;
 v_chat:=coalesce(public.owner_bill_chat(new.store_id),'');
 v_key:='sale-correction:'||new.id::text||':'||gen_random_uuid()::text;
 v_payload:=jsonb_build_object('reference',left(new.invoice_no||'-CORR',180),'kind',case when new.status='Cancelled' then 'Sale cancellation notice - not a new sale or proof of refund' else 'Sale correction notice - not additional revenue' end,'date',to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS'),'soldBy',v_actor,'payment',left(coalesce(old.payment_method,'Not recorded')||' -> '||coalesce(new.payment_method,'Not recorded')||'; status '||old.status||' -> '||new.status||'; paid '||coalesce(old.amount_paid::text,'unknown')||' -> '||coalesce(new.amount_paid::text,'unknown')||'; due '||coalesce(old.due_amount::text,'unknown')||' -> '||coalesce(new.due_amount::text,'unknown'),500),'total',new.total,'items',jsonb_build_array(jsonb_build_object('name','Previous recorded invoice total','quantity',1,'unitPrice',old.total),jsonb_build_object('name','Updated recorded invoice total (not a second charge)','quantity',1,'unitPrice',new.total)));
 insert into public.telegram_outbox(store_id,chat_id,message,bill_source_key,bill_payload,last_error) values(new.store_id,v_chat,'Sale correction notice',v_key,v_payload,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end);
 return new;
end $function$
;
revoke all on function public.enqueue_sale_correction_bill() from public,anon,authenticated;
CREATE TRIGGER sale_correction_telegram_enqueue AFTER UPDATE OF status, total, amount_paid, due_amount, payment_method, discount, tax, finance_loan_amount, finance_net_receivable ON public.sales FOR EACH ROW EXECUTE FUNCTION public.enqueue_sale_correction_bill();
