-- Phase 16 (2026-09-17): Phase 9 only locked down a hand-written subset. A live
-- advisor scan on 2026-09-17 still found 30 SECURITY DEFINER functions in
-- `public` callable by the `anon` role (i.e. by anyone holding the publishable
-- key, with no login at all) -- including save_store_state_for_user,
-- load_store_state_for_user, upsert_product_catalog, set_product_photos,
-- reserve_invoice_number, publish_app_version, set_app_version_live and
-- admin_force_logout_profile.
--
-- Doing this by hand is what left the gap last time, so this is done as a sweep
-- over pg_proc instead of a fixed list, and REVOKEs from PUBLIC (not just anon) --
-- Postgres grants EXECUTE to PUBLIC by default, which anon inherits, so
-- "REVOKE ... FROM anon" alone is a no-op. That lesson is already recorded in
-- this project's Phase 9 notes.
--
-- Deliberate exception: get_live_app_versions() stays anon-callable. The OTA
-- update check (Step 12.1) runs "app khulte hi", before any login resolves --
-- confirmed by the doc comment on getLiveAppVersions() in src/services/appVersion.ts.
--
-- Verified live after applying: anon-callable SECURITY DEFINER functions went
-- 30 -> 1 (only the intentional one), no function lost `authenticated` execute
-- that had it before, has_function_privilege('supabase_auth_admin',
-- 'public.handle_new_user()','EXECUTE') is still true (signup intact), and the
-- security advisor's `function_search_path_mutable` finding cleared.
do $$
declare
  r record;
  v_allow_anon text[] := array['get_live_app_versions'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not (p.proname = any(v_allow_anon))
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);

    -- handle_new_user() fires from the on_auth_user_created trigger on
    -- auth.users, whose INSERT is performed by supabase_auth_admin -- not
    -- authenticated/service_role. Revoking PUBLIC without this grant silently
    -- breaks every new signup (this exact regression was caught once before in
    -- Phase 9 and must not be reintroduced).
    if r.proname = 'handle_new_user' then
      execute format('grant execute on function %s to supabase_auth_admin', r.sig);
    end if;
  end loop;
end
$$;

-- Unrelated but caught in the same live scan: detect_ai_provider() (Phase 11)
-- still had a mutable search_path, flagged WARN by the linter. Signature is
-- (text, text), not (text) -- confirmed against pg_proc before writing this.
alter function public.detect_ai_provider(text, text) set search_path to 'public';
