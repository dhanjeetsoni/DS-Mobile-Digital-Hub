import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Service-role Supabase client (Step 2.1) — used ONLY internally by this
// trusted backend to read/write the `gemini_api_keys` table, which has zero
// RLS policies (deny-all via PostgREST for every role, owner included — see
// the 20260901_gemini_key_pool_v23.sql migration). This is what lets a
// STAFF member's AI request (Photo Stock Finder, box OCR, etc.) draw from
// the shop's key pool even though staff — and even the browser's own owner
// session — can never read the raw keys directly.
// If SUPABASE_SERVICE_ROLE_KEY isn't configured (older/partial setups),
// `supabaseAdmin` stays null and the app transparently falls back to the
// original global env-var key list (GEMINI_API_KEY_1..5 / GEMINI_API_KEY) —
// no breaking change for existing deployments.
// ---------------------------------------------------------------------------
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAdmin = (process.env.SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "15mb" }));

// Small in-memory limiter for expensive OCR calls. This is intentionally
// conservative; production deployments should also enforce edge/WAF limits.
const rateMap = new Map<string, { count: number; resetAt: number }>();
let lastRateMapSweep = 0;
function rateLimit(windowMs = 60_000, max = 12) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    if (now - lastRateMapSweep > 60_000) {
      lastRateMapSweep = now;
      for (const [ip, entry] of rateMap) if (entry.resetAt <= now) rateMap.delete(ip);
    }
    const key = req.ip || "unknown";
    const current = rateMap.get(key);
    if (!current || current.resetAt <= now) {
      rateMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count++;
    if (current.count > max) return res.status(429).json({ success: false, error: "Too many requests. Please try again shortly." });
    next();
  };
}

// ---------------------------------------------------------------------------
// Multi-key Gemini failover pool — Step 2.1 (up to 10 owner-managed keys,
// per store, stored in Supabase) + Step 2.2 (status feeds the Owner-only
// AI Key Status Widget via the get_gemini_key_status() RPC).
//
// A store's keys live in the `gemini_api_keys` table (see
// 20260901_gemini_key_pool_v23.sql), set by the Owner from Settings using
// the save_gemini_api_key() RPC. This backend reads them directly with the
// service-role client (supabaseAdmin), which is the ONLY thing allowed to
// see the raw key values — they are never sent back to any browser.
//
// Legacy fallback: if supabaseAdmin isn't configured, or a store has no keys
// saved yet, we fall back to the original global env vars
// (GEMINI_API_KEY_1..GEMINI_API_KEY_5 / GEMINI_API_KEY) under a synthetic
// "env" pool key — so nothing breaks for existing deployments that haven't
// used the new Settings UI yet.
//
// Only ONE key is ever "active" at a time per store. If a call on the active
// key fails with a quota/rate-limit/auth error, the pool rotates to the next
// key and retries the same request — the caller never sees the failure
// unless every key is exhausted. A key that fails is put on a short cooldown
// so we don't keep hammering an exhausted key every request.
// ---------------------------------------------------------------------------
const ENV_POOL_ID = "__env__"; // synthetic pool id for the legacy env-var fallback

const ENV_GEMINI_KEYS: string[] = (() => {
  const keys: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  if (keys.length === 0 && process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }
  return keys;
})();

interface KeyEntry { slot: number; apiKey: string }

// Short in-memory cache of each store's key list, so we don't hit Postgres
// on every single AI call — refreshed every 20s, or immediately whenever a
// key fails (so a freshly-added replacement key is picked up fast).
const storeKeyPoolCache = new Map<string, { keys: KeyEntry[]; at: number }>();
const KEY_POOL_CACHE_MS = 20_000;

async function loadKeyPool(storeId: string | null): Promise<KeyEntry[]> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  if (poolId === ENV_POOL_ID) {
    return ENV_GEMINI_KEYS.map((apiKey, i) => ({ slot: i + 1, apiKey }));
  }
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
    // If everything is resting on cooldown, fall back to the full set so a
    // request still gets attempted rather than failing outright (mirrors the
    // "only key we have" behaviour below).
    if (keys.length === 0) {
      keys = data.map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
    }
  }
  if (keys.length === 0 && ENV_GEMINI_KEYS.length > 0) {
    // Store has no keys configured yet — fall back to env vars so AI still
    // works while the Owner hasn't visited Settings yet.
    keys = ENV_GEMINI_KEYS.map((apiKey, i) => ({ slot: i + 1, apiKey }));
  }
  storeKeyPoolCache.set(poolId, { keys, at: Date.now() });
  return keys;
}

