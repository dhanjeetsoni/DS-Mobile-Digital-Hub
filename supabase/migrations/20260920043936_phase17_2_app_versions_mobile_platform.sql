-- Phase 17.2 (DS Mobile Unified App, PROJECT_PLAN.md): retiring the
-- dedicated "Staff Android"/"Owner Android" APKs in favour of the single
-- "mobile-android" (DS Mobile) build. No app_versions rows exist yet for
-- any platform (verified live before this was written), so this is a pure
-- schema change, not a data migration.
--
-- Without this, publish_app_version()/the app_versions CHECK constraint
-- would reject 'mobile-android' outright -- the Owner's App Versions panel
-- could never publish an update for the one Android build that now
-- actually ships (see build-and-release.yml's CI matrix).
--
-- Applied directly to production via the Supabase MCP on 2026-09-20;
-- this file mirrors that change so the repo and live schema stay in sync
-- (see PROJECT_PLAN.md's "Repo <-> production migration drift" item).
alter table public.app_versions drop constraint app_versions_platform_check;
alter table public.app_versions add constraint app_versions_platform_check
  check (platform in ('windows', 'mobile-android'));
