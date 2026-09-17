# Repo ↔ Production sync status — 2026-09-17

Measured by comparing this repo against the live Supabase project
`vjimgnmbgghtsfafamye` directly (`supabase_migrations.schema_migrations`,
`pg_proc`, the deployed Edge Function list), not from any plan document.

## What was fixed in this pass

**Duplicate migration files removed from the active folder (4).**
These were byte-identical copies of a migration already present under its real
applied timestamp — a `supabase db push` would have tried to apply each one a
second time as a brand-new migration. Verified identical with `diff` before
moving; moved to `supabase/migrations_legacy_pre_v2/` rather than deleted.

- `20260901130000_offline_download_stamp_v32.sql`
- `20260902060000_storage_usage_summary_v34.sql`
- `20260902060500_storage_usage_summary_revoke_anon_v35.sql`
- `20260905000000_android_access_area_manager_role_v37.sql`

**Migration files renamed to their real applied version (10).**
These existed only under a made-up round-number timestamp (`...070000`,
`...130000`) while live had applied them at a different version, so the CLI
treated them as unapplied. Renamed to match live exactly:

| was | now |
|---|---|
| `20260901120000_screen_size_cache_v31` | `20260901053022_…` |
| `20260906130000_phase1_products_staff_view_v38` | `20260906100730_…` |
| `20260906140000_phase1_products_staff_view_selling_price_v39` | `20260906101706_…` |
| `20260906150000_close_drift_ai_digest_schema` | `20260907044656_…` |
| `20260906160000_phase5_audit_log` | `20260907044848_…` |
| `20260907070000_phase5_weekly_report_security_hardening` | `20260907060947_…` |
| `20260907070000_phase5_weekly_daily_reports_relational_and_digest_toggle` | `20260907064712_…` |
| `20260907090000_sync_drift_low_stock_telegram_alert` | `20260908035129_…` |
| `20260907130000_phase6_grant_force_logout_at_select` | `20260909055537_…` |
| `20260913120000_multi_provider_ai_keys_v41` | `20260915063918_…` |

Repo-only migration versions went from **19 → 5**.

## Still open — deliberately not guessed at

### 5 repo files that duplicate a live migration but are NOT identical

Each of these has a sibling in the repo under the real applied timestamp, but
the two files differ. One of the pair is a stale/partial reconstruction from an
earlier session, but **which one** can't be decided from the file contents
alone, and deleting the wrong one loses history. Left in place for the owner
to call:

| name | files | diff |
|---|---|---|
| `app_versions_step12` | `20260903062204` vs `20260903120000` | 39 lines |
| `fix_product_sale_reconciliation` | `20260904101823` vs `20260904103000` | 2 lines |
| `cleanup_orphaned_null_sku_products` | `20260905070751` vs `20260905070000` | 11 lines |
| `sale_items_product_store_id_guard` | `20260906074217` vs `20260906120000` | 4 lines |
| `phase2_per_person_pin_lock` | `20260906075058` vs `20260906130000` | 76 lines |

In every case the **live database is the source of truth** — whatever is
actually running was applied under the live timestamp. The round-number file is
almost certainly the reconstruction, but confirm per-file before removing.

### 28 migrations applied live with no file in this repo

Nothing is at risk here — Supabase keeps the full SQL of every applied
migration in `supabase_migrations.schema_migrations.statements`, so these are
recoverable at any time. They are missing as *files*, which matters for
rebuilding the project from scratch, not for the running system.

The correct way to close this is the CLI's own repair flow, run from a machine
with the project linked (it writes the files directly, with no risk of a
hand-transcription error):

```bash
npx supabase link --project-ref vjimgnmbgghtsfafamye
npx supabase db pull            # writes the live schema back as migration files
npx supabase migration list     # local vs remote, side by side — should show no gaps
```

The missing ones are, in applied order:
`per_person_pin_system`, `sales_staff_select_policy`,
`fix_weekly_report_relational`,
`phase5_reports_relational_and_digest_toggle_replay_test`,
`phase6_advanced_features_20260907160000`,
`phase6_return_approval_wiring_fix_20260907163000`,
`phase5_instant_low_stock_telegram_alert`, `phase5_crash_reports`,
`phase6_multi_photo_upsert`, `phase6_drop_old_upsert_product_catalog_overload`,
`phase6_revoke_anon_upsert_product_catalog`,
`phase6_staff_performance_rpc_git_sync`, `staff_sales_performance_git_sync`,
`phase6_staff_performance_rpc`, `phase6_price_history_and_force_logout`,
`return_approval_and_staff_access_policy_git_sync`,
`phase6_staff_access_window_and_sections`,
`phase7_staff_view_sync_photos_specs_highlights`,
`phase8_typo_tolerant_screen_size_search`,
`phase8_fuzzy_screen_size_cache_lookup`,
`phase8_cleanup_redundant_fuzzy_fn_and_document_search_screen_size_cache`,
`phase9_lock_down_anon_execute_on_sensitive_functions`,
`phase9_lock_down_public_execute_properly`,
`phase9_fix_auth_admin_trigger_grant`, `phase10_category_quote_cache`,
`phase8_restore_find_similar_screen_size_cache`,
`phase11_lock_down_detect_ai_provider_from_anon`,
`phase11_revoke_detect_ai_provider_from_anon_directly`.

## Edge Functions: 14 deployed live, 12 in this repo

Both extras were checked by reading their actual deployed source, not by name:

- **`debug-gemini-probe`** (v7) — already retired. Its entire body is
  `Deno.serve(() => Response.json({ error: "retired debug probe" }, { status: 410 }))`.
  No secrets, no behaviour, no risk. Safe to delete from the project whenever
  convenient; deliberately not deleted here, since removing a live resource
  isn't a call to make without the owner.
- **`ai-product-search`** (v1) — **orphaned/superseded.** It is a complete,
  working AI search endpoint with the full key-pool/failover pattern, but
  nothing calls it: the client's `src/services/aiSearch.ts` points at
  `ai-search-match` (which *is* in this repo). It was deliberately **not**
  copied into the repo, because committing a second, dead copy of the AI search
  endpoint alongside the live one is how the duplicate-overload class of bug in
  this project keeps happening. Recommend deleting it from the project; if it's
  ever wanted back, the source is retrievable from the deployment.

Same pattern as the orphaned `category_quotes` table recorded in
`PROJECT_PLAN.md` Phase 16 — three separate cases now of something being built
and shipped live, then superseded and left behind. Worth a habit of removing
the old path in the same change that replaces it.
