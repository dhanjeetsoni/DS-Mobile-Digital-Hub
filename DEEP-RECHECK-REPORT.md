# Deep Production Recheck — 2026-08-28

## Base preservation
- Existing project extracted from the supplied production ZIP.
- Root project and `ds_work` copy preserved.
- No existing feature directories intentionally removed.
- New changes are additive/hardening focused.

## Critical bug fixes
1. Staff cloud autosave no longer skips staff.
2. Staff-safe server snapshot now merges append-only collections instead of replacing them with empty arrays.
3. Telegram Connect Edge Function added.
4. Telegram polling reduced to 15 seconds, pauses while tab is hidden, and stops while already connected.
5. FIFO sale preparation is wrapped so inventory/batch drift produces a visible error instead of an unhandled rejection.

## Security fixes
6. OCR endpoint now requires a valid Supabase session.
7. Optional Express `TRUST_PROXY` support added before IP rate limiting.
8. Rate limiter periodically removes expired entries.
9. `/api/health` no longer exposes API-key configuration flags.
10. Supabase browser client fails closed if environment configuration is missing; hardcoded project credentials were removed.

## Reliability/performance
11. IndexedDB database connections are explicitly closed after transactions.
12. Existing offline queue and idempotency mechanisms remain intact.
13. Staff state merge prevents old owner data from being blanked by staff projections.
14. Telegram connection sessions expire after 10 minutes and the connect function registers its webhook.
15. Windows Tauri bundle configuration now has actual PNG/ICO icons and a production build script.

## Current verification
- Static audit: PASS — 16 checks.
- Supabase staff merge migration: APPLIED and function existence verified.
- Gemini model check: `gemini-3.7-flash` is currently GA/stable as of August 2026.
- Full npm dependency install: NOT VERIFIED in this sandbox because npm install times out.
- Full TypeScript build: NOT VERIFIED for the same dependency-install limitation.
- Native Windows `.exe`: NOT VERIFIED in this Linux sandbox; use `BUILD-WINDOWS.bat` on Windows.

## Important production note
The entity-by-entity PostgreSQL migrations already present in this project remain the authoritative direction. The staff snapshot merge is a compatibility bridge so existing screens do not silently lose staff-created records while those screens are progressively moved to direct RPC/entity writes.

## Build
On Windows:
1. Install Node.js LTS and Rust via rustup.
2. Ensure WebView2 is installed (normally present on modern Windows).
3. Set `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Configure Supabase Edge Function secrets for Telegram if Telegram is enabled.
5. Run `BUILD-WINDOWS.bat`.
