-- Migration v41: Multi-provider AI key pool (Phase 11)
-- Extends gemini_api_keys to support arbitrary AI providers (Gemini, OpenAI, Anthropic, Groq, OpenRouter)

alter table public.gemini_api_keys
  add column if not exists provider text not null default 'gemini';

-- Helper to detect provider from key prefix if not explicitly specified
create or replace function public.detect_ai_provider(p_key text, p_explicit text default null)
returns text
language plpgsql
immutable
as $$
declare
  v_trimmed text;
begin
  if p_explicit is not null and p_explicit in ('gemini', 'openai', 'anthropic', 'groq', 'openrouter') then
    return p_explicit;
  end if;
  v_trimmed := trim(coalesce(p_key, ''));
  if v_trimmed like 'sk-ant-%' then
    return 'anthropic';
  elsif v_trimmed like 'gsk_%' then
    return 'groq';
  elsif v_trimmed like 'sk-or-%' then
    return 'openrouter';
  elsif v_trimmed like 'AIza%' then
    return 'gemini';
  elsif v_trimmed like 'sk-%' then
    return 'openai';
  else
    return 'gemini';
  end if;
end;
$$;

-- Drop old 3-parameter overload cleanly
drop function if exists public.save_gemini_api_key(smallint, text, text);
drop function if exists public.save_gemini_api_key(smallint, text, text, text);

create or replace function public.save_gemini_api_key(
  p_slot smallint,
  p_api_key text,
  p_label text default null,
  p_provider text default 'gemini'
)
returns table (out_slot smallint, out_status text, out_label text, out_provider text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_role text;
  v_clean_key text;
  v_provider text;
begin
  select p.store_id, p.role into v_store_id, v_role from public.profiles p where p.id = auth.uid();
  if v_store_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can manage AI keys.' using errcode = '42501';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 10 then
    raise exception 'Invalid key slot (must be 1-10).' using errcode = '22023';
  end if;

  v_clean_key := nullif(trim(coalesce(p_api_key, '')), '');
  v_provider := public.detect_ai_provider(v_clean_key, p_provider);

  insert into public.gemini_api_keys (store_id, slot, api_key, label, provider, status, cooldown_until, last_error)
  values (v_store_id, p_slot, v_clean_key, nullif(trim(coalesce(p_label, '')), ''), v_provider,
          case when v_clean_key is null then 'unset' else 'active' end, null, null)
  on conflict (store_id, slot) do update
    set api_key = excluded.api_key,
        label = coalesce(excluded.label, public.gemini_api_keys.label),
        provider = coalesce(excluded.provider, public.gemini_api_keys.provider, 'gemini'),
        status = excluded.status,
        cooldown_until = null,
        last_error = null
  returning gemini_api_keys.slot, gemini_api_keys.status, gemini_api_keys.label, gemini_api_keys.provider
    into out_slot, out_status, out_label, out_provider;

  return next;
end;
$$;

revoke all on function public.save_gemini_api_key(smallint, text, text, text) from public;
grant execute on function public.save_gemini_api_key(smallint, text, text, text) to authenticated;
revoke execute on function public.save_gemini_api_key(smallint, text, text, text) from anon;

-- Update status reader to return provider column
drop function if exists public.get_gemini_key_status();

create or replace function public.get_gemini_key_status()
returns table (
  slot smallint,
  has_key boolean,
  status text,
  label text,
  provider text,
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
    coalesce(k.provider, 'gemini') as provider,
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
-- FIXED: this line originally read `revoke ... TO anon`, which is not valid
-- PostgreSQL (REVOKE takes FROM), so it silently failed to apply as written.
revoke execute on function public.get_gemini_key_status() from anon;

-- Also lock down the helper, which the original migration never revoked at
-- all. Note anon holds a DIRECT grant on new functions under Supabase's
-- default privileges, so revoking PUBLIC alone is not enough here.
revoke execute on function public.detect_ai_provider(text, text) from public;
revoke execute on function public.detect_ai_provider(text, text) from anon;
grant execute on function public.detect_ai_provider(text, text) to authenticated, service_role;