function invalidateKeyPoolCache(storeId: string | null) {
  storeKeyPoolCache.delete(storeId && supabaseAdmin ? storeId : ENV_POOL_ID);
}

// Best-effort status write-backs for the Owner's AI Key Status Widget
// (Step 2.2). These never throw / never block the actual AI response.
//
// `failureStatus` distinguishes a temporary problem from a permanent one:
//   - 'exhausted' (quota/rate-limit) — the key is fine, just resting; it gets
//     a 60s cooldown and is retried automatically on the next rotation.
//   - 'invalid' (bad/revoked/malformed key, permission denied) — retrying
//     won't help, so no cooldown is set and `loadKeyPool()`'s
//     `.neq("status", "invalid")` filter permanently excludes it from
//     rotation until the Owner pastes a fresh key into that slot (which
//     resets status back to 'active' via `save_gemini_api_key`).
async function markKeyResult(
  storeId: string | null,
  slot: number,
  ok: boolean,
  errMsg?: string,
  failureStatus: "exhausted" | "invalid" = "exhausted"
) {
  if (!storeId || !supabaseAdmin) return; // env-var pool has no DB row to update
  try {
    if (ok) {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabaseAdmin
        .from("gemini_api_keys")
        .select("usage_count_today, usage_date")
        .eq("store_id", storeId)
        .eq("slot", slot)
        .maybeSingle();
      const sameDay = data?.usage_date === today;
      await supabaseAdmin
        .from("gemini_api_keys")
        .update({
          status: "active",
          cooldown_until: null,
          last_error: null,
          last_used_at: new Date().toISOString(),
          usage_date: today,
          usage_count_today: sameDay ? (data?.usage_count_today || 0) + 1 : 1,
        })
        .eq("store_id", storeId)
        .eq("slot", slot);
    } else {
      await supabaseAdmin
        .from("gemini_api_keys")
        .update({
          status: failureStatus,
          cooldown_until: failureStatus === "exhausted" ? new Date(Date.now() + 60_000).toISOString() : null,
          last_error: (errMsg || "").slice(0, 300),
        })
        .eq("store_id", storeId)
        .eq("slot", slot);
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
  if (!c) {
    c = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { "User-Agent": "ds-mobile-digital-hub" } } });
    geminiClients.set(key, c);
  }
  return c;
}

// activeKeyIndex is tracked per pool (per store, or the shared env pool) so
// one store's rotation doesn't affect another's.
const activeKeyIndexByPool = new Map<string, number>();

// Classifies a Gemini call failure so the pool can react correctly:
//   - "quota"   — the key itself is fine, it's just temporarily rate/quota
//                 limited. Retry it later (cooldown), keep it in rotation.
//   - "invalid" — the key is permanently bad (revoked, malformed, wrong
//                 project/API disabled, no permission). Retrying is
//                 pointless — take it out of rotation until the Owner
//                 replaces it.
//   - null      — not a key problem at all (bad request, network error,
//                 etc.) — don't touch this key's status, don't rotate,
//                 just surface the error.
function classifyGeminiFailure(err: any): "quota" | "invalid" | null {
  const msg = String(err?.message || err || "").toLowerCase();
  const status = err?.status || err?.code;

  if (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit")
  ) {
    return "quota";
  }

  if (
    status === 401 ||
    status === 403 ||
    msg.includes("permission_denied") ||
    msg.includes("unauthenticated") ||
    msg.includes("api key not valid") ||
    msg.includes("api_key_invalid") ||
    msg.includes("invalid api key") ||
    msg.includes("key not found") ||
    msg.includes("has not been used") // "...API has not been used in project... or it is disabled"
  ) {
    return "invalid";
  }

  return null;
}

function hasAI(): boolean {
  // A cheap synchronous check for the "no AI configured at all anywhere"
  // case (used by callers as an early-exit before doing any async work).
  // The real, per-store key list is resolved async inside
  // runWithGeminiFailover — this just guards the fully-unconfigured case.
  return ENV_GEMINI_KEYS.length > 0 || Boolean(supabaseAdmin);
}

