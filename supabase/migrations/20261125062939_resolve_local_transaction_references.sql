-- Resolve client-side identifiers without creating stock or changing a ledger.
CREATE OR REPLACE FUNCTION public.resolve_transaction_refs(p_store_id uuid,p_invoice_no text,p_sale_id text,p_sale_operation_id text,p_product_ids text[],p_customer_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_sale uuid; v_customer uuid; v_product uuid; v_id text; v_products jsonb:='{}'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.store_id=p_store_id AND (p.role='owner' OR (p.role IN ('staff','manager') AND p.access_enabled IS TRUE AND (p.access_mode='no_restriction' OR p.access_expires_at>now())))) THEN RAISE EXCEPTION 'not authorized'; END IF;
 SELECT s.id INTO v_sale FROM public.sales s WHERE s.store_id=p_store_id AND (s.id::text=p_sale_id OR (p_sale_operation_id IS NOT NULL AND s.idempotency_key=p_sale_operation_id) OR (p_invoice_no IS NOT NULL AND s.invoice_no=p_invoice_no)) ORDER BY CASE WHEN s.idempotency_key=p_sale_operation_id THEN 0 WHEN s.id::text=p_sale_id THEN 1 ELSE 2 END LIMIT 1;
 IF v_sale IS NULL THEN RAISE EXCEPTION 'SALE_NOT_SYNCED: original invoice must sync first'; END IF;
 FOREACH v_id IN ARRAY coalesce(p_product_ids,ARRAY[]::text[]) LOOP
  SELECT p.id INTO v_product FROM public.products p WHERE p.store_id=p_store_id AND (p.id::text=v_id OR p.client_id=v_id) ORDER BY CASE WHEN p.id::text=v_id THEN 0 ELSE 1 END LIMIT 1;
  IF v_product IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_SYNCED: product must sync first'; END IF;
  v_products:=v_products||jsonb_build_object(v_id,v_product);
 END LOOP;
 IF p_customer_id IS NOT NULL THEN
  SELECT c.id INTO v_customer FROM public.customers c WHERE c.store_id=p_store_id AND (c.id::text=p_customer_id OR c.client_id=p_customer_id) ORDER BY CASE WHEN c.id::text=p_customer_id THEN 0 ELSE 1 END LIMIT 1;
 END IF;
 RETURN jsonb_build_object('saleId',v_sale,'productIds',v_products,'customerId',v_customer);
END $$;
REVOKE ALL ON FUNCTION public.resolve_transaction_refs(uuid,text,text,text,text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_transaction_refs(uuid,text,text,text,text[],text) TO authenticated;
