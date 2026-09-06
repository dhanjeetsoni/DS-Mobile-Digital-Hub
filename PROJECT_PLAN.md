# DS Mobile & Digital Hub — Master Fix & Rebuild Plan

_Last updated: 2026-09-06_

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
- [ ] **Not done yet, carried over from the prior session's list**: a
      `sale_items` → `products` same-`store_id` defence-in-depth constraint.
- [ ] **Owner needs to actually test this on a real device** — everything
      above is verified against the live DB/repo and passes automated
      checks, but the "sell from one device, see stock update on another
      within ~1 second, no flicker" behaviour itself hasn't been watched
      happen live yet. That's the one thing left before this can be ✅.
- [ ] The JSON blob still carries the full product catalog (photos, MRP,
      discount%, warranty text) — only stock quantity and sales were made
      relational-authoritative here, which is what actually caused the
      race/flicker. Migrating the rest of the catalog to relational tables
      is a separate, bigger schema-migration effort, deliberately not
      attempted in this pass.
- [ ] **Technical detail, still open**: `resolve_product_for_sale()` now has
      `client_id`, but only products that go through a resolve call (sale,
      stock adjustment, purchase) get backfilled — a product that's never
      been sold/adjusted/restocked since this shipped still has
      `client_id = null` until the first time one of those happens to it.
      Harmless (SKU fallback still works), just not instant.

### ⬜ Phase 2: Login & session redesign
- [ ] Permanent background session (survives app close/reopen; only a true
      uninstall clears it — that part is an Android OS rule, unavoidable)
- [ ] Per-person 4-digit PIN lock on top of the persistent session
- [ ] Staff can change their own PIN; owner can reset anyone's
- [ ] 3–4 wrong PIN attempts → lock/warning
- [ ] "Restoring your data…" screen on first login after install/reinstall
      that blocks the UI until the full cloud snapshot (stock + invoices +
      customers) has actually loaded — no more "logged in but empty" moment

### ⬜ Phase 3: Multi-device sync verification
- [ ] Test matrix: Windows (owner) + Android (owner) + Android (staff) all
      open at once
- [ ] Confirm a sale from each one instantly reflects stock everywhere else
- [ ] Confirm Telegram gets every single transaction, no exceptions
- [ ] Confirm offline sale on staff Android queues correctly and syncs the
      moment internet returns

### ⬜ Phase 4: Android UI redesign
- [ ] New navigation: bottom tab bar (Home / Sell / Inventory / Reports /
      More)
- [ ] Redesign each screen for touch/mobile ergonomics, section by section
- [ ] Light + dark theme
- [ ] Camera-based barcode scanning
- [ ] Bluetooth/USB thermal printer support for receipts

### ⬜ Phase 5: Operational features
- [ ] Daily + weekly sales/profit summary → Telegram, automatic
- [ ] Instant low-stock alerts → Telegram + in-app
- [ ] Audit log (who added/edited/deleted what, and when)
- [ ] Manual backup file export (daily/weekly)
- [ ] In-app auto-update check (APK self-update prompt)
- [ ] Automatic crash reporting

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
