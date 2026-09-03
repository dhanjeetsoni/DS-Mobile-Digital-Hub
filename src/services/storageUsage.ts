// Step 7.3 — Storage Usage Meter (Owner-only Status Dashboard ka hissa —
// full dashboard Step 9 mein, yeh sirf meter part hai). Combines:
//   - Supabase side: get_storage_usage_summary() RPC (text data — see
//     supabase/migrations/20260902060000_storage_usage_summary_v34.sql)
//   - Cloudflare side: r2Usage() (heavy files — see services/r2Client.ts)
// Both are Owner/Manager-only, enforced server-side (RPC + Edge Function),
// not just hidden in the UI.
import { supabase } from "./supabaseClient";
import { r2Usage } from "./r2Client";

export interface SupabaseUsage {
  totalBytes: number;
  storeStateBytes: number;
  otherTablesBytes: number;
  tableCount: number;
}

export interface CloudflareUsage {
  totalBytes: number;
  publicBucketBytes: number;
  publicBucketCount: number;
  privateBucketBytes: number;
  privateBucketCount: number;
}

export interface StorageUsageResult {
  supabase: SupabaseUsage | null;
  supabaseError: string | null;
  cloudflare: CloudflareUsage | null;
  cloudflareError: string | null;
}

export async function getSupabaseUsage(): Promise<SupabaseUsage> {
  const { data, error } = await supabase.rpc("get_storage_usage_summary");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("No usage data returned.");
  return {
    totalBytes: Number(row.total_bytes) || 0,
    storeStateBytes: Number(row.store_state_bytes) || 0,
    otherTablesBytes: Number(row.other_tables_bytes) || 0,
    tableCount: Number(row.table_count) || 0,
  };
}

export async function getCloudflareUsage(storeId: string): Promise<CloudflareUsage> {
  const r = await r2Usage(storeId);
  return {
    totalBytes: r.totalBytes,
    publicBucketBytes: r.publicBucketBytes,
    publicBucketCount: r.publicBucketCount,
    privateBucketBytes: r.privateBucketBytes,
    privateBucketCount: r.privateBucketCount,
  };
}

/** Fetches both sides in parallel. Each side fails independently — a Cloudflare
 * secrets-not-set error (common until Step 7.1's manual setup is done) never
 * blocks the Supabase number from showing, and vice versa. */
export async function getStorageUsage(storeId: string): Promise<StorageUsageResult> {
  const [supabaseSettled, cloudflareSettled] = await Promise.allSettled([
    getSupabaseUsage(),
    getCloudflareUsage(storeId),
  ]);

  return {
    supabase: supabaseSettled.status === "fulfilled" ? supabaseSettled.value : null,
    supabaseError: supabaseSettled.status === "rejected" ? errMsg(supabaseSettled.reason) : null,
    cloudflare: cloudflareSettled.status === "fulfilled" ? cloudflareSettled.value : null,
    cloudflareError: cloudflareSettled.status === "rejected" ? errMsg(cloudflareSettled.reason) : null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Formats a byte count as a human-readable string (KB/MB/GB), Indian-reader-friendly (no locale weirdness). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

/** Usage level for warning/critical colouring, matching plan 7.3's "Warning (amber) / Critical (red)" wording. */
export type UsageLevel = "ok" | "warning" | "critical";
export function usageLevel(usedBytes: number, limitBytes: number): UsageLevel {
  if (!limitBytes || limitBytes <= 0) return "ok";
  const pct = usedBytes / limitBytes;
  if (pct >= 0.9) return "critical";
  if (pct >= 0.7) return "warning";
  return "ok";
}