// Runs `fn` against the currently active Gemini key for this store's pool.
// On a quota/auth failure it puts that key on a 60s cooldown (in-memory
// immediately, and in the DB in the background for the status widget) and
// tries the next key in the ring, until either a key succeeds or every key
// has been tried once this call.
async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable — no Gemini API keys configured. Owner: add keys in Settings.");

  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (activeIdx + attempt) % keys.length;
    const entry = keys[idx];
    try {
      const result = await fn(clientForKey(entry.apiKey));
      activeKeyIndexByPool.set(poolId, idx); // stick with the key that worked
      void markKeyResult(storeId, entry.slot, true);
      return result;
    } catch (err) {
      lastError = err;
      const failure = classifyGeminiFailure(err);
      if (failure) {
        console.warn(
          `Gemini key (store=${poolId}, slot=${entry.slot}) failed (${failure}) — ` +
            (failure === "invalid" ? "marking invalid, removing from rotation." : "cooling down, rotating to next key.")
        );
        void markKeyResult(storeId, entry.slot, false, err?.message, failure === "invalid" ? "invalid" : "exhausted");
        continue; // try next key
      }
      throw err; // non-quota/auth error (bad request etc.) — no point retrying other keys
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

const emptyResult = (imageType: string) => ({
  brand: "", modelName: "", imei1: "", imei2: "", serialNo: "", color: "",
  ramStorage: "", mrp: 0, sellingPriceSuggested: 0, androidVersion: "",
  batteryHealth: "", detectedCategory: imageType === "about_screen" ? "Second-Hand Mobile" : "New Mobile",
  notes: ""
});

function normalizeOcr(input: any, imageType: string) {
  const base = { ...emptyResult(imageType), ...(input || {}) };
  const cleanImei = (v: unknown) => {
    const digits = String(v || "").replace(/\D/g, "");
    return /^\d{15}$/.test(digits) ? digits : "";
  };
  return {
    ...base,
    brand: String(base.brand || "").trim(),
    modelName: String(base.modelName || "").trim(),
    imei1: cleanImei(base.imei1),
    imei2: cleanImei(base.imei2),
    serialNo: String(base.serialNo || "").trim(),
    color: String(base.color || "").trim(),
    ramStorage: String(base.ramStorage || "").trim(),
    mrp: Number(base.mrp) || 0,
    sellingPriceSuggested: Number(base.sellingPriceSuggested) || 0,
    androidVersion: String(base.androidVersion || "").trim(),
    batteryHealth: String(base.batteryHealth || "").trim(),
    detectedCategory: base.detectedCategory || emptyResult(imageType).detectedCategory,
    notes: String(base.notes || "").trim(),
  };
}

async function runGemini(storeId: string | null, base64Data: string, mimeType: string, imageType: string) {
  if (!hasAI()) return null;
  const prompt = `Read this mobile/product image. Extract ONLY information visibly supported by the image.
Return JSON fields: brand, modelName, imei1, imei2, serialNo, color, ramStorage, mrp, sellingPriceSuggested, androidVersion, batteryHealth, detectedCategory, notes.
Never invent or infer an absent value. An IMEI is valid only when a real 15-digit number is visibly present.
Image type: ${imageType}.`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brand:{type:Type.STRING}, modelName:{type:Type.STRING}, imei1:{type:Type.STRING},
            imei2:{type:Type.STRING}, serialNo:{type:Type.STRING}, color:{type:Type.STRING},
            ramStorage:{type:Type.STRING}, mrp:{type:Type.NUMBER}, sellingPriceSuggested:{type:Type.NUMBER},
            androidVersion:{type:Type.STRING}, batteryHealth:{type:Type.STRING},
            detectedCategory:{type:Type.STRING}, notes:{type:Type.STRING}
          }
        }
      }
    })
  );
  return normalizeOcr(JSON.parse(response.text || "{}"), imageType);
}

