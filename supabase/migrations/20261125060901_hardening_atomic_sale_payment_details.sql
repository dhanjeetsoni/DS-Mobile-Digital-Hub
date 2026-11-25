-- Preserve actual collected payment separately from customer credit and lender amounts.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS amount_paid numeric, ADD COLUMN IF NOT EXISTS due_amount numeric,
 ADD COLUMN IF NOT EXISTS finance_loan_amount numeric, ADD COLUMN IF NOT EXISTS finance_net_receivable numeric;
-- Backfill only matching historical invoice totals and explicit payment values.
WITH matched AS (
 SELECT s.id, (x.record->>'amountPaid')::numeric AS paid, (x.record->>'dueAmount')::numeric AS due
 FROM public.sales s JOIN public.store_state st USING(store_id)
 CROSS JOIN LATERAL (SELECT e AS record FROM jsonb_array_elements(coalesce(st.state->'sales','[]'::jsonb)) e
   WHERE e->>'invoiceNo'=s.invoice_no AND jsonb_typeof(e->'amountPaid')='number' AND jsonb_typeof(e->'dueAmount')='number'
     AND jsonb_typeof(e->'total')='number' AND (e->>'total')::numeric=s.total LIMIT 1) x
 WHERE s.amount_paid IS NULL AND s.due_amount IS NULL AND s.payment_method NOT LIKE 'Finance%'
)
UPDATE public.sales s SET amount_paid=m.paid,due_amount=m.due
FROM matched m WHERE s.id=m.id AND m.paid>=0 AND m.due>=0 AND abs(m.paid+m.due-s.total)<=0.01;
CREATE OR REPLACE FUNCTION public.atomic_complete_sale_v2(
 p_store_id uuid,p_invoice_no text,p_customer_name text,p_customer_phone text,p_payment_method text,
 p_discount numeric,p_tax numeric,p_idempotency_key text,p_items jsonb,p_amount_paid numeric,p_due_amount numeric,
 p_finance_loan_amount numeric DEFAULT NULL,p_finance_net_receivable numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sale uuid; v_total numeric; v_existing record; v_is_finance boolean;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.store_id=p_store_id AND
  (p.role='owner' OR (p.role IN ('staff','manager') AND p.access_enabled IS TRUE AND (p.access_mode='no_restriction' OR p.access_expires_at>now()))))
 THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF p_amount_paid IS NULL OR p_due_amount IS NULL OR p_amount_paid<0 OR p_due_amount<0 OR p_amount_paid='NaN'::numeric OR p_due_amount='NaN'::numeric THEN RAISE EXCEPTION 'invalid payment amount'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
 SELECT greatest(0,sum((i->>'quantity')::numeric*(i->>'unit_price')::numeric)-coalesce(p_discount,0)+coalesce(p_tax,0))
 INTO v_total FROM jsonb_array_elements(p_items) i;
 v_is_finance:=coalesce(p_payment_method,'') LIKE 'Finance (%';
 IF v_is_finance THEN
  IF p_finance_loan_amount IS NULL OR p_finance_net_receivable IS NULL OR p_finance_loan_amount<0 OR p_finance_net_receivable<0 OR
    p_finance_loan_amount='NaN'::numeric OR p_finance_net_receivable='NaN'::numeric OR p_finance_net_receivable>p_finance_loan_amount OR
    abs(p_amount_paid+p_due_amount+p_finance_loan_amount-v_total)>0.01 THEN RAISE EXCEPTION 'invalid payment amount: finance totals'; END IF;
 ELSE
  IF p_finance_loan_amount IS NOT NULL OR p_finance_net_receivable IS NOT NULL OR abs(p_amount_paid+p_due_amount-v_total)>0.01
    THEN RAISE EXCEPTION 'invalid payment amount: totals do not balance'; END IF;
 END IF;
 v_sale:=public.atomic_complete_sale(p_store_id,p_invoice_no,p_customer_name,p_customer_phone,p_payment_method,p_discount,p_tax,p_idempotency_key,p_items);
 SELECT total,amount_paid,status INTO v_existing FROM public.sales WHERE id=v_sale AND store_id=p_store_id FOR UPDATE;
 IF v_existing.total IS DISTINCT FROM v_total THEN RAISE EXCEPTION 'invalid payment amount: replay total differs'; END IF;
 UPDATE public.sales SET amount_paid=p_amount_paid,due_amount=p_due_amount,finance_loan_amount=p_finance_loan_amount,
  finance_net_receivable=p_finance_net_receivable,
  status=CASE WHEN p_due_amount<=0.005 THEN 'Paid' WHEN p_amount_paid>0 THEN 'Partial' ELSE 'Due' END
 WHERE id=v_sale AND store_id=p_store_id AND amount_paid IS NULL AND status<>'Cancelled';
 RETURN v_sale;
END $$;
REVOKE ALL ON FUNCTION public.atomic_complete_sale_v2(uuid,text,text,text,text,numeric,numeric,text,jsonb,numeric,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.atomic_complete_sale_v2(uuid,text,text,text,text,numeric,numeric,text,jsonb,numeric,numeric,numeric,numeric) TO authenticated;
