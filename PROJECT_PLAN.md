# DS Mobile & Digital Hub — Master Fix & Rebuild Plan

_Last updated: 2026-09-07_

This document is the single source of truth for the ongoing stabilization and
rebuild effort. Each phase is worked on **only after the owner explicitly
approves it**, and is marked ✅ here the moment it's done, tested, and pushed.
Nothing in a later phase starts until the owner says go — even if it looks
obvious or quick.

## Ground rules
- One phase at a time. Ask before starting the next.
- Every code change → typechecked → committed → pushed to GitHub → (if it
  touches the database) migration applied to the live Supabase project.
- **If any step in this plan is found already marked complete/done (✅ or
  `[x]`)**, never accept that at face value — deeply re-verify it end-to-end
  directly against the live Supabase project (actual tables, RPCs, policies,
  logs — not just the code that's supposed to call them) and against the
  actual GitHub repo (the real committed code, not a remembered summary of
  it). Confirm it genuinely works as claimed, then improve it further to the
  maximum level reasonably possible before moving on — a checkmark from an
  earlier session is a starting point to double-check, not a fact to trust.
- No silent "I think this is fixed" claims — call out what was verified vs.
  what still needs the owner to test on a real device.
- **Before starting any phase/item, always check first whether it's already
  partially built** — other sessions (automated pipelines or other Claude
  sessions) may have already started or finished pieces of it. Deeply
  verify what already exists in both GitHub (code/commit history) and the
  live Supabase project (tables, RPCs, migrations) before writing anything
  new. If something exists but is incomplete or rough, finish and improve
  it to the maximum reasonable level rather than building a parallel
  version next to it.

## Decisions locked in with the owner (2026-09-05)

| Topic | Decision |
|---|---|
| Devices in daily use | Windows (owner) + 2–3 Android (owner + staff) |
| Biggest pain right now | Android app opens now, but UI is messy/buggy in almost every section — needs a full Android-specific redesign |
| Garbage `products` rows (1,858) | Approved for deletion |
| Existing stock/product data | Fresh start is fine — data volume is still small |
| PIN unlock | Each person (owner/each staff) has their **own** 4-digit PIN. Underlying cloud session stays logged in permanently in the background; PIN is a fast local lock, not a re-login. Staff can change their own PIN. Wrong PIN 3–4x → app locks / shows a warning. |
| Offline mode scope | Staff can **only sell** while offline; adding/editing products requires being online |
| Staff Android permissions | Sell + view stock. **Cannot** add or delete products. Only owner can delete. |
| Telegram invoices | Always go to the **one bot the owner connected** — regardless of who makes the sale (owner or any staff), no way to skip/redirect it, zero missed transactions |
| Telegram summaries | Daily + weekly total sales/profit summary, sent automatically |
| Low stock alerts | Push immediately (Telegram + in-app), not just visible on a report screen |
| Auto-update | Yes — app should check for a new version and offer to install it, like a Play Store app |
| Backup | Cloud sync is primary, **plus** a manual daily/weekly backup file export as extra safety |
| Audit log | Yes — record which staff member added/edited/deleted what, and when |
| Barcode scanning | Yes — use the phone's camera, not just a physical scanner |
| Receipt printing | Yes — direct print to a Bluetooth/USB thermal printer from Android |
| GST / tax fields on invoice | Not needed — simple bill is fine |
| Theme | Both light **and** dark mode |
| Language | English only |
| EMI/Finance sale tracking | Current behaviour is fine, no changes needed |
| Sound/vibration on sale or alert | Not needed |
| Crash reporting | Yes — crashes should auto-report so they can be fixed proactively |
| Multi-store support | Not needed — single store only, for now |
| Android navigation style | Left to my judgement — plan: bottom tab bar for the 4–5 most-used sections (Home, Sell, Inventory, Reports, More), everything else tucked under "More" |
| UI redesign priority across screens | No specific order requested — will go through screens systematically (see Phase 5) |
| Testing cadence | Owner will do a full test pass after each phase is reported complete, not continuously mid-phase |

## Decisions locked in with the owner — round 2 (2026-09-05, AI + advanced features)

| Topic | Decision |
|---|---|
| AI Photo Scan accuracy | Actively used and valued — needs to be made more accurate, not just kept as-is |
| Product photos | Add support for **1 or 2 photos** (front + back) when adding a product. AI should auto-fill details from either 1 or 2 photos. Product list/stock view shows however many photos were given (1 if 1, both if 2) |
| Gemini AI key management | Keys sometimes hit limits/errors — needs better pooling/fallback so AI features don't just fail |
| Photo Stock Finder | Keep and improve |
| AI price suggestion | Add — when adding a product, AI should suggest a selling price/MRP based on market data, not fully manual |
| Bulk Excel import | Not needed — one-by-one add is fine, focus effort on making AI scan itself better instead |
| Auto reorder to supplier | Not needed |
| Customer-facing bill delivery | Telegram to the owner's bot only — no WhatsApp/SMS to customers needed |
| Staff performance tracking | Yes — track each staff member's sales (a leaderboard/summary) |
| Data export | Yes — invoices/customers exportable to Excel/PDF for the owner's records/accountant |
| Customer purchase history | Yes — a customer's profile should show everything they've ever bought |
| Repair job tracking | Current behaviour is fine, no change requested |
| Warranty claims | Yes — needs a proper tracked process with reminders, not just a note |
| Biometric unlock | Yes, fingerprint unlock in addition to PIN (PIN stays as fallback) |
| Auto-lock on idle | Not needed — only lock when the app is actually closed/backgrounded |
| Remote session kill | Yes — owner should be able to force-logout a lost/stolen device's session from the Windows app |
| Price change history | Yes — track when a product's price changed and to what |
| Receipt branding | Yes — shop logo/name/address customizable on the printed/PDF receipt |
| Staff access window | Owner needs a **configurable control** (from Windows or in-app) over staff access: what time range they can use the app, how many minutes of access, and which sections/data they're allowed to see — not a fixed rule, an owner-adjustable setting |
| Refund/return approval | Yes — a staff-initiated return/refund needs owner approval before it completes |
| Customer birthday/anniversary marketing reminders | Not needed |

---

## Phases

### ✅ Phase -1: Emergency stop (already done, 2026-09-05)
- [x] Found and stopped a live bug that was creating ~20 garbage `products`
      rows/minute (1,858 total) via `resolve_product_for_sale`
- [x] Reverted a same-day stock-reconciliation change that was itself causing
      a stock flicker (0 ↔ 5) on a single device
- [x] `resolve_product_for_sale` now refuses to create a product with no SKU
      instead of silently duplicating it
- [x] **Deep-verified 2026-09-06 directly against the live Supabase project**:
      read `resolve_product_for_sale`'s actual live function body — it
      genuinely raises `invalid quantity: product missing sku, cannot
      resolve safely (stale offline record)` instead of inserting, exactly
      as claimed. No new garbage has accumulated since.
- [x] **Also verified the concurrent-flush + retry-cap fix from this same
      session is live and working**: `sync_queue` had one row with
      `retry_count=750` stuck looping before the fix — it's now correctly
      `status='abandoned'` and no longer being retried. Only 5 rows remain
      total, 4 already `processed`, 0 stuck.

### ✅ Phase 0: Cleanup (deep-verified & completed 2026-09-06)
- [x] Delete the 1,858 garbage `products` rows (owner approved) — **the
      "1,858" figure was stale by the time this was actually checked live**:
      the table only had 4 rows total, 1 of them genuinely orphaned/garbage
      (every field NULL — no sku/brand/model/category — created alongside a
      stray `stock_movements`/`stock_batches` row from a
      "Physical Inventory Audit Count" adjustment). That one row (plus its
      2 dependent rows) was deleted after confirming zero `sale_items`
      referenced it. 3 legitimate products remain.
- [x] Clear/reset the old stuck `sync_queue` backlog — already resolved by
      this session's concurrent-flush-lock + 20-retry-abandon-cap fix
      (see Phase -1 above); nothing further needed
- [x] Fresh-start the real product/stock data with the owner directly in-app
      — **skipped by agreement**: remaining data (3 products) is already
      small and legitimate, no need to wipe and re-enter
- [x] Confirm `products`, `sales`, `sale_items`, `telegram_outbox` are all
      clean and consistent — **verified with direct queries**: 0 orphaned
      `sale_items` (referencing a missing product), 0 `sales` without
      matching `sale_items`, 0 `sales` without a matching `invoices` row,
      0 `invoices` that never reached `telegram_outbox`, and all 8
      `telegram_outbox` rows are `status='sent'`
- [ ] **Found during this audit, not yet actioned — flagging for the owner**:
      2 of the 3 remaining products look like unintentional duplicates —
      same model name ("Super X — ESD Anti-Static Super X Edge to Edge Big
      Curved Glass"), same category ("Tempered Glass"), but two different
      SKUs (`GLS3109C52C24` and `GLS4682B5640C`), suggesting the same
      physical item got re-added via AI Photo Scan and didn't get
      recognized as already existing. Left as-is pending owner's call —
      may be a real Phase 6 "AI Photo Scan accuracy" duplicate-detection
      gap worth folding in there rather than a one-off manual fix here.

### 🟡 Phase 1: Data architecture fix (the root cause of the flicker/races) — mostly done, needs owner device-test
_A prior session did real work on this but hit its time limit mid-way; per the
ground rules above, everything below was independently re-verified against
the live DB/repo rather than trusted, and what was actually missing was
finished in this session (2026-09-06)._

- [x] **DB-side, confirmed genuinely live** (was applied directly to
      Supabase by the prior session, but had no matching migration file in
      the repo — added one now, closing that drift):
      `products.client_id` column + unique index, and
      `resolve_product_for_sale()` checks it (after an exact-uuid match,
      before falling back to SKU) and backfills it on every SKU match too —
      read straight from the live function body, not assumed.
- [x] Realtime already enabled on `products` and `sales` (confirmed live via
      `supabase_realtime` publication) — also had no migration file in the
      repo; added one.
- [x] **Client-side — this was claimed done by the prior session but did not
      exist anywhere in the actual repo** (lost when that session's time ran
      out before it committed/pushed). Built it from scratch this session:
  - `fetchLiveStock()` + `subscribeToLiveStock()` (repository.ts): one-shot
    read of every product's real `stock_qty`, then a realtime feed that
    updates it live as any device sells/adjusts/restocks.
  - `liveStock` state + a `stockOf(product)` helper in App.tsx, seeded and
    kept current via the two functions above.
  - Every stock **gate** (add to cart, add gift, confidential-price add,
    the new pre-checkout availability check added this session) and every
    stock **display** (Product Catalog list, the dashboard low-stock table,
    the header's "LOW STOCK: N SKUs" pill) now reads `stockOf()` — the live
    relational number — instead of the JSON blob's cached `product.stock`.
  - Found and fixed the same "raw client-local id sent straight into a
    strict `uuid` column" bug in `PurchasesView.tsx`'s restock flow (both
    the live path and the offline-queue replay path) — the same class of
    bug already fixed earlier in `StockAdjustView`, just never applied here.
- [x] Verified after every change: `tsc --noEmit`, full test suite (26
      tests), static audit, production build — all clean.
- [x] **`sale_items` → `products` same-`store_id` defence-in-depth
      constraint — closed 2026-09-06 (this session)**: there's no direct
      `store_id` column on `sale_items` to express this as a plain
      composite foreign key across two joined tables, so it's enforced
      with a `BEFORE INSERT OR UPDATE` trigger
      (`enforce_sale_item_product_store_match()` /
      `sale_items_product_store_match`) instead — a real DB-level
      constraint that runs no matter which RPC/path writes the row, not
      an application-level check that could be bypassed.
  - Checked live data before adding it: 0 of 8 existing `sale_items` rows
    with a non-null `product_id` mismatch their sale's `store_id` — safe
    to roll out, nothing existing to break.
  - **Actually tested against the live DB, not just deployed and assumed
    working**: (1) a normal same-store insert — succeeded, confirming the
    trigger doesn't interfere with real usage; (2) a genuine cross-store
    insert (real second `stores` row + a product under it, not a fake
    UUID that would fail for an unrelated reason) — the trigger correctly
    raised `sale_items store mismatch: product ... belongs to a different
    store than sale ...` and blocked it. All test rows (fake store,
    product, sale_item) deleted immediately after; `sale_items` count
    confirmed back to its original 8 afterward.
  - Since the product's own locked-in decision is single-store-only for
    now, this trigger can't actually fire in today's real usage — it's
    insurance against a future bug (or future multi-store support)
    silently mixing another store's product into a sale, not a fix for
    an active problem.
  - Migration: `supabase/migrations/20260906120000_sale_items_product_store_id_guard.sql`.
- [x] **Full product catalog (photo, MRP, discount%, warranty, notes,
      compatible models, screen size, etc.) is now also relational — done
      this session, per the owner's explicit ask to close this gap**:
  - `products` table extended with every catalog field the Add/Edit
    Product forms capture (previously only the scalar transactional
    fields — sku/brand/model/category/prices/stock — existed there).
  - New `upsert_product_catalog()` RPC (owner/manager only, matching the
    "staff can't add/edit products" decision): resolves the same way
    `resolve_product_for_sale()` does (uuid → `client_id` → sku) so
    editing an already-resolved product updates the same row instead of
    creating a duplicate, and writes/updates every catalog field in one
    call.
  - `AddProductModal` and `EditProductModal` now call this (via a new
    `upsertProductCatalog()` in repository.ts) right alongside their
    existing local blob save — best-effort/non-blocking, with the same
    offline-queue fallback (a new `"product"` sync_queue operation type,
    which already existed as a declared-but-unused type and is now
    actually wired into `processOperation`) every other cloud write uses.
  - **What "migrated" means here, precisely**: every new/edited product
    is now durably, queryably relational going forward, and the
    relational row is authoritative for that data. The **read** side
    (every screen that displays a product) still reads from the JSON
    blob, which stays in sync because it's written at the same moment as
    the relational row — a full rip-and-replace of every catalog display
    call site to read relationally instead was **not** attempted in this
    pass (real scope, not a hidden gap: dozens of render sites across a
    very large file, meaningfully higher regression risk, and not what
    was actually causing the flicker — that was stock/sales, already
    fixed above). Worth its own pass later if/when a reason to need it
    directly emerges (e.g. Phase 7's e-commerce product pages).
  - **Backfill limitation, found while implementing**: the live
    `store_state` blob's `products` array is currently **empty (0
    items)** — likely from the earlier data-loss incident/fresh-start
    decision. That means the 3 existing relational product rows (the 2
    flagged "Super X" duplicates + 1 more) have **no photo/MRP/warranty/
    notes to backfill from** anywhere live; those 3 fields will stay
    null on those 3 rows until the owner opens each in Edit Product and
    re-saves once. Every product added/edited from now on will have full
    data from the start.
- [x] **Full independent re-verification pass, 2026-09-06 (this session,
      per this document's own ground rule — every earlier ✅/[x] item
      above was re-checked directly against the live project, not
      trusted)**:
  - `products` table columns: `client_id`, `photo`, `mrp`,
    `compatible_models`, `screen_size_inches`/`_max_inches`, and every
    other catalog field genuinely present — read directly from
    `information_schema.columns`, not assumed from a migration filename.
  - `products`/`sales` genuinely both in the live `supabase_realtime`
    publication — read directly from `pg_publication_tables`.
  - `resolve_product_for_sale()`'s real live body re-read in full: uuid
    match → `client_id` match → sku match (with `client_id` backfill) →
    explicit `raise exception` on missing sku — matches every claim above
    exactly, still true today.
  - `upsert_product_catalog()`'s real live body re-read in full: exactly
    one function overload exists (25 args, confirmed via `pg_proc`); the
    `UPDATE` branch still never touches `stock_qty`; the `INSERT` branch
    still uses `coalesce(p_stock_qty,0)` — the stock_qty=0 bug fix
    documented below is still genuinely in place, not silently reverted.
  - `npx tsc --noEmit`, `npx vitest run` (26/26), `npm run build` — all
    re-run clean against the current `main` right before this update.
- [x] **Found and fixed 2026-09-06 (this session) — a real gap in the Phase 1
      claim above that the "owner needs to test on a real device" item would
      have failed for a staff device specifically**: `fetchLiveStock()` /
      `subscribeToLiveStock()` and `fetchLiveCatalog()` /
      `subscribeToLiveCatalog()` were wired unconditionally for every role in
      `App.tsx`'s bootstrap, but query `products` directly — and `products`
      has exactly **one** RLS policy, `products_owner_manager_write`
      (owner/manager only, confirmed via `pg_policies` on the live project).
      For a staff session this silently returned zero rows (no thrown error
      — `fetchLiveStock`'s catch just logs "falling back to blob stock") and
      Realtime never delivered a single `postgres_changes` event either
      (Realtime enforces the same RLS a plain `SELECT` would). Net effect: a
      staff Android device got **none** of the Phase 1 instant-stock benefit
      and silently stayed on the slower/staler `store_state` blob path this
      whole migration exists to move away from — exactly the kind of gap
      that would only surface during the owner's real-device test, and would
      have looked like "Phase 1 didn't actually fix it" rather than what it
      really was (a staff-specific RLS hole).
  - Fix: new `products_staff_view` mirror table — same pattern as the
    existing `store_state_staff_view` (a physical table, not a SQL view,
    since Realtime needs real table replication) — holding only the columns
    these two functions already restricted themselves to (`fetchLiveStock`:
    `id`+`stock_qty` only; `fetchLiveCatalog`: `LIVE_CATALOG_COLUMNS`, which
    already explicitly excludes `cost_price`/`confidential_price`). Kept in
    lockstep by an `AFTER INSERT OR UPDATE OR DELETE` trigger on `products`;
    RLS lets any authenticated store member (owner, manager, **or staff**)
    read it, since it never carries a confidential column to begin with;
    added to the `supabase_realtime` publication; backfilled for every
    existing row. `repository.ts`'s four functions now point at this mirror
    instead of the base table.
  - **Verified live, not just deployed and assumed**: backfill row count
    matches `products` exactly (3/3); `products_staff_view` confirmed
    present in `pg_publication_tables` for `supabase_realtime`.
  - Migration: `supabase/migrations/20260906130000_phase1_products_staff_view_v38.sql`.
  - Same store_state/staff visibility class of bug, found and fixed the
    same way, one layer up: the JSON-blob realtime channel
    (`store-state-${storeId}` on table `store_state`) was also only ever
    wired for `role !== "staff"` in `App.tsx` — staff got zero live push
    from the blob path either. Fixed by wiring the already-existing (but
    never-subscribed-to) `store_state_staff_view` mirror
    (migration `20260831064309_realtime_store_state_sync_v23.sql`, built by
    an earlier session but left disconnected) for staff sessions instead.
- [ ] **Owner needs to actually test this on a real device — this is now
      the ONLY thing left before Phase 1 can be marked ✅.** Everything
      above (code, migrations, live DB structure, live function bodies)
      has been independently verified twice now (2026-09-06, twice) and
      passes every automated check available in this environment, but no
      automated check can actually watch "sell from one device, see stock
      update on another within ~1 second, no flicker" happen — that
      requires two real devices and a human watching them, which only the
      owner can do. Marking this ✅ without that would be exactly the
      "silent I think this is fixed" claim this document's own ground
      rules forbid.
- [ ] **Technical detail, still open**: `resolve_product_for_sale()` now has
      `client_id`, but only products that go through a resolve call (sale,
      stock adjustment, purchase) get backfilled — a product that's never
      been sold/adjusted/restocked since this shipped still has
      `client_id = null` until the first time one of those happens to it.
      Harmless (SKU fallback still works), just not instant.
- [x] **Deep-re-verified 2026-09-06, per the ground rule above — this
      exact catalog-migration work was NOT trusted at face value even
      though it looked complete**: read `upsert_product_catalog()`'s real
      live body and found the INSERT branch hardcoded `stock_qty = 0` for
      every brand-new product — `AddProductModal` never calls
      `resolve_product_for_sale` first (unlike the sale/adjustment/purchase
      paths, which all correctly pass a real stock number), so a
      newly-added product would have shown **0 stock everywhere**,
      including on the very device that just added it, the instant Phase
      1's `stockOf()` went live. Fixed: the RPC now takes `p_stock_qty`,
      used only in the INSERT branch, never added to the UPDATE branch (so
      editing a product still can never touch its stock — that stays
      resolve_product_for_sale/adjustment/purchase-only). Verified via the
      live `pg_proc` catalog that only one function overload exists after
      the fix (adding a parameter registers a *new* overload in Postgres,
      not a true replace — the old 24-arg buggy version had to be
      explicitly dropped, confirmed gone). Migration applied live, full
      test suite + typecheck + build re-run clean, then merged to `main`.

**JSON blob vs. relational tables — current status, 2026-09-06 (asked for
explicitly, answered precisely rather than "mostly migrated"):**

| Data | Source of truth | Live-synced to every device instantly? |
|---|---|---|
| `stock_qty` | ✅ Relational (`products.stock_qty`, via atomic RPCs) | ✅ Yes — owner **and staff** (`products_staff_view`, fixed this session) |
| Catalog fields (photo, MRP, warranty, notes, compatible models, screen size, min stock) | ✅ Relational (`products`, via `upsert_product_catalog()`) | ✅ Yes — owner **and staff** (`products_staff_view`, fixed this session) |
| `selling_price` | ✅ Relational (`products.selling_price`, written by the same RPCs) | ✅ **Fixed 2026-09-06** — added to `LIVE_CATALOG_COLUMNS`, `products_staff_view` (backfilled, 0 mismatches verified live), and `catalogOf()`'s merge. Every `addToCart`/POS/catalog-list call site already reads through `catalogProducts`/`catalogOf(p)`, confirmed by tracing every `.sellingPrice` usage — so this one change fixes it everywhere, owner and staff, with no per-screen edits needed. |
| `cost_price` / `confidential_price` | ✅ Relational (`products`) | 🚫 Intentionally blob/UI-gated only — never meant to be in any realtime feed (staff must never see it; owner's existing Confidential Price flow is untouched) |
| Full product object everywhere else it's rendered (most screens) | ⚠️ Still the JSON blob (`store_state.state.products[]`) | Only as fast as the blob save/load cycle (the slower path Phase 1 exists to move away from) — explicitly logged above as "not attempted in this pass" |
| Sales/invoices | ✅ Relational (`sales`, `sale_items`) + `supabase_realtime` publication enabled | ⚠️ Enabled at the DB level, but **nothing in the client subscribes to it yet** — no live "new sale from another device" feed exists; this was never actually wired, only the publication flag was added |
| Everything else (settings, customers, expenses, loans, staff-advice text, etc.) | JSON blob (`store_state.state`) | Owner/manager: yes, via the existing `store_state` realtime channel. Staff: yes, via `store_state_staff_view` (this session) |

Net: stock count, the "0 ↔ 5" race, and selling price are now all fully
relational and instantly synced for every role. The sales/sale_items
realtime hookup (enabled at the DB level, never wired client-side) is the
one concrete item left in the "enabled but unused" column.

### 🟡 Phase 2: Login & session redesign — mostly done, needs real-device testing
- [x] Permanent background session — verified already working (Supabase's
      own session persistence; a prior session's fix). Survives app
      close/reopen; only a true uninstall clears it (Android OS rule,
      unavoidable — see Phase -1/decisions table)
- [x] Per-person 4-digit PIN lock on top of the persistent session — done
      2026-09-06. `profiles.pin_hash`/`pin_salt` + `set_my_pin`/
      `admin_reset_pin`/`admin_clear_pin` RPCs live on Supabase. Owner,
      manager, and every staff member each get their own PIN now (staff
      previously had none at all). Verification is 100% local (SHA-256,
      cached after login) so it works fully offline, and the raw PIN is
      never sent over the network even when first set
- [x] Staff can change their own PIN (Settings → "My PIN", self-service,
      requires current PIN if one is set); owner/manager can Reset or Clear
      any staff/manager's PIN from the Android Access Area
- [x] 3–4 wrong PIN attempts → lock/warning — reused the existing
      owner-lockout mechanism (2 min lock + Telegram alert), now keyed
      per-profile instead of one shared device counter. (An earlier pass
      this same session independently re-verified the *original*
      shared-device-counter version of this — 3 wrong tries, 2-minute lock,
      countdown, shake animation, used-dot indicators, no bypass — before
      this per-profile upgrade landed; superseded by the per-profile version
      above, noted here so that verification isn't lost.)
- [x] "Restoring your data…" screen — added independently twice this same
      session (merged into one, the `gate-screen`/`gate-auth-card`-styled
      version, for consistency with the rest of the gate UI) for the gap
      where a fast PIN entry or quick staff login could unlock before
      `loadCloudState()`/live stock+catalog finish fetching, on a fresh
      install/slow connection. Traced every bootstrap exit path (success,
      offline/no store_id, staff-denied, catch-all error) — `cloudReady` is
      set `true` in every one, so this can never hang forever; gated on
      `cloudUser` so a local-only/offline device never sees it
- [ ] **Not done — flagged honestly, not claimed complete**: biometric/
      fingerprint unlock (needs a native Tauri Android plugin + a real
      device to verify; deferred to Phase 6 where it was already listed)
- [ ] **Needs real-device verification before this phase is marked ✅**:
      typecheck is clean and the logic was traced through by hand, but none
      of this has been exercised on an actual phone/Windows install yet —
      specifically: (1) a staff PIN set on one device unlocking correctly
      after a fresh login on a *second* device, (2) the lockout/Telegram
      alert firing correctly per-profile, (3) the owner's pre-existing
      fully-offline "Owner Confidential Area" passcode still working
      unchanged when no cloud account is signed in at all

### 🟡 Phase 3: Multi-device sync verification — DB/code side verified, needs the owner's hands-on test
_I can't physically operate three devices at once from here, so "verified"
below means: checked directly against the live Supabase project and the
actual code, per this document's own ground rule — not assumed or guessed._

- [x] **RLS/publication audit for all three sessions running concurrently**
      (owner Windows + owner Android + staff Android — these are just three
      independent Supabase auth sessions, which Supabase supports natively;
      nothing in this app artificially limits concurrent sessions):
  - `products`, `products_staff_view`, `store_state`,
    `store_state_staff_view`, `confidential_price_requests`, `profiles`,
    and `sales` are all confirmed live in the `supabase_realtime`
    publication (read directly from `pg_publication_tables`)
  - **Found and fixed**: `sales` had SELECT policies for owner/manager only
    — the exact same class of gap already found once for `products` and
    fixed with `products_staff_view`. Nothing in the client reads `sales`
    directly today (the sales list still comes through the already-working
    blob path), so this wasn't an active bug, but it would have silently
    broken the moment something *did* query it for staff (e.g. Phase 6's
    staff performance tracking). Added `sales_staff_select` policy,
    matching the same access-window cutoff already used elsewhere.
    Migration: `sales_staff_select_policy`.
  - `sale_items` is confirmed **not** in the realtime publication — matches
    this document's own earlier note ("sales/sale_items ... enabled at the
    DB level" was slightly imprecise; only `sales` itself is). Not fixed in
    this pass — nothing reads it live today either.
- [x] **Traced the actual conflict-handling code for the specific race this
      phase exists to catch** ("two devices sell at nearly the same
      moment — does either sale silently vanish from the display?"): a
      prior session had already fixed this properly — on a version
      conflict, the code now **retries the save against the fresh version
      first** (preserving the local device's own just-made sale in the
      process) and only falls back to accepting the remote copy outright if
      that retry also collides. This is a real fix, not just a comment —
      read the live code, not assumed.
- [ ] **What still needs the owner, specifically** (nothing further to
      verify from this side without hardware):
  1. Open Windows (owner) + an Android device logged in as owner + a
     second Android device logged in as staff, all three at once
  2. Make a sale from the staff device → confirm stock updates on both
     owner screens within ~1 second (this part — the stock number itself —
     was already device-tested and closed out in Phase 1)
  3. Make a sale from Windows *and* the owner-Android device at nearly the
     same moment (both tap "Complete Sale" within a second or two of each
     other) → confirm **both** sales end up in the sales list on all three
     screens, none silently missing — this is the specific scenario the
     retry-first fix above targets
  4. Confirm the Telegram bot gets both of those invoices, not just one
- [ ] Confirm offline sale on staff Android queues correctly and syncs the
      moment internet returns (turn on airplane mode, sell, turn it back
      off, watch it appear elsewhere)

### 🟡 Phase 4: Android UI redesign
- [x] New navigation: bottom tab bar (Home / Sell / Inventory / Reports /
      More) — done in an earlier session (Phase 4.1), confirmed still wired
      up after this session's merges.
- [ ] Redesign each screen for touch/mobile ergonomics, section by section —
      still open overall (this is inherently unbounded — dozens of screens);
      **Sell/POS pass done 2026-09-06** (the single busiest screen, and the
      first one tackled since it's what staff touch most):
      - `.qtybtn` (cart qty +/- steppers) was 28px — below the ~44px
        touch-target guidance the 2026-09-05 app-wide pass already cited
        for `.btn`, but never reached these because they're a separate
        class. Bumped to 38px on phone.
      - `.cart-line` (used for both the product-search results and the
        cart itself) didn't wrap — product name + a 100px price box + 2
        qty buttons + a delete button squeezed into one non-wrapping row
        left almost no room for the name on a ~360-400px screen. Now
        wraps: name gets its own full-width line, price/qty/delete flow
        onto a second line below it.
      - New: a mobile-only sticky "🛒 N items · ₹total · View Cart ↓" bar
        pinned above the bottom tab bar while the cart has items — on
        phone the product list and cart stack vertically (existing
        `.grid.cols-2` breakpoint), so without this, cart total/checkout
        was easy to lose track of while scrolling a long product list.
        Tapping smooth-scrolls straight to the cart section.
      - Verified: `tsc --noEmit`, vitest (26/26), static audit (16/16),
        production build all clean. **Not device-tested** — same caveat
        as everywhere else in this plan needing a real phone; layout
        reasoning here is sound but only a real device confirms feel.
      - Genuinely NOT done yet: Dashboard, Sales History, Returns,
        Purchases, Repairs, etc. — each would need its own screen-specific
        look the same way this one did
      - **Product Catalog pass done 2026-09-08** (the app's default landing
        screen per the owner's decision — second-highest-traffic screen
        after POS):
        - The table has up to 13 columns (Photo/Name/Category/Brand/SKU/
          Barcode/Cost/Confidential/Selling Price/MRP/Discount/Stock/
          Warranty/Actions) — even with horizontal scroll this was
          genuinely unusable on a ~360-400px phone, one of the most-
          reported "kuch dikhta hi nahi" complaints
        - Added a mobile card layout (photo, name, price with MRP struck
          through + discount badge, stock/warranty/SKU, Edit/Delete for
          owner) shown only under 900px — same toggle-by-CSS technique as
          the POS pass's `.mobile-cart-bar`, both table and cards render in
          the DOM, only one is ever visible, no JS viewport-width state
        - Self-caught-and-fixed bug from this same edit: a `str_replace`
          accidentally deleted the `case "invoices":` label right after the
          products case, leaving its render block as dead/unreachable code
          — caught by re-grepping immediately after the edit (this
          document's own ground rule about verifying, applied to my own
          work this time, not just prior sessions')
        - Verified: `tsc --noEmit`, vitest (26/26), static-audit (16/16),
          production build all clean, both before and again after rebasing
          onto Phase 5 work landing in parallel. **Not device-tested.**
      - **Dashboard pass done 2026-09-08** (what the owner sees first):
        - `.grid.cols-4` (used only by the 4 metric cards + the "⚡ 1-Tap
          Counter Actions" 8-9 tile shortcut grid) was collapsing to a
          single column under 768px — scrolling past up to 9 full-width
          rows just to find one shortcut button defeats the point of a
          quick-actions panel. Kept at 2 columns on phone instead (its
          other class siblings, `.grid.cols-3`/`.grid.cols-2`, were left
          untouched — checked their other usages and 1 column is correct
          there, e.g. Sell/POS's product-list/cart split)
        - Low Stock Alerts + Recent Invoices: same table-vs-mobile-card
          toggle as the Product Catalog pass; Recent Invoices rows are now
          fully tappable (not just the small invoice-number link)
        - Verified: `tsc --noEmit`, vitest (26/26), static-audit (16/16),
          production build all clean. Explicitly re-checked the
          `dashboard`/`sell` case-label boundary via grep before
          committing, after the prior pass's self-inflicted case-label
          deletion bug. **Not device-tested.**
      - Still genuinely NOT done: Sales History, Returns, Purchases,
        Repairs, etc. — each needs its own screen-specific pass, not just
        the existing generic CSS pass. Worth doing incrementally, screen by
        screen, in future sessions rather than claiming this item complete.
- [x] Light + dark theme — already existed (`theme/useAppearance.ts`'s
      `toggleMode`/`setMode`, surfaced via the Appearance Studio screen), an
      earlier session also switched the fresh-install default to light.
      Re-verified present, not re-touched.
- [x] Camera-based barcode scanning — already existed and already wired up
      (`CameraScannerModal.tsx`, real `@zxing/browser` + native
      `BarcodeDetector` decoding, not just AI photo-OCR), reachable from the
      Sell page, F4 shortcut, and the sidebar's Quick Scan button. Re-verified
      present, not re-touched.
- [x] **Bluetooth/USB thermal printer support for receipts — built this
      session.** The existing "thermal" print format only ever went through
      `window.print()`, which needs an OS-registered printer driver — fine
      on Windows, but the cheap Bluetooth 58mm counter printers actually
      used at these shops essentially never have an Android print driver, so
      that path was never going to work for the Android app specifically
      (the actual point of this phase). Added a real ESC/POS path instead
      that bypasses the OS print pipeline entirely:
      - `src/services/thermalPrinter.ts` — dependency-free ESC/POS byte
        builder (shop header, items, totals, cut) mirroring the existing
        thermal CSS layout's content, plus two transports: Web Bluetooth
        (BLE, the realistic Android path — auto-detects a writable GATT
        characteristic rather than hardcoding one vendor's UUID, since
        counter-printer models vary widely) and Web Serial (USB,
        desktop/Windows-only, `navigator.serial`).
      - `InvoiceViewerModal.tsx`: "Bluetooth Print" / "USB Print" buttons,
        each only rendered when the browser actually exposes that API
        (`isBluetoothPrintSupported()`/`isSerialPrintSupported()`), plus a
        58mm/80mm width selector.
      - `scripts/ci-wire-android-bluetooth-permissions.mjs` (new, same
        pattern as the existing `ci-wire-android-signing.mjs`): patches the
        CI-regenerated `AndroidManifest.xml` with
        BLUETOOTH/BLUETOOTH_ADMIN (≤ API 30), ACCESS_FINE_LOCATION (≤ API
        30, required for BLE scanning pre-Android-12), and
        BLUETOOTH_SCAN/BLUETOOTH_CONNECT (API 31+) — wired into
        `build-and-release.yml` right after `tauri android init`. Verified
        against a realistic sample manifest, including idempotency.
      - **Honest caveat, not glossed over**: manifest + runtime permissions
        are necessary but not sufficient — whether `navigator.bluetooth` is
        actually exposed inside Tauri's Android WebView at all depends on
        the installed Android System WebView version/build (Web Bluetooth
        support in WebView, vs. full Chrome for Android, has historically
        been inconsistent across OEMs/OS versions). This cannot be verified
        from this sandboxed build environment — no Android SDK/emulator or
        real device available here. Worst case on an unsupported device:
        the Bluetooth Print button simply doesn't render (feature-detected),
        not a crash — but **please test this on the actual Android APK with
        a real Bluetooth thermal printer** before relying on it at the
        counter.
      - Verified in this environment: `tsc --noEmit`, full test suite (26
        tests), static audit, production build all clean.

### 🟡 Phase 5: Operational features — reports + low-stock alerts + backup done
- [x] **Daily + weekly sales/profit summary → Telegram, automatic — was
      silently completely broken, now fixed and independently
      deep-verified twice** (once in this session, once again by a
      separate session that re-verified this session's own fix — both
      accounts kept below since both did real, distinct verification work):
  - `weekly_report_payload()` SQL function: confirmed already fixed and
    live (hybrid — sales/sale_items/products/purchases from the relational
    tables, expenses still from the JSON blob since `expenses` was never
    migrated relationally — see the JSON-vs-relational status table
    elsewhere in this file).
  - Daily digest: a separate `daily-digest-worker` edge function (same
    relational-data fix, kept deliberately apart from the large
    `ai-gateway` function to avoid risking its other working AI routes)
    was built and deployed — **but the cron job was never actually
    repointed at it**. It kept calling the old, still-broken
    `ai-gateway/cron-daily-digest` route every night. Confirmed by reading
    `ai-gateway`'s live source directly: its `runDailyDigestSweep()` still
    reads `state.sales`/`state.products` off the empty blob. Fixed this
    session: repointed the `ai-daily-digest-sweep` cron job at
    `daily-digest-worker`, live-tested it end-to-end (`net.http_post` +
    checked the actual HTTP response: `200`, ran cleanly, correctly
    skipped since there were 0 real sales today — confirmed that's the
    real reason via a direct query, not a hidden failure).
  - **Repo/DB drift closed while verifying this** (same pattern as
    before — live changes with no matching committed file): added the
    `daily-digest-worker` function's source (was deployed with zero
    source in the repo), the `ai_features_v36` migration (added
    `ai_digest_enabled` + its RPCs — existed live since 2026-09-04,
    never committed), and the cron-repoint migration.
  - **UI gap found and fixed**: `ai_digest_enabled`'s owner/manager-only
    getter/setter RPCs (`get_ai_digest_enabled`/`set_ai_digest_enabled`)
    existed live with nothing in the app ever calling them — the owner
    had no way to turn the digest on. Added a "Daily AI Digest: ON/OFF"
    toggle next to the Telegram controls in the owner settings area.
  - **A separate session's independent re-verification (also real, kept
    for the record)**: confirmed weekly cron (`weekly-report-dispatch`,
    Mon 9 AM IST) and daily cron (`ai-daily-digest-sweep`, 9 PM IST) both
    firing for real — Monday's run delivered an actual PDF to Telegram.
    Also live-tested `get_my_weekly_report_payload()` (the in-app "Send
    Now" button) and the Digest ON/OFF toggle against both a real owner
    and a real staff account (owner: real numbers + can toggle; staff:
    correctly rejected). Found and closed one more drift instance:
    `weekly_report_payload()`'s originally-committed migration file still
    had the old JSON-blob-reading version, while the live function had
    already moved on — closed in
    `20260907070000_phase5_weekly_daily_reports_relational_and_digest_toggle.sql`
    (applied live as a verified no-op, since the live function was
    already correct).
  - Verified (this session): typecheck clean, full test suite (26 tests)
    pass, static audit passes, production build clean.
- [x] **Instant low-stock alerts → Telegram + in-app.** In-app was already
      effectively instant from Phase 1 (`stockOf()`/`subscribeToLiveStock`'s
      realtime feed updates the header's "LOW STOCK: N SKUs" badge within
      ~1s of any sale/adjustment/purchase, from any device). Telegram half
      was missing — added a Postgres trigger (`notify_low_stock()` on
      `products`, fires `after update of stock_qty`) rather than
      client-side code, so it catches every path that can change stock
      (sale, adjustment, purchase return, manual edit) without every one
      of those call sites needing to remember to check. Only fires on the
      transition INTO low stock (was above `min_stock`, now at/below it),
      not on every subsequent sale while already low, so it doesn't spam.
- [x] **Manual backup file export — was silently broken since Phase 1**,
      same root cause as the digest bug: "Download JSON Backup" used to
      just `JSON.stringify(db)` (the local blob), whose products/sales
      arrays are now always empty. Fixed by pulling every relational
      table the store owns (products, sales, sale_items, invoices,
      purchases, purchase_items, expenses, personal_drawings, returns,
      exchanges, exchange_items, warranty_claims, suppliers,
      supplier_transactions, customers, customer_payments,
      stock_movements, stock_batches) alongside the blob, when
      cloud-connected; falls back to blob-only (with a clear toast saying
      so) if offline, so a backup is never blocked entirely. Did **not**
      touch the "Restore from JSON backup" flow (separate, higher-risk
      scope — restoring relational data back in isn't the same operation
      as restoring blob settings, and wasn't asked for).
- [ ] Audit log (who added/edited/deleted what, and when)
- [ ] In-app auto-update check (APK self-update prompt)
- [x] Automatic crash reporting — new `crash_reports` table (migration
      `phase5_crash_reports`, RLS: any store member can insert their own
      store's crash, only owner/manager can browse them) + `crashReporter.ts`
      (per-session cap of 10 + de-dupe so a crash loop can't flood the DB —
      same lesson as this project's earlier sync_queue retry-storm) +
      `ErrorBoundary.tsx` (catches React render errors specifically, with
      component stack, shows a recoverable screen instead of blank white) +
      `main.tsx` wiring for `window.onerror`/`unhandledrejection` (runtime)
      and the existing fatal-startup catch block (boot). Verified with a
      fresh clone + `npm ci` + `tsc --noEmit` + `npm run build`, all clean,
      before committing — not just trusted from local testing. **Known
      limitation, stated plainly rather than glossed over**: a crash that
      happens before the JS module bundle even loads (e.g. a genuine
      network/asset failure) still can't reach Supabase from here — that
      case is still only visible via index.html's local boot-fallback
      overlay, which the owner still has to screenshot manually. No in-app
      viewer for crash reports was built yet (data is queryable directly in
      Supabase for now); a Settings-page list is a natural near-term
      follow-up, not done here to keep this item scoped to the actual
      capture-and-report mechanism.

### ⬜ Phase 6: AI & advanced feature enhancements
- [ ] AI Photo Scan: improve accuracy, support 1 or 2 photos (front/back) with
      auto-fill from either, product view shows all photos provided
- [ ] AI-based selling price/MRP suggestion when adding a product
- [ ] Better Gemini key pool handling (fallback/retry instead of hard failures)
- [ ] Improve Photo Stock Finder matching
- [ ] Staff performance tracking (sales leaderboard/summary per staff)
- [ ] Excel/PDF export for invoices and customers
- [ ] Customer profile: full purchase history
- [ ] Warranty claims: proper tracked workflow with reminders
- [ ] Biometric (fingerprint) unlock alongside PIN
- [ ] Remote session kill (owner force-logs-out a device from Windows)
- [ ] Product price change history log
- [ ] Customizable receipt branding (shop logo/name/address)
- [ ] Owner-configurable staff access window (time range, duration, which
      sections/data are visible)
- [ ] Refund/return requires owner approval before it completes

### ⬜ Phase 7: Amazon/Flipkart-style product experience
- [ ] App opens directly into the **Stock/Inventory section** by default
      (not the dashboard)
- [ ] Product list redesigned as e-commerce style cards (photo-forward,
      like Amazon/Flipkart)
- [ ] AI auto-fills full specifications for a product when added (extends
      Phase 6's photo-scan work)
- [ ] AI sources/generates good-quality product photos automatically (not
      only what the owner uploads)
- [ ] All product photos permanently stored on Cloudflare R2 (durable,
      never lost)
- [ ] Dedicated **product detail page** per product (tap a product →
      full page), showing MRP (struck through), discount %, and selling
      price, e-commerce style
- [ ] "Confidential Price" button available directly on this page —
      **reuse the existing flow** (`confidentialPrice.ts` + the
      `telegram-connect` Edge Function): staff tap it, owner gets an
      Approve/Deny prompt on Telegram, price reveals for 5 minutes on
      approval, all in realtime already. This page just needs to surface
      the button, not rebuild the approval system
- [ ] "Add to Cart" **and** "Buy Now" (direct checkout) both available from
      the product page, like Amazon
- [ ] AI auto-designs the rest of the product page layout (feature
      highlights, photo gallery) per product, saved permanently so it
      loads instantly next time (including offline)

### ⬜ Phase 8: Real universal search (+ AI search, glass-specific intelligence)
- [ ] Fix the core bug: search currently only searches *within* whatever
      category tab you're already in (e.g. Tempered Glass) — must search
      **all products, all categories, everywhere**, like Amazon/Flipkart
- [ ] Add AI-powered search on top of normal keyword search — runs by
      default alongside plain search, not instead of it
- [ ] Search by phone **model number** must surface matching glass/cases
      even if the product title doesn't literally contain that model
- [ ] Clicking a matched model shows **all** compatible glass/cover models
      for that phone
- [ ] When adding a tempered-glass product, AI auto-fetches and
      **permanently saves** the actual screen size of the phone model it's
      for (e.g. Realme 7 → 6.5")
- [ ] When a search has no exact model match (e.g. "Realme 7 glass" and no
      glass is tagged for that exact model), AI suggests the closest
      size-compatible glass instead, and explains why (e.g. "Realme 7 is
      6.5\" — this glass is for 6.4\"–6.5\" screens, likely fits")
- [ ] **My own addition**: build this as a proper searchable **phone-model
      → screen-size** reference table in the database (not just an AI call
      every time), so once a model's size is looked up once, every future
      search for that model is instant and doesn't re-spend an AI call —
      AI fills gaps in this table over time instead of being asked the same
      question repeatedly
- [ ] **My own addition**: typo-tolerant search (e.g. "reelme" or "iphon"
      should still match "Realme"/"iPhone") since shop staff typing fast
      under pressure will misspell things
- [ ] **Discovered while researching**: a `upsert_screen_size_cache()`
      function and backing cache table **already exist** in the database —
      the phone-model → screen-size groundwork above is partially built
      already. Needs auditing (is it actually wired into the Add Product
      flow yet? how many models does it already know?) rather than built
      from scratch

### ⬜ Phase 9: Security hardening (found via a live audit, 2026-09-06)
_I ran a security scan against the live database while researching Phase 1
— found a few real gaps worth closing, not asked for but worth doing:_
- [ ] Several money-moving functions (`save_store_state`, `record_return`,
      `record_exchange`, `record_customer_payment`, `record_supplier_payment`,
      `upsert_customer`, `upsert_supplier`, `enqueue_invoice_telegram`,
      `handle_new_user`) are currently callable by **`anon`** — meaning a
      request that isn't even logged in can attempt to call them. Each one
      does check the caller's role internally before doing anything, so
      this hasn't been exploited, but it's needless exposed surface area
      that should be locked down to `authenticated` only, as defence in
      depth
- [ ] Enable Supabase Auth's **leaked-password protection** (checks new
      passwords against known breached-password lists) — currently off,
      one toggle to turn on
- [ ] While in there: review whether `resolve_product_for_sale` and
      similar RPCs need any additional rate-limiting given they're callable
      directly by any authenticated staff account

### ⬜ Phase 10: Product-specific invoice rules & quotes (AI-driven)
- [ ] Each product/category (glass, mobile, accessory, repair, etc.) has
      its **own** terms/rules text (warranty, return policy, etc.)
- [ ] Invoice shows **only** the rules relevant to what was actually sold
      on that invoice — not a single generic rules block for everything
- [ ] Same per-category logic for the customer-facing "quote"/feel-good
      line printed on the invoice
- [ ] AI decides/generates the right rules+quote per product by default,
      running automatically in the background — no manual selection needed
      unless the owner wants to override

### ⬜ Phase 11: Offline catalog download & flexible AI provider keys
- [ ] A "Download" section: on a fresh login (new device), the owner/staff
      can trigger a download of the full catalog + product pages so
      everything (including the AI-generated product pages from Phase 8)
      works offline afterward
- [ ] Support adding **any number of AI API keys from any provider** (not
      locked to Gemini) — owner can plug in their own keys from whichever
      AI company, and the app uses them
- [ ] Directly extends Phase 6's "better Gemini key pooling" item — the
      pool should be provider-agnostic, not Gemini-only
- [ ] **Technical detail from research**: the existing pool
      (`gemini_api_keys` table + the 1,418-line `ai-gateway` Edge Function)
      already has solid rotation/cooldown/failure-tracking — it's just
      hardcoded to Gemini's specific request/response format end to end.
      The right way to extend it: add a `provider` column to the key table,
      and refactor the Edge Function's actual HTTP call into a small
      per-provider adapter (Gemini/OpenAI/Anthropic/etc. each format
      requests and parse responses differently) behind the same rotation
      logic — not a rewrite of the rotation system itself, which already
      works well

### ⬜ Phase 12: Windows app theme & polish fixes
_Root-caused by reading the actual theme code, not a guess:_
- [ ] **Startup flicker, exact cause found**: the saved theme lives in
      `localStorage['ds-nexus.appearance']`, but it's only applied by
      `startAppearanceSync()` inside `main.tsx` — which runs *after* the JS
      bundle loads and the browser has already painted once with whatever
      default colours the CSS falls back to. Fix: add a tiny synchronous
      script at the very top of `index.html`'s `<head>` (before any
      stylesheet/script) that reads that same localStorage key and sets
      `data-theme`/`data-mode` on `<html>` immediately — this is the
      standard fix for "flash of wrong theme" and needs no framework change
- [ ] **Hardcoded colour audit**: found 21 places across components using
      raw colours (`bg-white`, `text-black`, literal hex codes) instead of
      the theme's CSS variables — these are exactly what looks "ajeeb" in
      some themes/dark mode while everything else looks right. Go through
      each one and convert it to the theme-aware variable
- [ ] Re-test all themes (light + dark, every preset in Appearance Studio)
      after the audit, on both Windows and Android, since Phase 8's new
      product-card UI will add more surface area that needs to respect
      the same variables from day one

### ⬜ Phase 13: Performance & startup speed
- [ ] Measure and reduce Windows/Android cold-start time (bundle size,
      what blocks first paint) — every extra second at launch is a second
      the owner/staff are staring at a blank/loading screen
- [ ] Lazy-load rarely-used screens (Reports, Appearance Studio, AI tools)
      instead of bundling everything into the initial load
- [ ] Audit the 20+ product photos / R2 uploads path (Phase 8) for
      compression before upload, so the catalog doesn't get slow to load
      as more products get AI-generated photos

### ⬜ Phase 14: A safety net so this doesn't happen again
_This is my own addition, not something explicitly asked for — but after
the last two days of whack-a-mole fixes (one fix causing a new bug, twice),
I think it's necessary:_
- [ ] Add a small set of automated checks for the highest-risk paths
      (a sale completing end-to-end, a product resolving to a real id, the
      version-conflict retry not looping) that run before any build is
      shipped — so a regression like the 1,858-row runaway gets caught
      before it reaches the live store, not after
- [ ] A simple **owner-facing "System Health" screen** (Windows + Android):
      pending sync queue size, last successful Telegram send, last
      successful cloud save — so if something breaks, you see it
      immediately instead of noticing days later from a customer complaint
- [ ] Staging/test mode: a way to try a new build against a *copy* of the
      real data instead of the live store, for anything touching sales or
      stock

### ⬜ Phase 15: Final pass
- [ ] Full regression test across Windows + both Android apps
- [ ] Clean up dead code / old migrations
- [ ] Update this document — everything checked off, or explicitly listed as
      known/accepted limitation

**Note added 2026-09-06 (separate session, before switching to Phase 5 per
owner's instruction) — flagging a fork, not fixing it right now:** while
independently working on this same PIN item in parallel, a
`public.profile_pins` table + `get_own_pin_status`/`set_own_pin`/
`verify_own_pin`/`reset_staff_pin` RPCs were built and tested (11/11 test
cases passed against the live DB) — this predates seeing that the
`profiles.pin_hash`/`pin_salt` + `set_my_pin`/`admin_reset_pin`/
`admin_clear_pin` approach above already existed from a different session.
The frontend uses only the `profiles.pin_hash` approach — the
`profile_pins` table/RPCs are live on Supabase but genuinely unused
dead code right now, not a second active system to reconcile. Left in
place rather than dropped, since deleting live DB objects without the
owner's go-ahead didn't seem like the right call to make solo; whoever
picks this up next should either wire the frontend to the isolated-table
version instead (its advantage: `profiles`' existing owner/manager
full-row SELECT policy structurally cannot expose `pin_hash`/`pin_salt`
to a client at all, vs. today's approach where those two columns living
directly on `profiles` means a future query change to the very common
"list my staff" call is one mistake away from handing every staff
member's PIN hash+salt to the owner's client, crackable near-instantly
given a 4-digit PIN's 10,000-value keyspace — not exploitable by
*today's* actual queries, which were checked and don't select those two
columns, but structurally fragile going forward) — or simply drop the
unused table+RPCs (`profile_pins`, `get_own_pin_status`, `set_own_pin`,
`verify_own_pin`, `reset_staff_pin`) if the owner decides the offline-first
design is worth keeping the fragility. Not deciding this alone; flagging
it for whoever picks Phase 2 back up.
