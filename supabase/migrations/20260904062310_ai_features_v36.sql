-- AI Features batch: resale price advisor, customer reply draft, demand
-- forecast, expense OCR, loyalty churn risk (all served from ai-gateway,
-- no new tables needed) + scheduled AI daily digest (needs a per-store
-- opt-in flag + owner/manager-only getter/setter RPCs, same security-definer
-- pattern as save_gemini_api_key()).

alter table public.stores
  add column if not exists ai_digest_enabled boolean not null default false;

create or replace function public.set_ai_digest_enabled(p_enabled boolean)
returns void
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
    raise exception 'Only the Owner/Manager can change this setting.' using errcode = '42501';
  end if;
  update public.stores set ai_digest_enabled = coalesce(p_enabled, false) where id = v_store_id;
end;
$$;

revoke all on function public.set_ai_digest_enabled(boolean) from public, anon;
grant execute on function public.set_ai_digest_enabled(boolean) to authenticated;

create or replace function public.get_ai_digest_enabled()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_enabled boolean;
begin
  select p.store_id into v_store_id from public.profiles p where p.id = auth.uid();
  if v_store_id is null then
    return false;
  end if;
  select s.ai_digest_enabled into v_enabled from public.stores s where s.id = v_store_id;
  return coalesce(v_enabled, false);
end;
$$;

revoke all on function public.get_ai_digest_enabled() from public, anon;
grant execute on function public.get_ai_digest_enabled() to authenticated;

-- Daily sweep (21:00 IST) — POSTs to ai-gateway's cron-only route, which
-- fans out to every ai_digest_enabled store with a connected Telegram chat.
-- Same shared-secret cron pattern as telegram-outbox-worker-sweep.
-- NOTE: superseded by 20260907041406_point_daily_digest_cron_to_fixed_worker.sql,
-- which repoints this same cron job at daily-digest-worker (the version that
-- reads relational sales/products instead of the now-empty JSON blob).
select cron.schedule(
  'ai-daily-digest-sweep',
  '30 15 * * *',
  $$
  select net.http_post(
    url := 'https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/ai-gateway/cron-daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0c3d70b61966a67436377dbfec1fe53e420e3a919962f56a'
    ),
    body := '{}'::jsonb
  );
  $$
);
