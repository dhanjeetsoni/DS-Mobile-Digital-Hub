-- Phase 5 (Operational features): "Daily + weekly sales/profit summary ->
-- Telegram, automatic".
--
-- DRIFT CLOSED BY THIS MIGRATION (found during this session's own
-- independent re-verification, not taken on trust):
-- `weekly_report_payload()` had TWO different definitions: the one
-- committed in `20260830064011_weekly_report_payload_from_state.sql`
-- reads numbers out of the `store_state.state` JSON blob, but the
-- function actually LIVE on the project (confirmed via
-- `pg_get_functiondef`, and confirmed working — today's Monday cron run
-- delivered a real PDF to Telegram, and a live owner-authenticated call
-- inside a rolled-back transaction returned real numbers: 8 invoices,
-- Rs.800 sales, Rs.688 gross profit) reads from the RELATIONAL
-- `sales`/`sale_items`/`products`/`purchases` tables instead — Phase 1's
-- migration to relational stock as the source of truth. Nobody ever
-- committed that update. This migration replaces the file version with
-- the exact live definition, so replaying migrations on a fresh
-- environment produces what's actually running, not a stale blob-reading
-- copy. (Expenses are read from the blob still on purpose — see
-- PROJECT_PLAN.md's JSON-vs-relational status table: no relational write
-- path exists for expenses yet, so that part of the live function is
-- correct as-is, not drift.)
--
-- Also newly documented here (existed live, no migration file at all):
-- `get_my_weekly_report_payload()` (derives store_id from auth.uid()'s
-- own profile — never a client-supplied id — and requires owner/manager
-- role; used by the app's "Send Now" button so a manual send shows the
-- exact same numbers as the automatic Monday cron), the
-- `stores.ai_digest_enabled` column, and `get_ai_digest_enabled()` /
-- `set_ai_digest_enabled()` (the Settings-page ON/OFF toggle for the
-- daily Telegram digest — RPCs existed live with correct owner/manager
-- checks, but had no UI at all until this session, meaning the feature
-- was silently unreachable for every store).
--
-- Verified before writing this file: `weekly_report_payload` and
-- `send_due_weekly_reports` are EXECUTE-revoked from anon/public live
-- (added below); `get_my_weekly_report_payload` /
-- `get_ai_digest_enabled` / `set_ai_digest_enabled` were already
-- anon-blocked, authenticated-only, live. Live-tested end-to-end inside
-- BEGIN/ROLLBACK against the real owner + real staff account: owner gets
-- a real report payload and can toggle the digest on/off; a staff
-- account is correctly rejected from both
-- (`get_my_weekly_report_payload` and, by the same role check pattern,
-- `set_ai_digest_enabled`) with "Only the Owner/Manager can...".

