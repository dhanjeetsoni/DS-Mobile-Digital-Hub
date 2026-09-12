import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2";

// ---------------------------------------------------------------------------
// enhance-product-photo — Supabase Edge Function (Phase 7: "AI sources/
// generates good-quality product photos automatically").
//
// IMPORTANT SCOPE NOTE: this does NOT source real photos from Amazon/
// Flipkart/anywhere else — reproducing another retailer's copyrighted
// product photography into this shop's own commercial catalog (shown to
// customers via invoices, WhatsApp, etc.) would be a real copyright
// problem, not something to build regardless of how it's asked for. What
// this DOES do: takes the shop's OWN uploaded photo and asks a Gemini
// image-generation-capable model to clean it up into an e-commerce-style
// shot — white/neutral background, product centered and well-lit, junk/
// clutter removed — the same *source* product, not a different or
// invented one. If the model can't do this reliably it fails loudly with
// a clear error; it never silently returns something misleading.
//
// Same multi-key failover/rate-limit/auth pattern as the other AI Edge
// Functions in this project (ai-gateway, ai-price-advisor) — duplicated
// rather than shared, matching how every function here is self-contained.
//
// Model name is env-configurable (GEMINI_MODEL_IMAGE) specifically because
// image-generation model names change faster than text/vision ones and
// this is genuinely the one part of this feature that needs a live check
// against the real API to confirm — if the default is wrong for whatever
// account/region this runs under, the Owner can override it in Settings/
// Supabase env without a code change, and every call site here degrades
// to a clear "AI enhance failed, try again or keep the original photo"
// rather than corrupting or losing the original photo either way (the
// original is never touched/deleted by this function — it only ever
// returns a NEW image for the client to preview and optionally accept).
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
// 2026-09-10: corrected default per a live-tested finding from a parallel
// session's `ai-product-photo` function (same account/API) — the guessed
// "gemini-3-pro-image" and "gemini-3.5-flash-image" both 404 (don't exist
// on this API version yet); "gemini-2.5-flash-image" is the real,
// reachable model via generateContent() on a plain Gemini API key. Note:
// that session also found every key in this store's pool returning 429
// quota-exceeded specifically on this model (image generation sits on a
// separate, stricter quota than text/vision) — so a "quota"/429 error here
// is expected until that quota resets or is raised, not a config bug.
const GEMINI_MODEL_IMAGE = Deno.env.get("GEMINI_MODEL_IMAGE") || "gemini-2.5-flash-image";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 25_000;

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

class GeminiTimeoutError extends Error {
  constructor() { super("Gemini call timed out"); this.name = "GeminiTimeoutError"; }
}
function callWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new GeminiTimeoutError()), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const rateMap = new Map<string, { count: number; resetAt: number }>();
let lastRateMapSweep = 0;
function checkRateLimit(key: string, windowMs = 60_000, max = 10): boolean {
  const now = Date.now();
  if (now - lastRateMapSweep > 60_000) {
    lastRateMapSweep = now;
    for (const [k, entry] of rateMap) if (entry.resetAt <= now) rateMap.delete(k);
  }
  const current = rateMap.get(key);
  if (!current || current.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count++;
  return current.count <= max;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

// --- Multi-key Gemini failover pool (kept in sync with ai-gateway/index.ts
// and ai-price-advisor/index.ts — see ai-gateway/index.ts for the full
// original writeup) ---
const ENV_POOL_ID = "__env__";
const ENV_GEMINI_KEYS: string[] = (() => {
  const keys: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (k && k.trim()) keys.push(k.trim());
  }
  if (keys.length === 0) {
    const single = Deno.env.get("GEMINI_API_KEY");
    if (single && single.trim()) keys.push(single.trim());
  }
  return keys;
})();

interface KeyEntry { slot: number; apiKey: string }
const storeKeyPoolCache = new Map<string, { keys: KeyEntry[]; at: number }>();
const KEY_POOL_CACHE_MS = 20_000;

async function loadKeyPool(storeId: string | null): Promise<KeyEntry[]> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  if (poolId === ENV_POOL_ID) return ENV_GEMINI_KEYS.map((apiKey, i) => ({ slot: i + 1, apiKey }));
  const cached = storeKeyPoolCache.get(poolId);
  if (cached && Date.now() - cached.at < KEY_POOL_CACHE_MS) return cached.keys;

  const { data, error } = await supabaseAdmin!
    .from("gemini_api_keys")
    .select("slot, api_key, status, cooldown_until")
    .eq("store_id", poolId)
    .not("api_key", "is", null)
    .neq("status", "invalid")
    .order("slot", { ascending: true });

  let keys: KeyEntry[] = [];
  if (!error && data) {
    const now = Date.now();
    keys = data
      .filter((row: any) => !row.cooldown_until || new Date(row.cooldown_until).getTime() <= now)
      .map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
    if (keys.length === 0) keys = data.map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
  }
  if (keys.length === 0 && ENV_GEMINI_KEYS.length > 0) keys = ENV_GEMINI_KEYS.map((apiKey, i) => ({ slot: i + 1, apiKey }));
  storeKeyPoolCache.set(poolId, { keys, at: Date.now() });
  return keys;
}

