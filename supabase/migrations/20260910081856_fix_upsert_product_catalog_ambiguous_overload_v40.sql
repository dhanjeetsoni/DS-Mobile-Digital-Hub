-- CRITICAL FIX (2026-09-09/10): upsert_product_catalog had TWO live overloads
-- (26-param original, and a 28/29-param version adding p_photos/
-- p_specifications/p_feature_highlights created via CREATE OR REPLACE with
-- a different signature — which registers a NEW overload in Postgres, not
-- a true replace, same exact recurring mistake already documented once
-- before in this codebase for a stock_qty parameter addition, and fixed
-- once already in phase6_drop_old_upsert_product_catalog_overload — only
-- to have the drifted phase7_persist_ai_specs_and_feature_highlights
-- migration re-introduce it by adding two more parameters the same way).
--
-- Empirically verified (not assumed) this was actively broken: calling it
-- with exactly the parameter set the JS client (repository.ts's
-- upsertProductCatalog()) actually sends threw
-- "function upsert_product_catalog(...) is not unique / Could not choose a
-- best candidate function" (Postgres error 42725) — a HARD FAILURE, not a
-- silent no-op. Since every Add/Edit Product save calls this exact same
-- function (and the offline-queue retry path calls the identical function
-- with the identical arguments), this meant EVERY product catalog write
-- since the second overload was created had failed and been stuck retrying
-- forever in the offline queue (a permanent failure, not a transient one --
-- retrying an ambiguous call never resolves it). Confirmed via
-- information_schema/pg_proc that only the OLD 26-param overload lacks
-- specifications/feature_highlights, and the JS client never sent those two
-- fields (nor photos) anyway before this fix, so dropping the old one and
-- keeping the new one is a strict superset -- no functionality lost, only
-- regained. Live-checked afterwards: only one overload remains, and a test
-- call (with the exact argument set the client sends) resolves cleanly to
-- the normal RLS "not authorized" (expected outside an authenticated
-- session) instead of the ambiguity error.

drop function if exists public.upsert_product_catalog(
  p_store_id uuid, p_local_id text, p_sku text, p_name text, p_brand text,
  p_category text, p_barcode text, p_photo text, p_cost_price numeric,
  p_confidential_price numeric, p_selling_price numeric, p_mrp numeric,
  p_pending_cost boolean, p_min_stock numeric, p_warranty_enabled boolean,
  p_warranty_months integer, p_require_customer_details boolean,
  p_supplier text, p_notes text, p_compatible_models jsonb,
  p_screen_size_inches numeric, p_screen_size_max_inches numeric,
  p_is_mobile_phone boolean, p_is_spare_part boolean, p_stock_qty numeric,
  p_photos jsonb
);
