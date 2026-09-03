select cron.schedule(
  'telegram-outbox-worker-sweep',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/telegram-outbox-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0c3d70b61966a67436377dbfec1fe53e420e3a919962f56a'
    ),
    body := '{}'::jsonb
  );
  $$
);
