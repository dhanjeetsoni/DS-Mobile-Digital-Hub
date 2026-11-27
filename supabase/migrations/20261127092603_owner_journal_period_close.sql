alter table public.stores add column journal_closed_through date;
CREATE OR REPLACE FUNCTION ds_accounting.guard_closed_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare closed date;
begin
 select journal_closed_through into closed from public.stores where id=new.store_id for share;
 if closed is not null and new.effective_date<=closed then raise exception 'Journal period closed through %; do not backdate postings',closed;end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION ds_accounting.protect_period_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('anon','authenticated') and new.journal_closed_through is distinct from old.journal_closed_through then raise exception 'Owner journal close RPC required';end if;
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

CREATE OR REPLACE FUNCTION public.close_journal_period(p_through date, p_confirmation text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st uuid:=ds_accounting.owner_store();v_old date;
begin
 if p_through is null or p_through>=(now() at time zone 'Asia/Kolkata')::date or p_confirmation is distinct from 'CLOSE:'||p_through::text then raise exception 'Choose a completed date and explicitly confirm the journal close';end if;
 select journal_closed_through into v_old from public.stores where id=st for update;
 if v_old is not null and p_through<v_old then raise exception 'Closed journal cannot be reopened or shortened';end if;
 if v_old is not distinct from p_through then return v_old;end if;
 update public.stores set journal_closed_through=p_through where id=st;
 insert into public.audit_logs(store_id,user_id,action,details) values(st,auth.uid(),'journal_period_closed',jsonb_build_object('prior',v_old,'through',p_through));
 return p_through;
end $function$
;

CREATE OR REPLACE FUNCTION public.read_journal_period_lock()
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select journal_closed_through from public.stores where id=ds_accounting.owner_store()
$function$
;
revoke all on function ds_accounting.guard_closed_period(),ds_accounting.protect_period_close() from public,anon,authenticated;
create trigger journal_closed_period_guard before insert on ds_accounting.pos_events for each row execute function ds_accounting.guard_closed_period();
create trigger journal_close_owner_guard before update on public.stores for each row execute function ds_accounting.protect_period_close();
revoke all on function public.read_journal_period_lock(),public.close_journal_period(date,text) from public,anon,authenticated;
grant execute on function public.read_journal_period_lock(),public.close_journal_period(date,text) to authenticated;
