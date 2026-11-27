CREATE OR REPLACE FUNCTION public.ensure_sale_telegram_bill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.sales%rowtype;v_invoice uuid;v_chat text;v_payload jsonb;v_items jsonb;v_actor text;
begin
 if auth.uid() is null then return new;end if;
 select * into s from public.sales where id=new.id and store_id=new.store_id;
 if s.id is null then return new;end if;
 select id into v_invoice from public.invoices where sale_id=s.id and store_id=s.store_id order by created_at limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('name',left(coalesce(i.service_name,p.model,p.brand,'Item'),180),'quantity',i.quantity,'unitPrice',i.unit_price,'gift',coalesce(i.is_gift,false)) order by i.id),'[]'::jsonb) into v_items from public.sale_items i left join public.products p on p.id=i.product_id and p.store_id=s.store_id where i.sale_id=s.id;
 select coalesce(nullif(staff_name,''),nullif(full_name,''),role) into v_actor from public.profiles where id=s.created_by and store_id=s.store_id;
 v_payload:=jsonb_build_object('schema','pos-v1','reference',s.invoice_no,'kind','Original POS invoice','date',to_char(s.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS'),'soldBy',coalesce(v_actor,'Staff'),'customer',coalesce(s.customer_name,'Walk-in'),'phone',coalesce(s.customer_phone,''),'payment',s.payment_method,'status',s.status,'subtotal',s.subtotal,'discount',s.discount,'tax',s.tax,'total',s.total,'paid',s.amount_paid,'due',s.due_amount,'financeLoan',s.finance_loan_amount,'items',v_items);
 v_chat:=coalesce(public.owner_bill_chat(s.store_id),'');
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,sale_id,invoice_id,next_attempt_at,bill_source_key,last_error,bill_payload)
 values(s.store_id,v_chat,'Invoice '||s.invoice_no,'pending',0,s.id,v_invoice,now(),'pos:'||s.id::text,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end,v_payload)
 on conflict(sale_id) where sale_id is not null do update set bill_payload=excluded.bill_payload where public.telegram_outbox.bill_payload is null and public.telegram_outbox.status='pending' and public.telegram_outbox.telegram_message_id is null and public.telegram_outbox.telegram_document_id is null;
 return new;
end $function$
;
revoke all on function public.ensure_sale_telegram_bill() from public,anon,authenticated;
