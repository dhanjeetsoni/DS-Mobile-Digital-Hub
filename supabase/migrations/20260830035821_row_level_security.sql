alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.store_state enable row level security;
alter table public.products enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_reservations enable row level security;
alter table public.invoice_sequences enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.expenses enable row level security;
alter table public.personal_drawings enable row level security;
alter table public.returns enable row level security;
alter table public.supplier_transactions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ocr_scans enable row level security;
alter table public.pending_orders enable row level security;
alter table public.sync_queue enable row level security;
alter table public.telegram_connections enable row level security;
alter table public.telegram_connect_sessions enable row level security;
alter table public.telegram_outbox enable row level security;

drop policy if exists stores_member_select on public.stores;
create policy stores_member_select on public.stores for select to authenticated
using (id = public.my_store_id());

drop policy if exists profiles_owner_manager_select on public.profiles;
create policy profiles_owner_manager_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = profiles.store_id and p.role in ('owner','manager')
    )
  );

drop policy if exists profiles_owner_manager_update_staff on public.profiles;
create policy profiles_owner_manager_update_staff on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = profiles.store_id and p.role in ('owner','manager')
    )
    and profiles.role = 'staff'
  )
  with check (
    role = 'staff'
    and store_id = (select p.store_id from public.profiles p where p.id = auth.uid())
  );

comment on column public.profiles.access_enabled is 'Owner ON/OFF switch. false = staff app shows "Contact Shop Owner for Access" and cannot log in / stays logged out.';
comment on column public.profiles.access_mode is 'no_restriction = no time limit, full_day = expires end of day, timed = expires at access_expires_at (enforced client-side even while offline).';
comment on column public.profiles.visibility_from is 'Sales/galla before this timestamp are hidden from this staff member; product catalog (A-Z) is never hidden.';

drop policy if exists store_state_owner_manager_select on public.store_state;
create policy store_state_owner_manager_select on public.store_state for select to authenticated
using (
  store_id = public.my_store_id()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','manager'))
);

create policy products_owner_manager_select on public.products for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=products.store_id and p.role in ('owner','manager')));
create policy products_owner_manager_write on public.products for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=products.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=products.store_id and p.role in ('owner','manager')));

create policy purchases_owner_manager on public.purchases for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=purchases.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=purchases.store_id and p.role in ('owner','manager')));

create policy purchase_items_owner_manager on public.purchase_items for all to authenticated using (exists(select 1 from public.purchases pu join public.profiles p on p.store_id=pu.store_id where pu.id=purchase_items.purchase_id and p.id=auth.uid() and p.role in ('owner','manager'))) with check (exists(select 1 from public.purchases pu join public.profiles p on p.store_id=pu.store_id where pu.id=purchase_items.purchase_id and p.id=auth.uid() and p.role in ('owner','manager')));

create policy expenses_owner_manager on public.expenses for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=expenses.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=expenses.store_id and p.role in ('owner','manager')));

create policy personal_drawings_owner_manager on public.personal_drawings for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=personal_drawings.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=personal_drawings.store_id and p.role in ('owner','manager')));

create policy stock_batches_owner_manager on public.stock_batches for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=stock_batches.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=stock_batches.store_id and p.role in ('owner','manager')));

create policy supplier_transactions_owner_manager on public.supplier_transactions for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=supplier_transactions.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=supplier_transactions.store_id and p.role in ('owner','manager')));

create policy telegram_outbox_owner_manager on public.telegram_outbox for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=telegram_outbox.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=telegram_outbox.store_id and p.role in ('owner','manager')));

create policy audit_logs_owner_manager on public.audit_logs for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=audit_logs.store_id and p.role in ('owner','manager')));
create policy audit_logs_member_insert on public.audit_logs for insert to authenticated with check (store_id = public.my_store_id());

create policy sales_owner_manager_select on public.sales for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=sales.store_id and p.role in ('owner','manager')));
create policy sales_store_write on public.sales for insert to authenticated with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=sales.store_id and p.role in ('owner','manager','staff')));
create policy sales_owner_manager_update on public.sales for update to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=sales.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=sales.store_id and p.role in ('owner','manager')));
create policy sale_items_owner_manager on public.sale_items for all to authenticated using (exists(select 1 from public.sales s join public.profiles p on p.store_id=s.store_id where s.id=sale_items.sale_id and p.id=auth.uid() and p.role in ('owner','manager'))) with check (exists(select 1 from public.sales s join public.profiles p on p.store_id=s.store_id where s.id=sale_items.sale_id and p.id=auth.uid() and p.role in ('owner','manager')));

create policy invoices_owner_manager_select on public.invoices for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=invoices.store_id and p.role in ('owner','manager')));

create policy invoice_reservations_owner_manager on public.invoice_reservations for select
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=store_id and p.role in ('owner','manager')));
create policy invoice_sequences_owner_manager on public.invoice_sequences for select
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=store_id and p.role in ('owner','manager')));

create policy returns_owner_manager on public.returns for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=returns.store_id and p.role in ('owner','manager'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=returns.store_id and p.role in ('owner','manager')));

create policy stock_movements_owner_manager_select on public.stock_movements for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=stock_movements.store_id and p.role in ('owner','manager')));

create policy ocr_scans_member_insert on public.ocr_scans for insert to authenticated with check (store_id = public.my_store_id());
create policy ocr_scans_owner_manager_select on public.ocr_scans for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=ocr_scans.store_id and p.role in ('owner','manager')));

create policy pending_orders_member on public.pending_orders for all to authenticated using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());

create policy sync_queue_member on public.sync_queue for all to authenticated using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());