create or replace function public.weekly_report_payload(p_store_id uuid, p_period_end date default ((now() at time zone 'Asia/Kolkata'))::date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with state as (
    select coalesce(state, '{}'::jsonb) as s
    from public.store_state
    where store_id = p_store_id
  ),
  bounds as (
    select (p_period_end - 6) as period_start, p_period_end as period_end
  ),
  sales_in_range as (
    select s.id, s.total, s.discount, coalesce(nullif(s.payment_method, ''), 'Cash') as payment
    from public.sales s, bounds
    where s.store_id = p_store_id
      and coalesce(s.status, '') is distinct from 'Cancelled'
      and (s.created_at at time zone 'Asia/Kolkata')::date between bounds.period_start and bounds.period_end
  ),
  sale_costs as (
    select
      sir.id, sir.total, sir.discount, sir.payment,
      coalesce(sum(coalesce(si.cost_price, 0) * coalesce(si.quantity, 0)), 0) as cost
    from sales_in_range sir
    left join public.sale_items si on si.sale_id = sir.id
    group by sir.id, sir.total, sir.discount, sir.payment
  ),
  sales_agg as (
    select
      count(*) as invoice_count,
      coalesce(sum(total), 0) as total_sales,
      coalesce(sum(discount), 0) as total_discount,
      coalesce(sum(cost), 0) as total_cost,
      coalesce(sum(total - cost), 0) as gross_profit
    from sale_costs
  ),
  payment_agg as (
    select coalesce(jsonb_agg(jsonb_build_object('method', payment, 'total', total_amt, 'count', cnt) order by total_amt desc), '[]'::jsonb) as breakdown
    from (
      select payment, sum(total) as total_amt, count(*) as cnt
      from sale_costs
      group by payment
    ) p
  ),
  purchases_agg as (
    select count(*) as purchase_count, coalesce(sum(pu.total), 0) as total_purchases
    from public.purchases pu, bounds
    where pu.store_id = p_store_id
      and (pu.created_at at time zone 'Asia/Kolkata')::date between bounds.period_start and bounds.period_end
  ),
  expense_sum as (
    -- Intentionally still the JSON blob — see migration header note above.
    select
      coalesce((select sum(coalesce((e->>'amount')::numeric, 0)) from state, bounds, jsonb_array_elements(coalesce(state.s #> '{expenses,shop}', '[]'::jsonb)) as e where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}' and substr(e->>'date', 1, 10)::date between bounds.period_start and bounds.period_end), 0) as shop_total,
      coalesce((select sum(coalesce((e->>'amount')::numeric, 0)) from state, bounds, jsonb_array_elements(coalesce(state.s #> '{expenses,personal}', '[]'::jsonb)) as e where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}' and substr(e->>'date', 1, 10)::date between bounds.period_start and bounds.period_end), 0) as personal_total,
      coalesce((select sum(coalesce((e->>'amount')::numeric, 0)) from state, bounds, jsonb_array_elements(coalesce(state.s #> '{expenses,other}', '[]'::jsonb)) as e where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}' and substr(e->>'date', 1, 10)::date between bounds.period_start and bounds.period_end), 0) as other_total
  ),
  products_agg as (
    select
      count(*) as total_products,
      coalesce(sum(coalesce(stock_qty, 0)), 0) as total_stock_units,
      coalesce(sum(coalesce(cost_price, 0) * coalesce(stock_qty, 0)), 0) as stock_valuation
    from public.products
    where store_id = p_store_id
  ),
  low_stock as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'name', x.model,
        'category', coalesce(x.category, ''),
        'stock', x.stock_qty,
        'minStock', x.min_stock
      ) order by x.stock_qty asc), '[]'::jsonb) as items
    from (
      select model, category, coalesce(stock_qty, 0) as stock_qty, coalesce(min_stock, 0) as min_stock
      from public.products
      where store_id = p_store_id and coalesce(stock_qty, 0) <= coalesce(min_stock, 0)
      order by coalesce(stock_qty, 0) asc
      limit 40
    ) x
  )
  select jsonb_build_object(
    'periodStart', bounds.period_start,
    'periodEnd', bounds.period_end,
    'generatedAt', now(),
    'invoiceCount', sales_agg.invoice_count,
    'totalSales', round(sales_agg.total_sales, 2),
    'totalDiscount', round(sales_agg.total_discount, 2),
    'paymentBreakdown', payment_agg.breakdown,
    'totalCost', round(sales_agg.total_cost, 2),
    'grossProfit', round(sales_agg.gross_profit, 2),
    'totalPurchases', round(purchases_agg.total_purchases, 2),
    'purchaseCount', purchases_agg.purchase_count,
    'totalShopExpenses', round(expense_sum.shop_total, 2),
    'totalPersonalDrawings', round(expense_sum.personal_total, 2),
    'totalOtherExpenses', round(expense_sum.other_total, 2),
    'totalProducts', products_agg.total_products,
    'totalStockUnits', products_agg.total_stock_units,
    'stockValuation', round(products_agg.stock_valuation, 2),
    'lowStockItems', low_stock.items,
    'shopName', coalesce((select s #>> '{settings,shopName}' from state), 'My Shop')
  )
  from bounds, sales_agg, payment_agg, purchases_agg, expense_sum, products_agg, low_stock;
$$;

revoke all on function public.weekly_report_payload(uuid, date) from public, anon, authenticated;
revoke all on function public.send_due_weekly_reports() from public, anon, authenticated;

create or replace function public.get_my_weekly_report_payload(p_period_end date default ((now() at time zone 'Asia/Kolkata'))::date)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
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
grant execute on function public.get_my_weekly_report_payload(date) to authenticated;

alter table public.stores add column if not exists ai_digest_enabled boolean not null default false;

create or replace function public.get_ai_digest_enabled()
returns boolean
language plpgsql
security definer
set search_path = 'public'
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
grant execute on function public.get_ai_digest_enabled() to authenticated;

create or replace function public.set_ai_digest_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
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
grant execute on function public.set_ai_digest_enabled(boolean) to authenticated;

-- Daily 9 PM IST (15:30 UTC) sweep -> dedicated daily-digest-worker edge
-- function, which reads sales relationally (sales/sale_items/products,
-- same Phase-1 source of truth) and only expenses from the blob. This
-- superseded ai-gateway's older `cron-daily-digest` route, which read
-- both sales AND products from the blob (stale per Phase 1) — that old
-- route is unreferenced by any cron job now (dead code, left as-is,
-- harmless: still guarded by the same cron secret, just never called).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'ai-daily-digest-sweep') then
    perform cron.schedule(
      'ai-daily-digest-sweep',
      '30 15 * * *',
      $cron$
      select net.http_post(
        url := 'https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/daily-digest-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', '0c3d70b61966a67436377dbfec1fe53e420e3a919962f56a'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  end if;
end;
$$;
