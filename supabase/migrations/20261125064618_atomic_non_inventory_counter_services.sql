-- Counter services are invoice lines, not inventory products.
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS service_name text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS service_category text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS service_note text;
DO $migration$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb)'::regprocedure) INTO original;
 patched:=replace(original,'    select * into v_product from public.products',$body$    IF coalesce((v_item->>'is_service')::boolean,false) THEN
      IF v_item->>'product_id' IS NOT NULL OR coalesce((v_item->>'is_gift')::boolean,false) OR v_qty::text IN ('NaN','Infinity','-Infinity') OR v_unit_price::text IN ('NaN','Infinity','-Infinity') OR nullif(btrim(v_item->>'service_name'),'') IS NULL OR length(v_item->>'service_name')>200 THEN RAISE EXCEPTION 'invalid quantity: service line invalid'; END IF;
      v_subtotal:=v_subtotal+v_qty*v_unit_price;
      CONTINUE;
    END IF;
    select * into v_product from public.products$body$);
 patched:=replace(patched,'    v_remaining := v_qty;',$body$    IF coalesce((v_item->>'is_service')::boolean,false) THEN
      INSERT INTO public.sale_items(sale_id,product_id,quantity,unit_price,cost_price,service_name,service_category,service_note)
      VALUES(v_sale_id,NULL,v_qty,v_unit_price,0,btrim(v_item->>'service_name'),left(v_item->>'service_category',100),left(v_item->>'service_note',1000));
      CONTINUE;
    END IF;
    v_remaining := v_qty;$body$);
 IF strpos(patched,'service line invalid')=0 OR strpos(patched,'service_name,service_category,service_note)')=0 THEN RAISE EXCEPTION 'service anchors missing'; END IF;
 EXECUTE patched;
END $migration$;