// Accessory packaging scanner: tempered glass / curved glass / back cover /
// cable / etc. One physical item can be printed with dozens of compatible
// phone models (e.g. "For: R-ME7/C17/A32/A53 2020/..."). We extract the
// brand/product name ONCE and the full compatible-models list as a clean
// array, so the shop can save it as a SINGLE catalog item with one stock
// count that many models map onto — never one row per model.
function normalizeAccessory(input: any) {
  const base = input || {};
  const rawModels: unknown = base.compatibleModels;
  const models = Array.isArray(rawModels)
    ? rawModels.map((m) => String(m || "").trim()).filter(Boolean)
    : String(rawModels || "")
        .split(/[,/\n]/)
        .map((m) => m.trim())
        .filter(Boolean);
  // de-duplicate while preserving order
  const seen = new Set<string>();
  const compatibleModels = models.filter((m) => {
    const k = m.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Step 3.4b: screen size may come back as a genuine range (min/max) for
  // universal-fit items, or as a single value (older prompts / min only).
  // Normalize so min <= max always, and max is only kept when it's a real,
  // distinct range — a single-size pack should not carry a redundant
  // identical max value.
  let screenSizeInches = Number(base.screenSizeInches) || 0;
  let screenSizeMaxInches = Number(base.screenSizeMaxInches) || 0;
  if (screenSizeMaxInches && screenSizeInches && screenSizeMaxInches < screenSizeInches) {
    // AI returned them swapped — correct rather than discard.
    [screenSizeInches, screenSizeMaxInches] = [screenSizeMaxInches, screenSizeInches];
  }
  if (!screenSizeInches && screenSizeMaxInches) {
    // Only a max came back (shouldn't normally happen) — treat it as the size.
    screenSizeInches = screenSizeMaxInches;
    screenSizeMaxInches = 0;
  }
  if (screenSizeMaxInches === screenSizeInches) screenSizeMaxInches = 0;
  return {
    brand: String(base.brand || "").trim(),
    productName: String(base.productName || "").trim(),
    category: String(base.category || "").trim() || "Accessories",
    compatibleModels,
    notes: String(base.notes || "").trim(),
    screenSizeInches,
    screenSizeMaxInches,
  };
}

async function runGeminiAccessory(storeId: string | null, base64Data: string, mimeType: string) {
  if (!hasAI()) return null;
  const prompt = `Read this accessory packaging photo (tempered glass, curved/edge-to-edge glass, back cover, charger, cable, earphones etc. for mobile phones).
Extract ONLY information visibly printed/supported by the image. Return JSON fields:
- brand: the manufacturer/company name printed on the pack (e.g. "Super X"). Do NOT confuse this with a phone brand.
- productName: the short product title/tagline printed (e.g. "Edge to Edge Big Curved Glass", "ESD Anti-Static Tempered Glass").
- category: best single category, one of exactly: "Tempered Glass", "Curved Glass", "Back Covers", "Charger", "Cable", "Earphones", "Accessories".
  Use "Curved Glass" ONLY when the pack/photo clearly shows or states an edge-to-edge / curved-edge / 3D/5D/UV-glue glass design (curved sides that wrap the phone's screen edges). Use plain "Tempered Glass" for a normal flat-panel glass, even if it has rounded corners.
- compatibleModels: an array of EVERY individual phone model this item fits, taken from any "For:" / compatibility list on the pack.
  Expand abbreviations into readable model names (e.g. "R-ME7" -> "Realme 7", "R-ME C17" -> "Realme C17", "1+NORD N100" -> "OnePlus Nord N100").
  Split combined lists like "A32/A33 2020/A53 2020" into separate array entries, keeping the shared brand prefix inferred from context (e.g. Samsung A32, Samsung A33 2020, Samsung A53 2020).
  Include every model listed, do not truncate or summarize the list.
- notes: any other relevant printed detail (finish, protection type) in a short phrase, or empty string.
- screenSizeInches: the phone screen size(s) in inches this item is designed for, worked out from the compatible models and/or any printed size text (e.g. "For 6.5-6.7 inch mobiles").
  If every compatible model shares essentially the same screen size, return that single number here and leave screenSizeMaxInches as 0.
  If the models span a genuine RANGE of screen sizes (common for a universal-fit / curved glass covering many models), return the SMALLEST size in screenSizeInches and the LARGEST size in screenSizeMaxInches — do not force a single number when the models clearly differ in size.
  If no screen size can be determined at all, return 0 for both.
- screenSizeMaxInches: as described above — 0 when there is no real range.
Never invent a model that is not printed on the pack.`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brand: { type: Type.STRING },
            productName: { type: Type.STRING },
            category: { type: Type.STRING },
            compatibleModels: { type: Type.ARRAY, items: { type: Type.STRING } },
            notes: { type: Type.STRING },
            screenSizeInches: { type: Type.NUMBER },
            screenSizeMaxInches: { type: Type.NUMBER },
          }
        }
      }
    })
  );
  return normalizeAccessory(JSON.parse(response.text || "{}"));
}