function invalidateKeyPoolCache(storeId: string | null) {
  storeKeyPoolCache.delete(storeId && supabaseAdmin ? storeId : ENV_POOL_ID);
}

async function markKeyResult(storeId: string | null, slot: number, ok: boolean, errMsg?: string, failureStatus: "exhausted" | "invalid" = "exhausted") {
  if (!storeId || !supabaseAdmin) return;
  try {
    if (ok) {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabaseAdmin.from("gemini_api_keys").select("usage_count_today, usage_date").eq("store_id", storeId).eq("slot", slot).maybeSingle();
      const sameDay = data?.usage_date === today;
      await supabaseAdmin.from("gemini_api_keys").update({
        status: "active", cooldown_until: null, last_error: null, last_used_at: new Date().toISOString(),
        usage_date: today, usage_count_today: sameDay ? (data?.usage_count_today || 0) + 1 : 1,
      }).eq("store_id", storeId).eq("slot", slot);
    } else {
      await supabaseAdmin.from("gemini_api_keys").update({
        status: failureStatus, cooldown_until: failureStatus === "exhausted" ? new Date(Date.now() + 60_000).toISOString() : null,
        last_error: (errMsg || "").slice(0, 300),
      }).eq("store_id", storeId).eq("slot", slot);
    }
  } catch (e) {
    console.warn("markKeyResult: non-fatal status write-back failed", e);
  } finally {
    invalidateKeyPoolCache(storeId);
  }
}

const geminiClients = new Map<string, GoogleGenAI>();
function clientForKey(key: string): GoogleGenAI {
  let c = geminiClients.get(key);
  if (!c) { c = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { "User-Agent": "ds-mobile-digital-hub" } } }); geminiClients.set(key, c); }
  return c;
}

const activeKeyIndexByPool = new Map<string, number>();

function classifyGeminiFailure(err: any): "quota" | "invalid" | "unavailable" | null {
  if (err instanceof GeminiTimeoutError) return "quota";
  const msg = String(err?.message || err || "").toLowerCase();
  const status = err?.status || err?.code;
  if (status === 429 || msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("rate limit")) return "quota";
  if (status === 401 || status === 403 || msg.includes("permission_denied") || msg.includes("unauthenticated") || msg.includes("api key not valid") || msg.includes("api_key_invalid") || msg.includes("invalid api key") || msg.includes("key not found") || msg.includes("has not been used")) return "invalid";
  if (status === 503 || msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded") || msg.includes("high demand")) return "unavailable";
  if (err instanceof TypeError || msg.includes("failed to fetch") || msg.includes("fetch failed") || msg.includes("network") || msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout") || msg.includes("socket hang up") || msg.includes("dns")) return "unavailable";
  return null;
}

function hasAI(): boolean {
  return ENV_GEMINI_KEYS.length > 0 || Boolean(supabaseAdmin);
}

const FAILOVER_TIME_BUDGET_MS = 27_000;

async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable — no Gemini API keys configured. Owner: add keys in Settings.");

  const startedAt = Date.now();
  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;
  let anyUnavailable = false;

  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      if (!anyUnavailable) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    for (let attempt = 0; attempt < keys.length; attempt++) {
      if (Date.now() - startedAt > FAILOVER_TIME_BUDGET_MS) {
        throw lastError || new Error("AI busy hai (high demand) — thodi der mein dobara try karein.");
      }
      const idx = (activeIdx + attempt) % keys.length;
      const entry = keys[idx];
      try {
        const result = await callWithTimeout(fn(clientForKey(entry.apiKey)), GEMINI_TIMEOUT_MS);
        activeKeyIndexByPool.set(poolId, idx);
        void markKeyResult(storeId, entry.slot, true);
        return result;
      } catch (err) {
        lastError = err;
        const failure = classifyGeminiFailure(err);
        if (!failure) throw err;
        if (failure === "unavailable") { anyUnavailable = true; continue; }
        void markKeyResult(storeId, entry.slot, false, (err as any)?.message || String(err), failure === "invalid" ? "invalid" : "exhausted");
      }
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

const storeIdByUserCache = new Map<string, { storeId: string | null; at: number }>();
const STORE_ID_CACHE_MS = 60_000;

async function requireUserAndStore(req: Request): Promise<{ userId: string; storeId: string | null } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || !SUPABASE_URL || !SERVICE_ROLE_KEY || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  const cached = storeIdByUserCache.get(data.user.id);
  if (cached && Date.now() - cached.at < STORE_ID_CACHE_MS) return { userId: data.user.id, storeId: cached.storeId };
  const { data: profile } = await supabaseAdmin.from("profiles").select("store_id").eq("id", data.user.id).maybeSingle();
  const storeId = profile?.store_id || null;
  storeIdByUserCache.set(data.user.id, { storeId, at: Date.now() });
  return { userId: data.user.id, storeId };
}

function decodeImage(image: unknown): { mimeType: string; base64Data: string } | null {
  if (!image || typeof image !== "string") return null;
  if (image.length > 14_000_000) return null;
  let mimeType = "image/jpeg";
  let base64Data = image;
  if (image.startsWith("data:")) {
    const parts = image.split(";base64,");
    mimeType = parts[0].replace("data:", "") || mimeType;
    base64Data = parts[1] || "";
  }
  if (!/^image\/(jpeg|png|webp|jpg)$/i.test(mimeType)) return null;
  return { mimeType, base64Data };
}

async function runPhotoEnhance(storeId: string | null, base64Data: string, mimeType: string): Promise<{ mimeType: string; base64Data: string }> {
  if (!hasAI()) throw new Error("AI unavailable");
  // Deliberately conservative prompt: same product, same angle/framing —
  // only background/lighting/cleanup change. Never asked to "improve",
  // "upscale detail", or otherwise invent visual information that wasn't
  // in the source photo, since this is a real product a real customer is
  // buying, not illustrative art.
  const prompt = `Edit this exact product photo for an e-commerce catalog listing, in the style of a
professional Amazon/Flipkart product shot. Keep the SAME product, SAME angle, and SAME physical details
visible in the photo — do not add, remove, or change any feature of the product itself, and do not invent
detail that isn't visible in the source image. Only change:
- Replace the background with a clean, plain white/light-neutral studio background.
- Center the product with balanced margins.
- Even, bright, shadow-free studio-style lighting.
- Remove any clutter, hands, price tags, or background objects not part of the product itself.
Output only the edited photo.`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL_IMAGE,
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
    })
  );

  const parts = (response as any)?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p: any) => p.inlineData?.data);
  if (!imgPart) throw new Error("AI ne photo edit nahi ki — dobara try karein ya original photo rakhein.");
  return { mimeType: imgPart.inlineData.mimeType || "image/png", base64Data: imgPart.inlineData.data };
}

