alter table public.sales add column whatsapp_consent_at timestamptz,add column whatsapp_delivery_state text check(whatsapp_delivery_state in ('queued','processing','accepted','review','skipped')),add column whatsapp_provider_id text,add column whatsapp_delivery_error text,add column whatsapp_claimed_at timestamptz;
create index sales_whatsapp_pending_idx on public.sales(store_id,created_at) where whatsapp_delivery_state='queued';
CREATE OR REPLACE FUNCTION ds_recovery.guard_whatsapp_delivery_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('anon','authenticated') and (tg_op='INSERT' and (new.whatsapp_consent_at is not null or new.whatsapp_delivery_state is not null or new.whatsapp_provider_id is not null or new.whatsapp_delivery_error is not null or new.whatsapp_claimed_at is not null) or tg_op='UPDATE' and (new.whatsapp_consent_at is distinct from old.whatsapp_consent_at or new.whatsapp_delivery_state is distinct from old.whatsapp_delivery_state or new.whatsapp_provider_id is distinct from old.whatsapp_provider_id or new.whatsapp_delivery_error is distinct from old.whatsapp_delivery_error or new.whatsapp_claimed_at is distinct from old.whatsapp_claimed_at)) then raise exception 'WhatsApp receipt state requires server workflow';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION ds_recovery.replace_business(p_store_id uuid, p_backup_id uuid, p_confirmation text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE t text; predicate text; data jsonb; before_id uuid; current_version bigint; current_state jsonb; next_state jsonb; expected text; ordered text[]; i int;
BEGIN
 expected:=CASE WHEN p_backup_id IS NULL THEN 'RESET:'||p_store_id::text ELSE 'RESTORE:'||p_store_id::text||':'||p_backup_id::text END;
 IF p_confirmation IS DISTINCT FROM expected THEN RAISE EXCEPTION 'explicit shop confirmation required'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.confidential_price_requests,public.customer_payments,public.customers,public.exchange_items,public.exchanges,public.expenses,public.invoice_reservations,public.invoice_sequences,public.invoices,public.ocr_scans,public.pending_orders,public.personal_drawings,public.product_price_history,public.products,public.products_staff_view,public.purchase_items,public.purchases,public.return_approval_requests,public.returns,public.sale_items,public.sales,public.stock_batches,public.stock_movements,public.store_state,public.store_state_staff_view,public.store_state_tombstones,public.supplier_transactions,public.suppliers,public.sync_queue,public.telegram_outbox,public.warranty_claims,public.weekly_report_runs IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE ds_accounting.pos_events IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE public.customer_share_links IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE ds_recovery.sale_imei_reservations IN ACCESS EXCLUSIVE MODE;
 IF p_backup_id IS NOT NULL THEN
  PERFORM ds_recovery.verify_business_backup(p_backup_id);
  SELECT b.payload INTO STRICT data FROM ds_recovery.business_backups b WHERE b.id=p_backup_id AND b.store_id=p_store_id;
 END IF;
 IF p_backup_id IS NOT NULL AND NOT (data ? 'accounting_events') AND EXISTS(SELECT 1 FROM ds_accounting.pos_events WHERE store_id=p_store_id) THEN RAISE EXCEPTION 'Legacy backup has no accounting journal; restore blocked to preserve posted history'; END IF;
 IF p_backup_id IS NOT NULL AND NOT (data ? 'sale_imei_reservations') AND EXISTS(SELECT 1 FROM ds_recovery.sale_imei_reservations WHERE store_id=p_store_id) THEN RAISE EXCEPTION 'Legacy backup lacks IMEI reservation history; restore blocked';END IF;
 IF EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id AND journal_closed_through IS NOT NULL) THEN
 IF p_backup_id IS NULL OR NOT (data ? 'accounting_events') OR (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM ds_accounting.pos_events e WHERE e.store_id=p_store_id AND e.effective_date<=(SELECT journal_closed_through FROM public.stores WHERE id=p_store_id)) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM jsonb_populate_recordset(NULL::ds_accounting.pos_events,data->'accounting_events') e WHERE e.store_id=p_store_id AND e.effective_date<=(SELECT journal_closed_through FROM public.stores WHERE id=p_store_id)) THEN RAISE EXCEPTION 'Closed journal history must be preserved; reset or incompatible restore blocked';END IF;
 END IF;
 before_id:=ds_recovery.capture_business(p_store_id,CASE WHEN p_backup_id IS NULL THEN 'before reset' ELSE 'before restore' END);
 SELECT state,version INTO STRICT current_state,current_version FROM public.store_state WHERE store_id=p_store_id;
 -- Suppress only side-effect triggers, not foreign keys or row checks.
 ALTER TABLE public.products DISABLE TRIGGER hardening_opening_fifo;
 ALTER TABLE public.invoices DISABLE TRIGGER invoices_telegram_outbox_trigger;
 ALTER TABLE public.warranty_claims DISABLE TRIGGER warranty_claim_reminder_schedule;
 ALTER TABLE public.store_state DISABLE TRIGGER store_state_tombstone_trg;
 -- Customer bearer links are intentionally never restored or reactivated.
 UPDATE public.customer_share_links SET revoked_at=now() WHERE store_id=p_store_id AND revoked_at IS NULL;
 DELETE FROM ds_accounting.pos_events WHERE store_id=p_store_id;
 DELETE FROM ds_recovery.sale_imei_reservations WHERE store_id=p_store_id;
 ordered:=ds_recovery.business_tables();
 FOR i IN REVERSE array_length(ordered,1)..1 LOOP
  t:=ordered[i];
  IF t='store_state' THEN CONTINUE; END IF;
  predicate:=CASE t WHEN 'purchase_items' THEN 'purchase_id IN (SELECT id FROM public.purchases WHERE store_id=$1)' WHEN 'sale_items' THEN 'sale_id IN (SELECT id FROM public.sales WHERE store_id=$1)' WHEN 'exchange_items' THEN 'exchange_id IN (SELECT id FROM public.exchanges WHERE store_id=$1)' ELSE 'store_id=$1' END;
  EXECUTE format('DELETE FROM public.%I WHERE %s',t,predicate) USING p_store_id;
 END LOOP;
 IF p_backup_id IS NOT NULL THEN
  FOREACH t IN ARRAY ordered LOOP
   IF t='store_state' THEN CONTINUE; END IF;
   EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I,$1)',t,t) USING data->t;
  END LOOP;
  IF data ? 'accounting_events' THEN
 IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::ds_accounting.pos_events,data->'accounting_events') e WHERE e.store_id IS DISTINCT FROM p_store_id) THEN RAISE EXCEPTION 'accounting backup scope mismatch'; END IF;
 ALTER TABLE ds_accounting.pos_events DISABLE TRIGGER journal_closed_period_guard;
 INSERT INTO ds_accounting.pos_events(id,store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_at,recorded_by,lines,source_kind) OVERRIDING SYSTEM VALUE
 SELECT id,store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_at,recorded_by,lines,source_kind FROM jsonb_populate_recordset(NULL::ds_accounting.pos_events,data->'accounting_events') ORDER BY id;
 ALTER TABLE ds_accounting.pos_events ENABLE TRIGGER journal_closed_period_guard;
 END IF;
 IF data ? 'sale_imei_reservations' THEN
 IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::ds_recovery.sale_imei_reservations,data->'sale_imei_reservations') e WHERE e.store_id IS DISTINCT FROM p_store_id OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=e.sale_id AND s.store_id=p_store_id) OR NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=e.product_id AND p.store_id=p_store_id)) THEN RAISE EXCEPTION 'IMEI backup scope mismatch';END IF;
 INSERT INTO ds_recovery.sale_imei_reservations SELECT * FROM jsonb_populate_recordset(NULL::ds_recovery.sale_imei_reservations,data->'sale_imei_reservations');
 END IF;
 next_state:=data->'store_state'->0->'state';
  UPDATE public.sync_queue SET status='abandoned',last_error='RESTORE_REVIEW_REQUIRED: pending operation preserved, not replayed' WHERE store_id=p_store_id AND status IN ('pending','syncing','failed');
  UPDATE public.telegram_outbox SET status='failed',last_error='RESTORE_REVIEW_REQUIRED: do not resend automatically' WHERE store_id=p_store_id AND status IN ('pending','sending');
  UPDATE public.sales SET whatsapp_delivery_state='review',whatsapp_delivery_error='RESTORE_REVIEW_REQUIRED: do not resend automatically' WHERE store_id=p_store_id AND whatsapp_delivery_state IN ('queued','processing');
 ELSE
  next_state:=jsonb_build_object('settings',coalesce(current_state->'settings','{}'::jsonb)-'lastWeeklyReportSentAt'-'lastPhotoCleanupAt','categories',coalesce(current_state->'categories','[]'::jsonb));
 END IF;
 IF next_state IS NULL OR jsonb_typeof(next_state)<>'object' THEN RAISE EXCEPTION 'invalid restored state'; END IF;
 UPDATE public.store_state SET state=next_state,version=current_version+1,updated_at=now() WHERE store_id=p_store_id;
 ALTER TABLE public.products ENABLE TRIGGER hardening_opening_fifo;
 ALTER TABLE public.invoices ENABLE TRIGGER invoices_telegram_outbox_trigger;
 ALTER TABLE public.warranty_claims ENABLE TRIGGER warranty_claim_reminder_schedule;
 ALTER TABLE public.store_state ENABLE TRIGGER store_state_tombstone_trg;
 INSERT INTO public.audit_logs(store_id,action,details) VALUES(p_store_id,CASE WHEN p_backup_id IS NULL THEN 'business_reset' ELSE 'business_restore' END,jsonb_build_object('beforeBackup',before_id,'restoredBackup',p_backup_id));
 RETURN before_id;
