alter table public.sales add column whatsapp_consent_phone text check(whatsapp_consent_phone ~ '^91[6-9][0-9]{9}$'),add column whatsapp_delivery_at timestamptz,add column whatsapp_attempts integer not null default 0 check(whatsapp_attempts between 0 and 10),add column whatsapp_next_attempt_at timestamptz;
alter table public.sales drop constraint sales_whatsapp_delivery_state_check;
alter table public.sales add constraint sales_whatsapp_delivery_state_check check(whatsapp_delivery_state in ('queued','processing','accepted','delivered','read','review','skipped'));
create unique index sales_whatsapp_provider_unique on public.sales(store_id,whatsapp_provider_id) where whatsapp_provider_id is not null;
update public.sales set whatsapp_delivery_state='review',whatsapp_delivery_error='Original recipient consent was not frozen; review manually' where whatsapp_consent_at is not null and whatsapp_consent_phone is null and whatsapp_delivery_state in ('queued','processing');
create table ds_recovery.whatsapp_delivery_events(store_id uuid not null references public.stores(id) on delete cascade,provider_id text not null,status text not null check(status in ('failed','delivered','read')),occurred_at timestamptz not null,primary key(store_id,provider_id));
alter table ds_recovery.whatsapp_delivery_events enable row level security;
revoke all on ds_recovery.whatsapp_delivery_events from public,anon,authenticated;
CREATE OR REPLACE FUNCTION ds_recovery.guard_whatsapp_delivery_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('anon','authenticated') and (tg_op='INSERT' and (new.whatsapp_consent_at is not null or new.whatsapp_delivery_state is not null or new.whatsapp_provider_id is not null or new.whatsapp_delivery_error is not null or new.whatsapp_claimed_at is not null or new.whatsapp_consent_phone is not null or new.whatsapp_delivery_at is not null or new.whatsapp_attempts<>0 or new.whatsapp_next_attempt_at is not null) or tg_op='UPDATE' and (new.whatsapp_consent_at is distinct from old.whatsapp_consent_at or new.whatsapp_delivery_state is distinct from old.whatsapp_delivery_state or new.whatsapp_provider_id is distinct from old.whatsapp_provider_id or new.whatsapp_delivery_error is distinct from old.whatsapp_delivery_error or new.whatsapp_claimed_at is distinct from old.whatsapp_claimed_at or new.whatsapp_consent_phone is distinct from old.whatsapp_consent_phone or new.whatsapp_delivery_at is distinct from old.whatsapp_delivery_at or new.whatsapp_attempts is distinct from old.whatsapp_attempts or new.whatsapp_next_attempt_at is distinct from old.whatsapp_next_attempt_at)) then raise exception 'WhatsApp receipt state requires server workflow';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.atomic_complete_sale_v3(p_store_id uuid, p_invoice_no text, p_customer_name text, p_customer_phone text, p_payment_method text, p_discount numeric, p_tax numeric, p_idempotency_key text, p_items jsonb, p_amount_paid numeric, p_due_amount numeric, p_finance_loan_amount numeric DEFAULT NULL::numeric, p_finance_net_receivable numeric DEFAULT NULL::numeric, p_whatsapp_consent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid;digits text:=regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g');
begin
 if p_whatsapp_consent is true and digits !~ '^(91)?[6-9][0-9]{9}$' then raise exception 'invalid payment amount: official WhatsApp consent requires a valid Indian mobile number; uncheck to bill without WhatsApp';end if;
 sid:=public.atomic_complete_sale_v2(p_store_id,p_invoice_no,p_customer_name,p_customer_phone,p_payment_method,p_discount,p_tax,p_idempotency_key,p_items,p_amount_paid,p_due_amount,p_finance_loan_amount,p_finance_net_receivable);
 if p_whatsapp_consent is true then
 update public.sales set whatsapp_consent_at=now(),whatsapp_consent_phone=case when length(digits)=10 then '91'||digits else digits end,whatsapp_delivery_state='queued',whatsapp_next_attempt_at=now() where id=sid and store_id=p_store_id and created_by=auth.uid() and created_at>=transaction_timestamp() and whatsapp_consent_at is null and status<>'Cancelled' and regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g')=digits;
 end if;
 return sid;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_whatsapp_delivery_event(p_store uuid, p_provider_id text, p_status text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s text;d timestamptz;
begin
 if p_store is null or p_provider_id is null or length(p_provider_id) not between 1 and 300 or p_status not in ('failed','delivered','read') or p_at is null or p_at>now()+interval '1 day' or p_at<now()-interval '90 days' then raise exception 'Invalid delivery event';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||':wa:'||p_provider_id,0));
 insert into ds_recovery.whatsapp_delivery_events values(p_store,p_provider_id,p_status,p_at) on conflict(store_id,provider_id) do update set status=excluded.status,occurred_at=excluded.occurred_at where (case excluded.status when 'read' then 3 when 'delivered' then 2 else 1 end)>(case whatsapp_delivery_events.status when 'read' then 3 when 'delivered' then 2 else 1 end);
 select status,occurred_at into s,d from ds_recovery.whatsapp_delivery_events where store_id=p_store and provider_id=p_provider_id;
 update public.sales set whatsapp_delivery_state=case when s='failed' then 'review' else s end,whatsapp_delivery_at=d,whatsapp_delivery_error=case when s='failed' then 'Meta delivery failure; review before resending' else null end where store_id=p_store and whatsapp_provider_id=p_provider_id and (whatsapp_delivery_state in ('accepted','review') or whatsapp_delivery_state='delivered' and s='read');
end $function$
;

CREATE OR REPLACE FUNCTION public.record_whatsapp_provider_acceptance(p_store uuid, p_sale uuid, p_provider_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s text;d timestamptz;
begin
 if p_store is null or p_sale is null or p_provider_id is null or length(p_provider_id) not between 1 and 300 then raise exception 'Invalid provider acceptance';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||':wa:'||p_provider_id,0));
 select status,occurred_at into s,d from ds_recovery.whatsapp_delivery_events where store_id=p_store and provider_id=p_provider_id;
 update public.sales set whatsapp_provider_id=p_provider_id,whatsapp_delivery_state=case when s='failed' then 'review' when s in ('delivered','read') then s else 'accepted' end,whatsapp_delivery_at=d,whatsapp_delivery_error=case when s='failed' then 'Meta delivery failure; review before resending' else null end where id=p_sale and store_id=p_store and whatsapp_delivery_state='processing';
 if not found then raise exception 'Provider acceptance checkpoint unavailable';end if;
end $function$
;
revoke all on function public.record_whatsapp_delivery_event(uuid,text,text,timestamptz),public.record_whatsapp_provider_acceptance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_whatsapp_delivery_event(uuid,text,text,timestamptz),public.record_whatsapp_provider_acceptance(uuid,uuid,text) to service_role;
