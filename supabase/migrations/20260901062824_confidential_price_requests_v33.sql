-- Step 4.3 — Confidential Price: per-product Telegram request/approval flow.
create table if not exists public.confidential_price_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  product_category text,
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_by_name text,
  status text not null default 'pending' check (status in ('pending','approved','denied','expired')),
  revealed_price numeric,
  telegram_chat_id text,
  telegram_message_id text,
  reveal_expires_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists confidential_price_requests_store_id_idx on public.confidential_price_requests(store_id);
create index if not exists confidential_price_requests_requested_by_idx on public.confidential_price_requests(requested_by);
create index if not exists confidential_price_requests_status_idx on public.confidential_price_requests(status);

alter table public.confidential_price_requests enable row level security;

drop policy if exists "cpr_select_own_or_store_owner" on public.confidential_price_requests;
create policy "cpr_select_own_or_store_owner"
  on public.confidential_price_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.store_id = confidential_price_requests.store_id
        and p.role in ('owner','manager')
    )
  );

grant select on public.confidential_price_requests to authenticated;
revoke insert, update, delete on public.confidential_price_requests from authenticated, anon;

create or replace function public.expire_confidential_price_requests()
returns void
language sql
security definer
set search_path = public
as $$
  update public.confidential_price_requests
    set status = 'expired', revealed_price = null
    where status = 'approved' and reveal_expires_at is not null and reveal_expires_at < now();
  update public.confidential_price_requests
    set status = 'expired'
    where status = 'pending' and created_at < now() - interval '30 minutes';
$$;
revoke all on function public.expire_confidential_price_requests() from public, anon, authenticated;

select cron.schedule(
  'expire-confidential-price-requests',
  '* * * * *',
  $$select public.expire_confidential_price_requests();$$
);

alter publication supabase_realtime add table public.confidential_price_requests;
