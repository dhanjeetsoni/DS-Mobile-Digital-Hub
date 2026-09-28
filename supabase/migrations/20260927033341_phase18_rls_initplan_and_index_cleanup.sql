-- Phase 18 (full audit sweep): fix real, concrete findings from Supabase's
-- own performance advisor -- not a DS Mobile feature, a correctness/perf
-- pass across the whole schema. Every change here is either (a) rewording
-- an RLS policy to be semantically IDENTICAL but avoid Postgres
-- re-evaluating auth.uid() per row (Supabase's documented
-- "(select auth.<fn>())" pattern -- caches the value once per query
-- instead of once per row), or (b) dropping a byte-for-byte duplicate
-- index, or (c) adding a covering index for an FK that didn't have one.
-- None of these change what any query returns or who can access what.
--
-- Applied directly to production via the Supabase MCP on 2026-09-27, then
-- re-queried against pg_advisors to confirm auth_rls_initplan and
-- duplicate_index findings were both gone afterward; this file mirrors
-- that change so the repo and live schema stay in sync.

-- 1) auth_rls_initplan: 10 policies calling auth.uid() directly instead of
--    (select auth.uid()). Rewritten via ALTER POLICY so ownership/grants
--    are untouched; qual/with_check text is otherwise byte-identical.

alter policy crash_reports_member_insert on public.crash_reports
  with check (store_id = ( SELECT p.store_id FROM profiles p WHERE (p.id = (select auth.uid()))));

alter policy crash_reports_owner_manager_select on public.crash_reports
  using (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = crash_reports.store_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

alter policy products_staff_view_select on public.products_staff_view
  using (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = products_staff_view.store_id))));

alter policy profiles_owner_manager_update_staff on public.profiles
  using ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = profiles.store_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text]))))) AND (role = ANY (ARRAY['staff'::text, 'manager'::text])))
  with check ((role = ANY (ARRAY['staff'::text, 'manager'::text])) AND (store_id = ( SELECT p.store_id FROM profiles p WHERE (p.id = (select auth.uid())))));

alter policy return_approval_owner_manager on public.return_approval_requests
  using (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = return_approval_requests.store_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  with check (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = return_approval_requests.store_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

alter policy return_approval_staff_insert on public.return_approval_requests
  with check ((requested_by = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = return_approval_requests.store_id) AND (p.role = 'staff'::text)))));

alter policy return_approval_staff_self on public.return_approval_requests
  using (requested_by = (select auth.uid()));

alter policy sales_staff_select on public.sales
  using (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = sales.store_id) AND (p.role = 'staff'::text) AND (p.access_enabled = true))));

alter policy staff_access_owner_manager on public.staff_access_policies
  using (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = staff_access_policies.store_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text])))))
  with check (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (select auth.uid())) AND (p.store_id = staff_access_policies.store_id) AND (p.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

alter policy staff_access_self_read on public.staff_access_policies
  using (staff_profile_id = (select auth.uid()));

-- 2) duplicate_index: byte-for-byte duplicate indexes on
--    product_price_history. Keeping the *_idx names (the naming
--    convention used everywhere else in this schema) and dropping the
--    *_id_idx ones.
drop index if exists public.product_price_history_product_id_idx;
drop index if exists public.product_price_history_store_id_idx;

-- 3) unindexed_foreign_keys: 7 FKs with no covering index. Plain btree
--    indexes, additive only.
create index if not exists idx_crash_reports_profile_id on public.crash_reports (profile_id);
create index if not exists idx_product_price_history_changed_by on public.product_price_history (changed_by);
create index if not exists idx_return_approval_requests_customer_id on public.return_approval_requests (customer_id);
create index if not exists idx_return_approval_requests_requested_by on public.return_approval_requests (requested_by);
create index if not exists idx_return_approval_requests_reviewed_by on public.return_approval_requests (reviewed_by);
create index if not exists idx_return_approval_requests_sale_id on public.return_approval_requests (sale_id);
create index if not exists idx_staff_access_policies_updated_by on public.staff_access_policies (updated_by);
