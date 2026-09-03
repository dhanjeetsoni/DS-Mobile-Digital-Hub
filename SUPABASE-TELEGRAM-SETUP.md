# DS Mobile & Digital Hub Pro — Cloud Architecture

## Supabase project
The frontend is wired to the connected Supabase project through the public publishable key. The publishable key is safe for browser use only because PostgreSQL RLS is enforced.

## Cloud data
- `stores` / `profiles` — multi-store membership and roles
- `products` — inventory master
- `sales` / `sale_items` — sales ledger
- `purchases` / `purchase_items` — purchase ledger
- `stock_movements` — stock audit trail
- `expenses`, `personal_drawings` — cash/accounting records
- `suppliers`, `supplier_transactions` — supplier ledger
- `returns` — return records
- `store_state` — versioned application snapshot + Realtime
- `sync_queue` — offline replay queue
- `audit_logs` — security/business audit trail
- `ocr_scans` — OCR audit records
- `model_compatibility` — accessory compatibility database
- `telegram_connections` / `telegram_connect_sessions` — secure Telegram account linking
- `telegram_outbox` — persistent notification queue

## Authentication
Supabase Auth uses email/password. A database trigger creates a store, owner profile and initial `store_state` row for a new account. Roles are `owner`, `manager`, and `staff`.

## Offline-first behavior
The existing local state remains available immediately. A SQLite WASM adapter persists an offline operation queue. When a signed-in session is available, queued operations and the versioned cloud snapshot are synchronized.

## Atomic sales
`atomic_complete_sale(...)` locks the affected products, validates store membership, writes the sale/items, decrements inventory and writes stock/audit records in one PostgreSQL transaction.

## Telegram
1. Sign in.
2. Select **Telegram Connect**.
3. The Edge Function creates a short-lived nonce and returns a Telegram deep link.
4. Press **Start** in the bot.
5. The webhook resolves the nonce and stores the chat ID server-side.
6. Test messages enter `telegram_outbox` and are processed by `telegram-outbox-worker`.
7. Retry state is persisted with exponential backoff up to 8 attempts.

The Telegram bot token is a server secret and is never read by the browser bundle.

## Frontend environment
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` may be supplied through `.env`. Never use `VITE_` variables for service-role keys, Telegram bot tokens, or Gemini server secrets.


## Telegram Connect deployment
Deploy `supabase/functions/telegram-connect` alongside `telegram-outbox-worker`. Configure `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or publishable key), and `SUPABASE_SERVICE_ROLE_KEY` (or secret key). Optional but recommended: set `TELEGRAM_WEBHOOK_SECRET`; the connect function automatically registers its own webhook when the user starts Connect.
