-- Phase 10: "Same per-category logic for the customer-facing 'quote'/
-- feel-good line printed on the invoice". Today's line
-- (InvoiceViewerModal's MOTIVATIONAL_LINES) is a fixed set of 8 generic
-- lines chosen by hashing the invoice number — unrelated to what was
-- actually sold. This adds a per-category, AI-generated + cached line
-- instead (mirrors the phone_screen_size_cache pattern already used for
-- this exact "ask AI once, cache the answer, categories are open-ended
-- so a static lookup table can't cover them" shape of problem).

create table if not exists public.category_quotes (
  store_id uuid not null references public.stores(id) on delete cascade,
  category text not null,
  quote_text text not null,
  generated_at timestamptz not null default now(),
  primary key (store_id, category)
);

alter table public.category_quotes enable row level security;

-- Read-only for the store's own staff/owner/manager (needed so the quote
-- shows on an invoice regardless of who's viewing it) -- writes only ever
-- happen via the ai-gateway Edge Function's service-role client, same
-- write boundary as phone_screen_size_cache.
create policy category_quotes_own_store_select on public.category_quotes
  for select
  using (store_id = public.current_profile_store_id());

revoke all on public.category_quotes from anon, authenticated;
grant select on public.category_quotes to authenticated;
