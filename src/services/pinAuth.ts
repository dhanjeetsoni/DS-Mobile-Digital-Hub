// Phase 2: per-person 4-digit PIN lock.
//
// Every signed-in profile (owner, manager, or staff) gets their OWN PIN,
// instead of the old single shared "Owner Device PIN"
// (db.settings.ownerPasscode). The PIN must keep working fully OFFLINE for
// everyday unlock — that's the entire point of it (a fast local lock on top
// of an already long-lived Supabase session) — so verification never makes
// a network call.
//
// How it works:
//   - profiles.pin_hash / profiles.pin_salt are the durable, cross-device
//     source of truth (set via the set_my_pin / admin_reset_pin RPCs).
//   - After a real login on a device, we fetch this profile's own
//     pin_hash/pin_salt once (already allowed by the existing
//     "id = auth.uid()" self-select RLS policy) and cache them locally,
//     keyed by profile id.
//   - Every PIN check from then on is a local SHA-256(salt + pin) compare —
//     no server round trip, works offline, and the raw PIN is never sent
//     over the network, not even when first setting it.

import { supabase } from "./supabaseClient";

const CACHE_PREFIX = "dsmdh_pin_v1_";

export interface CachedPin {
  hash: string;
  salt: string;
}

function cacheKey(profileId: string) {
  return `${CACHE_PREFIX}${profileId}`;
}

export function readCachedPin(profileId: string): CachedPin | null {
  try {
    const raw = localStorage.getItem(cacheKey(profileId));
    return raw ? (JSON.parse(raw) as CachedPin) : null;
  } catch {
    return null;
  }
}

function writeCachedPin(profileId: string, pin: CachedPin | null) {
  try {
    if (pin) localStorage.setItem(cacheKey(profileId), JSON.stringify(pin));
    else localStorage.removeItem(cacheKey(profileId));
  } catch {
    // best-effort — a failed cache write just means the next unlock falls
    // back to "no PIN configured" until the next successful sync
  }
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Call once after a successful login to pull this profile's PIN (if any) down to this device. */
export async function syncPinFromServer(profileId: string): Promise<CachedPin | null> {
  try {
    const { data, error } = await supabase.from("profiles").select("pin_hash,pin_salt").eq("id", profileId).maybeSingle();
    if (error || !data) return readCachedPin(profileId);
    if (data.pin_hash && data.pin_salt) {
      const pin: CachedPin = { hash: data.pin_hash, salt: data.pin_salt };
      writeCachedPin(profileId, pin);
      return pin;
    }
    // Server has no PIN for this profile (never set, or an owner/manager
    // just cleared it) — reflect that locally too.
    writeCachedPin(profileId, null);
    return null;
  } catch {
    // Offline right after login (rare) — fall back to whatever was cached
    // from a previous session on this device, if any.
    return readCachedPin(profileId);
  }
}

/** Pure local check — no network call, works offline. */
export async function verifyPin(profileId: string, enteredPin: string): Promise<boolean> {
  const cached = readCachedPin(profileId);
  if (!cached) return false;
  const hash = await sha256Hex(cached.salt + enteredPin);
  return hash === cached.hash;
}

export function hasPinConfigured(profileId: string): boolean {
  return !!readCachedPin(profileId);
}

/** Self-service: set or change your own PIN. Requires the current PIN if one is already set. */
export async function setMyPin(profileId: string, newPin: string, currentPin?: string): Promise<{ ok: boolean; message: string }> {
  if (!/^\d{4}$/.test(newPin)) return { ok: false, message: "PIN exactly 4 digits ka hona chahiye." };
  const existing = readCachedPin(profileId);
  let oldHash: string | undefined;
  if (existing) {
    if (!currentPin) return { ok: false, message: "Pehle apna current PIN daalein." };
    oldHash = await sha256Hex(existing.salt + currentPin);
    if (oldHash !== existing.hash) return { ok: false, message: "Current PIN galat hai." };
  }
  const newSalt = randomSalt();
  const newHash = await sha256Hex(newSalt + newPin);
  try {
    const { error } = await supabase.rpc("set_my_pin", { p_new_hash: newHash, p_new_salt: newSalt, p_old_hash: oldHash ?? null });
    if (error) return { ok: false, message: error.message || "PIN save nahi ho paya." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "PIN save nahi ho paya." };
  }
  writeCachedPin(profileId, { hash: newHash, salt: newSalt });
  return { ok: true, message: "" };
}

/** Owner/manager: force-set a staff or manager's PIN without knowing the old one. */
export async function adminResetPin(targetProfileId: string, newPin: string): Promise<{ ok: boolean; message: string }> {
  if (!/^\d{4}$/.test(newPin)) return { ok: false, message: "PIN exactly 4 digits ka hona chahiye." };
  const newSalt = randomSalt();
  const newHash = await sha256Hex(newSalt + newPin);
  try {
    const { error } = await supabase.rpc("admin_reset_pin", { p_target_id: targetProfileId, p_new_hash: newHash, p_new_salt: newSalt });
    if (error) return { ok: false, message: error.message || "PIN reset nahi ho paya." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "PIN reset nahi ho paya." };
  }
  // Only affects the cache if we happen to be resetting our own device's
  // view of that profile (rare) — the target device picks it up on its own
  // next syncPinFromServer() call (right after their next real login, or
  // the next periodic sync — see App.tsx wiring).
  return { ok: true, message: "" };
}

/** Owner/manager: remove a staff or manager's PIN entirely (they'll be prompted to set a new one). */
export async function adminClearPin(targetProfileId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { error } = await supabase.rpc("admin_clear_pin", { p_target_id: targetProfileId });
    if (error) return { ok: false, message: error.message || "PIN clear nahi ho paya." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "PIN clear nahi ho paya." };
  }
  return { ok: true, message: "" };
}

// Phase 6: Biometric (fingerprint/Face) unlock, layered ON TOP of the PIN
// above — never a replacement for it. Deliberately per-profile AND
// per-device (plain localStorage, never synced to the server): a
// fingerprint enrolled in one phone's sensor has no meaning on a second
// device, so "is biometric on" can only ever be a local, this-device fact,
// same as how the PIN cache itself is per-device (see readCachedPin
// above). Enabling it does not replace/remove the PIN — verifyPin() above
// still works exactly as before; this is purely an alternate, faster
// unlock path that a successful native OS biometric prompt substitutes
// for typing the PIN, never a way to unlock without ever having set one.
const BIOMETRIC_PREF_PREFIX = "dsmdh_biometric_enabled_v1_";

function biometricPrefKey(profileId: string) {
  return `${BIOMETRIC_PREF_PREFIX}${profileId}`;
}

export function isBiometricEnabled(profileId: string): boolean {
  try {
    return localStorage.getItem(biometricPrefKey(profileId)) === "1";
  } catch {
    return false;
  }
}

/** Turns biometric unlock on/off for this profile, on THIS device only. Caller is responsible for
 *  only turning it on after confirming (a) a PIN is already configured and (b) the device's own
 *  checkStatus() reports isAvailable — this function itself does neither check, it's just storage. */
export function setBiometricEnabled(profileId: string, enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(biometricPrefKey(profileId), "1");
    else localStorage.removeItem(biometricPrefKey(profileId));
  } catch {
    // best-effort — a failed write just means the toggle didn't stick, not a functional break
  }
}
