ALTER POLICY invoices_owner_manager_select ON public.invoices
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = (select auth.uid()) AND p.store_id = invoices.store_id AND p.role = ANY (ARRAY['owner'::text,'manager'::text])));
