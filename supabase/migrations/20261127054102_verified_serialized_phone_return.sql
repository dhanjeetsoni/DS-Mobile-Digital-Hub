alter table public.returns add column returned_imei text check(returned_imei is null or returned_imei ~ '^[0-9]{15}$');
CREATE OR REPLACE FUNCTION ds_recovery.release_returned_imei(p_store uuid, p_sale uuid, p_item jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_product uuid:=(p_item->>'product_id')::uuid; v_imei text:=p_item->>'returned_imei'; v_qty numeric:=(p_item->>'quantity')::numeric; s public.sales%rowtype; v_price numeric;
begin
 if not exists(select 1 from public.products where id=v_product and store_id=p_store and is_mobile_phone)
 and not exists(select 1 from ds_recovery.sale_imei_reservations where store_id=p_store and sale_id=p_sale and product_id=v_product) then
  if v_imei is not null then raise exception 'IMEI reservation: nonserialized item';end if;return null;
 end if;
 if v_qty<>1 or v_imei is null or v_imei !~ '^[0-9]{15}$' then raise exception 'IMEI reservation: one physically verified returned device required';end if;
 select * into s from public.sales where id=p_sale and store_id=p_store;
 if s.amount_paid is null or s.amount_paid<>s.total or s.due_amount is distinct from 0::numeric or s.finance_loan_amount is not null or s.discount<>0 or s.tax<>0 then raise exception 'invalid payment amount: serialized return needs allocation review';end if;
 select unit_price into v_price from public.sale_items where sale_id=p_sale and product_id=v_product order by id limit 1;
 if (select count(*) from public.sale_items where sale_id=p_sale and product_id=v_product)<>1 or (p_item->>'refund_amount')::numeric is distinct from v_price then raise exception 'invalid payment amount: original single-line device price required';end if;
 update ds_recovery.sale_imei_reservations set released_at=now() where store_id=p_store and sale_id=p_sale and product_id=v_product and imei=v_imei and released_at is null;
 if not found then raise exception 'IMEI reservation: device not actively assigned to original invoice';end if;
 return v_imei;
end $function$
;
revoke all on function ds_recovery.release_returned_imei(uuid,uuid,jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.record_return(p_store_id uuid, p_sale_id uuid, p_return_no text, p_customer_id uuid, p_return_type text, p_reason text, p_refund_method text, p_notes text, p_items jsonb, p_idempotency_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text; v_existing text; v_item jsonb; v_product public.products%rowtype; v_qty numeric; v_refund numeric; v_purchase_price numeric; v_returned_imei text;
begin
  IF NOT public.current_account_allowed() THEN RAISE EXCEPTION 'not authorized: account outside access window'; END IF;
  -- hardening_active_profile_guard
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id = auth.uid() AND (caller.role = 'owner' OR (caller.role IN ('staff', 'manager') AND caller.access_enabled IS TRUE AND (caller.access_mode = 'no_restriction' OR caller.access_expires_at > now())))) THEN
    RAISE EXCEPTION 'not authorized: account disabled or expired';
  END IF;
  select role into v_role from public.profiles where id=auth.uid() and store_id=p_store_id;
  if v_role is null or v_role not in ('owner','manager') then raise exception 'staff return requires owner approval'; end if;
  if p_idempotency_key is null or trim(p_idempotency_key)='' then raise exception 'idempotency key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':return:' || p_idempotency_key,0)); select return_no into v_existing from public.returns where store_id=p_store_id and idempotency_key=p_idempotency_key limit 1;
  if v_existing is not null then return v_existing; end if;
  perform public.validate_return_quantities(p_store_id,p_sale_id,p_items); if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'invalid quantity: no return items'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'invalid quantity'; end if;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and store_id=p_store_id for update;
    if v_product.id is null then raise exception 'invalid quantity: unknown product'; end if;
  end loop;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_refund := coalesce((v_item->>'refund_amount')::numeric,0);
    v_returned_imei:=ds_recovery.release_returned_imei(p_store_id,p_sale_id,v_item);
    select sum(cost_price*quantity)/nullif(sum(quantity),0) into v_purchase_price from public.sale_items where sale_id=p_sale_id and product_id=(v_item->>'product_id')::uuid;
    insert into public.stock_batches(store_id,product_id,qty,remaining_qty,purchase_price,source,ref)
    values (p_store_id,(v_item->>'product_id')::uuid,v_qty,v_qty,v_purchase_price,'return',coalesce(p_return_no,p_idempotency_key));
    update public.products set stock_qty=stock_qty+v_qty where id=(v_item->>'product_id')::uuid and store_id=p_store_id;
    insert into public.stock_movements(store_id,product_id,movement_type,quantity,reference,created_by)
    values (p_store_id,(v_item->>'product_id')::uuid,'return',v_qty,coalesce(p_return_no,p_idempotency_key),auth.uid());
    insert into public.returns(store_id,sale_id,product_id,quantity,refund_amount,reason,return_no,customer_id,refund_method,notes,return_type,idempotency_key,created_by,approval_request_id,returned_imei)
    values (p_store_id,p_sale_id,(v_item->>'product_id')::uuid,v_qty,v_refund,p_reason,p_return_no,p_customer_id,p_refund_method,p_notes,p_return_type,p_idempotency_key,auth.uid(),null,v_returned_imei);
  end loop;
  return p_return_no;
exception when unique_violation then
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':return:' || p_idempotency_key,0)); select return_no into v_existing from public.returns where store_id=p_store_id and idempotency_key=p_idempotency_key limit 1;
  if v_existing is not null then return v_existing; end if; raise;
end; $function$
;
