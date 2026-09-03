// Staff Access Management (Part 1): owner creates a staff login ID +
// password, can flip access on/off any time, and staff sign in on the
// Android/desktop app using just that ID + password (no email needed).
//
// Account creation / password reset / delete need the Supabase service-role
// key, so those three go through the `staff-manage` edge function. Everyday
// reads/toggles (list staff, turn access on/off) go straight to `profiles`
// under RLS — no function round-trip needed.

import { supabase, isCloudConfigured } from "./supabaseClient";

export interface StaffProfile {
  id: string;
  staff_login_id: string | null;
  staff_name: string | null;
  access_enabled: boolean;
  access_mode: "no_restriction" | "full_day" | "timed";
  access_expires_at: string | null;
  access_granted_at: string | null;
  visibility_from: string | null;
  /** Step 1.7: when this staff login was created — shown in the Owner's Live Access Control table. */
  created_at: string | null;
  /** Step 1.7: stamped by touch_staff_last_active() on every staff sign-in. Null = never logged in yet. */
  last_active_at: string | null;
  /** Step 3.5: stamped by touch_staff_offline_download() when staff completes a Download Area sync. Null = never downloaded. */
  last_offline_download_at: string | null;
}

const STAFF_EMAIL_DOMAIN = "staff.dsmdh.internal";
const loginIdToEmail = (loginId: string) => `${loginId.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;

// Step 1.2 / 1.6: Owner never types a Staff ID or password by hand anymore —
// the system generates both, randomly, so nothing sequential/guessable
// (STAFF-1, STAFF-2...) or lazily-typed (staffname123) ever gets created.
// Characters that look alike (0/O, 1/I/l) are left out so a hand-copied or
// verbally-read ID/password doesn't get miskeyed by the staff member.
const UNAMBIGUOUS_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LOWER_CHARS = "abcdefghjkmnpqrstuvwxyz";

function secureRandomChar(charset: string): string {
  const arr = new Uint32Array(1);
  (window.crypto || (globalThis as any).crypto).getRandomValues(arr);
  return charset[arr[0] % charset.length];
}

function secureRandomString(charset: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += secureRandomChar(charset);
  return out;
}

/** Generates a random, unguessable Staff ID like "STAFF-7Q2K". Never sequential. */
export function generateStaffLoginId(): string {
  return `STAFF-${secureRandomString(UNAMBIGUOUS_CHARS, 4)}`;
}

/**
 * Generates a random 10-character temporary password: mix of upper, lower
 * and digits, guaranteed to contain at least one of each so it never looks
 * like a lazy/simple pattern. Two calls in a row will never look similar —
 * every character is independently drawn.
 */
export function generateStaffPassword(): string {
  const upper = secureRandomChar(UNAMBIGUOUS_CHARS);
  const lower = secureRandomChar(LOWER_CHARS);
  const digit = secureRandomChar("23456789");
  const rest = secureRandomString(UNAMBIGUOUS_CHARS + LOWER_CHARS + "23456789", 7);
  // Shuffle so the guaranteed chars aren't always in the same position.
  const chars = (upper + lower + digit + rest).split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor((secureRandomChar("0123456789").charCodeAt(0) - 48) / 10 * (i + 1));
    [chars[i], chars[Math.min(j, i)]] = [chars[Math.min(j, i)], chars[i]];
  }
  return chars.join("");
}

async function callStaffManage(action: string, payload: Record<string, unknown> = {}) {
  if (!isCloudConfigured) {
    throw new Error("Staff accounts need cloud sync to be set up first (Cloud & Security \u2192 sign in). Ye feature offline-only mode mein kaam nahi karta.");
  }
  const { data, error } = await supabase.functions.invoke("staff-manage", { body: { action, ...payload } });
  if (error) throw new Error((data as any)?.error || error.message || "Staff action failed.");
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Owner: create a new staff login (ID + password). Returns the created staff row info. */
export async function createStaffAccount(opts: { staffName: string; loginId: string; password: string }) {
  return callStaffManage("create", opts);
}

/** Owner: change a staff member's password without knowing the old one. */
export async function resetStaffPassword(staffId: string, password: string) {
  return callStaffManage("reset_password", { staffId, password });
}

/** Owner: permanently remove a staff login. */
export async function deleteStaffAccount(staffId: string) {
  return callStaffManage("delete", { staffId });
}

/** Owner: list every staff account in this shop. */
export async function listStaffAccounts(storeId: string): Promise<StaffProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,staff_login_id,staff_name,access_enabled,access_mode,access_expires_at,access_granted_at,visibility_from,created_at,last_active_at,last_offline_download_at")
    .eq("store_id", storeId)
    .eq("role", "staff")
    .order("staff_name", { ascending: true });
  if (error) throw error;
  return (data || []) as StaffProfile[];
}

/** Owner: turn a staff member's access OFF. Immediate — they're logged out and blocked on next check. */
export async function revokeStaffAccess(staffId: string) {
  const { error } = await supabase.from("profiles").update({ access_enabled: false }).eq("id", staffId).eq("role", "staff");
  if (error) throw error;
}

/**
 * Owner: grant/restart a staff member's access window (Part 2). This is the
 * one action that both turns access ON and decides *how much* access they
 * get:
 *   - "no_restriction": no time limit at all, valid until the owner turns it
 *     off again.
 *   - "full_day": expires at the end of today (owner's local clock at the
 *     moment of granting).
 *   - "timed": expires `hours`/`minutes` from now.
 * Every grant also resets `visibility_from` to "now", so the staff member's
 * app only ever shows sales/galla recorded from this grant onward — never
 * whatever happened before, even on a previous access window.
 */
export async function grantStaffAccess(
  staffId: string,
  opts: { mode: "no_restriction" | "full_day" | "timed"; hours?: number; minutes?: number }
) {
  const now = new Date();
  let expiresAt: string | null = null;
  if (opts.mode === "full_day") {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    expiresAt = endOfDay.toISOString();
  } else if (opts.mode === "timed") {
    const ms = ((opts.hours || 0) * 60 + (opts.minutes || 0)) * 60 * 1000;
    if (ms <= 0) throw new Error("Kam se kam 1 minute ka time do.");
    expiresAt = new Date(now.getTime() + ms).toISOString();
  }
  const { error } = await supabase
    .from("profiles")
    .update({
      access_enabled: true,
      access_mode: opts.mode,
      access_expires_at: expiresAt,
      access_granted_at: now.toISOString(),
      visibility_from: now.toISOString(),
    })
    .eq("id", staffId)
    .eq("role", "staff");
  if (error) throw error;
}

/** True once `access_expires_at` has passed. Pure client-clock check — works fully offline. */
/** Step 3.5: best-effort stamp of "last downloaded for offline" for the Owner's Staff Access table. Never throws. */
export async function touchStaffOfflineDownload() {
  await supabase.rpc("touch_staff_offline_download").then(() => {}, () => {});
}

export function isAccessWindowExpired(profile: Pick<StaffProfile, "access_mode" | "access_expires_at">): boolean {
  if (profile.access_mode === "no_restriction") return false;
  if (!profile.access_expires_at) return false;
  return new Date(profile.access_expires_at).getTime() <= Date.now();
}

const STAFF_SESSION_CACHE_KEY = "dsmdh_staff_session_v2";

export interface CachedStaffSession {
  staffId: string;
  staffName: string | null;
  accessMode: StaffProfile["access_mode"];
  accessExpiresAt: string | null;
  visibilityFrom: string | null;
}

/**
 * Cache the bits needed to enforce the access window while fully offline
 * (no server round-trip = no way to re-check `access_enabled`/expiry, so we
 * trust the last value we saw and compare against the device's own clock).
 */
export function cacheStaffSession(session: CachedStaffSession) {
  try {
    localStorage.setItem(STAFF_SESSION_CACHE_KEY, JSON.stringify(session));
  } catch {}
}

export function readCachedStaffSession(): CachedStaffSession | null {
  try {
    const raw = localStorage.getItem(STAFF_SESSION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedStaffSession) : null;
  } catch {
    return null;
  }
}

export function clearCachedStaffSession() {
  try {
    localStorage.removeItem(STAFF_SESSION_CACHE_KEY);
  } catch {}
}

export type StaffSignInResult =
  | { status: "ok"; profile: any }
  | { status: "disabled" }
  | { status: "expired" }
  | { status: "error"; message: string };

/** Staff: sign in with the owner-issued Login ID + password. */
export async function staffSignIn(loginId: string, password: string): Promise<StaffSignInResult> {
  if (!isCloudConfigured) {
    return { status: "error", message: "Cloud sync is not set up on this device yet — ask the owner to configure it." };
  }
  const email = loginIdToEmail(loginId);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { status: "error", message: "Galat Login ID ya Password." };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,full_name,store_id,role,staff_login_id,staff_name,access_enabled,access_mode,access_expires_at,access_granted_at,visibility_from")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "staff") {
    await supabase.auth.signOut();
    return { status: "error", message: "Ye account staff account nahi hai." };
  }
  if (!profile.access_enabled) {
    await supabase.auth.signOut();
    return { status: "disabled" };
  }
  if (isAccessWindowExpired(profile)) {
    await supabase.auth.signOut();
    return { status: "expired" };
  }
  // Step 1.7: stamp "Last active" for the Owner's Live Access Control table.
  // Best-effort — never block/fail the actual sign-in over this.
  supabase.rpc("touch_staff_last_active").then(() => {}, () => {});
  cacheStaffSession({
    staffId: profile.id,
    staffName: profile.staff_name,
    accessMode: profile.access_mode,
    accessExpiresAt: profile.access_expires_at,
    visibilityFrom: profile.visibility_from,
  });
  return { status: "ok", profile };
}
