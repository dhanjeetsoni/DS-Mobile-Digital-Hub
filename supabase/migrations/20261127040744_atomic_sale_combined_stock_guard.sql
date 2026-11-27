do $patch$
declare f text;a text;
begin
 f:=pg_get_functiondef('public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb)'::regprocedure);
 a:='  v_sale_id := gen_random_uuid();';
 if position(a in f)=0 then raise exception 'sale validation anchor missing';end if;
 f:=replace(f,a,'  -- Lock all distinct inventory rows in stable order, before processing any line.
  PERFORM p.id FROM public.products p WHERE p.store_id=p_store_id
    AND p.id IN (SELECT (j->>''product_id'')::uuid FROM jsonb_array_elements(p_items) j WHERE NOT coalesce((j->>''is_service'')::boolean,false))
    ORDER BY p.id FOR UPDATE;
  v_sale_id := gen_random_uuid();');
 a:='  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_tax,0));';
 if position(a in f)=0 then raise exception 'sale total anchor missing';end if;
 f:=replace(f,a,'  -- Paid and gift lines can reference the same product; validate the combined quantity.
  IF EXISTS (SELECT 1 FROM (SELECT (j->>''product_id'')::uuid product_id,sum((j->>''quantity'')::numeric) qty FROM jsonb_array_elements(p_items) j WHERE NOT coalesce((j->>''is_service'')::boolean,false) GROUP BY 1) requested
    JOIN public.products p ON p.id=requested.product_id AND p.store_id=p_store_id WHERE requested.qty>p.stock_qty)
  THEN RAISE EXCEPTION ''insufficient inventory: combined cart quantity exceeds stock''; END IF;
  IF coalesce(p_discount,0)>v_subtotal THEN RAISE EXCEPTION ''invalid payment amount: discount exceeds subtotal''; END IF;
  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_tax,0));');
 execute f;
end $patch$;
