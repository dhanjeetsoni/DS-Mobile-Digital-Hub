-- Step 3.4d — Tempered/Curved Glass Screen-Size Smart Fallback Search:
-- persistent, cross-store cache of phone model -> screen size (inches).

create table if not exists public.phone_screen_size_cache (
  model_key text primary key,
  model_name text not null,
  screen_size_inches numeric(4,1) not null,
  lookup_count integer not null default 1,
  looked_up_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.phone_screen_size_cache is
  'Step 3.4d: durable, cross-store cache of phone model -> diagonal screen size (inches), so a model looked up via AI once never needs an internet/Gemini call again.';

alter table public.phone_screen_size_cache enable row level security;

drop policy if exists "authenticated can read screen size cache" on public.phone_screen_size_cache;
create policy "authenticated can read screen size cache"
  on public.phone_screen_size_cache
  for select
  to authenticated
  using (true);

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
    return;
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

revoke all on function public.upsert_screen_size_cache(text, text, numeric) from public;
revoke all on function public.upsert_screen_size_cache(text, text, numeric) from anon;
grant execute on function public.upsert_screen_size_cache(text, text, numeric) to authenticated;
