# DS Mobile & Digital Hub — Master Fix & Rebuild Plan

_Last updated: 2026-09-05_

This document is the single source of truth for the ongoing stabilization and
rebuild effort. Each phase is worked on **only after the owner explicitly
approves it**, and is marked ✅ here the moment it's done, tested, and pushed.
Nothing in a later phase starts until the owner says go — even if it looks
obvious or quick.

## Ground rules
- One phase at a time. Ask before starting the next.
- Every code change → typechecked → committed → pushed to GitHub → (if it
  touches the database) migration applied to the live Supabase project.
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

---

## Phases

### ✅ Phase -1: Emergency stop (already done, 2026-09-05)
- [x] Found and stopped a live bug that was creating ~20 garbage `products`
      rows/minute (1,858 total) via `resolve_product_for_sale`
- [x] Reverted a same-day stock-reconciliation change that was itself causing
      a stock flicker (0 ↔ 5) on a single device
- [x] `resolve_product_for_sale` now refuses to create a product with no SKU
      instead of silently duplicating it

### ⬜ Phase 0: Cleanup
- [ ] Delete the 1,858 garbage `products` rows (owner approved)
- [ ] Clear/reset the old stuck `sync_queue` backlog (pre-fix snapshot/sale
      rows that can never cleanly replay)
- [ ] Fresh-start the real product/stock data with the owner directly in-app
- [ ] Confirm `products`, `sales`, `sale_items`, `telegram_outbox` are all
      clean and consistent

### ⬜ Phase 1: Data architecture fix (the root cause of the flicker/races)
- [ ] Stop treating the single JSON `store_state` blob as the source of truth
      for stock/sales/invoices
- [ ] Make the relational tables (`products.stock_qty`, `sales`,
      `sale_items`, row-locked RPCs) authoritative for anything transactional
- [ ] Keep the JSON blob only for slow-changing settings/config
- [ ] Add realtime subscriptions so every device reflects a sale/adjustment
      within ~1 second, from whichever device made it (owner Windows, owner
      Android, or staff Android)
- [ ] Re-verify: sell from any one device → stock updates on all others
      instantly, invoice fires to Telegram silently, every time, no misses

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

### ⬜ Phase 6: Final pass
- [ ] Full regression test across Windows + both Android apps
- [ ] Clean up dead code / old migrations
- [ ] Update this document — everything checked off, or explicitly listed as
      known/accepted limitation