// ---------------------------------------------------------------------------
// Screen-size lookup: given a phone model name the shop doesn't have listed
// under any glass/cover's compatibleModels, ask Gemini for that phone's
// screen size so it can still be matched against accessories that recorded
// a screenSizeInches (Step 3.4c — "same screen-size" smart fallback search).
//
// Step 3.4d — Local Caching (Supabase): a phone model's screen size is a
// fixed fact, so once ANY store's AI has looked it up we never want to pay
// for a fresh Gemini call again — for that store OR any other. Results are
// cached in two layers:
//   1. In-memory Map — fastest, avoids a DB round-trip for repeat lookups
//      within the same running server process/day.
//   2. `public.phone_screen_size_cache` table (Supabase) — durable across
//      server restarts/redeploys and shared by every store, which is what
//      lets this feature "work offline" in the sense the plan means: once a
//      model has been looked up once (by anyone), it never needs the
//      internet again. Only used when `supabaseAdmin` is configured; if not,
//      the feature transparently falls back to in-memory-only caching (same
//      behaviour as before this step) — no breaking change.
// ---------------------------------------------------------------------------
const screenSizeCache = new Map<string, { size: number; at: number }>();
const SCREEN_SIZE_CACHE_MS = 24 * 60 * 60 * 1000; // in-memory freshness window only; the Supabase row itself never expires

async function getScreenSizeFromSupabase(key: string): Promise<number | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("phone_screen_size_cache")
      .select("screen_size_inches")
      .eq("model_key", key)
      .maybeSingle();
    if (error || !data) return null;
    return Number(data.screen_size_inches) || null;
  } catch {
    return null;
  }
}

async function saveScreenSizeToSupabase(key: string, modelName: string, size: number): Promise<void> {
  if (!supabaseAdmin || !size) return;
  try {
    await supabaseAdmin.rpc("upsert_screen_size_cache", {
      p_model_key: key,
      p_model_name: modelName.trim().slice(0, 120),
      p_screen_size_inches: size,
    });
  } catch {
    // Best-effort only — a cache-write failure should never break the
    // lookup response the user is waiting on.
  }
}

async function runScreenSizeLookup(storeId: string | null, modelName: string): Promise<number> {
  const key = modelName.trim().toLowerCase();

  // Layer 1: in-memory (fastest, same-process repeat lookups).
  const cached = screenSizeCache.get(key);
  if (cached && Date.now() - cached.at < SCREEN_SIZE_CACHE_MS) return cached.size;

  // Layer 2: Supabase (durable, shared across stores/restarts) — a hit here
  // means we NEVER need to ask Gemini again for a model already learned,
  // even after this in-memory cache is empty (fresh deploy, cold start).
  const fromDb = await getScreenSizeFromSupabase(key);
  if (fromDb) {
    screenSizeCache.set(key, { size: fromDb, at: Date.now() });
    return fromDb;
  }

  if (!hasAI()) return 0;
  const prompt = `What is the diagonal screen size, in inches, of the mobile phone "${modelName}"?
Reply with ONLY the number rounded to 1 decimal place (e.g. "6.7"). If you are not confident which phone this is, reply "0".`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ text: prompt }] },
    })
  );
  const size = parseFloat(String(response.text || "0").trim().match(/[\d.]+/)?.[0] || "0") || 0;
  screenSizeCache.set(key, { size, at: Date.now() });
  if (size) await saveScreenSizeToSupabase(key, modelName, size);
  return size;
}

