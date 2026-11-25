-- Harden remaining customer/supplier and warranty RPCs, including both legacy overloads.
DO $migration$
DECLARE r record; original text; patched text; n integer:=0; note_col text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.proname IN ('upsert_customer','upsert_supplier','record_customer_payment','record_supplier_payment','record_warranty_claim','update_warranty_claim_status_by_no')
 LOOP
 original:=pg_get_functiondef(r.oid);
 patched:=regexp_replace(original,E'\\nbegin\\n',E'\nbegin\n  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id=auth.uid() AND caller.store_id=p_store_id AND (caller.role=''owner'' OR (caller.role IN (''staff'',''manager'') AND caller.access_enabled IS TRUE AND (caller.access_mode=''no_restriction'' OR caller.access_expires_at>now())))) THEN RAISE EXCEPTION ''not authorized''; END IF;\n','i');
 IF patched=original THEN RAISE EXCEPTION 'Missing body anchor: %',r.proname; END IF;
 IF r.proname IN ('record_customer_payment','record_supplier_payment') THEN
  note_col:=CASE WHEN r.proname='record_customer_payment' THEN 'note' ELSE 'notes' END;
  patched:=replace(patched,'if p_amount is null or p_amount <= 0 then','if p_amount is null or p_amount <= 0 or p_amount::text in (''NaN'',''Infinity'',''-Infinity'') then');
  patched:=replace(patched,'if p_idempotency_key is not null then', 'if p_idempotency_key is not null then' || E'\n    perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '':'' || ' || quote_literal(r.proname) || ' || '':'' || p_idempotency_key,0));');
  patched:=replace(patched,note_col || ' = (''idem:'' || p_idempotency_key)', 'split_part(' || note_col || ', '' | '', 1) = (''idem:'' || p_idempotency_key)');
  IF r.proname='record_customer_payment' THEN
   patched:=replace(patched,'insert into public.customer_payments', 'if ' || CASE WHEN strpos(original,'v_customer_id uuid')>0 THEN 'v_customer_id' ELSE 'p_customer_id' END || ' is null or not exists(select 1 from public.customers where id=' || CASE WHEN strpos(original,'v_customer_id uuid')>0 THEN 'v_customer_id' ELSE 'p_customer_id' END || ' and store_id=p_store_id) then raise exception ''invalid customer''; end if;' || E'\n  insert into public.customer_payments');
  ELSE
   patched:=replace(patched,'insert into public.supplier_transactions', 'if ' || CASE WHEN strpos(original,'v_supplier_id uuid')>0 THEN 'v_supplier_id' ELSE 'p_supplier_id' END || ' is null or not exists(select 1 from public.suppliers where id=' || CASE WHEN strpos(original,'v_supplier_id uuid')>0 THEN 'v_supplier_id' ELSE 'p_supplier_id' END || ' and store_id=p_store_id) then raise exception ''invalid supplier''; end if;' || E'\n  insert into public.supplier_transactions');
  END IF;
 END IF;
 IF r.proname='upsert_customer' THEN
  patched:=replace(patched,'if p_phone is not null and p_phone <> '''' then','if p_client_id is not null and trim(p_client_id)<>'''' then select id into v_id from public.customers where store_id=p_store_id and client_id=p_client_id limit 1; end if;' || E'\n  if v_id is null and p_phone is not null and p_phone <> '''' then');
 END IF;
 EXECUTE patched; n:=n+1;
 END LOOP;
 IF n<>8 THEN RAISE EXCEPTION 'Expected eight RPC overloads, got %',n; END IF;
END $migration$;
