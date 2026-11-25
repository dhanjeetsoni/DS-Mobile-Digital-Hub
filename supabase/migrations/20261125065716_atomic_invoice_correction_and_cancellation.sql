-- Payment correction and cancellation commit the relational ledger AND the
-- versioned app snapshot in one transaction. Never mutate stock on a failed save.
CREATE OR REPLACE FUNCTION public.commit_invoice_correction(
 p_store_id uuid,p_invoice_no text,p_operation_id text,p_action text,p_note text,
 p_state jsonb,p_expected_version bigint,p_payment_method text DEFAULT NULL,p_amount_paid numeric DEFAULT NULL,p_due_amount numeric DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_sale public.sales%ROWTYPE; v_state public.store_state%ROWTYPE; line record; v_candidate jsonb; days integer; v_status text; next_version bigint;
BEGIN
 IF NOT public.current_account_allowed() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND store_id=p_store_id AND role IN ('owner','manager')) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF p_expected_version IS NULL OR p_action NOT IN ('cancel','payment') OR p_state IS NULL OR jsonb_typeof(p_state)<>'object' OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'invalid correction'; END IF;
 SELECT * INTO v_state FROM public.store_state WHERE store_id=p_store_id FOR UPDATE;
 IF v_state.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 SELECT * INTO v_sale FROM public.sales WHERE store_id=p_store_id AND ((p_operation_id IS NOT NULL AND idempotency_key=p_operation_id) OR invoice_no=p_invoice_no)
 ORDER BY CASE WHEN idempotency_key=p_operation_id THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE;
 IF v_sale.id IS NULL THEN RAISE EXCEPTION 'SALE_NOT_SYNCED: sync original invoice first'; END IF;
 IF v_sale.status='Cancelled' THEN RAISE EXCEPTION 'Invoice already cancelled'; END IF;
 days:=greatest(0,least(365,coalesce((v_state.state#>>'{settings,saleCorrectionWindowDays}')::integer,10)));
 IF v_sale.created_at<now()-make_interval(days=>days) THEN RAISE EXCEPTION 'Correction window expired'; END IF;
 SELECT x INTO v_candidate FROM jsonb_array_elements(coalesce(p_state->'sales','[]'::jsonb)) x WHERE x->>'invoiceNo'=v_sale.invoice_no OR x->>'syncOperationId'=v_sale.idempotency_key LIMIT 1;
 IF v_candidate IS NULL THEN RAISE EXCEPTION 'Correction snapshot missing invoice'; END IF;
 IF p_action='cancel' THEN
  IF v_candidate->>'status' IS DISTINCT FROM 'Cancelled' THEN RAISE EXCEPTION 'Correction snapshot status mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.returns WHERE sale_id=v_sale.id) OR EXISTS(SELECT 1 FROM public.exchanges WHERE sale_id=v_sale.id) OR EXISTS(SELECT 1 FROM public.warranty_claims WHERE sale_id=v_sale.id) OR EXISTS(SELECT 1 FROM public.return_approval_requests WHERE sale_id=v_sale.id AND status='pending') THEN RAISE EXCEPTION 'Invoice has return/exchange/warranty activity; resolve it before cancellation'; END IF;
  IF EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=v_sale.id AND service_name IS NULL AND (product_id IS NULL OR cost_price IS NULL)) THEN RAISE EXCEPTION 'Invoice stock/cost requires reconciliation before cancellation'; END IF;
  FOR line IN SELECT product_id,quantity,cost_price FROM public.sale_items WHERE sale_id=v_sale.id AND product_id IS NOT NULL ORDER BY product_id,id LOOP
   UPDATE public.products SET stock_qty=stock_qty+line.quantity WHERE id=line.product_id AND store_id=p_store_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invoice product missing'; END IF;
   INSERT INTO public.stock_batches(store_id,product_id,qty,remaining_qty,purchase_price,source,ref) VALUES(p_store_id,line.product_id,line.quantity,line.quantity,line.cost_price,'sale_cancel',v_sale.invoice_no);
   INSERT INTO public.stock_movements(store_id,product_id,movement_type,quantity,reference,created_by) VALUES(p_store_id,line.product_id,'sale_cancel',line.quantity,v_sale.invoice_no,auth.uid());
  END LOOP;
  UPDATE public.sales SET status='Cancelled' WHERE id=v_sale.id;
 ELSE
  IF p_amount_paid IS NULL OR p_due_amount IS NULL OR p_amount_paid<0 OR p_due_amount<0 OR p_amount_paid::text IN ('NaN','Infinity','-Infinity') OR p_due_amount::text IN ('NaN','Infinity','-Infinity') OR nullif(btrim(p_payment_method),'') IS NULL THEN RAISE EXCEPTION 'invalid payment amount'; END IF;
  IF abs(p_amount_paid+p_due_amount+coalesce(v_sale.finance_loan_amount,0)-v_sale.total)>0.01 THEN RAISE EXCEPTION 'Payment totals must match invoice'; END IF;
  IF (v_sale.finance_loan_amount IS NOT NULL AND p_payment_method IS DISTINCT FROM v_sale.payment_method) OR (v_sale.finance_loan_amount IS NULL AND p_payment_method LIKE 'Finance%') THEN RAISE EXCEPTION 'Finance settlement requires finance workflow'; END IF;
  v_status:=CASE WHEN p_due_amount<=0.005 THEN 'Paid' WHEN p_amount_paid>0 THEN 'Partial' ELSE 'Due' END;
  IF (v_candidate->>'amountPaid')::numeric IS DISTINCT FROM p_amount_paid OR (v_candidate->>'dueAmount')::numeric IS DISTINCT FROM p_due_amount OR v_candidate->>'status' IS DISTINCT FROM v_status OR v_candidate->>'payment' IS DISTINCT FROM p_payment_method THEN RAISE EXCEPTION 'Correction snapshot payment mismatch'; END IF;
  UPDATE public.sales SET payment_method=p_payment_method,amount_paid=p_amount_paid,due_amount=p_due_amount,status=v_status WHERE id=v_sale.id;
 END IF;
 next_version:=public.save_store_state(p_state,p_expected_version);
 INSERT INTO public.audit_logs(store_id,user_id,action,details) VALUES(p_store_id,auth.uid(),'invoice_'||p_action,jsonb_build_object('saleId',v_sale.id,'invoiceNo',v_sale.invoice_no,'note',left(p_note,1000),'priorStatus',v_sale.status,'priorPaid',v_sale.amount_paid,'priorDue',v_sale.due_amount));
 RETURN next_version;
END $$;
REVOKE ALL ON FUNCTION public.commit_invoice_correction(uuid,text,text,text,text,jsonb,bigint,text,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commit_invoice_correction(uuid,text,text,text,text,jsonb,bigint,text,numeric,numeric) TO authenticated;
