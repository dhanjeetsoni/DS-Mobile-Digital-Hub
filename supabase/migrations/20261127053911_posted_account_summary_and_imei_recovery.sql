CREATE OR REPLACE FUNCTION ds_recovery.capture_business(p_store_id uuid, p_label text DEFAULT 'manual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE t text; predicate text; v_rows jsonb; data jsonb:='{}'; counts jsonb:='{}'; backup uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id) THEN RAISE EXCEPTION 'unknown shop'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.confidential_price_requests,public.customer_payments,public.customers,public.exchange_items,public.exchanges,public.expenses,public.invoice_reservations,public.invoice_sequences,public.invoices,public.ocr_scans,public.pending_orders,public.personal_drawings,public.product_price_history,public.products,public.products_staff_view,public.purchase_items,public.purchases,public.return_approval_requests,public.returns,public.sale_items,public.sales,public.stock_batches,public.stock_movements,public.store_state,public.store_state_staff_view,public.store_state_tombstones,public.supplier_transactions,public.suppliers,public.sync_queue,public.telegram_outbox,public.warranty_claims,public.weekly_report_runs IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE ds_accounting.pos_events IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.customer_share_links IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) INTO v_rows FROM ds_accounting.pos_events e WHERE e.store_id=p_store_id;
 data:=data||jsonb_build_object('accounting_events',v_rows);
 counts:=counts||jsonb_build_object('accounting_events',jsonb_array_length(v_rows));
 LOCK TABLE ds_recovery.sale_imei_reservations IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.sale_id,e.imei),'[]'::jsonb) INTO v_rows FROM ds_recovery.sale_imei_reservations e WHERE e.store_id=p_store_id;
 data:=data||jsonb_build_object('sale_imei_reservations',v_rows);
 counts:=counts||jsonb_build_object('sale_imei_reservations',jsonb_array_length(v_rows));
 FOREACH t IN ARRAY ds_recovery.business_tables() LOOP
  predicate:=CASE t WHEN 'purchase_items' THEN 'purchase_id IN (SELECT id FROM public.purchases WHERE store_id=$1)' WHEN 'sale_items' THEN 'sale_id IN (SELECT id FROM public.sales WHERE store_id=$1)' WHEN 'exchange_items' THEN 'exchange_id IN (SELECT id FROM public.exchanges WHERE store_id=$1)' ELSE 'store_id=$1' END;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb) FROM public.%I r WHERE %s',t,predicate) INTO v_rows USING p_store_id;
  data:=data||jsonb_build_object(t,v_rows);
  counts:=counts||jsonb_build_object(t,jsonb_array_length(v_rows));
 END LOOP;
 INSERT INTO ds_recovery.business_backups(store_id,label,payload,sha256,counts,format_version)
 VALUES(p_store_id,left(coalesce(p_label,'manual'),100),data,encode(extensions.digest(data::text,'sha256'),'hex'),counts,3)
 RETURNING id INTO backup;
 RETURN backup;
END $function$
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
 INSERT INTO ds_accounting.pos_events(id,store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_at,recorded_by,lines,source_kind) OVERRIDING SYSTEM VALUE
 SELECT id,store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_at,recorded_by,lines,source_kind FROM jsonb_populate_recordset(NULL::ds_accounting.pos_events,data->'accounting_events') ORDER BY id;
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

CREATE OR REPLACE FUNCTION ds_recovery.verify_business_backup(p_backup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE b ds_recovery.business_backups%ROWTYPE; t text;
BEGIN
 SELECT * INTO STRICT b FROM ds_recovery.business_backups WHERE id=p_backup_id;
 IF b.format_version NOT IN (1,2,3) OR b.sha256<>encode(extensions.digest(b.payload::text,'sha256'),'hex') THEN RAISE EXCEPTION 'backup checksum/version mismatch'; END IF;
 FOREACH t IN ARRAY ds_recovery.business_tables() LOOP
  IF jsonb_typeof(b.payload->t) IS DISTINCT FROM 'array' OR (b.counts->>t)::int IS DISTINCT FROM jsonb_array_length(b.payload->t) THEN RAISE EXCEPTION 'backup count mismatch: %',t; END IF;
 END LOOP;
 IF b.format_version>=2 AND (jsonb_typeof(b.payload->'accounting_events') IS DISTINCT FROM 'array' OR (b.counts->>'accounting_events')::int IS DISTINCT FROM jsonb_array_length(b.payload->'accounting_events')) THEN RAISE EXCEPTION 'backup accounting count mismatch'; END IF;
 IF b.format_version>=3 AND (jsonb_typeof(b.payload->'sale_imei_reservations') IS DISTINCT FROM 'array' OR (b.counts->>'sale_imei_reservations')::int IS DISTINCT FROM jsonb_array_length(b.payload->'sale_imei_reservations')) THEN RAISE EXCEPTION 'backup IMEI reservation count mismatch'; END IF;
 RETURN jsonb_build_object('ok',true,'id',b.id,'createdAt',b.created_at,'counts',b.counts);
END $function$
;

CREATE OR REPLACE FUNCTION public.read_posted_account_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_store uuid:=ds_accounting.owner_store(); v_rows jsonb; v_events bigint;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'choose a period of at most 367 days';end if;
 select count(*) into v_events from ds_accounting.pos_events where store_id=v_store and effective_date<=p_to;
 with amounts as (
 select x->>'account' as account,
 sum(case when e.effective_date<p_from then (x->>'debit')::numeric-(x->>'credit')::numeric else 0 end) opening_net,
 sum(case when e.effective_date>=p_from then (x->>'debit')::numeric else 0 end) debit,
 sum(case when e.effective_date>=p_from then (x->>'credit')::numeric else 0 end) credit
 from ds_accounting.pos_events e cross join lateral jsonb_array_elements(e.lines) x
 where e.store_id=v_store and e.effective_date<=p_to group by 1)
 select coalesce(jsonb_agg(jsonb_build_object('account',account,'opening_net',opening_net,'debit',debit,'credit',credit,'closing_net',opening_net+debit-credit) order by account),'[]'::jsonb) into v_rows from amounts;
 return jsonb_build_object('accounts',v_rows,'events',v_events,'from',p_from,'to',p_to,'scope','posted events only');
end $function$
;
revoke all on function public.read_posted_account_summary(date,date) from public,anon,authenticated;
grant execute on function public.read_posted_account_summary(date,date) to authenticated;
revoke all on function ds_recovery.capture_business(uuid,text),ds_recovery.verify_business_backup(uuid),ds_recovery.replace_business(uuid,uuid,text) from public,anon,authenticated;
