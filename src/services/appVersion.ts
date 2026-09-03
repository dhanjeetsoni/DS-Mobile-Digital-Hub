// STEP 12 — App Update & OTA Push System (Windows + Staff Android + Owner
// Android). See DS_Mobile_Master_Plan.md Step 12 and
// STEP12-APP-UPDATE-SETUP.md for the full picture.
//
// One shared JS bundle ships inside 3 different native shells (see
// package.json's android:staff:build / android:owner:build / tauri:build
// scripts and src-tauri/tauri.*.conf.json) — so at runtime the bundle has
// to figure out *which* of the 3 it's currently running as before it can
// know which "live" row in app_versions applies to it. There's no Tauri JS
// API in this project yet (see supabaseClient.ts-style env-var pattern),
// so platform + the installed version/build are both injected the same
// way Supabase's URL/key already are: Vite env vars set per build target.
import { supabase } from "./supabaseClient";
import { r2Upload, r2PublicUrl } from "./r2Client";

export const APP_PLATFORMS = ["windows", "staff-android", "owner-android"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

const env = (import.meta as any).env || {};

/**
 * Which of the 3 shells this running bundle is. Resolution order:
 *   1. VITE_APP_PLATFORM — set explicitly per build (see package.json
 *      scripts + .env.example). This is the reliable source once the
 *      build scripts below are used.
 *   2. Fallback heuristic for builds that haven't been updated yet: any
 *      Android WebView reports "Android" in the user agent — treat that as
 *      staff-android (the more common of the two installs) rather than
 *      silently skipping the update check. Anything else falls back to
 *      "windows" (desktop Tauri shell / dev-server preview).
 * A wrong guess here only affects which row of app_versions gets compared
 * against — it can never crash the app, it just means a stale/absent
 * "Update Available" pill until the real build sets VITE_APP_PLATFORM.
 */
export function detectRunningPlatform(): AppPlatform {
  const fromEnv = String(env.VITE_APP_PLATFORM || "").trim();
  if ((APP_PLATFORMS as readonly string[]).includes(fromEnv)) return fromEnv as AppPlatform;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (/Android/i.test(ua)) return "staff-android";
  return "windows";
}

/** Installed version/build of *this* running bundle — also build-time injected (see .env.example). Defaults match src-tauri/tauri.conf.json's starting "1.0.0" / build 1 so a build that forgets to set these still behaves (just never shows a false "update available"). */
export function getInstalledVersion(): { version: string; buildNumber: number } {
  const version = String(env.VITE_APP_VERSION || "1.0.0").trim() || "1.0.0";
  const buildNumber = Number(env.VITE_APP_BUILD || 1) || 1;
  return { version, buildNumber };
}

export interface LiveAppVersion {
  platform: AppPlatform;
  version: string;
  buildNumber: number;
  downloadPath: string;
  signature: string | null;
  releaseNotes: string | null;
  publishedAt: string;
}

/** Public — no login required (Step 12.1: check happens "app khulte hi", which can be before any login screen resolves). Returns the current live row for every platform that has one published yet. */
export async function getLiveAppVersions(): Promise<LiveAppVersion[]> {
  const { data, error } = await supabase.rpc("get_live_app_versions");
  if (error) throw error;
  return (data || []).map((row: any) => ({
    platform: row.platform,
    version: row.version,
    buildNumber: Number(row.build_number) || 0,
    downloadPath: row.download_path,
    signature: row.signature ?? null,
    releaseNotes: row.release_notes ?? null,
    publishedAt: row.published_at,
  }));
}

export interface AppUpdateInfo extends LiveAppVersion {
  downloadUrl: string;
  installedVersion: string;
}

/**
 * The actual check this app's device runs on load + periodically (see
 * hooks/useAppUpdateCheck.ts). Compares by buildNumber (a plain increasing
 * integer), not the version string — a version string like "1.2.0" is only
 * for display, semver-comparing strings correctly is a whole extra problem
 * this project doesn't need since the Owner controls both numbers anyway.
 * Returns null when already up to date, cloud isn't configured, or nothing
 * has ever been published for this platform yet.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  const platform = detectRunningPlatform();
  const installed = getInstalledVersion();
  let rows: LiveAppVersion[];
  try {
    rows = await getLiveAppVersions();
  } catch {
    return null; // offline / cloud not configured — never block the app on this
  }
  const live = rows.find((r) => r.platform === platform);
  if (!live || live.buildNumber <= installed.buildNumber) return null;
  return {
    ...live,
    downloadUrl: r2PublicUrl("app", live.downloadPath),
    installedVersion: installed.version,
  };
}

// ---------------------------------------------------------------------
// Owner-only — the "App Versions" Panel (Step 12.3).
// ---------------------------------------------------------------------

export interface AppVersionRow {
  id: string;
  platform: AppPlatform;
  version: string;
  buildNumber: number;
  downloadPath: string;
  releaseNotes: string | null;
  isLive: boolean;
  createdAt: string;
}

export async function listAppVersions(): Promise<AppVersionRow[]> {
  const { data, error } = await supabase.rpc("list_app_versions");
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    platform: row.platform,
    version: row.version,
    buildNumber: Number(row.build_number) || 0,
    downloadPath: row.download_path,
    releaseNotes: row.release_notes ?? null,
    isLive: Boolean(row.is_live),
    createdAt: row.created_at,
  }));
}

/** Uploads the installer/APK to Cloudflare R2 (kind="app") and creates a new (not-yet-live) app_versions row for it. Owner still has to call setAppVersionLive separately — a fresh upload never auto-goes-live, so a bad build can be uploaded and reviewed/tested before anyone's device sees it. */
export async function publishAppVersion(opts: {
  storeId: string;
  platform: AppPlatform;
  version: string;
  buildNumber: number;
  file: Blob;
  filename: string;
  contentType: string;
  signature?: string;
  releaseNotes?: string;
}): Promise<string> {
  const path = await r2Upload("app", opts.storeId, opts.filename, opts.file, opts.contentType);
  const { data, error } = await supabase.rpc("publish_app_version", {
    p_platform: opts.platform,
    p_version: opts.version,
    p_build_number: opts.buildNumber,
    p_download_path: path,
    p_signature: opts.signature || null,
    p_release_notes: opts.releaseNotes || null,
  });
  if (error) throw error;
  return data as string;
}

/** Marks an existing (already-uploaded) row live for its platform — this is the actual "push" moment every device's next check will see, and also doubles as an instant rollback (pick an older row to re-publish it). */
export async function setAppVersionLive(id: string): Promise<void> {
  const { error } = await supabase.rpc("set_app_version_live", { p_id: id });
  if (error) throw error;
}

export const PLATFORM_LABELS: Record<AppPlatform, string> = {
  windows: "Windows App",
  "staff-android": "Staff Android App",
  "owner-android": "Owner Android App",
};
