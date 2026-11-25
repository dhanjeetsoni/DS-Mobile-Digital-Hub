-- The confidential selling floor is enforced on the server without exposing it.
-- Preserve the existing phone-sale gift workflow: an explicit free gift is
-- allowed for staff only alongside a paid phone line, with one unit per gift SKU.
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
DO $migration$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb)'::regprocedure) INTO original;
 patched:=replace(original,'  v_take numeric;','  v_take numeric; v_floor_total numeric:=0; v_has_paid_phone boolean:=false; v_has_gift boolean:=false; v_floor numeric;');
 patched:=replace(patched,'    v_subtotal := v_subtotal + (v_qty * v_unit_price);',$body$    IF v_qty::text IN ('NaN','Infinity','-Infinity') OR v_unit_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid quantity or selling price'; END IF;
    IF v_role='staff' THEN
      v_floor:=greatest(0,coalesce(v_product.confidential_price,v_product.cost_price,0));
      IF coalesce((v_item->>'is_gift')::boolean,false) THEN
        IF v_unit_price<>0 OR v_qty<>1 THEN RAISE EXCEPTION 'selling price invalid: gift must be one free unit'; END IF;
        v_has_gift:=true;
      ELSE
        IF v_unit_price<v_floor THEN RAISE EXCEPTION 'selling price invalid: owner-approved price required'; END IF;
        v_floor_total:=v_floor_total+v_floor*v_qty;
        IF v_product.is_mobile_phone AND v_unit_price>0 THEN v_has_paid_phone:=true; END IF;
      END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_unit_price);$body$);
 patched:=replace(patched,'  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_tax,0));',$body$  IF coalesce(p_discount,0)<0 OR coalesce(p_tax,0)<0 OR coalesce(p_discount,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(p_tax,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid payment amount'; END IF;
  IF v_role='staff' THEN
    IF v_has_gift AND NOT v_has_paid_phone THEN RAISE EXCEPTION 'selling price invalid: gift requires a paid phone sale'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) j WHERE coalesce((j->>'is_gift')::boolean,false) GROUP BY j->>'product_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'selling price invalid: duplicate gift'; END IF;
    IF v_subtotal-coalesce(p_discount,0)<v_floor_total THEN RAISE EXCEPTION 'selling price invalid: discount requires owner approval'; END IF;
  END IF;
  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_tax,0));$body$);
 patched:=replace(patched,'cost_price, warranty_enabled, warranty_months, warranty_start, warranty_end)','cost_price, warranty_enabled, warranty_months, warranty_start, warranty_end, is_gift)');
 patched:=replace(patched,'nullif(v_item->>''warranty_end'','''')::date','nullif(v_item->>''warranty_end'','''')::date, coalesce((v_item->>''is_gift'')::boolean,false)');
 IF strpos(patched,'v_floor_total:=v_floor_total')=0 OR strpos(patched,'warranty_end, is_gift)')=0 THEN RAISE EXCEPTION 'sale anchors missing'; END IF;
 EXECUTE patched;
END $migration$;
-- Staff price lookups must never invent or replace a confidential cost.
DO $migration$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.resolve_product_for_sale(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric)'::regprocedure) INTO original;
 patched:=replace(original,'cost_price, selling_price, stock_qty, min_stock, client_id)','cost_price, selling_price, stock_qty, min_stock, client_id, pending_cost)');
 patched:=replace(patched,'coalesce(p_cost_price,0), coalesce(p_selling_price,0)','case when v_role=''staff'' then 0 else coalesce(p_cost_price,0) end, coalesce(p_selling_price,0)');
 patched:=replace(patched,'nullif(trim(coalesce(p_local_id,'''')),''''))','nullif(trim(coalesce(p_local_id,'''')),''''), v_role=''staff'')');
 IF strpos(patched,'client_id, pending_cost)')=0 OR strpos(patched,'v_role=''staff'')')=0 THEN RAISE EXCEPTION 'resolver anchors missing'; END IF;
 EXECUTE patched;
END $migration$;
