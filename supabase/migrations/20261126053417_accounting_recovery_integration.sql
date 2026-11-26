-- Extend the existing private backup format without making old backups unreadable.
do $patch$
declare f text; a text;
begin
 f:=pg_get_functiondef('ds_recovery.capture_business(uuid,text)'::regprocedure);
 a:='FOREACH t IN ARRAY ds_recovery.business_tables() LOOP';
 if position(a in f)=0 then raise exception 'capture anchor missing';end if;
 f:=replace(f,a,'LOCK TABLE ds_accounting.pos_events IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.customer_share_links IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),''[]''::jsonb) INTO v_rows FROM ds_accounting.pos_events e WHERE e.store_id=p_store_id;
 data:=data||jsonb_build_object(''accounting_events'',v_rows);
 counts:=counts||jsonb_build_object(''accounting_events'',jsonb_array_length(v_rows));
 FOREACH t IN ARRAY ds_recovery.business_tables() LOOP');
 a:='INSERT INTO ds_recovery.business_backups(store_id,label,payload,sha256,counts)';
 if position(a in f)=0 then raise exception 'capture insert anchor missing';end if;
 f:=replace(f,a,'INSERT INTO ds_recovery.business_backups(store_id,label,payload,sha256,counts,format_version)');
 a:='encode(extensions.digest(data::text,''sha256''),''hex''),counts)';
 if position(a in f)=0 then raise exception 'capture version anchor missing';end if;
 f:=replace(f,a,'encode(extensions.digest(data::text,''sha256''),''hex''),counts,2)');
 execute f;
 f:=pg_get_functiondef('ds_recovery.verify_business_backup(uuid)'::regprocedure);
 a:='b.format_version<>1';
 if position(a in f)=0 then raise exception 'verify version anchor missing';end if;
 f:=replace(f,a,'b.format_version NOT IN (1,2)');
 a:='RETURN jsonb_build_object(''ok'',true';
 if position(a in f)=0 then raise exception 'verify return anchor missing';end if;
 f:=replace(f,a,'IF b.format_version=2 AND (jsonb_typeof(b.payload->''accounting_events'') IS DISTINCT FROM ''array'' OR (b.counts->>''accounting_events'')::int IS DISTINCT FROM jsonb_array_length(b.payload->''accounting_events'')) THEN RAISE EXCEPTION ''backup accounting count mismatch''; END IF;
 RETURN jsonb_build_object(''ok'',true');
 execute f;
 f:=pg_get_functiondef('ds_recovery.replace_business(uuid,uuid,text)'::regprocedure);
 a:='IF p_backup_id IS NOT NULL THEN';
 if position(a in f)=0 then raise exception 'restore anchor missing';end if;
 -- Only patch the first occurrence, before verification and pre-operation capture.
 f:=substring(f from 1 for position(a in f)-1)||'LOCK TABLE ds_accounting.pos_events IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE public.customer_share_links IN ACCESS EXCLUSIVE MODE;
 '||substring(f from position(a in f));
 a:='before_id:=ds_recovery.capture_business';
 if position(a in f)=0 then raise exception 'restore checkpoint anchor missing';end if;
 f:=replace(f,a,'IF p_backup_id IS NOT NULL AND NOT (data ? ''accounting_events'') AND EXISTS(SELECT 1 FROM ds_accounting.pos_events WHERE store_id=p_store_id) THEN RAISE EXCEPTION ''Legacy backup has no accounting journal; restore blocked to preserve posted history''; END IF;
 before_id:=ds_recovery.capture_business');
 a:='ordered:=ds_recovery.business_tables();';
 if position(a in f)=0 then raise exception 'restore delete anchor missing';end if;
 f:=replace(f,a,'-- Customer bearer links are intentionally never restored or reactivated.
 UPDATE public.customer_share_links SET revoked_at=now() WHERE store_id=p_store_id AND revoked_at IS NULL;
 DELETE FROM ds_accounting.pos_events WHERE store_id=p_store_id;
 ordered:=ds_recovery.business_tables();');
 a:='next_state:=data->''store_state''->0->''state'';';
 if position(a in f)=0 then raise exception 'restore payload anchor missing';end if;
 f:=replace(f,a,'IF data ? ''accounting_events'' THEN
 IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::ds_accounting.pos_events,data->''accounting_events'') e WHERE e.store_id IS DISTINCT FROM p_store_id) THEN RAISE EXCEPTION ''accounting backup scope mismatch''; END IF;
 INSERT INTO ds_accounting.pos_events(id,store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_at,recorded_by,lines,source_kind) OVERRIDING SYSTEM VALUE
 SELECT id,store_id,source_id,invoice_no,event_kind,reverses_id,effective_date,recorded_at,recorded_by,lines,source_kind FROM jsonb_populate_recordset(NULL::ds_accounting.pos_events,data->''accounting_events'') ORDER BY id;
 END IF;
 next_state:=data->''store_state''->0->''state'';');
 execute f;
end $patch$;
revoke all on function ds_recovery.capture_business(uuid,text),ds_recovery.verify_business_backup(uuid),ds_recovery.replace_business(uuid,uuid,text) from public,anon,authenticated;
