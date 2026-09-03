-- Step 2.3 audit fix — `sales` table already lets staff INSERT their own
-- sale (sales_store_write, added in 20260827_staff_normalized_sales_projection_v6.sql),
-- but `sale_items` (the actual line items of what was sold) only had an
-- owner/manager ALL policy — no staff INSERT path existed at all.
--
-- This is currently dormant (nothing in the app writes to these normalized
-- tables yet — they're scaffolding for a future reporting step), but left
-- as-is it would silently 403/permission-deny every staff-submitted sale's
-- line items the moment that feature gets wired up. Fixing it now while
-- auditing per Step 2.3, matching the same store-scoped pattern already
-- used for `sales_store_write`. Staff still gets NO select/update/delete on
-- sale_items (matches `sales`, where staff also can't SELECT — they use
-- store_state_staff_view for their own view of transactions instead), so
-- this only opens the one path that was actually missing.
create policy sale_items_staff_insert on public.sale_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.sales s
      join public.profiles p on p.store_id = s.store_id
      where s.id = sale_items.sale_id
        and p.id = auth.uid()
        and p.role = 'staff'
    )
  );
