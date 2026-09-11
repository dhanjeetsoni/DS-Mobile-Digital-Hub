-- 1) function_search_path_mutable: pin search_path on project_staff_state
ALTER FUNCTION public.project_staff_state(jsonb) SET search_path = 'public';

-- 2) SECURITY BUG FIX: invoice_reservations_owner_manager had a tautology
--    (p.store_id = p.store_id) instead of comparing against the row's
--    store_id, letting any owner/manager see every store's rows.
--    Also wraps auth.uid() per auth_rls_initplan perf recommendation.
ALTER POLICY invoice_reservations_owner_manager ON public.invoice_reservations
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (select auth.uid())
        AND p.store_id = invoice_reservations.store_id
        AND p.role = ANY (ARRAY['owner'::text,'manager'::text])
    )
  );

-- 2b) Same bug + fix on invoice_sequences_owner_manager
ALTER POLICY invoice_sequences_owner_manager ON public.invoice_sequences
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (select auth.uid())
        AND p.store_id = invoice_sequences.store_id
        AND p.role = ANY (ARRAY['owner'::text,'manager'::text])
    )
  );
