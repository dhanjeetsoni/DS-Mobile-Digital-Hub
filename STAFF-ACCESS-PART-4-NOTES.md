# Part 4 — Real Profit Tracking Across Every Revenue Stream

## What changed and why

Before this change, only regular product (POS) sales had a cost price and
therefore a real profit number. Two other big revenue streams had **no cost
tracking at all** and were silently treated as 100% profit:

1. **Cybercafe / Xerox 1-Tap counter** (`XeroxGrid.tsx`) — printing, photo,
   lamination, custom services the owner adds (e.g. "Exam Form Fill").
2. **Repair / Mobile Unlock jobs** (`App.tsx` Jobs section) — including the
   Mobile Unlock / FRP Bypass quick-picker. Spare parts pulled from
   inventory were already costed, but anything the owner personally paid
   for outside inventory (an FRP/unlock tool credit, an outsourced flashing
   job, a paid online unlock portal fee) was invisible.

Regular products (Diwali lights, table fans, stand fans, phones, spares,
etc.) already had a Purchase Price field in "Add Product" — that flow was
untouched and already feeds the P&L correctly.

## What was added

- `XeroxEntry.costAmount` (optional) — owner-only, per-transaction cost.
  Manage Rates also gained a `defaultCost` per service that auto-fills the
  cost box so recurring costs (e.g. paper+ink per copy) don't need retyping.
  A one-off manual override box next to the copies multiplier covers
  variable-cost cases like "FRP bypass — laga ₹350 is baar".
- `RepairJob.otherCost` (optional) — owner-only extra cost beyond any
  auto-deducted spare part. `laborProfit` now = charge − partsCostTotal −
  otherCost.
- Both are **fully optional**. Leaving them blank keeps the exact old
  behaviour (profit = full amount) so nothing breaks for existing data.
- Both are **editable after the fact** — an inline cost editor on the Xerox
  log table, and an "Edit Cost" button on each job card — so the owner can
  correct/add a cost once it's actually known.
- Both are **owner-only**. Staff never see cost or profit figures for these
  — same `ownerMode` gate already used everywhere else in this app (e.g.
  product cost column). This matches every owner-only page already declared
  `ownerOnly: true` in `Sidebar.tsx`.
- New `src/utils/profitEngine.ts` centralizes profit math for sales, xerox
  entries and repair jobs, and builds a combined daily-totals series, so the
  Profit & Loss Dashboard, Daily Review, Monthly Review and Owner Reports
  all agree on one number instead of drifting apart.
- New `src/components/MiniCharts.tsx` — dependency-free SVG bar/line/share
  charts (no chart library is installed and this environment has no network
  access to add one) used across the reports pages for revenue-by-source
  breakdowns and daily profit trend lines.

## Where to see it

- **Xerox / Cyber 1-Tap** page: cost box + per-entry cost/profit + a
  profit-by-service chart (owner only).
- **Repairs & Service** page: per-job profit + "Edit Cost" (owner only).
- **Profit & Loss Dashboard**, **Daily Review**, **Monthly Review**,
  **Owner Financial Reports**: now show one true combined profit number
  (Products + Cybercafe + Repairs) instead of just products, plus charts.
