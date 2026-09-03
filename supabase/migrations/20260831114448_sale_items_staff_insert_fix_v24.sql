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
