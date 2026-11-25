-- Operator-only, in-database recovery checkpoints. Not a replacement for off-site backups.
CREATE TABLE ds_recovery.business_backups(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 label text NOT NULL,format_version integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,sha256 text NOT NULL,counts jsonb NOT NULL);
ALTER TABLE ds_recovery.business_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ds_recovery.business_backups FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION ds_recovery.business_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT ARRAY['customers','suppliers','products','purchases','purchase_items','sales','sale_items','invoices','stock_batches','stock_movements','product_price_history','customer_payments','supplier_transactions','expenses','personal_drawings','ocr_scans','pending_orders','return_approval_requests','returns','exchanges','exchange_items','warranty_claims','confidential_price_requests','invoice_sequences','invoice_reservations','sync_queue','telegram_outbox','weekly_report_runs','store_state_tombstones','store_state']::text[] $$;
CREATE OR REPLACE FUNCTION ds_recovery.capture_business(p_store_id uuid,p_label text DEFAULT 'manual') RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t text; predicate text; v_rows jsonb; data jsonb:='{}'; counts jsonb:='{}'; backup uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_store_id) THEN RAISE EXCEPTION 'unknown shop'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.confidential_price_requests,public.customer_payments,public.customers,public.exchange_items,public.exchanges,public.expenses,public.invoice_reservations,public.invoice_sequences,public.invoices,public.ocr_scans,public.pending_orders,public.personal_drawings,public.product_price_history,public.products,public.products_staff_view,public.purchase_items,public.purchases,public.return_approval_requests,public.returns,public.sale_items,public.sales,public.stock_batches,public.stock_movements,public.store_state,public.store_state_staff_view,public.store_state_tombstones,public.supplier_transactions,public.suppliers,public.sync_queue,public.telegram_outbox,public.warranty_claims,public.weekly_report_runs IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY ds_recovery.business_tables() LOOP
  predicate:=CASE t WHEN 'purchase_items' THEN 'purchase_id IN (SELECT id FROM public.purchases WHERE store_id=$1)' WHEN 'sale_items' THEN 'sale_id IN (SELECT id FROM public.sales WHERE store_id=$1)' WHEN 'exchange_items' THEN 'exchange_id IN (SELECT id FROM public.exchanges WHERE store_id=$1)' ELSE 'store_id=$1' END;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb) FROM public.%I r WHERE %s',t,predicate) INTO v_rows USING p_store_id;
  data:=data||jsonb_build_object(t,v_rows);
  counts:=counts||jsonb_build_object(t,jsonb_array_length(v_rows));
 END LOOP;
 INSERT INTO ds_recovery.business_backups(store_id,label,payload,sha256,counts)
 VALUES(p_store_id,left(coalesce(p_label,'manual'),100),data,encode(extensions.digest(data::text,'sha256'),'hex'),counts)
 RETURNING id INTO backup;
 RETURN backup;
END $$;
CREATE OR REPLACE FUNCTION ds_recovery.verify_business_backup(p_backup_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b ds_recovery.business_backups%ROWTYPE; t text;
BEGIN
 SELECT * INTO STRICT b FROM ds_recovery.business_backups WHERE id=p_backup_id;
 IF b.format_version<>1 OR b.sha256<>encode(extensions.digest(b.payload::text,'sha256'),'hex') THEN RAISE EXCEPTION 'backup checksum/version mismatch'; END IF;
 FOREACH t IN ARRAY ds_recovery.business_tables() LOOP
  IF jsonb_typeof(b.payload->t) IS DISTINCT FROM 'array' OR (b.counts->>t)::int IS DISTINCT FROM jsonb_array_length(b.payload->t) THEN RAISE EXCEPTION 'backup count mismatch: %',t; END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'id',b.id,'createdAt',b.created_at,'counts',b.counts);
END $$;
-- Requires the operator to stop every device, clear old offline queues and
-- disconnect external workers before running. No public/anonymous RPC exists.
-- Keep login accounts, access policy, keys, app versions, storage objects and
-- audit history intact. Old pending messages/operations are not replayed.
CREATE OR REPLACE FUNCTION ds_recovery.replace_business(p_store_id uuid,p_backup_id uuid,p_confirmation text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t text; predicate text; data jsonb; before_id uuid; current_version bigint; current_state jsonb; next_state jsonb; expected text; ordered text[]; i int;
BEGIN
 expected:=CASE WHEN p_backup_id IS NULL THEN 'RESET:'||p_store_id::text ELSE 'RESTORE:'||p_store_id::text||':'||p_backup_id::text END;
 IF p_confirmation IS DISTINCT FROM expected THEN RAISE EXCEPTION 'explicit shop confirmation required'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.confidential_price_requests,public.customer_payments,public.customers,public.exchange_items,public.exchanges,public.expenses,public.invoice_reservations,public.invoice_sequences,public.invoices,public.ocr_scans,public.pending_orders,public.personal_drawings,public.product_price_history,public.products,public.products_staff_view,public.purchase_items,public.purchases,public.return_approval_requests,public.returns,public.sale_items,public.sales,public.stock_batches,public.stock_movements,public.store_state,public.store_state_staff_view,public.store_state_tombstones,public.supplier_transactions,public.suppliers,public.sync_queue,public.telegram_outbox,public.warranty_claims,public.weekly_report_runs IN ACCESS EXCLUSIVE MODE;
 IF p_backup_id IS NOT NULL THEN
  PERFORM ds_recovery.verify_business_backup(p_backup_id);
  SELECT b.payload INTO STRICT data FROM ds_recovery.business_backups b WHERE b.id=p_backup_id AND b.store_id=p_store_id;
 END IF;
 before_id:=ds_recovery.capture_business(p_store_id,CASE WHEN p_backup_id IS NULL THEN 'before reset' ELSE 'before restore' END);
 SELECT state,version INTO STRICT current_state,current_version FROM public.store_state WHERE store_id=p_store_id;
 -- Suppress only side-effect triggers, not foreign keys or row checks.
 ALTER TABLE public.products DISABLE TRIGGER hardening_opening_fifo;
 ALTER TABLE public.invoices DISABLE TRIGGER invoices_telegram_outbox_trigger;
 ALTER TABLE public.warranty_claims DISABLE TRIGGER warranty_claim_reminder_schedule;
 ALTER TABLE public.store_state DISABLE TRIGGER store_state_tombstone_trg;
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
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ds_recovery FROM PUBLIC,anon,authenticated;
