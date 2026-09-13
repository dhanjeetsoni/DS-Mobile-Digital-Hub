-- products: products_owner_manager_select duplicated the exact same
-- condition already covered by the ALL policy products_owner_manager_write.
-- Drop the redundant SELECT-only policy; no access change, one less
-- policy evaluated per SELECT.
DROP POLICY IF EXISTS products_owner_manager_select ON public.products;

-- sale_items: sale_items_owner_manager (ALL) and sale_items_staff_insert
-- (INSERT) both run on every INSERT for the authenticated role. Split the
-- ALL policy into per-command policies and fold INSERT into one combined
-- policy so only one permissive policy runs per action.
DROP POLICY IF EXISTS sale_items_owner_manager ON public.sale_items;
DROP POLICY IF EXISTS sale_items_staff_insert ON public.sale_items;

CREATE POLICY sale_items_owner_manager_select ON public.sale_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM sales s JOIN profiles p ON p.store_id = s.store_id WHERE s.id = sale_items.sale_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

CREATE POLICY sale_items_owner_manager_update ON public.sale_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM sales s JOIN profiles p ON p.store_id = s.store_id WHERE s.id = sale_items.sale_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s JOIN profiles p ON p.store_id = s.store_id WHERE s.id = sale_items.sale_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

CREATE POLICY sale_items_owner_manager_delete ON public.sale_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM sales s JOIN profiles p ON p.store_id = s.store_id WHERE s.id = sale_items.sale_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));

CREATE POLICY sale_items_insert ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM sales s JOIN profiles p ON p.store_id = s.store_id WHERE s.id = sale_items.sale_id AND p.id = (select auth.uid()) AND p.role = ANY (ARRAY['owner'::text,'manager'::text]))
    OR
    EXISTS (SELECT 1 FROM sales s JOIN profiles p ON p.store_id = s.store_id WHERE s.id = sale_items.sale_id AND p.id = (select auth.uid()) AND p.role = 'staff'::text)
  );
