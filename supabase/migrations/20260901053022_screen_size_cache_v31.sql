-- Step 3.4d — Tempered/Curved Glass Screen-Size Smart Fallback Search:
-- persistent, cross-store cache of phone model -> screen size (inches).
--
-- Why global (not store-scoped): a phone model's diagonal screen size is a
-- fixed physical fact, identical for every shop. Once ANY store's AI has
-- looked up "Realme P4" -> 6.7", every other store benefits instantly and
-- never needs to spend a Gemini call re-deriving the same fact. This is not
-- sensitive/secret data (it's public phone specs), so — unlike
-- gemini_api_keys — a shared table is the correct design here, not a
-- per-store silo.
--
-- Access pattern: the trusted backend (server.ts, using the service-role
-- client) reads/writes this directly and is the primary path. The SELECT
-- policy and RPC below additionally allow any signed-in (owner or staff)
-- client to read/write it directly in the future without needing a new
-- migration, consistent with how this app already lets staff sessions
-- reach non-sensitive shared data.

create table if not exists public.phone_screen_size_cache (
  model_key text primary key,               -- normalized (trim + lowercase) lookup key
  model_name text not null,                  -- last-seen human-readable form, for debugging/audit
  screen_size_inches numeric(4,1) not null,
  lookup_count integer not null default 1,
  looked_up_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.phone_screen_size_cache is
  'Step 3.4d: durable, cross-store cache of phone model -> diagonal screen size (inches), so a model looked up via AI once never needs an internet/Gemini call again.';

alter table public.phone_screen_size_cache enable row level security;

-- Any authenticated user (owner OR staff, both are real Supabase Auth
-- sessions per Step 1.2/1.5) can read the cache directly — it's shared,
-- non-sensitive reference data, the same category of thing as "what screen
-- size is a Realme P4" that's freely available anywhere online.
drop policy if exists "authenticated can read screen size cache" on public.phone_screen_size_cache;
create policy "authenticated can read screen size cache"
  on public.phone_screen_size_cache
  for select
  to authenticated
  using (true);

-- Writes go through a SECURITY DEFINER RPC (not a direct INSERT/UPDATE
-- policy) so every write is a clean upsert with a validated numeric size
-- and an incrementing lookup_count, rather than trusting arbitrary client
-- writes straight into the table.
create or replace function public.upsert_screen_size_cache(
  p_model_key text,
  p_model_name text,
  p_screen_size_inches numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_model_key is null or trim(p_model_key) = '' then
    return;
  end if;
  if p_screen_size_inches is null or p_screen_size_inches <= 0 or p_screen_size_inches > 20 then
    return; -- guard against garbage/out-of-range values polluting the shared cache
  end if;

  insert into public.phone_screen_size_cache (model_key, model_name, screen_size_inches, looked_up_at, lookup_count)
  values (lower(trim(p_model_key)), coalesce(nullif(trim(p_model_name), ''), p_model_key), p_screen_size_inches, now(), 1)
  on conflict (model_key) do update
    set screen_size_inches = excluded.screen_size_inches,
        model_name = excluded.model_name,
        looked_up_at = now(),
        lookup_count = public.phone_screen_size_cache.lookup_count + 1;
end;
$$;

-- Match this project's established pattern (see 20260831114557 /
-- 20260831115430 gemini RPC hardening): explicitly revoke the default
-- PUBLIC grant and re-grant only to `authenticated`, not `anon`.
revoke all on function public.upsert_screen_size_cache(text, text, numeric) from public;
revoke all on function public.upsert_screen_size_cache(text, text, numeric) from anon;
grant execute on function public.upsert_screen_size_cache(text, text, numeric) to authenticated;

-- The service-role client (server.ts's `supabaseAdmin`) bypasses RLS
-- entirely, so it can read/write regardless of the policy/RPC above — this
-- is the primary path used by Step 3.4's runScreenSizeLookup(). The RLS
-- policy + RPC exist as a secondary, safe path for any future direct-client
-- use, matching this project's defense-in-depth pattern elsewhere.
