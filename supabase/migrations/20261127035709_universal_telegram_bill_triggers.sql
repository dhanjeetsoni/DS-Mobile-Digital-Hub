create or replace function public.enqueue_invoice_telegram() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;v_chat text;
begin
 select * into s from public.sales where id=new.sale_id and store_id=new.store_id;
 if s.id is null then return new;end if;
 v_chat:=coalesce(public.owner_bill_chat(s.store_id),'');
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,sale_id,invoice_id,next_attempt_at,bill_source_key,last_error)
 values(s.store_id,v_chat,'Invoice '||s.invoice_no,'pending',0,s.id,new.id,now(),'pos:'||s.id::text,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end)
 on conflict(sale_id) where sale_id is not null do nothing;
 return new;
end $$;
revoke all on function public.enqueue_invoice_telegram() from public,anon,authenticated;
create function public.ensure_sale_telegram_bill() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;v_invoice uuid;v_chat text;
begin
 if auth.uid() is null then return new;end if;
 select * into s from public.sales where id=new.id and store_id=new.store_id;
 if s.id is null then return new;end if;
 select id into v_invoice from public.invoices where sale_id=s.id and store_id=s.store_id order by created_at limit 1;
 v_chat:=coalesce(public.owner_bill_chat(s.store_id),'');
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,sale_id,invoice_id,next_attempt_at,bill_source_key,last_error)
 values(s.store_id,v_chat,'Invoice '||s.invoice_no,'pending',0,s.id,v_invoice,now(),'pos:'||s.id::text,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end)
 on conflict(sale_id) where sale_id is not null do nothing;
 return new;
end $$;
revoke all on function public.ensure_sale_telegram_bill() from public,anon,authenticated;
create constraint trigger sale_telegram_bill_ensure after insert on public.sales deferrable initially deferred for each row execute function public.ensure_sale_telegram_bill();
create trigger xerox_telegram_bill_enqueue after insert or update of state on public.store_state for each row execute function public.enqueue_xerox_bill();
create function public.get_telegram_bill_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=ds_accounting.owner_store(); v_rows jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_rows from
 (select id,coalesce(bill_payload->>'reference',s.invoice_no,bill_source_key,'Invoice') as reference,o.status,o.attempts,o.created_at,o.sent_at,o.last_error,o.telegram_message_id is not null as text_sent,o.telegram_document_id is not null as pdf_sent from public.telegram_outbox o left join public.sales s on s.id=o.sale_id and s.store_id=o.store_id where o.store_id=shop and (o.sale_id is not null or o.bill_source_key is not null or o.bill_payload is not null) order by o.created_at desc limit 100) x;
 return jsonb_build_object('connected',public.owner_bill_chat(shop) is not null,'bills',v_rows,'pending',(select count(*) from public.telegram_outbox where store_id=shop and (sale_id is not null or bill_source_key is not null or bill_payload is not null) and status in ('pending','sending')),'failed',(select count(*) from public.telegram_outbox where store_id=shop and (sale_id is not null or bill_source_key is not null or bill_payload is not null) and status='failed'),'missingSales',(select count(*) from public.sales s where s.store_id=shop and not exists(select 1 from public.telegram_outbox o where o.sale_id=s.id)),'missingCyber',(select count(*) from public.store_state st cross join lateral jsonb_array_elements(case when jsonb_typeof(st.state->'xeroxEntries')='array' then st.state->'xeroxEntries' else '[]'::jsonb end) e where st.store_id=shop and not exists(select 1 from public.telegram_outbox o where o.store_id=shop and o.bill_source_key='xerox:'||(e->>'id'))));
end $$;
revoke all on function public.get_telegram_bill_status() from public,anon,authenticated;
grant execute on function public.get_telegram_bill_status() to authenticated;
create function public.retry_telegram_bill(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare shop uuid:=ds_accounting.owner_store();
begin
 update public.telegram_outbox set status='pending',claimed_at=null,next_attempt_at=now(),last_error='Owner requested retry after delivery review'
 where id=p_id and store_id=shop and status='failed' and (sale_id is not null or bill_source_key is not null or bill_payload is not null)
 and coalesce(last_error,'') not like 'RESTORE_REVIEW_REQUIRED:%';
 return found;
end $$;
revoke all on function public.retry_telegram_bill(uuid) from public,anon,authenticated;
grant execute on function public.retry_telegram_bill(uuid) to authenticated;
