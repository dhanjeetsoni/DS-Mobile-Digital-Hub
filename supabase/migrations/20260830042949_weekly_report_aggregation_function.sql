create or replace function public.weekly_report_data(p_store_id uuid, p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'store_name', (select s.name from public.stores s where s.id = p_store_id),
    'period_since', p_since,
    'period_until', p_until,
    'sales_count', (select count(*) from public.sales sa where sa.store_id = p_store_id and sa.created_at >= p_since and sa.created_at < p_until and sa.status = 'completed'),
    'sales_total', (select coalesce(sum(sa.total),0) from public.sales sa where sa.store_id = p_store_id and sa.created_at >= p_since and sa.created_at < p_until and sa.status = 'completed'),
    'payment_breakdown', (
      select coalesce(jsonb_object_agg(pm, amt), '{}'::jsonb) from (
        select coalesce(sa.payment_method,'unknown') as pm, sum(sa.total) as amt
        from public.sales sa
        where sa.store_id = p_store_id and sa.created_at >= p_since and sa.created_at < p_until and sa.status = 'completed'
        group by 1
      ) t
    ),
    'gross_profit', (
      select coalesce(sum((si.unit_price - coalesce(si.cost_price,0)) * si.quantity),0)
      from public.sale_items si
      join public.sales sa on sa.id = si.sale_id
      where sa.store_id = p_store_id and sa.created_at >= p_since and sa.created_at < p_until and sa.status = 'completed'
    ),
    'invoices_count', (select count(*) from public.invoices i where i.store_id = p_store_id and i.created_at >= p_since and i.created_at < p_until),
    'purchases_total', (select coalesce(sum(pu.total),0) from public.purchases pu where pu.store_id = p_store_id and pu.created_at >= p_since and pu.created_at < p_until),
    'purchases_count', (select count(*) from public.purchases pu where pu.store_id = p_store_id and pu.created_at >= p_since and pu.created_at < p_until),
    'expenses_total', (select coalesce(sum(e.amount),0) from public.expenses e where e.store_id = p_store_id and e.created_at >= p_since and e.created_at < p_until),
    'top_products', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select p.brand, p.model, sum(si.quantity) as qty, sum(si.unit_price*si.quantity) as revenue
        from public.sale_items si
        join public.sales sa on sa.id = si.sale_id
        join public.products p on p.id = si.product_id
        where sa.store_id = p_store_id and sa.created_at >= p_since and sa.created_at < p_until and sa.status = 'completed'
        group by p.brand, p.model
        order by sum(si.quantity) desc
        limit 5
      ) t
    ),
    'low_stock', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select p.brand, p.model, p.stock_qty, p.min_stock
        from public.products p
        where p.store_id = p_store_id and p.stock_qty <= p.min_stock
        order by p.stock_qty asc
        limit 15
      ) t
    ),
    'stock_value', (
      select coalesce(sum(sb.remaining_qty * sb.purchase_price),0)
      from public.stock_batches sb
      where sb.store_id = p_store_id and sb.remaining_qty > 0
    ),
    'total_products', (select count(*) from public.products p where p.store_id = p_store_id)
  );
$$;

revoke all on function public.weekly_report_data(uuid, timestamptz, timestamptz) from public, anon, authenticated;