// ---------------------------------------------------------------------------
// Staff "Photo Stock Finder": staff snaps a photo of ANY item in the shop
// (a phone, a charger, a cover on the rack, a box, an earphone pack) and the
// AI identifies what it is + gives short search keywords. The client then
// searches the shop's OWN catalog (never invented items) by those keywords
// and lets staff add a matching in-stock item straight to the bill. This is
// a search-keyword generator only — it never returns price/stock, since
// those must always come from the shop's real database, not the AI.
// ---------------------------------------------------------------------------
function normalizeProductPhoto(input: any) {
  const base = input || {};
  const keywords = Array.isArray(base.searchKeywords)
    ? base.searchKeywords.map((k: unknown) => String(k || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    itemType: String(base.itemType || "").trim(),
    brand: String(base.brand || "").trim(),
    productName: String(base.productName || "").trim(),
    color: String(base.color || "").trim(),
    searchKeywords: keywords,
    notes: String(base.notes || "").trim(),
  };
}

async function runGeminiProductPhoto(storeId: string | null, base64Data: string, mimeType: string) {
  if (!hasAI()) return null;
  const prompt = `Look at this photo of a product/item from a mobile phone & digital accessories shop
(could be a phone, a tempered glass, a back cover, a charger, a cable, earphones, a power bank, or any
other shop item, on a shelf, in a hand, or in its box). Identify ONLY what is visibly supported by the
image. Return JSON fields:
- itemType: short category guess, e.g. "Mobile Phone", "Tempered Glass", "Back Cover", "Charger", "Cable", "Earphones", "Power Bank", "Accessory".
- brand: manufacturer/brand name visible on the item or packaging, or empty string if not visible.
- productName: short product name/title visible, or your best short visible description (e.g. "Black silicone back cover"), or empty string.
- color: dominant visible color, or empty string.
- searchKeywords: an array of 3-6 short keywords (brand names, model numbers, product type, color) a shop
  search box could use to find this exact item in an existing catalog. Do NOT invent a model number that
  isn't visible — only include keywords actually supported by the image.
- notes: any other short useful visible detail, or empty string.
Never invent details not visible in the photo.`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            itemType: { type: Type.STRING },
            brand: { type: Type.STRING },
            productName: { type: Type.STRING },
            color: { type: Type.STRING },
            searchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            notes: { type: Type.STRING },
          },
        },
      },
    })
  );
  return normalizeProductPhoto(JSON.parse(response.text || "{}"));
}

// ---------------------------------------------------------------------------
// Staff-mode quick advice: a short, actionable Hinglish tip aimed at a staff
// member on shift (not the owner) — what to focus on right now to help
// sales, using only the small non-sensitive numeric snapshot the client
// sends (today's sales so far, top-moving items, low-stock items). Kept
// separate from /api/business-insights (owner-only, full P&L) so staff never
// receive profit/margin/expense figures.
// ---------------------------------------------------------------------------
async function runStaffAdvice(storeId: string | null, summary: Record<string, unknown>): Promise<string> {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are a friendly shift-advisor for a staff member working the counter at a small Indian
mobile phone & digital services shop today. Using ONLY the numbers given below, write short, practical,
encouraging tips in simple Hinglish (Hindi+English mix, easy to read fast between customers). Use short
bullet points (use "-" per line, no markdown headers, no bold/asterisks). Cover:
1) Aaj ab tak kaisa chal raha hai — 1 line, encouraging tone.
2) Kaunsa item push/upsell karna chahiye abhi (fast-moving ya combo-worthy items) — 1-2 lines, name items if given.
3) Kaunsa low-stock item hai jiske liye customer ko turant batana/order lena chahiye — 1 line if any given.
4) Ek chhota customer-service tip for today.
Do NOT mention profit, margin, cost price, or expenses — staff should not see those. Keep the whole reply
under 120 words. Do not invent numbers not present below.

DATA:
${JSON.stringify(summary)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ text: prompt }] },
    })
  );
  return (response.text || "").trim();
}

async function runBusinessInsights(storeId: string | null, summary: Record<string, unknown>): Promise<string> {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are a business advisor for a small Indian mobile phone & digital services shop.
All amounts are in INR (₹). Based ONLY on the numbers given below, write a short, practical business
summary in simple Hinglish (Hindi+English mix, easy for a shopkeeper to read). Cover, in short bullet
points (use "-" per line, no markdown headers, no bold/asterisks):
1) Is month ka overall hisaab (sales, expenses, profit) — 1-2 lines.
2) Byaj/loan interest aur muldhan repayment ke liye kitna paisa alag rakhna chahiye (savings target) — 1-2 lines.
3) Kaunsa saman jyada bik raha hai aur kya order/reorder karna chahiye — 1-2 lines, name specific items if given.
4) Ek clear warning ya suggestion agar kharcha zyada ho raha ho ya due/baaki zyada ho.
Keep the whole reply under 160 words. Do not invent numbers not present below.