// 2026-09-12: live-verified (via direct calls to Google's own API, not
// just reading the error text) that this "quota exceeded" is NOT a
// transient rate limit that clears up if you wait — Google's free tier
// gives a hard 0 requests/day quota to EVERY image-generation-capable
// Gemini model (tested gemini-2.5-flash-image itself, the exact model
// this function already uses, and got the identical 429/limit:0
// response). This only ever resolves by enabling billing (pay-as-you-go)
// on the Google AI Studio / Cloud project the key belongs to — no code
// change or model-name swap fixes it. The raw Google error was
// previously leaking straight into the UI as an unreadable JSON blob
// (error.message passed through unwrapped) — this replaces that with an
// accurate, actionable Hinglish message instead.
function friendlyPhotoError(err: any): string {
  const failure = classifyGeminiFailure(err);
  if (failure === "quota") {
    return "AI Photo Enhance is API key ke saath kaam nahi kar raha — Google free-tier keys mein photo-editing/generation ke liye 0 quota hoti hai (ye baad mein try karne se theek nahi hoga). Isko chalane ke liye Google AI Studio mein us key par billing (pay-as-you-go) enable karni hogi. Filhal original photo hi use karein.";
  }
  if (failure === "unavailable") {
    return "AI abhi high demand mein hai (Google ki taraf se) — 15-20 second baad ek baar phir try karein.";
  }
  if (failure === "invalid") {
    return "Gemini API key invalid hai ya expire ho gayi hai — Settings mein naya key add karein.";
  }
  return err instanceof Error ? err.message : "AI photo enhance fail ho gaya. Original photo rakh sakte hain.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`enhance-photo:${clientIp(req)}`, 60_000, 8)) {
    return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const decoded = decodeImage(body?.image);
  if (!body?.image) return json({ success: false, error: "No image provided." }, 400);
  if (!decoded) return json({ success: false, error: "Unsupported image type." }, 415);

  try {
    const result = await runPhotoEnhance(ctx.storeId, decoded.base64Data, decoded.mimeType);
    return json({ success: true, image: `data:${result.mimeType};base64,${result.base64Data}` });
  } catch (error) {
    console.error("enhance-product-photo error", error);
    return json({ success: false, error: friendlyPhotoError(error) }, 500);
  }
});
