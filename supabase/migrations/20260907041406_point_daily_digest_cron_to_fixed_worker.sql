-- BUG FIX: the daily-digest-worker edge function (relational-data-correct
-- version of the daily Telegram digest) was deployed but the cron job was
-- never repointed at it -- it kept calling the OLD ai-gateway/cron-daily-
-- digest route, which still reads the empty JSON blob (state.sales,
-- state.products) and has been silently sending "0 sales" or nothing at
-- all since the Phase 1 catalog migration. This repoints the existing
-- cron job at the fixed function; same schedule, same secret.
select cron.schedule(
  'ai-daily-digest-sweep',
  '30 15 * * *',
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