DATA:
${JSON.stringify(summary)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ text: prompt }] },
    })
  );
  return (response.text || "").trim();
}

// IMEI is validated by the strict 15-digit regex in normalizeOcr() and by
// the "requiresVerification" flag the client already forces the staff to
// confirm — that is the verification step now that there is no second
// (OCR.space) provider to cross-check against.

async function requireSupabaseUser(req: express.Request, res: express.Response) {
  const auth = req.header("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!token || !url || !key) {
    res.status(401).json({ success: false, error: "Authentication required." });
    return null;
  }
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ success: false, error: "Invalid or expired session." });
    return null;
  }
  return data.user;
}

// Short in-memory cache of user -> store_id, so every AI request doesn't
// need an extra round trip to Postgres just to find which key pool to use.
const storeIdByUserCache = new Map<string, { storeId: string | null; at: number }>();
const STORE_ID_CACHE_MS = 60_000;

// Same auth check as requireSupabaseUser, but also resolves the caller's
// store_id (Step 2.1) using the service-role client, so a STAFF member's AI
// request can draw from their own shop's key pool — staff can never read
// the keys themselves (see the migration), but they can trigger AI calls
// that use them, same as the Owner.
async function requireSupabaseUserAndStore(req: express.Request, res: express.Response) {
  const user = await requireSupabaseUser(req, res);
  if (!user) return null;
  if (!supabaseAdmin) return { user, storeId: null as string | null }; // legacy env-pool fallback
  const cached = storeIdByUserCache.get(user.id);
  if (cached && Date.now() - cached.at < STORE_ID_CACHE_MS) return { user, storeId: cached.storeId };
  const { data } = await supabaseAdmin.from("profiles").select("store_id").eq("id", user.id).maybeSingle();
  const storeId = data?.store_id || null;
  storeIdByUserCache.set(user.id, { storeId, at: Date.now() });
  return { user, storeId };
}

app.get("/api/health", (_req, res) => {
  // Do not expose secret/configuration presence to unauthenticated callers.
  res.json({ status: "ok", environment: process.env.NODE_ENV || "development" });
});

app.post("/api/ocr-phone", rateLimit(), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  if (!ctx) return;
  const { storeId } = ctx;
  try {
    const { image, imageType = "auto" } = req.body || {};
    if (!image || typeof image !== "string") return res.status(400).json({ success: false, error: "No image provided." });
    if (image.length > 14_000_000) return res.status(413).json({ success: false, error: "Image is too large." });

    let mimeType = "image/jpeg";
    let base64Data = image;
    if (image.startsWith("data:")) {
      const parts = image.split(";base64,");
      mimeType = parts[0].replace("data:", "") || mimeType;
      base64Data = parts[1] || "";
    }
    if (!/^image\/(jpeg|png|webp|jpg)$/i.test(mimeType)) return res.status(415).json({ success: false, error: "Unsupported image type." });

    const gemini = await runGemini(storeId, base64Data, mimeType, imageType);

    if (gemini) {
      const data = normalizeOcr(gemini, imageType);
      // A staff member must still eyeball the IMEI/serial before saving —
      // that manual glance is the verification step (no second AI/OCR
      // provider to auto cross-check against anymore).
      return res.json({
        success: true,
        provider: "gemini",
        verified: false,
        requiresVerification: true,
        mismatches: [],
        rawText: "",
        data,
      });
    }

    return res.status(503).json({ success: false, error: "AI unavailable — enter manually." });
  } catch (error) {
    console.error("OCR endpoint error", error);
    res.status(500).json({ success: false, error: "OCR service failed. Enter manually." });
  }
});

