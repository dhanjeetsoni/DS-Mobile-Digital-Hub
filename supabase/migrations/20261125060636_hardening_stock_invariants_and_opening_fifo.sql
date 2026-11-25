-- Database invariants prevent negative stock and invalid FIFO lots.
ALTER TABLE public.products ADD CONSTRAINT hardening_nonnegative_stock CHECK (stock_qty >= 0);
ALTER TABLE public.stock_batches ADD CONSTRAINT hardening_valid_fifo_qty CHECK (qty > 0 AND remaining_qty >= 0 AND remaining_qty <= qty);
-- A catalog INSERT with an opening quantity must also open an actual FIFO lot.
-- Unknown purchase cost remains NULL rather than being silently converted to zero.
CREATE OR REPLACE FUNCTION public.create_opening_fifo_lot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.stock_qty > 0 THEN
  INSERT INTO public.stock_batches(store_id,product_id,qty,remaining_qty,purchase_price,source,ref)
  VALUES (NEW.store_id,NEW.id,NEW.stock_qty,NEW.stock_qty,CASE WHEN NEW.pending_cost THEN NULL ELSE NEW.cost_price END,'opening_catalog','Initial catalog stock');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.create_opening_fifo_lot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hardening_opening_fifo AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.create_opening_fifo_lot();
-- Reject over-adjustment rather than silently clamping product stock to zero.
DO $migration$
DECLARE original text; patched text; needle text;
BEGIN
 SELECT pg_get_functiondef('public.atomic_apply_stock_adjustment(uuid,uuid,numeric,text,text)'::regprocedure) INTO original;
 needle := 'if p_delta > 0 then';
 IF strpos(original,needle)=0 THEN RAISE EXCEPTION 'Stock adjustment anchor missing'; END IF;
 patched := replace(original,needle,'if v_product.stock_qty + p_delta < 0 then raise exception ''insufficient inventory for stock adjustment''; end if;' || E'\n  ' || needle);
 EXECUTE patched;
 -- Preserve correct cost of any FIFO quantity consumed before a legacy shortage.
 SELECT pg_get_functiondef('public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb)'::regprocedure) INTO original;
 needle := $old$select cost_price into v_line_cost from public.products where id = (v_item->>'product_id')::uuid;
      v_line_cost := coalesce(v_line_cost,0) * v_qty;$old$;
 IF strpos(original,needle)=0 THEN RAISE EXCEPTION 'Sale FIFO anchor missing'; END IF;
 patched := replace(original,needle,$new$-- Remaining legacy stock lacks a FIFO lot; cost cannot be established reliably.
      v_line_cost := NULL;$new$);
 patched := replace(patched,'v_line_cost := v_line_cost + (v_take * coalesce(v_batch.purchase_price,0));','v_line_cost := v_line_cost + (v_take * v_batch.purchase_price);');
 EXECUTE patched;
END $migration$;
