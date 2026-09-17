-- Phase 16 (2026-09-17): data repair, found by comparing the live relational
-- tables against the JSON snapshot rather than trusting either on its own.
--
-- `sales` held 12 rows (DSM-000009 .. DSM-000020) but `store_state.sales` held
-- only 3 (DSM-000018/19/20). Every owner-facing report reads the JSON snapshot,
-- not the relational ledger -- SalesHistoryView (`db.sales.filter`),
-- ProfitLossDashboardView (`db.sales.filter`) and OwnerReportsView
-- (`db.sales.reduce`) -- so 9 of 12 sales, worth Rs 880 of Rs 1,200 lifetime
-- revenue, were simply invisible in Sales History, P&L and Owner Reports.
-- The relational side was always correct; the JSON snapshot had been reset at
-- some point (fresh install / local DB clear) while the ledger kept going.
--
-- This reconstructs only the missing invoices from the authoritative ledger and
-- appends them, ordered by invoice number. Matched on invoiceNo, so re-running
-- is a no-op. Reconstructed rows are tagged `reconstructedFromLedger: true` so
-- they are always distinguishable from natively-saved ones. Dry-run first
-- confirmed: 9 sales, Rs 880, 0 of them missing their line items.
--
-- Verified after applying: ledger 12 sales / Rs 1,200 == snapshot 12 sales /
-- Rs 1,200, 0 reconstructed sales missing items, and the staff projection
-- trigger re-ran correctly on the new rows (staff view shows 12 sales with no
-- purchasePrice on any item).
--
-- Note: the JSON snapshot remains the reporting source of truth in the app, so
-- this is a repair, not a fix for the underlying dual-persistence split. That
-- split is recorded as a follow-up item in PROJECT_PLAN.md (Phase 16).
with existing as (
  select s->>'invoiceNo' as inv
  from public.store_state ss, lateral jsonb_array_elements(ss.state->'sales') s
),
rebuilt as (
  select sa.invoice_no,
    jsonb_build_object(
      'id', 's_'||sa.id::text,
      'invoiceNo', sa.invoice_no,
      'date', to_char(sa.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),
      'time', to_char(sa.created_at at time zone 'Asia/Kolkata','HH24:MI'),
      'customer', case when coalesce(sa.customer_name,'')='' then null
                  else jsonb_build_object('name',sa.customer_name,'phone',coalesce(sa.customer_phone,'')) end,
      'customerId', null,
      'payment', coalesce(sa.payment_method,'Cash'),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
            'productId', coalesce(p.client_id, si.product_id::text),
            'name', nullif(trim(coalesce(p.brand,'')||' '||coalesce(p.model,'')),''),
            'category', coalesce(p.category,''),
            'qty', si.quantity,
            'price', si.unit_price,
            'purchasePrice', coalesce(si.cost_price,0),
            'cost', coalesce(si.cost_price,0)*si.quantity,
            'warrantyEnabled', coalesce(si.warranty_enabled,false),
            'warrantyMonths', coalesce(si.warranty_months,0),
            'warrantyStart', si.warranty_start,
            'warrantyEnd', si.warranty_end
          )) from public.sale_items si
          left join public.products p on p.id = si.product_id
          where si.sale_id = sa.id),'[]'::jsonb),
      'subtotal', sa.subtotal,
      'discount', coalesce(sa.discount,0),
      'taxAmount', coalesce(sa.tax,0),
      'total', sa.total,
      'amountPaid', sa.total,
      'dueAmount', 0,
      'status', coalesce(sa.status,'Paid'),
      'createdAt', to_char(sa.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'reconstructedFromLedger', true
    ) as sale_json
  from public.sales sa
  where sa.invoice_no not in (select inv from existing)
),
merged as (
  select coalesce(jsonb_agg(sale_json order by invoice_no),'[]'::jsonb) as add_json from rebuilt
)
update public.store_state ss
set state = jsonb_set(ss.state,'{sales}', coalesce(ss.state->'sales','[]'::jsonb) || m.add_json, true),
    version = ss.version + 1,
    updated_at = now()
from merged m
where jsonb_array_length(m.add_json) > 0;
