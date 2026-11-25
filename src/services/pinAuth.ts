// Personal PIN: server verifies the PIN with a slow hash and a per-account lockout.
// Offline unlock is available only after this device has successfully verified the
// current PIN revision online. Never download the server hash or fail open on RPC errors.
import { supabase } from "./supabaseClient";

const CACHE_PREFIX = "dsmdh_pin_v2_";
const STATUS_PREFIX = "dsmdh_pin_status_v2_";
export interface CachedPin { hash: string; salt: string; revision: string; }
type PinStatus = { hasPin: boolean; revision: string; lockedUntil?: string | null };

export function readCachedPin(profileId: string): CachedPin | null {
  try { const raw = localStorage.getItem(CACHE_PREFIX + profileId); return raw ? JSON.parse(raw) as CachedPin : null; } catch { return null; }
}
function readStatus(profileId: string): PinStatus | null {
  try { const raw = localStorage.getItem(STATUS_PREFIX + profileId); return raw ? JSON.parse(raw) as PinStatus : null; } catch { return null; }
}
function writeStatus(profileId: string, status: PinStatus) {
  try {
    const cached = readCachedPin(profileId);
    if (!status.hasPin || (cached && cached.revision !== status.revision)) {
      localStorage.removeItem(CACHE_PREFIX + profileId);
      setBiometricEnabled(profileId, false);
    }
    localStorage.setItem(STATUS_PREFIX + profileId, JSON.stringify(status));
    localStorage.removeItem("dsmdh_pin_v1_" + profileId);
  } catch {}
}
function randomSalt(): string {
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function deriveVerifier(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:enc.encode(salt),iterations:310000},material,256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,"0")).join("");
}
async function cacheVerifiedPin(profileId: string, pin: string, revision: string) {
  if (!revision) return;
  writeStatus(profileId,{hasPin:true,revision,lockedUntil:null});
  try {
    const salt = randomSalt();
    const hash = await deriveVerifier(pin,salt);
    localStorage.setItem(CACHE_PREFIX + profileId,JSON.stringify({hash,salt,revision}));
  } catch { /* online unlock can succeed even when offline storage is unavailable */ }
}
async function isCurrentProfile(profileId: string): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id === profileId;
}

/** True means lock the UI. Only an authoritative no-PIN status permits skipping it. */
export async function syncPinFromServer(profileId: string): Promise<boolean> {
  try {
    if (!await isCurrentProfile(profileId)) return true;
    if (!navigator.onLine) return readStatus(profileId)?.hasPin !== false;
    const { data, error } = await supabase.rpc("get_own_pin_status");
    if (error || typeof data?.hasPin !== "boolean" || !data.revision) return true;
    writeStatus(profileId,{hasPin:data.hasPin,revision:String(data.revision),lockedUntil:data.lockedUntil ?? null});
    return data.hasPin;
  } catch { return true; }
}

export async function verifyPin(profileId: string, enteredPin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(enteredPin)) return false;
  try {
    if (!await isCurrentProfile(profileId)) return false;
    if (navigator.onLine) {
      const {data,error} = await supabase.rpc("verify_own_pin",{p_pin:enteredPin});
      if (error || data?.ok !== true) return false;
      await cacheVerifiedPin(profileId,enteredPin,String(data.revision || ""));
      return true;
    }
    const cached = readCachedPin(profileId), status = readStatus(profileId);
    if (!cached || !status?.hasPin || cached.revision !== status.revision) return false;
    if (status.lockedUntil && Date.parse(status.lockedUntil) > Date.now()) return false;
    return await deriveVerifier(enteredPin,cached.salt) === cached.hash;
  } catch { return false; }
}

export function hasPinConfigured(profileId: string): boolean {
  return readStatus(profileId)?.hasPin === true;
}

export async function setMyPin(profileId: string,newPin: string,currentPin?: string): Promise<{ok:boolean;message:string}> {
  if (!/^\d{4}$/.test(newPin)) return {ok:false,message:"PIN exactly 4 digits ka hona chahiye."};
  try {
    if (!await isCurrentProfile(profileId)) return {ok:false,message:"Please sign in again."};
    const {data,error} = await supabase.rpc("change_my_pin",{p_new_pin:newPin,p_current_pin:currentPin ?? null});
    if (error) return {ok:false,message:error.message};
    if (data?.ok !== true) return {ok:false,message:data?.locked ? "Too many attempts. Try again in 2 minutes." : "Current PIN galat hai."};
    await cacheVerifiedPin(profileId,newPin,String(data.revision || ""));
    return {ok:true,message:""};
  } catch(e) { return {ok:false,message:e instanceof Error ? e.message : "PIN save nahi ho paya."}; }
}

export async function adminResetPin(targetProfileId:string,newPin:string):Promise<{ok:boolean;message:string}> {
  if (!/^\d{4}$/.test(newPin)) return {ok:false,message:"PIN exactly 4 digits ka hona chahiye."};
  try {
    const {error}=await supabase.rpc("admin_reset_account_pin",{p_target_id:targetProfileId,p_new_pin:newPin});
    return error ? {ok:false,message:error.message} : {ok:true,message:""};
  } catch(e) { return {ok:false,message:e instanceof Error ? e.message : "PIN reset nahi ho paya."}; }
}

export async function adminClearPin(targetProfileId:string):Promise<{ok:boolean;message:string}> {
  try {
    const {error}=await supabase.rpc("admin_clear_pin",{p_target_id:targetProfileId});
    return error ? {ok:false,message:error.message} : {ok:true,message:""};
  } catch(e) { return {ok:false,message:e instanceof Error ? e.message : "PIN clear nahi ho paya."}; }
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
    const cached = readCachedPin(profileId), status = readStatus(profileId);
    return !!cached && !!status?.hasPin && cached.revision === status.revision && !(status.lockedUntil && Date.parse(status.lockedUntil) > Date.now()) && localStorage.getItem(biometricPrefKey(profileId)) === "1";
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