app.post("/api/ocr-accessory", rateLimit(), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  if (!ctx) return;
  const { storeId } = ctx;
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== "string") return res.status(400).json({ success: false, error: "No image provided." });
    if (image.length > 14_000_000) return res.status(413).json({ success: false, error: "Image is too large." });

    let mimeType = "image/jpeg";
    let base64Data = image;
    if (image.startsWith("data:")) {
      const parts = image.split(";base64,");
      mimeType = parts[0].replace("data:", "") || mimeType;
      base64Data = parts[1] || "";
    }
    if (!/^image\/(jpeg|png|webp|jpg)$/i.test(mimeType)) return res.status(415).json({ success: false, error: "Unsupported image type." });

    const data = await runGeminiAccessory(storeId, base64Data, mimeType);
    if (!data) return res.status(503).json({ success: false, error: "AI unavailable — enter manually." });
    return res.json({ success: true, provider: "gemini", data });
  } catch (error) {
    console.error("Accessory OCR endpoint error", error);
    res.status(500).json({ success: false, error: "AI scan failed. Enter manually." });
  }
});

app.post("/api/screen-size-lookup", rateLimit(60_000, 30), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  if (!ctx) return;
  const { storeId } = ctx;
  try {
    const { modelName } = req.body || {};
    if (!modelName || typeof modelName !== "string" || modelName.trim().length < 2) {
      return res.status(400).json({ success: false, error: "No model name provided." });
    }
    const size = await runScreenSizeLookup(storeId, modelName.trim().slice(0, 80));
    if (!size) return res.status(503).json({ success: false, error: "Could not determine screen size for this model." });
    return res.json({ success: true, modelName: modelName.trim(), screenSizeInches: size });
  } catch (error) {
    console.error("Screen-size lookup error", error);
    res.status(500).json({ success: false, error: "Lookup failed." });
  }
});

app.post("/api/business-insights", rateLimit(60_000, 6), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  if (!ctx) return;
  const { storeId } = ctx;
  try {
    const summary = req.body?.summary;
    if (!summary || typeof summary !== "object") {
      return res.status(400).json({ success: false, error: "No summary data provided." });
    }
    const insights = await runBusinessInsights(storeId, summary);
    if (!insights) return res.status(503).json({ success: false, error: "AI unavailable — try again shortly." });
    return res.json({ success: true, insights });
  } catch (error) {
    console.error("Business insights endpoint error", error);
    res.status(500).json({ success: false, error: "AI insights failed. Try again shortly." });
  }
});

app.post("/api/staff-advice", rateLimit(60_000, 10), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  if (!ctx) return;
  const { storeId } = ctx;
  try {
    const summary = req.body?.summary;
    if (!summary || typeof summary !== "object") {
      return res.status(400).json({ success: false, error: "No summary data provided." });
    }
    const advice = await runStaffAdvice(storeId, summary);
    if (!advice) return res.status(503).json({ success: false, error: "AI unavailable — try again shortly." });
    return res.json({ success: true, advice });
  } catch (error) {
    console.error("Staff advice endpoint error", error);
    res.status(500).json({ success: false, error: "AI advice failed. Try again shortly." });
  }
});

app.post("/api/product-photo-search", rateLimit(), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  if (!ctx) return;
  const { storeId } = ctx;
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== "string") return res.status(400).json({ success: false, error: "No image provided." });
    if (image.length > 14_000_000) return res.status(413).json({ success: false, error: "Image is too large." });

    let mimeType = "image/jpeg";
    let base64Data = image;
    if (image.startsWith("data:")) {
      const parts = image.split(";base64,");
      mimeType = parts[0].replace("data:", "") || mimeType;
      base64Data = parts[1] || "";
    }
    if (!/^image\/(jpeg|png|webp|jpg)$/i.test(mimeType)) return res.status(415).json({ success: false, error: "Unsupported image type." });

    const data = await runGeminiProductPhoto(storeId, base64Data, mimeType);
    if (!data) return res.status(503).json({ success: false, error: "AI unavailable — search manually." });
    return res.json({ success: true, provider: "gemini", data });
  } catch (error) {
    console.error("Product photo search endpoint error", error);
    res.status(500).json({ success: false, error: "AI photo search failed. Search manually." });
  }
});

async function start() {
  if (!isProduction) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve(__dirname, "dist");
    app.use(express.static(dist, { maxAge: "1y", index: false }));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled server error", error);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error." });
  });

  app.listen(PORT, () => console.log(`DS Mobile & Digital Hub running on http://localhost:${PORT}`));
}

start().catch((error) => {
  console.error("Server startup failed", error);
  process.exit(1);
});
