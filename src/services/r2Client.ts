// STEP 7.1 — Storage & Backup Architecture.
//
// Heavy files (product photos, KYC photos, box-scan images, invoice PDFs)
// now go to Cloudflare R2 instead of Supabase Storage. The browser never
// talks to R2 or holds R2 credentials directly — everything goes through
// the `r2-storage` Supabase Edge Function, which checks the caller's store
// and signs the actual request to R2 server-side. See
// supabase/functions/r2-storage/index.ts for the other half of this file,
// and STEP7.1-CLOUDFLARE-SETUP.md for the one-time Cloudflare setup needed
// before this works end-to-end.
import { supabase, SUPABASE_URL, isCloudConfigured } from "./supabaseClient";

export type R2Kind = "product" | "boxscan" | "invoice" | "kyc" | "app";

function functionBase(): string {
  return `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/r2-storage`;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Uploads a blob to R2 under `${storeId}/${filename}` for the given kind. Returns the stored path. Throws on any failure (offline, not configured, denied, etc.) — callers fall back to a data: URL, same as before Step 7.1. */
export async function r2Upload(kind: R2Kind, storeId: string, filename: string, blob: Blob, contentType: string): Promise<string> {
  if (!isCloudConfigured) throw new Error("Cloud not configured");
  const path = `${storeId}/${filename}`;
  const headers = { ...(await authHeader()), "Content-Type": contentType };
  const res = await fetch(`${functionBase()}/${kind}/${path}`, { method: "PUT", headers, body: blob });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Upload failed (${res.status})`);
  }
  return path;
}

/** Public/no-auth-required GET URL for a kind that isn't marked private (product/boxscan/invoice) — usable directly in <img src>. */
export function r2PublicUrl(kind: R2Kind, path: string): string {
  return `${functionBase()}/${kind}/${path}`;
}

/** Fetches a private (kyc) file with the caller's auth token and returns a local blob: URL for rendering. Returns null on any failure so callers can just skip rendering the image. */
export async function r2FetchPrivateAsBlobUrl(kind: R2Kind, path: string): Promise<string | null> {
  if (!isCloudConfigured) return null;
  try {
    const headers = await authHeader();
    const res = await fetch(`${functionBase()}/${kind}/${path}`, { headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export interface R2UsageSummary {
  publicBucketBytes: number;
  publicBucketCount: number;
  privateBucketBytes: number;
  privateBucketCount: number;
  totalBytes: number;
}

/** Step 7.3 — Storage Usage Meter. Owner/Manager-only totals for both R2 buckets, scoped to this store. Throws on failure (offline, not configured, R2 secrets missing, denied) — callers should show "unavailable" rather than a broken 0. */
export async function r2Usage(storeId: string): Promise<R2UsageSummary> {
  if (!isCloudConfigured) throw new Error("Cloud not configured");
  const headers = await authHeader();
  const res = await fetch(`${functionBase()}/usage/${storeId}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Usage check failed (${res.status})`);
  }
  return res.json();
}

/** Best-effort delete — never throws, matches the old Supabase Storage behaviour (an orphaned file isn't worth failing a save over). */
export async function r2Delete(kind: R2Kind, path: string): Promise<void> {
  if (!isCloudConfigured) return;
  try {
    const headers = await authHeader();
    await fetch(`${functionBase()}/${kind}/${path}`, { method: "DELETE", headers });
  } catch {
    // best-effort — ignore
  }
}
