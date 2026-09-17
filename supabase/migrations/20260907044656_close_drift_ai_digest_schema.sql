-- Closes drift found while auditing Phase 5 (Operational features):
-- `stores.ai_digest_enabled` and the `ai-daily-digest-sweep` pg_cron job
-- were already live on Supabase (working correctly, confirmed by
-- directly querying the live DB), and the `daily-digest-worker` Edge
-- Function was already deployed and live too (version 1) -- but NONE of
-- the three had a matching migration file, and the Edge Function had no
-- folder at all in the repo (added separately as
-- supabase/functions/daily-digest-worker/). This migration documents the
-- current live state so a fresh deploy of this repo reproduces it, using
-- idempotent statements so re-running it against the already-live project
-- is a safe no-op.

alter table public.stores
  add column if not exists ai_digest_enabled boolean not null default false;

comment on column public.stores.ai_digest_enabled is
  'Owner opt-in for the automatic end-of-day AI Telegram digest (ai-daily-digest-sweep cron -> daily-digest-worker Edge Function -> telegram_outbox).';

select cron.schedule(
  'ai-daily-digest-sweep',
  '30 15 * * *', -- 15:30 UTC = 21:00 IST, end of a typical shop's business day
  $$
  select net.http_post(
    url := 'https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/daily-digest-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0c3d70b61966a67436377dbfec1fe53e420e3a919962f56a'
    ),
    body := '{}'::jsonb
  );
  $$
);
