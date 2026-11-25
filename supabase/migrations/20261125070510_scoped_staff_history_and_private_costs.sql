-- Parse snapshot record times conservatively for staff visibility.
CREATE OR REPLACE FUNCTION ds_recovery.visible_staff_record(p_record jsonb,p_cutoff timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE stamp timestamptz; raw text;
BEGIN
 IF p_cutoff IS NULL THEN RETURN true; END IF;
 raw:=nullif(p_record->>'createdAt','');
 IF raw IS NOT NULL THEN stamp:=raw::timestamptz;
 ELSIF nullif(p_record->>'date','') IS NOT NULL THEN
  stamp:=((p_record->>'date')||'T'||coalesce(nullif(p_record->>'time',''),'00:00'))::timestamp AT TIME ZONE 'Asia/Kolkata';
 ELSE RETURN false; END IF;
 RETURN stamp>=p_cutoff;
EXCEPTION WHEN others THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION ds_recovery.staff_history_filter(p_state jsonb,p_cutoff timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE out_state jsonb:=p_state; k text; rows jsonb;
BEGIN
 IF p_cutoff IS NULL THEN RETURN out_state; END IF;
 FOREACH k IN ARRAY ARRAY['sales','returns','xeroxEntries'] LOOP
  SELECT coalesce(jsonb_agg(x ORDER BY ord),'[]'::jsonb) INTO rows FROM jsonb_array_elements(coalesce(out_state->k,'[]'::jsonb)) WITH ORDINALITY q(x,ord) WHERE ds_recovery.visible_staff_record(x,p_cutoff);
  out_state:=jsonb_set(out_state,ARRAY[k],rows,true);
 END LOOP;
 RETURN out_state;
END $$;
CREATE OR REPLACE FUNCTION ds_recovery.preserve_hidden_history(p_old jsonb,p_incoming jsonb,p_cutoff timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE out_state jsonb:=p_incoming; k text; rows jsonb; hidden jsonb;
BEGIN
 IF p_cutoff IS NULL THEN RETURN out_state; END IF;
 FOREACH k IN ARRAY ARRAY['sales','returns','xeroxEntries'] LOOP
  SELECT coalesce(jsonb_agg(x ORDER BY ord),'[]'::jsonb) INTO hidden FROM jsonb_array_elements(coalesce(p_old->k,'[]'::jsonb)) WITH ORDINALITY q(x,ord) WHERE NOT ds_recovery.visible_staff_record(x,p_cutoff);
  SELECT coalesce(jsonb_agg(x ORDER BY ord),'[]'::jsonb) INTO rows FROM jsonb_array_elements(coalesce(out_state->k,'[]'::jsonb)) WITH ORDINALITY q(x,ord)
   WHERE ds_recovery.visible_staff_record(x,p_cutoff) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(hidden) h WHERE h->>'id'=x->>'id');
  out_state:=jsonb_set(out_state,ARRAY[k],hidden||rows,true);
 END LOOP;
 RETURN out_state;
END $$;
-- Redact additional owner-only financial fields that newer feature models introduced.
CREATE OR REPLACE FUNCTION ds_recovery.strip_private_costs(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE out_value jsonb;
BEGIN
 IF jsonb_typeof(p)='object' THEN
  SELECT coalesce(jsonb_object_agg(key,ds_recovery.strip_private_costs(value)),'{}'::jsonb) INTO out_value
  FROM jsonb_each(p) WHERE key NOT IN ('costPrice','purchasePrice','cost','batchConsumption','confidentialPrice','pendingCost','partsCostTotal','otherCost','otherCostNote','laborProfit','costAmount','costEditedAt');
 ELSIF jsonb_typeof(p)='array' THEN
  SELECT coalesce(jsonb_agg(ds_recovery.strip_private_costs(x) ORDER BY n),'[]'::jsonb) INTO out_value FROM jsonb_array_elements(p) WITH ORDINALITY q(x,n);
 ELSE RETURN p; END IF;
 RETURN out_value;
END $$;
CREATE OR REPLACE FUNCTION ds_recovery.restore_private_costs(p_old jsonb,p_incoming jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE out_value jsonb; k text; v jsonb; old_item jsonb; n bigint;
BEGIN
 IF jsonb_typeof(p_incoming)='object' THEN
  out_value:='{}';
  FOR k,v IN SELECT key,value FROM jsonb_each(p_incoming) LOOP
   IF k NOT IN ('costPrice','purchasePrice','cost','batchConsumption','confidentialPrice','pendingCost','partsCostTotal','otherCost','otherCostNote','laborProfit','costAmount','costEditedAt') THEN
    out_value:=out_value||jsonb_build_object(k,ds_recovery.restore_private_costs(p_old->k,v));
   END IF;
  END LOOP;
  IF jsonb_typeof(p_old)='object' THEN
   SELECT out_value||coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO out_value FROM jsonb_each(p_old) WHERE key IN ('costPrice','purchasePrice','cost','batchConsumption','confidentialPrice','pendingCost','partsCostTotal','otherCost','otherCostNote','laborProfit','costAmount','costEditedAt');
  END IF;
 ELSIF jsonb_typeof(p_incoming)='array' THEN
  out_value:='[]';
  FOR v,n IN SELECT x,ord FROM jsonb_array_elements(p_incoming) WITH ORDINALITY q(x,ord) LOOP
   old_item:=NULL;
   IF jsonb_typeof(p_old)='array' AND jsonb_typeof(v)='object' THEN
    IF nullif(v->>'id','') IS NOT NULL THEN
     SELECT x INTO old_item FROM jsonb_array_elements(p_old) x WHERE x->>'id'=v->>'id' LIMIT 1;
    ELSIF nullif(v->>'productId','') IS NOT NULL THEN
     SELECT x INTO old_item FROM jsonb_array_elements(p_old) WITH ORDINALITY q(x,ord) WHERE ord=n AND x->>'productId'=v->>'productId' LIMIT 1;
    END IF;
   END IF;
   out_value:=out_value||jsonb_build_array(ds_recovery.restore_private_costs(old_item,v));
  END LOOP;
 ELSE RETURN p_incoming; END IF;
 RETURN out_value;
END $$;
DO $migration$
DECLARE orig text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.project_staff_state(jsonb)'::regprocedure) INTO orig;
 patched:=replace(orig,'return v_state;','return ds_recovery.strip_private_costs(v_state);');
 IF orig=patched THEN RAISE EXCEPTION 'projection anchor missing'; END IF; EXECUTE patched;
 SELECT pg_get_functiondef('public.save_store_state_for_user(jsonb,bigint)'::regprocedure) INTO orig;
 patched:=replace(orig,'v_state:=coalesce(p_state,''{}''::jsonb);','v_state:=ds_recovery.restore_private_costs(v_current,coalesce(p_state,''{}''::jsonb));');
 patched:=replace(patched,'  if p_expected_version is null then',$body$  -- Keep owner settings unchanged and preserve records outside the caller's history window.
  v_state:=jsonb_set(v_state,'{settings}',coalesce(v_current->'settings','{}'::jsonb),true);
  v_state:=ds_recovery.preserve_hidden_history(v_current,v_state,(SELECT visibility_from FROM public.profiles WHERE id=auth.uid()));
  if p_expected_version is null then$body$);
 patched:=replace(patched,'v_row.state := public.project_staff_state(v_row.state);','v_row.state := ds_recovery.staff_history_filter(public.project_staff_state(v_row.state),(SELECT visibility_from FROM public.profiles WHERE id=auth.uid()));');
 IF strpos(patched,'preserve_hidden_history')=0 OR strpos(patched,'restore_private_costs')=0 THEN RAISE EXCEPTION 'staff save anchors missing'; END IF; EXECUTE patched;
 SELECT pg_get_functiondef('public.load_store_state_for_user()'::regprocedure) INTO orig;
 patched:=replace(orig,'return public.project_staff_state(v_state);','return ds_recovery.staff_history_filter(public.project_staff_state(v_state),(SELECT visibility_from FROM public.profiles WHERE id=auth.uid()));');
 IF patched=orig THEN RAISE EXCEPTION 'staff load anchor missing'; END IF; EXECUTE patched;
END $migration$;
CREATE OR REPLACE FUNCTION public.load_scoped_store_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; s public.store_state%ROWTYPE; visible jsonb;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF p.id IS NULL OR NOT public.current_account_allowed() THEN RAISE EXCEPTION 'not authorized'; END IF;
 SELECT * INTO s FROM public.store_state WHERE store_id=p.store_id;
 IF s.store_id IS NULL THEN RETURN NULL; END IF;
 visible:=CASE WHEN p.role='staff' THEN ds_recovery.staff_history_filter(public.project_staff_state(s.state),p.visibility_from) ELSE s.state END;
 RETURN jsonb_build_object('state',visible,'version',s.version,'storeId',s.store_id);
END $$;
REVOKE ALL ON FUNCTION public.load_scoped_store_state() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.load_scoped_store_state() TO authenticated;
-- The shared projection cannot enforce different visibility cutoffs for each staff account.
-- Only manager/owner may query it directly; staff uses the scoped RPC.
CREATE POLICY staff_state_scoped_rpc_only ON public.store_state_staff_view AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_manage_store_profiles(store_id));
ALTER POLICY sales_staff_select ON public.sales USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.store_id=sales.store_id AND p.role='staff' AND p.access_enabled AND (p.visibility_from IS NULL OR sales.created_at>=p.visibility_from)));
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ds_recovery FROM PUBLIC,anon,authenticated;
-- Refresh existing shared mirrors to remove cost fields before any future read.
UPDATE public.store_state_staff_view m SET state=public.project_staff_state(s.state),updated_at=now() FROM public.store_state s WHERE s.store_id=m.store_id;
