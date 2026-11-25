DO $migration$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.list_return_approval_requests(uuid,text)'::regprocedure) INTO original;
 patched:=replace(original,'select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;','select pr.role into v_role from public.profiles pr where pr.id = auth.uid() and pr.store_id = p_store_id;');
 IF patched=original THEN RAISE EXCEPTION 'profile lookup anchor missing'; END IF;
 EXECUTE patched;
END $migration$;