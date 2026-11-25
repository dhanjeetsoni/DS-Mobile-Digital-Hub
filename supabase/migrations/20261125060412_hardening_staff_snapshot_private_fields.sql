-- Preserve private fields that were intentionally absent from a staff projection.
-- Never return the raw owner snapshot in the response to a staff write.
DO $migration$
DECLARE original text; patched text; needle text;
BEGIN
 SELECT pg_get_functiondef('public.save_store_state_for_user(jsonb,bigint)'::regprocedure) INTO original;
 patched := original;
 needle := '(incoming-''purchasePrice''-''pendingCost''-''supplier''-''units'')';
 IF strpos(patched,needle)=0 THEN RAISE EXCEPTION 'Product projection anchor missing'; END IF;
 patched := replace(patched,needle,'(incoming-''purchasePrice''-''pendingCost''-''supplier''-''units''-''confidentialPrice'')');
 needle := '''purchasePrice'',coalesce(oldp->''purchasePrice'',''null''::jsonb),';
 IF strpos(patched,needle)=0 THEN RAISE EXCEPTION 'Product cost anchor missing'; END IF;
 patched := replace(patched,needle,needle || E'\n      ''confidentialPrice'',coalesce(oldp->''confidentialPrice'',''null''::jsonb),');
 needle := $old$select coalesce(jsonb_agg(b-'purchasePrice'),'[]'::jsonb)
  into v_batches from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b;$old$;
 IF strpos(patched,needle)=0 THEN RAISE EXCEPTION 'Batch anchor missing'; END IF;
 patched := replace(patched,needle,$new$select coalesce(jsonb_agg((b-'purchasePrice') ||
    CASE WHEN oldb ? 'purchasePrice' THEN jsonb_build_object('purchasePrice',oldb->'purchasePrice') ELSE '{}'::jsonb END),'[]'::jsonb)
  into v_batches from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b
  left join lateral (select x as oldb from jsonb_array_elements(coalesce(v_current->'stockBatches','[]'::jsonb)) x where x->>'id'=b->>'id' limit 1) prior on true;$new$);
 needle := $old$select coalesce(jsonb_agg(
    (s-'items'-'financeDetails') ||
    jsonb_build_object('items',coalesce((
      select jsonb_agg(i-'purchasePrice'-'cost'-'batchConsumption')
      from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i
    ),'[]'::jsonb))
  ),'[]'::jsonb)
  into v_sales from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s;$old$;
 IF strpos(patched,needle)=0 THEN RAISE EXCEPTION 'Sale projection anchor missing'; END IF;
 patched := replace(patched,needle,$new$select coalesce(jsonb_agg(
    (s-'items'-'financeDetails') ||
    CASE WHEN olds ? 'financeDetails' THEN jsonb_build_object('financeDetails',olds->'financeDetails') ELSE '{}'::jsonb END ||
    jsonb_build_object('items',coalesce((
      select jsonb_agg((i-'purchasePrice'-'cost'-'batchConsumption') ||
        coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(oldi,'{}'::jsonb)) where key in ('purchasePrice','cost','batchConsumption')),'{}'::jsonb))
      from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) WITH ORDINALITY AS current_item(i,pos)
      left join lateral (select old_items.item as oldi from jsonb_array_elements(coalesce(olds->'items','[]'::jsonb)) WITH ORDINALITY AS old_items(item,pos)
        where old_items.pos=current_item.pos and old_items.item->>'productId'=i->>'productId' limit 1) prior_item on true
    ),'[]'::jsonb))
  ),'[]'::jsonb)
  into v_sales from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s
  left join lateral (select x as olds from jsonb_array_elements(coalesce(v_current->'sales','[]'::jsonb)) x where x->>'id'=s->>'id' limit 1) prior_sale on true;$new$);
 needle := 'return v_row;';
 IF strpos(patched,needle)=0 THEN RAISE EXCEPTION 'Return anchor missing'; END IF;
 patched := replace(patched,needle,'v_row.state := public.project_staff_state(v_row.state); return v_row;');
 EXECUTE patched;
END $migration$;
