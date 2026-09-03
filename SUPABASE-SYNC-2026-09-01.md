# Supabase Local ↔ Live Sync — 2026-09-01

## What triggered this
The zip uploaded for this session (`DS_Mobile_Digital_Hub_v1_9_Step2_Complete.zip`)
contained 21 migration files. The connected live Supabase project
(`vjimgnmbgghtsfafamye`, "DS mobile & Digital Hub") had **35 migrations**
actually applied, with different filenames/timestamps than every one of the
21 local files. This file records exactly what was found and what changed.

## Important discovery: this Supabase project is a fresh rebuild, not a migrated original
The live project's `created_at` is **2026-08-29T19:46:45Z**. Its very first
migration, `20260830035649_base_schema.sql`, contains this note written by
whichever prior session created it:

> "The original project's base schema was never captured in the zip (only
> later incremental hardening patches were), so this file reconstructs the
> full foundation directly in its final, hardened form from the
> application's contracts (types.ts, repository.ts, staffAuth.ts, the three
> edge functions, and the 9 patch migration files)."

In other words: at some point, a previous session **built a brand-new
Supabase project from scratch** by reverse-engineering the schema out of the
app's TypeScript code, rather than replaying the original 21 local migration
files against it. That's why none of the local files' timestamps/names
matched anything live — they were written for a different (older) project.

**Live data check right now:** only 1 store ("My Shop"), 1 profile (owner
`dhanjeethml@gmail.com`), 0 products/sales/purchases/customers/suppliers —
i.e. this is currently a fresh/test dataset, not real shop history. If real
production data existed in an older Supabase project, it is **not** in this
one. Worth confirming with whoever owns the shop data whether this is
intentional before treating this project as "the" production database.

## What changed in this sync
- **`supabase/migrations/`** now contains all **35** migration files, named
  and ordered exactly as they exist in the live database's
  `supabase_migrations.schema_migrations` table (`<full-14-digit-timestamp>_<name>.sql`),
  with SQL pulled directly from that table — not retyped or reconstructed.
- The old 21 local files were **not deleted** — moved to
  `supabase/migrations_legacy_pre_v2/` for reference, since they document an
  earlier/different project's intended schema and may still contain useful
  history or design notes in their comments.
- One migration (`20260830080737_returns_exchanges_warranty_normalization_v19.sql`)
  is a literal placeholder (`-- placeholder, will be replaced with file
  content`) in the live history itself — it was superseded a minute later by
  `20260830080846_returns_exchanges_warranty_normalization_v19_full.sql`.
  This is not a sync error; it's genuinely what's in the live migration log.

## Verified while syncing
- `get_gemini_key_status()`, `save_gemini_api_key()`, `record_gemini_key_usage()`
  all read back from live exactly as the prior session's audit claimed:
  slot is cast to `smallint`, output columns renamed to avoid ambiguity, and
  `anon` execute is revoked on all three (confirmed via
  `has_function_privilege` — anon: false, authenticated: true, service_role: true).
- Supabase security advisor: no new critical issues. The one standing item is
  **leaked-password protection is still OFF** in Auth settings (a dashboard
  toggle, not a migration) — already flagged in the original `PRODUCTION-AUDIT.md`.
- All 33 base tables have RLS enabled; `gemini_api_keys` intentionally has
  zero policies (deny-all via REST, service-role-only via backend), matching
  its own migration's documented design.

## What this sync does NOT do
- Does not touch application code, Edge Functions, or `.github/workflows`.
- Does not modify or repair `supabase/migrations_legacy_pre_v2/` — those are
  kept as-is for reference only and should not be pushed to any project.
- Does not attempt any new feature work.

## Correction to my own first read of this zip
On first pass I only found `STAFF-ACCESS-PART-1-NOTES.md` and
`STAFF-ACCESS-PART-2-NOTES.md` (a `find` command got truncated at 100
files and silently dropped the rest) and wrongly told the user "Part 3 is
still pending." That was wrong. The full 168-file listing shows the real
state, and there are **two separate, differently-scoped "Part" numbering
schemes** in this zip's docs — worth being explicit about so nothing gets
double-built or skipped:

**Scheme A — Staff Access Manager (`STAFF-ACCESS-PART-*-NOTES.md`) — all 3 parts DONE:**
- Part 1: Staff login ID/password + ON/OFF access switch.
- Part 2: No-restriction / full-day / custom-hours access window, offline-safe
  auto-logout, visibility-from-grant-time filtering.
- Part 3: Pending-sync badge, and owner-side sale Correct/Cancel with a
  configurable (default 10-day) correction window.

There's also a **`STAFF-ACCESS-PART-4-NOTES.md`** which is actually a
different feature (real cost/profit tracking for Xerox/Cybercafe and
Repair jobs, not staff access) — also DONE.

**Scheme B — general remaining-work list (`PART-1-NOTES.md` + `COPY-PASTE-HANDOFF.md`) — NOT all done:**
- "Part 1" here = staff-sync tombstone bug + dead PIN-gate + Supplier Khata
  nav-guard gap — DONE.
- "Part 2" here = Supabase leaked-password protection toggle — **still not
  done** (confirmed live via security advisor scan).
- "Part 3" here = migrating Purchases/Inventory/Returns/Warranty/Expenses UI
  to the normalized Postgres tables — **not done in the UI**, even though the
  underlying DB migrations/RPCs for several of these already exist live
  (`purchase_ui_atomic_normalized_v17`, `stock_adjust_atomic_v18`,
  `warranty_tracking_normalized_v19`, `returns_exchanges_warranty_normalization_v19_full`).
  In other words: the database scaffolding is ready, but the React screens
  still write through the older `store_state` snapshot path for these
  modules.
- "Part 4" here = Android build, Windows Tauri build with Rust, full 32-case
  E2E matrix, CI with locked dependencies — **not done** (no network/Rust
  toolchain in any sandbox so far).

If you want to pick up more work next, it's worth telling me which
numbering you mean by "Part 3" etc. — they point at very different things.

## If you deploy this fresh to a brand-new Supabase project
Running `supabase db push` against an *empty* project with the new
`supabase/migrations/` folder should now reproduce the current live schema
faithfully, since every file's content came directly from what's actually
running — not from guesswork.
