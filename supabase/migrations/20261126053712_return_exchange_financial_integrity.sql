-- Guard money and quantities before they can become stock or accounting facts.
alter table public.returns add constraint returns_finite_nonnegative_amounts check (
 quantity is not null and quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity')
 and refund_amount is not null and refund_amount>=0 and refund_amount::text not in ('NaN','Infinity','-Infinity')) not valid;
alter table public.exchanges add constraint exchanges_finite_balanced_values check (
 returned_value>=0 and replacement_value>=0 and returned_value::text not in ('NaN','Infinity','-Infinity')
 and replacement_value::text not in ('NaN','Infinity','-Infinity') and difference_amount::text not in ('NaN','Infinity','-Infinity')
 and round(difference_amount,2)=round(replacement_value-returned_value,2)) not valid;
alter table public.exchange_items add constraint exchange_items_finite_values check (
 quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity') and unit_price>=0 and purchase_price>=0
 and unit_price::text not in ('NaN','Infinity','-Infinity') and purchase_price::text not in ('NaN','Infinity','-Infinity')) not valid;
do $patch$
declare f text;a text;b text;
begin
 f:=pg_get_functiondef('public.record_exchange(uuid,uuid,text,uuid,jsonb,jsonb,numeric,numeric,numeric,text,text,text)'::regprocedure);
 a:='  v_exchange_id := gen_random_uuid();';
 if position(a in f)=0 then raise exception 'exchange anchor missing';end if;
 f:=replace(f,a,'  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_returned_items||p_replacement_items) j WHERE j->>''unit_price'' IS NULL OR (j->>''unit_price'')::numeric<0 OR j->>''unit_price'' IN (''NaN'',''Infinity'',''-Infinity'') OR j->>''quantity'' IN (''NaN'',''Infinity'',''-Infinity'')) THEN RAISE EXCEPTION ''invalid payment amount: exchange lines''; END IF;
  IF p_returned_value IS NULL OR p_replacement_value IS NULL OR p_difference_amount IS NULL OR round(p_returned_value,2) IS DISTINCT FROM (SELECT round(sum((j->>''quantity'')::numeric*(j->>''unit_price'')::numeric),2) FROM jsonb_array_elements(p_returned_items) j) OR round(p_replacement_value,2) IS DISTINCT FROM (SELECT round(sum((j->>''quantity'')::numeric*(j->>''unit_price'')::numeric),2) FROM jsonb_array_elements(p_replacement_items) j) OR round(p_difference_amount,2) IS DISTINCT FROM round(p_replacement_value-p_returned_value,2) THEN RAISE EXCEPTION ''invalid payment amount: exchange totals''; END IF;
  v_exchange_id := gen_random_uuid();');
 a:='    if v_remaining > 0 then';
 b:='    insert into public.exchange_items(exchange_id, kind, product_id, quantity, unit_price, purchase_price)';
 if position(a in f)=0 then raise exception 'FIFO anchor missing';end if;
 if position(b in substring(f from position(a in f)))=0 then raise exception 'FIFO end missing';end if;
 f:=substring(f from 1 for position(a in f)-1)||'    if v_remaining > 0 then
      raise exception ''insufficient inventory: verified FIFO stock cost unavailable for exchange'';
    end if;
    if v_purchase_price is null then raise exception ''invalid quantity: unknown exchange cost''; end if;

'||substring(substring(f from position(a in f)) from position(b in substring(f from position(a in f))));
 a:='v_purchase_price := v_purchase_price + (v_take * coalesce(v_batch.purchase_price,0));';
 if position(a in f)=0 then raise exception 'FIFO cost anchor missing';end if;
 f:=replace(f,a,'IF v_batch.purchase_price IS NULL OR v_batch.purchase_price<0 THEN RAISE EXCEPTION ''invalid quantity: unknown exchange FIFO cost''; END IF;
      v_purchase_price := v_purchase_price + (v_take * v_batch.purchase_price);');
 execute f;
end $patch$;
