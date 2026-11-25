-- Serialize return/exchange mutations on the original invoice, check total
-- quantities returned across both ledgers, and derive returned-item cost from the sale.
CREATE OR REPLACE FUNCTION public.validate_return_quantities(p_store_id uuid,p_sale_id uuid,p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i record; sold numeric; returned numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.store_id=p_store_id AND (p.role='owner' OR (p.role IN ('staff','manager') AND p.access_enabled IS TRUE AND (p.access_mode='no_restriction' OR p.access_expires_at>now())))) THEN RAISE EXCEPTION 'not authorized'; END IF;
 PERFORM 1 FROM public.sales WHERE id=p_sale_id AND store_id=p_store_id AND status<>'Cancelled' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid sale: original invoice required'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) j WHERE j->>'product_id' IS NULL OR j->>'quantity' IS NULL OR (j->>'quantity')::numeric<=0 OR j->>'quantity' IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'invalid quantity'; END IF;
 FOR i IN SELECT (j->>'product_id')::uuid product_id,sum((j->>'quantity')::numeric) qty FROM jsonb_array_elements(p_items) j GROUP BY 1 LOOP
  SELECT coalesce(sum(quantity),0) INTO sold FROM public.sale_items WHERE sale_id=p_sale_id AND product_id=i.product_id;
  SELECT coalesce(sum(quantity),0) INTO returned FROM public.returns WHERE store_id=p_store_id AND sale_id=p_sale_id AND product_id=i.product_id;
  SELECT returned+coalesce(sum(ei.quantity),0) INTO returned FROM public.exchange_items ei JOIN public.exchanges e ON e.id=ei.exchange_id WHERE e.store_id=p_store_id AND e.sale_id=p_sale_id AND ei.product_id=i.product_id AND ei.kind='returned';
  IF i.qty+returned>sold THEN RAISE EXCEPTION 'over-return: quantity exceeds original invoice'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.validate_return_quantities(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
DO $migration$
DECLARE r record; orig text; patched text; anchor text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('record_return','record_exchange','record_warranty_claim','request_return_approval') LOOP
 orig:=pg_get_functiondef(r.oid); patched:=orig;
 IF r.proname='record_return' THEN
  anchor:='select return_no into v_existing from public.returns';
  patched:=replace(patched,anchor,'perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '':return:'' || p_idempotency_key,0)); '||anchor);
  anchor:='if p_items is null or jsonb_array_length(p_items)=0';
  patched:=replace(patched,anchor,'perform public.validate_return_quantities(p_store_id,p_sale_id,p_items); '||anchor);
  patched:=replace(patched,'v_purchase_price := coalesce((v_item->>''purchase_price'')::numeric,0);','select sum(cost_price*quantity)/nullif(sum(quantity),0) into v_purchase_price from public.sale_items where sale_id=p_sale_id and product_id=(v_item->>''product_id'')::uuid;');
 ELSIF r.proname='record_exchange' THEN
  anchor:='select id into v_existing_id from public.exchanges';
  patched:=replace(patched,anchor,'perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '':exchange:'' || p_idempotency_key,0)); '||anchor);
  anchor:='if p_returned_items is null or jsonb_array_length(p_returned_items) = 0';
  patched:=replace(patched,anchor,'perform public.validate_return_quantities(p_store_id,p_sale_id,p_returned_items); '||anchor);
  patched:=replace(patched,'v_purchase_price := coalesce((v_item->>''purchase_price'')::numeric, 0);','select sum(cost_price*quantity)/nullif(sum(quantity),0) into v_purchase_price from public.sale_items where sale_id=p_sale_id and product_id=(v_item->>''product_id'')::uuid; if v_purchase_price is null then raise exception ''invalid quantity: returned item has unknown cost''; end if;');
 ELSIF r.proname='record_warranty_claim' THEN
  anchor:='insert into public.warranty_claims(';
  patched:=replace(patched,anchor,'if v_sale_item_id is null or not exists(select 1 from public.sales s join public.sale_items i on i.sale_id=s.id where s.id=p_sale_id and s.store_id=p_store_id and s.status<>''Cancelled'' and i.id=v_sale_item_id and i.warranty_enabled and i.warranty_end>=current_date) then raise exception ''invalid warranty: eligible invoice item required''; end if;'||E'\n  '||anchor);
 ELSE
  anchor:='insert into public.return_approval_requests(';
  patched:=replace(patched,anchor,'perform public.validate_return_quantities(p_store_id,p_sale_id,p_items); '||anchor);
 END IF;
 IF patched=orig THEN RAISE EXCEPTION 'Missing anchor for %',r.proname; END IF;
 EXECUTE patched;
 END LOOP;
END $migration$;
