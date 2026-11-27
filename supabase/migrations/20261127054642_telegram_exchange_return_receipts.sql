CREATE OR REPLACE FUNCTION public.enqueue_exchange_return_bill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor text; v_chat text; v_ref text; v_key text; v_kind text; v_payment text; v_total numeric; v_items jsonb; v_payload jsonb;v_invoice text;
begin
 if auth.uid() is null or not public.current_account_allowed() then return new;end if;
 select coalesce(nullif(p.staff_name,''),nullif(p.full_name,''),p.role) into v_actor from public.profiles p where p.id=auth.uid() and p.store_id=new.store_id;
 if v_actor is null then return new;end if;
 select invoice_no into v_invoice from public.sales where id=new.sale_id and store_id=new.store_id;
 v_chat:=coalesce(public.owner_bill_chat(new.store_id),'');
 if tg_table_name='exchanges' then
  v_key:='exchange:'||new.id::text;v_ref:=coalesce(new.exchange_no,'EXCHANGE-'||new.id::text);
  v_kind:=case when new.difference_amount>0 then 'Exchange: additional amount recorded' when new.difference_amount<0 then 'Exchange: refund amount recorded; not additional revenue' else 'Even exchange' end;
  v_kind:=v_kind||'; original invoice '||coalesce(v_invoice,'not linked')||'; returned INR '||new.returned_value||'; replacement INR '||new.replacement_value;
  v_payment:=coalesce(new.settlement_method,'Not recorded');v_total:=abs(new.difference_amount);
  select jsonb_agg(jsonb_build_object('name',left(case when i.kind='returned' then 'Returned: ' else 'Replacement: ' end||coalesce(p.model,p.brand,'Item'),180),'quantity',i.quantity,'unitPrice',i.unit_price) order by i.kind,i.id) into v_items from public.exchange_items i left join public.products p on p.id=i.product_id and p.store_id=new.store_id where i.exchange_id=new.id;
 else
  v_key:='return:'||coalesce(nullif(new.idempotency_key,''),new.id::text);v_ref:=coalesce(new.return_no,'RETURN-'||new.id::text);
  v_kind:='Return: refund recorded, not new revenue or proof of payment; original invoice '||coalesce(v_invoice,'not linked');
  v_payment:=coalesce(new.refund_method,'Not recorded');
  select coalesce(sum(r.refund_amount),0),jsonb_agg(jsonb_build_object('name',left('Returned: '||coalesce(p.model,p.brand,'Item'),180),'quantity',r.quantity,'unitPrice',round(r.refund_amount/nullif(r.quantity,0),2)) order by r.id) into v_total,v_items from public.returns r left join public.products p on p.id=r.product_id and p.store_id=new.store_id where r.store_id=new.store_id and (r.id=new.id or (new.idempotency_key is not null and r.idempotency_key=new.idempotency_key));
 end if;
 if v_total is null or v_total<0 or v_total::text in ('NaN','Infinity','-Infinity') or v_items is null then raise exception 'Exchange/return bill data incomplete';end if;
 v_payload:=jsonb_build_object('reference',left(v_ref,180),'kind',left(v_kind,350),'date',to_char(new.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI')||' IST','soldBy',v_actor,'payment',left(v_payment,120),'total',v_total,'items',v_items);
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,next_attempt_at,bill_source_key,bill_payload,last_error) values(new.store_id,v_chat,'Recorded exchange or return receipt','pending',0,now(),v_key,v_payload,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end) on conflict(store_id,bill_source_key) where bill_source_key is not null do nothing;
 return new;
end $function$
;
revoke all on function public.enqueue_exchange_return_bill() from public,anon,authenticated;
create constraint trigger exchange_telegram_receipt after insert on public.exchanges deferrable initially deferred for each row execute function public.enqueue_exchange_return_bill();
create constraint trigger return_telegram_receipt after insert on public.returns deferrable initially deferred for each row execute function public.enqueue_exchange_return_bill();
