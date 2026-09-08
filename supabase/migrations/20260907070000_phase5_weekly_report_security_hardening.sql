-- Phase 5 (Daily + weekly sales/profit summary -> Telegram, automatic):
-- security hardening found during verification of the already-built
-- weekly report system.
--
-- weekly_report_payload(uuid, date) and send_due_weekly_reports() were
-- both directly EXECUTE-able by anon AND authenticated, with no internal
-- ownership check -- any authenticated session (or, for the outer shell,
-- even a fully unauthenticated request) could call
-- weekly_report_payload('<any-store-id>', date) and pull that store's
-- sales/profit/stock numbers directly, bypassing the app's own
-- owner/manager-only UI gating entirely. RLS on the underlying tables
-- (sales, sale_items, purchases, products are all owner/manager-only
-- SELECT) limited the real damage for a non-owner caller in practice, but
-- this was never supposed to be reachable by a bare RPC call at all.
--
-- Locked down to service_role only -- pg_cron's own jobs run as
-- `postgres`, a superuser that bypasses grants entirely, so this does not
-- affect the existing Monday-9AM cron job (job id 2, `select
-- public.send_due_weekly_reports();`).

revoke execute on function public.weekly_report_payload(uuid, date) from anon, authenticated, public;
revoke execute on function public.send_due_weekly_reports() from anon, authenticated, public;

-- Safe, owner/manager-gated wrapper for the app's own "Send Weekly Report
-- Now" button (Owner Reports screen) -- never accepts a store_id from the
-- client, always resolves it from the caller's own profile, exactly like
-- set_own_pin/admin_reset_staff_pin already do elsewhere in this schema.
-- Also replaces the old client-side, JSON-blob-based buildWeeklyReport()
-- (src/utils/weeklyReport.ts, now removed) as the source for that button
-- -- this returns the exact same field shape, computed from the
-- relational sales/sale_items/purchases/products tables instead of the
-- app's in-memory (and potentially stale/pre-Phase-1) state blob.
create or replace function public.get_my_weekly_report_payload(
  p_period_end date default ((now() at time zone 'Asia/Kolkata'))::date
)
returns jsonb
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
    raise exception 'Only the Owner/Manager can generate this report.' using errcode = '42501';
  end if;
  return public.weekly_report_payload(v_store_id, p_period_end);
end;
$$;

-- Deliberately NOT granted to anon/public — authenticated only, and the
-- role check inside the function itself is the real gate.
revoke execute on function public.get_my_weekly_report_payload(date) from anon, public;
grant execute on function public.get_my_weekly_report_payload(date) to authenticated;
