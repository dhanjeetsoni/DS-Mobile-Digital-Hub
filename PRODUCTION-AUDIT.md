# DS Mobile & Digital Hub — Production Audit / Current Status

## Completed in this hardening pass

- Preserved the existing application and feature modules.
- Replaced collision-prone Date.now/Math.random IDs with UUID-backed IDs.
- Removed FIFO purchase-price fallback argument.
- Added server-authoritative invoice reservation with idempotency.
- Added staff-safe state read/write RPCs with version conflict protection.
- Removed raw `store_state` reads from the staff client path.
- Disabled raw `store_state` realtime subscription for staff.
- Sanitized staff state: purchase prices, batch costs, supplier data, personal expenses, KYC, IMEI registry, sale costs, batch consumption and finance details are not returned.
- Restricted normalized sensitive tables to owner/manager access.
- Made atomic sale RPC SECURITY DEFINER with explicit store/role validation so staff can still complete atomic sales without direct table access.
- Added durable invoice-triggered Telegram outbox creation.
- Upgraded Telegram worker to send both message and a generated invoice PDF with retry/idempotency state.
- Added IndexedDB persistence for SQLite WASM instead of serializing the database into localStorage when IndexedDB is available.
- Fixed offline queue operation-id mismatch.
- Added automatic reconnect/background sync with visibility-aware polling.
- Added a real ZXing barcode fallback for image uploads and browsers without BarcodeDetector.
- Prevented image data URLs from being treated as SKU/IMEI values.
- Added Gemini + OCR.space dual-provider response metadata and mandatory verification UI.
- Added production Express/Vite server startup and SPA serving; the previous server file did not start the Vite/static application.
- Added rate limiting and basic security headers to the server.
- Added PWA deep-link startup routing through `?page=...`.
- Removed accidental mixed-language UI text found in the Windows/Sim tracker areas.
- Added Tauri 2 desktop packaging scaffold.
- Added static source audit script.

## Verified against connected Supabase

- All public tables have RLS enabled.
- Invoice reservation table and sequence exist.
- `reserve_invoice_number` exists.
- Invoice Telegram trigger exists.
- Sensitive role-aware policies are active.
- Unauthenticated invoice reservation correctly fails with `not authorized`.
- Telegram outbox currently has no pending rows.
- Telegram worker deployed successfully as version 6.

## Not claimable as fully E2E-tested in this environment

- Full npm install/build because the environment has no dependency cache and registry installation timed out.
- Real authenticated staff/owner sale because no test login/session is available to the build environment.
- Real Telegram delivery because no Telegram connection/chat ID currently exists in the database.
- Android native build.
- Tauri Windows binary build because Rust toolchain is not installed in this environment.
- Full 32-case business E2E matrix.

## Known production configuration item

Enable Supabase Auth leaked-password protection in the Auth security settings.

## Important architecture note

`store_state` remains as a compatibility bridge for existing UI modules. It is no longer exposed raw to staff and is no longer the authority for atomic online sales. Full entity-by-entity repository migration remains the next architectural phase for purchases, returns, exchanges, repairs, expenses and other legacy modules.


## 2026-08-28 Hardening Pass
- Staff snapshot sync no longer skips staff users.
- Staff-safe server write now merges append-only collections instead of blanking purchases, suppliers, expenses, KYC, IMEI, galla and exchanges.
- Telegram connect Edge Function added with authenticated browser actions and Telegram webhook handling.
- Telegram background polling reduced to 15s, pauses while hidden, and stops after connection.
- FIFO sale preparation is guarded against inventory/batch mismatch exceptions.
- OCR endpoint now requires a valid Supabase session.
- Rate limiter periodically evicts expired IP entries and honors optional TRUST_PROXY.
- `/api/health` no longer reveals API-key configuration flags.
- Supabase browser client now fails closed when env configuration is missing.
- IndexedDB handles are explicitly closed after transactions.
- Gemini 3.7 Flash remains the current stable model as of Aug 2026.
