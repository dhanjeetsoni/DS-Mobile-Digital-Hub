-- Step 2.1 / 2.2 — Owner-managed Gemini API key pool (up to 10 keys per store)
-- with status tracking for the Owner-only "AI Key Status Widget".

create table if not exists public.gemini_api_keys (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  slot smallint not null check (slot between 1 and 10),
  api_key text,
  label text,
  status text not null default 'unset' check (status in ('unset', 'active', 'exhausted', 'invalid')),
  cooldown_until timestamptz,
  last_used_at timestamptz,
  last_error text,
  usage_count_today integer not null default 0,
  usage_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slot)
);

alter table public.gemini_api_keys enable row level security;
-- Intentionally NO policies here — RLS + zero policies = deny-all via
-- PostgREST for every role. Access is only via the RPCs below (client) and
-- the server_role key (trusted Node backend, bypasses RLS by design).

create or replace function public.touch_gemini_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gemini_api_keys_touch_updated_at on public.gemini_api_keys;
create trigger gemini_api_keys_touch_updated_at
  before update on public.gemini_api_keys
  for each row execute function public.touch_gemini_updated_at();

create or replace function public.save_gemini_api_key(p_slot smallint, p_api_key text, p_label text default null)
returns table (slot smallint, status text, label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_role text;
  v_clean_key text;
begin
  select p.store_id, p.role into v_store_id, v_role from public.profiles p where p.id = auth.uid();
  if v_store_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can manage AI keys.' using errcode = '42501';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 10 then
    raise exception 'Invalid key slot (must be 1-10).' using errcode = '22023';
  end if;

  v_clean_key := nullif(trim(coalesce(p_api_key, '')), '');

  insert into public.gemini_api_keys (store_id, slot, api_key, label, status, cooldown_until, last_error)
  values (v_store_id, p_slot, v_clean_key, nullif(trim(coalesce(p_label, '')), ''),
          case when v_clean_key is null then 'unset' else 'active' end, null, null)
  on conflict (store_id, slot) do update
    set api_key = excluded.api_key,
        label = coalesce(excluded.label, public.gemini_api_keys.label),
        status = excluded.status,
        cooldown_until = null,
        last_error = null
  returning gemini_api_keys.slot, gemini_api_keys.status, gemini_api_keys.label into slot, status, label;

  return next;
end;
$$;

revoke all on function public.save_gemini_api_key(smallint, text, text) from public;
grant execute on function public.save_gemini_api_key(smallint, text, text) to authenticated;

create or replace function public.get_gemini_key_status()
returns table (
  slot smallint,
  has_key boolean,
  status text,
  label text,
  cooldown_until timestamptz,
  last_used_at timestamptz,
  usage_count_today integer,
  last_error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_role text;
begin
  select p.store_id, p.role into v_store_id, v_role from public.profiles p where p.id = auth.uid();
  if v_store_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can view AI key status.' using errcode = '42501';
  end if;

  return query
  select
    s.slot,
    (k.api_key is not null) as has_key,
    coalesce(k.status, 'unset') as status,
    k.label,
    k.cooldown_until,
    k.last_used_at,
    case when k.usage_date = current_date then coalesce(k.usage_count_today, 0) else 0 end as usage_count_today,
    k.last_error
  from generate_series(1, 10) as s(slot)
  left join public.gemini_api_keys k on k.store_id = v_store_id and k.slot = s.slot
  order by s.slot;
end;
$$;

revoke all on function public.get_gemini_key_status() from public;
grant execute on function public.get_gemini_key_status() to authenticated;
