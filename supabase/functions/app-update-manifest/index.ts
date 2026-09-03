import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// STEP 12.2 — Windows silent auto-update (Master Plan Step 12.2).
//
// This is the exact URL configured in src-tauri/tauri.conf.json's
// "plugins.updater.endpoints" — the Tauri Updater plugin GETs this on its
// own (app-launch + periodic check, no in-app fetch code needed for the
// check itself, unlike Android's manual pill-driven flow in
// useAppUpdateCheck.ts). It has nothing to do with checkForAppUpdate() in
// src/services/appVersion.ts (which drives the small in-app pill for
// Android + as a Windows fallback) — this endpoint is the second,
// independent path: the one the native Rust updater plugin itself reads,
// completely outside the React app's own JS.
//
// Tauri's "dynamic JSON" updater endpoint contract (v1 schema — see
// https://v2.tauri.app/plugin/updater/#dynamic-update-server):
//   - HTTP 200 + this exact JSON shape => an update is available.
//   - HTTP 204 (No Content) => already up to date / nothing published.
// The plugin does its own semver comparison of the returned "version"
// against the running app's tauri.conf.json "version" — this is a
// DIFFERENT comparison from checkForAppUpdate()'s build_number check, so
// keep tauri.conf.json's "version" and .env.windows's VITE_APP_VERSION in
// sync with whatever "version" string is typed into the App Versions
// panel when publishing a Windows build (see .env.example's Step 12 note).
//
// Deliberately its own tiny function rather than a new route on
// r2-storage/index.ts: this one has a fixed response *shape* the Tauri
// updater plugin itself dictates (not this project's own JSON convention
// like every other endpoint here), and it's called by native Rust code,
// not this app's own fetch() calls — keeping it separate means a future
// change to r2-storage's routing can never accidentally break the one
// endpoint an already-installed Windows app is silently polling.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function noUpdate(): Response {
  // 204 with no body is the documented Tauri convention for "nothing to
  // update to right now" — NOT a 404/500, both of which the plugin would
  // (correctly) treat as a real check failure and retry/log noisily.
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Misconfigured function itself (missing auto-injected secrets) —
    // still resolve as "no update" rather than erroring the updater
    // plugin's own retry/backoff logic over something the app itself
    // can't fix.
    return noUpdate();
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Same public RPC the in-app pill already calls (get_live_app_versions
    // — granted to anon, no auth needed, see the Step 12 migration). Using
    // the service-role admin client here isn't for extra access (the RPC
    // is public either way) — it's simply this function's default client,
    // consistent with every other edge function in this project.
    const { data, error } = await admin.rpc("get_live_app_versions");
    if (error) {
      console.error("get_live_app_versions failed:", error.message);
      return noUpdate();
    }

    const row = (data || []).find((r: any) => r.platform === "windows");
    if (!row || !row.download_path) return noUpdate();

    // Windows Tauri Updater artifacts MUST be signed (this project's
    // NSIS installer is set to createUpdaterArtifacts in tauri.conf.json,
    // which produces a matching .sig alongside the .exe at build time via
    // `npx tauri signer sign` / the TAURI_SIGNING_PRIVATE_KEY* env vars —
    // see .github/workflows/build-and-release.yml's windows job and
    // STEP12-APP-UPDATE-SETUP.md). A live row with no signature can't be
    // verified by the plugin's pubkey check, so it must never be reported
    // as an available update — that would just make every device's
    // updater silently fail its signature check on every poll.
    if (!row.signature) {
      console.warn("Live windows app_versions row has no signature — skipping (see STEP12-APP-UPDATE-SETUP.md).");
      return noUpdate();
    }

    const downloadUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/r2-storage/app/${row.download_path}`;

    const body = {
      version: row.version,
      notes: row.release_notes || "",
      pub_date: row.published_at,
      platforms: {
        "windows-x86_64": {
          signature: row.signature,
          url: downloadUrl,
        },
        // NSIS/MSI installers built by this project's single Windows
        // runner target x86_64 only (see .github/workflows/build-and-release.yml's
        // windows job) — an ARM64 Windows build isn't part of this app's
        // scope. Tauri simply won't match any platform key it doesn't ask
        // for, so leaving arm64 out here is safe, not a bug.
      },
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("app-update-manifest error:", e);
    return noUpdate();
  }
});
