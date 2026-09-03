-- Logs one row per store per week the report was dispatched — pure dedup
-- guard so a manual cron re-run (or the job overlapping itself) never
-- sends the same store's PDF twice for the same period. Not touched by
-- the client app at all.
create table if not exists public.weekly_report_runs (
  store_id uuid not null references public.stores(id) on delete cascade,
  period_end date not null,
  chat_id text not null,
  triggered_at timestamptz not null default now(),
  net_request_id bigint,
  primary key (store_id, period_end, chat_id)
);
alter table public.weekly_report_runs enable row level security;
-- Intentionally no policies: only ever touched by the SECURITY DEFINER
-- function below (which runs with elevated privilege), never directly by
-- an authenticated client.

-- Runs every scheduled tick: finds every store with a connected Telegram
-- chat that hasn't already received this week's report, computes that
-- store's numbers straight from store_state (weekly_report_payload), and
-- fires the PDF off via the telegram-connect edge function over pg_net —
-- the same pattern already used for telegram-outbox-worker.
create or replace function public.send_due_weekly_reports()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_end date := (now() at time zone 'Asia/Kolkata')::date;
  v_row record;
  v_payload jsonb;
  v_request_id bigint;
  v_edge_url text := 'https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/telegram-connect';
  v_cron_secret text := '0c3d70b61966a67436377dbfec1fe53e420e3a919962f56a';
begin
  for v_row in
    select tc.store_id, tc.chat_id
    from public.telegram_connections tc
    where tc.chat_id is not null
      and not exists (
        select 1 from public.weekly_report_runs r
        where r.store_id = tc.store_id and r.period_end = v_period_end and r.chat_id = tc.chat_id
      )
  loop
    v_payload := public.weekly_report_payload(v_row.store_id, v_period_end);

    select net.http_post(
      url := v_edge_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_cron_secret),
      body := jsonb_build_object(
        'action', 'cron_send_weekly_report',
        'chatId', v_row.chat_id,
        'report', v_payload
      )
    ) into v_request_id;

    insert into public.weekly_report_runs (store_id, period_end, chat_id, net_request_id)
    values (v_row.store_id, v_period_end, v_row.chat_id, v_request_id)
    on conflict (store_id, period_end, chat_id) do nothing;
  end loop;
end;
$$;

-- Monday 9:00 AM IST = 03:30 UTC (pg_cron runs in UTC).
select cron.schedule(
  'weekly-report-dispatch',
  '30 3 * * 1',
  $$select public.send_due_weekly_reports();$$
);
