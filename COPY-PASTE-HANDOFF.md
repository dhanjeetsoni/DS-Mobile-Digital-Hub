# COPY-PASTE HANDOFF — DS MOBILE & DIGITAL HUB

The uploaded existing project was patched in-place. Do not rebuild it.

## Current architecture

React 19 + TypeScript + Vite + Express.
Supabase Auth + PostgreSQL is the cloud backend.
Existing feature components remain under `src/components/`.
Services remain under `src/services/`.
FIFO and OCR utilities remain under `src/utils/`.

## Completed in latest hardening

- Server-authoritative invoice reservations with idempotency.
- Atomic sale RPC is protected and usable by owner/manager/staff.
- FIFO batch consumption remains server-authoritative for online sales.
- Staff raw `store_state` access removed.
- Staff-safe state read/write RPC added with version conflict protection.
- Sensitive normalized tables restricted to owner/manager.
- Staff state strips purchase cost, supplier costs, personal expenses, KYC, IMEI registry, sale costs, batch consumption and finance details.
- Telegram invoice trigger creates a durable outbox record after invoice creation.
- Telegram worker version 6 deployed; it sends message + generated PDF and retries with exponential backoff.
- Offline SQLite now persists through IndexedDB where available.
- Offline queue operation IDs are stable and removable after replay.
- Automatic reconnect/background sync added.
- BarcodeDetector fallback replaced with ZXing.
- Image uploads now decode real barcodes and never treat the image data URL as a SKU/IMEI.
- Gemini + OCR.space metadata and mandatory verification UI added.
- Production Express/Vite server startup fixed.
- Server security headers + OCR rate limiting added.
- PWA query routing added.
- English-only cleanup performed.
- Tauri 2 desktop packaging scaffold added.

## Supabase current state (updated — new project, old one hit its free-tier limit)

Project: `vjimgnmbgghtsfafamye` ("DS mobile & Digital Hub")
URL: `https://vjimgnmbgghtsfafamye.supabase.co`
The old project (`bgvyuxlkjgpsfcbvcnnt` referenced below in stale notes) is abandoned — it hit its free-tier limit. Everything was rebuilt fresh on the new project.

Applied migrations:
- `base_schema`
- `core_functions`
- `row_level_security`
- `harden_function_search_path` (fixed mutable search_path lint on `my_store_id` / `merge_staff_json_array`)
- `enable_cron_and_net_extensions` (`pg_cron`, `pg_net`)
- `schedule_telegram_outbox_worker` (cron job `telegram-outbox-worker-sweep`, runs every 2 minutes)

24 public tables, all RLS enabled. Security/performance advisors reviewed — remaining warnings (SECURITY DEFINER RPCs, `rls_enabled_no_policy` on the two telegram tables, unindexed FKs) are intentional/low-priority and documented, not bugs.

## Telegram

Edge functions deployed on the new project:
- `staff-manage` (v1)
- `telegram-connect` (v1)
- `telegram-outbox-worker` (v2 — v2 adds a cron-secret sweep mode, see below)

### Outbox worker scheduling (new in this pass)
The original `telegram-outbox-worker` only worked when called with a real logged-in user's session token, which a scheduler can't provide. It was rewritten to also accept a shared-secret header:
- Header `x-cron-secret` matched against edge-function secret `CRON_SECRET` → sweeps **all stores'** due messages (limit 50).
- Otherwise falls back to the original per-user/per-store behavior (limit 20), used by the in-app "test send" flow.

A Postgres cron job (`pg_cron` + `pg_net`) calls the function every 2 minutes with that header. The `CRON_SECRET` value must be set identically in both the DB cron job (already done) and the edge function secrets (owner must do this via Dashboard → Edge Functions → Secrets — not settable via API/CLI from outside).

### Required Edge Function secrets (Dashboard → Edge Functions → Secrets)
Owner has already set:
- `TELEGRAM_BOT_TOKEN`
- `CRON_SECRET` = `0c3d70b61966a67436377dbfec1fe53e420e3a919962f56a`

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase into every edge function and must NOT be set manually — the dashboard blocks the `SUPABASE_` prefix on custom secrets.

A real Telegram chat connection still needs to be made from inside the app (Owner → Telegram Connect panel → Connect Telegram) before live delivery can be verified end-to-end.

## Offline

SQLite WASM + IndexedDB persistence is active.
Online reconnect automatically flushes pending operations.
Sale replay uses server atomic sale + idempotency.
Legacy snapshot replay remains only as a compatibility bridge for modules not yet migrated.

## Remaining work

1. Migrate Purchase UI to normalized PostgreSQL repository.
2. Migrate Inventory/stock adjustment UI to normalized repository.
3. Migrate Returns/Exchanges to reversal transaction services.
4. Migrate Warranty to normalized repository.
5. Migrate Customer Khata/payments to normalized repository.
6. Migrate Expenses and reports to SQL aggregates.
7. Add full staff-safe normalized read RPC/view layer for catalog/history.
8. Build Android Staff app.
9. Install Rust and build the Tauri Windows installer.
10. Run full authenticated 32-case E2E test matrix.
11. Enable Supabase leaked-password protection.
12. Add CI with locked dependencies.

## Test status

Static source audit: PASSED.
Supabase RLS-enabled check: PASSED.
Unauthenticated invoice reservation security check: PASSED.
Telegram worker deployment: PASSED.
Full npm install/build: NOT RUN to completion because dependency installation timed out.
Real Telegram send: NOT TESTED because no connected chat exists.
Android build: NOT TESTED.
Windows Tauri build: NOT TESTED.


## Latest hardening pass
See `DEEP-RECHECK-REPORT.md`. Staff sync, Telegram Connect, OCR auth, FIFO error handling, rate-limit cleanup, IndexedDB connection lifecycle, Supabase fail-closed config, and Windows Tauri packaging were hardened in-place.
