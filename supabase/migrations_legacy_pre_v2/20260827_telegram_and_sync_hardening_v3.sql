-- Durable Telegram enqueue after the invoice row exists.
create or replace function public.enqueue_invoice_telegram()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_chat text; v_sale public.sales%rowtype; v_items text; v_message text;
begin
 select * into v_sale from public.sales where id=new.sale_id;
 if v_sale.id is null then return new; end if;
 select tc.chat_id into v_chat
 from public.telegram_connections tc join public.profiles p on p.id=tc.user_id
 where tc.store_id=v_sale.store_id and p.role in ('owner','manager') and tc.chat_id is not null
 order by tc.updated_at desc nulls last limit 1;
 if v_chat is null then return new; end if;
 select string_agg(format('%s x %s @ %s',coalesce(nullif(p.model,''),nullif(p.brand,''),'Product'),si.quantity,si.unit_price),E'\n' order by si.id)
 into v_items from public.sale_items si join public.products p on p.id=si.product_id where si.sale_id=v_sale.id;
 v_message := format(E'DS MOBILE & DIGITAL HUB\nInvoice: %s\nDate: %s\nCustomer: %s\nPhone: %s\nSold By: %s\nProducts:\n%s\nTotal: %s\nPayment: %s',
 v_sale.invoice_no,to_char(v_sale.created_at,'YYYY-MM-DD HH24:MI'),coalesce(v_sale.customer_name,'Walk-in'),coalesce(v_sale.customer_phone,'-'),
 coalesce((select full_name from public.profiles where id=v_sale.created_by),'Staff'),coalesce(v_items,'-'),v_sale.total,v_sale.payment_method);
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,sale_id,invoice_id,next_attempt_at)
 values(v_sale.store_id,v_chat,v_message,'pending',0,v_sale.id,new.id,now())
 on conflict(sale_id) where sale_id is not null do nothing;
 return new;
end; $$;
drop trigger if exists invoices_telegram_outbox_trigger on public.invoices;
create trigger invoices_telegram_outbox_trigger after insert on public.invoices for each row execute function public.enqueue_invoice_telegram();

alter table public.sync_queue add column if not exists server_reference text;
create index if not exists invoice_reservations_store_prefix_idx on public.invoice_reservations(store_id,prefix,created_at);
create index if not exists sync_queue_store_status_created_idx on public.sync_queue(store_id,status,created_at);
