-- Restore the authoritative relational FIFO cost to owner-facing staff-sale snapshots.
-- Staff still receives the redacted projection, and unknown costs remain unknown.
CREATE OR REPLACE FUNCTION public.hydrate_snapshot_sale_costs(p_store_id uuid,p_sales jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s jsonb; i jsonb; result jsonb:='[]'; items jsonb; sale_uuid uuid; average_cost numeric;
BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements(coalesce(p_sales,'[]'::jsonb)) LOOP
  SELECT x.id INTO sale_uuid FROM public.sales x WHERE x.store_id=p_store_id AND (x.id::text=s->>'id' OR x.invoice_no=s->>'invoiceNo' OR x.idempotency_key=s->>'syncOperationId')
  ORDER BY CASE WHEN x.idempotency_key=s->>'syncOperationId' THEN 0 WHEN x.id::text=s->>'id' THEN 1 ELSE 2 END LIMIT 1;
  IF sale_uuid IS NOT NULL THEN
   items:='[]'::jsonb;
   FOR i IN SELECT value FROM jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) LOOP
    SELECT CASE WHEN count(*)>0 AND count(si.cost_price)=count(*) THEN sum(si.cost_price*si.quantity)/nullif(sum(si.quantity),0) ELSE NULL END
    INTO average_cost
    FROM public.sale_items si JOIN public.products p ON p.id=si.product_id AND p.store_id=p_store_id
    WHERE si.sale_id=sale_uuid AND (p.id::text=i->>'productId' OR p.client_id=i->>'productId') AND si.unit_price=(i->>'price')::numeric;
    IF average_cost IS NOT NULL THEN
     i:=i||jsonb_build_object('purchasePrice',round(average_cost,2),'cost',round(average_cost*(i->>'qty')::numeric,2),'costPending',false);
    ELSIF NOT (i ? 'cost') THEN
     i:=i||jsonb_build_object('costPending',true);
    END IF;
    items:=items||jsonb_build_array(i);
   END LOOP;
   s:=jsonb_set(s,'{items}',items,true);
  END IF;
  result:=result||jsonb_build_array(s);
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.hydrate_snapshot_sale_costs(uuid,jsonb) FROM PUBLIC,anon,authenticated;
DO $migration$
DECLARE r record; orig text; patched text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('save_store_state_for_user','save_store_state_scoped') LOOP
  orig:=pg_get_functiondef(r.oid);
  patched:=regexp_replace(orig,E'\\nbegin[ \\t]*\\n',E'\nbegin\n  IF p_expected_version IS NULL THEN RAISE EXCEPTION ''VERSION_CONFLICT: expected version required''; END IF;\n','i');
  IF orig=patched THEN RAISE EXCEPTION 'missing version guard'; END IF;
  IF r.proname='save_store_state_for_user' THEN
   IF strpos(patched,'v_state:=jsonb_set(v_state,''{sales}'',v_sales,true);')=0 THEN RAISE EXCEPTION 'missing sales anchor'; END IF;
   patched:=replace(patched,'v_state:=jsonb_set(v_state,''{sales}'',v_sales,true);','v_state:=jsonb_set(v_state,''{sales}'',public.hydrate_snapshot_sale_costs(v_store,v_sales),true);');
  END IF;
  EXECUTE patched;
 END LOOP;
END $migration$;