END $function$
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
 update public.sales set whatsapp_consent_at=now(),whatsapp_delivery_state='queued' where id=sid and store_id=p_store_id and created_by=auth.uid() and created_at>=transaction_timestamp() and whatsapp_consent_at is null and status<>'Cancelled' and regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g')=digits;
 end if;
 return sid;
end $function$
;

CREATE OR REPLACE FUNCTION public.read_whatsapp_invoice_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();rows jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) into rows from (select invoice_no,created_at,whatsapp_delivery_state as state,whatsapp_delivery_error as issue from public.sales where store_id=st and whatsapp_consent_at is not null order by created_at desc limit 100) q;
 return jsonb_build_object('rows',rows,'queued',(select count(*) from public.sales where store_id=st and whatsapp_delivery_state='queued'),'review',(select count(*) from public.sales where store_id=st and whatsapp_delivery_state='review'));
end $function$
;
revoke all on function ds_recovery.guard_whatsapp_delivery_fields() from public,anon,authenticated;
create trigger whatsapp_delivery_field_guard before insert or update on public.sales for each row execute function ds_recovery.guard_whatsapp_delivery_fields();
revoke all on function public.atomic_complete_sale_v3(uuid,text,text,text,text,numeric,numeric,text,jsonb,numeric,numeric,numeric,numeric,boolean) from public,anon,authenticated;
grant execute on function public.atomic_complete_sale_v3(uuid,text,text,text,text,numeric,numeric,text,jsonb,numeric,numeric,numeric,numeric,boolean) to authenticated;
revoke all on function public.read_whatsapp_invoice_status() from public,anon,authenticated;
grant execute on function public.read_whatsapp_invoice_status() to authenticated;
