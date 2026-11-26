create table public.customer_share_links (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 store_id uuid not null references public.stores(id) on delete cascade,
 kind text not null check (kind in ('receipt','repair')),
 resource_id text not null check (length(resource_id) between 1 and 150),
 created_by uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 constraint share_link_expiry check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
alter table public.customer_share_links enable row level security;
revoke all on table public.customer_share_links from public, anon, authenticated;
grant select,insert,update,delete on table public.customer_share_links to service_role;
create index customer_share_links_resource_idx on public.customer_share_links(store_id,kind,resource_id);
create index customer_share_links_expiry_idx on public.customer_share_links(expires_at);
comment on table public.customer_share_links is 'Server-only hashed bearer links; never contains receipt or repair payload. No direct client access.';
