-- Replaces the earlier weekly_report_data() (which read the normalized
-- sales/purchases/expenses/products tables — currently 0 rows, since this
-- app still stores its live data inside store_state.state JSONB per store).
-- This version computes the exact same numbers the app's own Owner Reports
-- screen shows, straight from that JSON blob, so the weekly Telegram PDF
-- never disagrees with what the owner sees in-app.
drop function if exists public.weekly_report_data(uuid, timestamptz, timestamptz);

create or replace function public.weekly_report_payload(
  p_store_id uuid,
  p_period_end date default ((now() at time zone 'Asia/Kolkata')::date)
)
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
    select
      row_number() over () as rn,
      sale,
      coalesce((sale->>'total')::numeric, 0) as total,
      coalesce((sale->>'discount')::numeric, 0) as discount,
      coalesce(nullif(sale->>'payment', ''), 'Cash') as payment
    from state, bounds, jsonb_array_elements(coalesce(state.s->'sales', '[]'::jsonb)) as sale
    where coalesce(sale->>'status', '') is distinct from 'Cancelled'
      and (sale->>'date') ~ '^\d{4}-\d{2}-\d{2}'
      and substr(sale->>'date', 1, 10)::date between bounds.period_start and bounds.period_end
  ),
  sale_costs as (
    select
      sir.rn, sir.total, sir.discount, sir.payment,
      coalesce(sum(
        coalesce((item->>'cost')::numeric, coalesce((item->>'purchasePrice')::numeric, 0) * coalesce((item->>'qty')::numeric, 0))
      ), 0) as cost
    from sales_in_range sir
    left join jsonb_array_elements(coalesce(sir.sale->'items', '[]'::jsonb)) as item on true
    group by sir.rn, sir.total, sir.discount, sir.payment
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
  purchases_in_range as (
    select coalesce((p->>'total')::numeric, 0) as total
    from state, bounds, jsonb_array_elements(coalesce(state.s->'purchases', '[]'::jsonb)) as p
    where (p->>'date') ~ '^\d{4}-\d{2}-\d{2}'
      and substr(p->>'date', 1, 10)::date between bounds.period_start and bounds.period_end
  ),
  purchases_agg as (
    select count(*) as purchase_count, coalesce(sum(total), 0) as total_purchases from purchases_in_range
  ),
  expense_sum as (
    select
      coalesce((select sum(coalesce((e->>'amount')::numeric, 0)) from state, bounds, jsonb_array_elements(coalesce(state.s #> '{expenses,shop}', '[]'::jsonb)) as e where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}' and substr(e->>'date', 1, 10)::date between bounds.period_start and bounds.period_end), 0) as shop_total,
      coalesce((select sum(coalesce((e->>'amount')::numeric, 0)) from state, bounds, jsonb_array_elements(coalesce(state.s #> '{expenses,personal}', '[]'::jsonb)) as e where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}' and substr(e->>'date', 1, 10)::date between bounds.period_start and bounds.period_end), 0) as personal_total,
      coalesce((select sum(coalesce((e->>'amount')::numeric, 0)) from state, bounds, jsonb_array_elements(coalesce(state.s #> '{expenses,other}', '[]'::jsonb)) as e where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}' and substr(e->>'date', 1, 10)::date between bounds.period_start and bounds.period_end), 0) as other_total
  ),
  products_all as (
    select prod
    from state, jsonb_array_elements(coalesce(state.s->'products', '[]'::jsonb)) as prod
  ),
  products_agg as (
    select
      count(*) as total_products,
      coalesce(sum(coalesce((prod->>'stock')::numeric, 0)), 0) as total_stock_units,
      coalesce(sum(coalesce((prod->>'purchasePrice')::numeric, 0) * coalesce((prod->>'stock')::numeric, 0)), 0) as stock_valuation
    from products_all
  ),
  low_stock as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'name', x.prod->>'name',
        'category', coalesce(x.prod->>'category', ''),
        'stock', coalesce((x.prod->>'stock')::numeric, 0),
        'minStock', coalesce((x.prod->>'minStock')::numeric, 0)
      ) order by coalesce((x.prod->>'stock')::numeric, 0) asc), '[]'::jsonb) as items
    from (
      select prod from products_all
      where coalesce((prod->>'stock')::numeric, 0) <= coalesce((prod->>'minStock')::numeric, 0)
      order by coalesce((prod->>'stock')::numeric, 0) asc
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
