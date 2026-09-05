import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai@2";

// ---------------------------------------------------------------------------
// ai-gateway — Supabase Edge Function
//
// WHY THIS EXISTS (root cause, see DEEP-RECHECK-REPORT / handoff notes):
// /api/ocr-phone, /api/ocr-accessory, /api/business-insights, /api/staff-advice,
// /api/product-photo-search and /api/screen-size-lookup were only ever
// implemented in server.ts (a Node/Express server). That server is started by
// `npm start` on a developer machine — it has never been deployed anywhere
// reachable. The frontend called these as relative fetch("/api/...") paths,
// assuming whatever served the frontend was also running that Express server.
//
// The Windows .exe (Tauri) only bundles the static frontend build
// (src-tauri/tauri.conf.json -> frontendDist: "../dist") with no backend
// sidecar, so in the desktop app "/api/..." resolves to Tauri's own local
// asset server, which has no such route and falls back to index.html. The
// client then tries to JSON.parse the returned HTML -> "Unexpected token '<'"
// (OCR) or a generic "AI insights unavailable" (business insights, same
// underlying cause with a friendlier message).
//
// This function moves that logic to Supabase Edge Functions, matching the
// architecture the rest of the app already uses (r2-storage, staff-manage,
// telegram-connect are all Edge Functions; the Gemini key pool already lives
// in Supabase's `gemini_api_keys` table via service-role access). Once this
// is deployed, the frontend calls a real, always-on HTTPS endpoint regardless
// of whether it's running in a browser tab or the packaged Tauri app — no
// bundled Node server or sidecar process needed.
//
// Route shape (after Supabase's own "/ai-gateway" prefix is stripped):
//   POST /ocr-phone
//   POST /ocr-accessory
//   POST /screen-size-lookup
//   POST /business-insights
//   POST /staff-advice
//   POST /product-photo-search
//   GET  /health
//
// AI feature batch (v36) — same auth/rate-limit/failover pattern as above:
//   POST /resale-price-advisor  — second-hand phone resale price range
//   POST /customer-reply-draft  — WhatsApp/Telegram reply draft assistant
//   POST /demand-forecast       — reorder suggestions from sales velocity
//   POST /ocr-expense           — expense receipt/bill photo -> category+amount
//   POST /churn-risk            — loyalty churn risk + win-back message drafts
//   POST /cron-daily-digest     — cron-only (x-cron-secret), queues an AI
//                                 daily digest into telegram_outbox per store
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.7-flash";
// Speed: disable Gemini's extended "thinking" step for every call in this
// gateway. None of these prompts need multi-step reasoning (OCR fields,
// short Hinglish summaries, JSON-schema extraction) — thinking only adds
// latency here, so every request below asks for the fastest possible
// response instead of paying for a reasoning pass it doesn't need.
const FAST_MODE_CONFIG = { thinkingConfig: { thinkingBudget: 0 } };

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Small in-memory limiter for expensive OCR/AI calls (best-effort — Edge
// Function instances are ephemeral, so this resets on cold start; production
// deployments should also enforce edge/WAF limits, same caveat as before).
// ---------------------------------------------------------------------------
const rateMap = new Map<string, { count: number; resetAt: number }>();
let lastRateMapSweep = 0;
function checkRateLimit(key: string, windowMs = 60_000, max = 12): boolean {
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
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
}

// ---------------------------------------------------------------------------
// Multi-key Gemini failover pool — ported as-is from server.ts (Step 2.1 /
// 2.2). A store's keys live in `gemini_api_keys`, set by the Owner via the
// save_gemini_api_key() RPC. Only this service-role client may read the raw
// key values.
// ---------------------------------------------------------------------------
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
    if (keys.length === 0) {
      keys = data.map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
    }
  }
  if (keys.length === 0 && ENV_GEMINI_KEYS.length > 0) {
    keys = ENV_GEMINI_KEYS.map((apiKey, i) => ({ slot: i + 1, apiKey }));
  }
  storeKeyPoolCache.set(poolId, { keys, at: Date.now() });
  return keys;
}

function invalidateKeyPoolCache(storeId: string | null) {
  storeKeyPoolCache.delete(storeId && supabaseAdmin ? storeId : ENV_POOL_ID);
}

async function markKeyResult(
  storeId: string | null,
  slot: number,
  ok: boolean,
  errMsg?: string,
  failureStatus: "exhausted" | "invalid" = "exhausted"
) {
  if (!storeId || !supabaseAdmin) return;
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

const activeKeyIndexByPool = new Map<string, number>();

function classifyGeminiFailure(err: any): "quota" | "invalid" | "unavailable" | null {
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
    msg.includes("has not been used")
  ) {
    return "invalid";
  }

  // Google's own model-overload error ("This model is currently
  // experiencing high demand... usually temporary"). Nothing wrong with
  // the key or the request — a short retry on the SAME key almost always
  // succeeds, so this must not be treated like "quota"/"invalid" (which
  // cool the key down / remove it from rotation).
  if (
    status === 503 ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("high demand")
  ) {
    return "unavailable";
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasAI(): boolean {
  return ENV_GEMINI_KEYS.length > 0 || Boolean(supabaseAdmin);
}

async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable — no Gemini API keys configured. Owner: add keys in Settings.");

  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (activeIdx + attempt) % keys.length;
    const entry = keys[idx];
    // Up to 2 quick retries on the SAME key for a transient "model
    // overloaded" error (Google's own message says these are usually a
    // few seconds, not a real outage) before treating it like any other
    // failure and rotating to the next key.
    for (let overloadRetry = 0; overloadRetry <= 2; overloadRetry++) {
      try {
        const result = await fn(clientForKey(entry.apiKey));
        activeKeyIndexByPool.set(poolId, idx);
        void markKeyResult(storeId, entry.slot, true);
        return result;
      } catch (err) {
        lastError = err;
        const failure = classifyGeminiFailure(err);
        if (failure === "unavailable" && overloadRetry < 2) {
          await sleep(600 * (overloadRetry + 1));
          continue;
        }
        if (!failure) throw err; // Not a key problem (bad input, etc) — fail fast, don't burn other keys retrying it.
        console.warn(
          `Gemini key (store=${poolId}, slot=${entry.slot}) failed (${failure}) — ` +
            (failure === "invalid" ? "marking invalid, removing from rotation." : "cooling down, rotating to next key.")
        );
        void markKeyResult(storeId, entry.slot, false, err?.message, failure === "invalid" ? "invalid" : "exhausted");
        break;
      }
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

// ---------------------------------------------------------------------------
// Auth: same boundary as requireSupabaseUserAndStore() in server.ts.
// ---------------------------------------------------------------------------
const storeIdByUserCache = new Map<string, { storeId: string | null; at: number }>();
const STORE_ID_CACHE_MS = 60_000;

async function requireUserAndStore(req: Request): Promise<{ userId: string; storeId: string | null } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || !SUPABASE_URL || !SERVICE_ROLE_KEY || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  const cached = storeIdByUserCache.get(data.user.id);
  if (cached && Date.now() - cached.at < STORE_ID_CACHE_MS) {
    return { userId: data.user.id, storeId: cached.storeId };
  }
  const { data: profile } = await supabaseAdmin.from("profiles").select("store_id").eq("id", data.user.id).maybeSingle();
  const storeId = profile?.store_id || null;
  storeIdByUserCache.set(data.user.id, { storeId, at: Date.now() });
  return { userId: data.user.id, storeId };
}

// ---------------------------------------------------------------------------
// Phone OCR (box / about-screen)
// ---------------------------------------------------------------------------
const emptyOcrResult = (imageType: string) => ({
  brand: "", modelName: "", imei1: "", imei2: "", serialNo: "", color: "",
  ramStorage: "", mrp: 0, sellingPriceSuggested: 0, androidVersion: "",
  batteryHealth: "", detectedCategory: imageType === "about_screen" ? "Second-Hand Mobile" : "New Mobile",
  notes: ""
});

function normalizeOcr(input: any, imageType: string) {
  const base = { ...emptyOcrResult(imageType), ...(input || {}) };
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
    detectedCategory: base.detectedCategory || emptyOcrResult(imageType).detectedCategory,
    notes: String(base.notes || "").trim(),
  };
}

async function runGeminiPhoneOcr(storeId: string | null, base64Data: string, mimeType: string, imageType: string) {
  if (!hasAI()) return null;
  const prompt = `Read this mobile/product image. Extract ONLY information visibly supported by the image.
Return JSON fields: brand, modelName, imei1, imei2, serialNo, color, ramStorage, mrp, sellingPriceSuggested, androidVersion, batteryHealth, detectedCategory, notes.
Never invent or infer an absent value. An IMEI is valid only when a real 15-digit number is visibly present.
Image type: ${imageType}.`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brand: { type: Type.STRING }, modelName: { type: Type.STRING }, imei1: { type: Type.STRING },
            imei2: { type: Type.STRING }, serialNo: { type: Type.STRING }, color: { type: Type.STRING },
            ramStorage: { type: Type.STRING }, mrp: { type: Type.NUMBER }, sellingPriceSuggested: { type: Type.NUMBER },
            androidVersion: { type: Type.STRING }, batteryHealth: { type: Type.STRING },
            detectedCategory: { type: Type.STRING }, notes: { type: Type.STRING }
          }
        }
      }
    })
  );
  return normalizeOcr(JSON.parse(response.text || "{}"), imageType);
}

// ---------------------------------------------------------------------------
// Accessory packaging OCR
// ---------------------------------------------------------------------------
function normalizeAccessory(input: any) {
  const base = input || {};
  const rawModels: unknown = base.compatibleModels;
  const models = Array.isArray(rawModels)
    ? rawModels.map((m) => String(m || "").trim()).filter(Boolean)
    : String(rawModels || "")
        .split(/[,/\n]/)
        .map((m) => m.trim())
        .filter(Boolean);
  const seen = new Set<string>();
  const compatibleModels = models.filter((m) => {
    const k = m.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let screenSizeInches = Number(base.screenSizeInches) || 0;
  let screenSizeMaxInches = Number(base.screenSizeMaxInches) || 0;
  if (screenSizeMaxInches && screenSizeInches && screenSizeMaxInches < screenSizeInches) {
    [screenSizeInches, screenSizeMaxInches] = [screenSizeMaxInches, screenSizeInches];
  }
  if (!screenSizeInches && screenSizeMaxInches) {
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
      model: GEMINI_MODEL,
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
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
// Screen-size lookup (with the same two-layer cache: in-memory + Supabase
// `phone_screen_size_cache`, durable/shared across every store and restart).
// ---------------------------------------------------------------------------
const screenSizeCache = new Map<string, { size: number; at: number }>();
const SCREEN_SIZE_CACHE_MS = 24 * 60 * 60 * 1000;

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
    // Best-effort only.
  }
}

async function runScreenSizeLookup(storeId: string | null, modelName: string): Promise<number> {
  const key = modelName.trim().toLowerCase();

  const cached = screenSizeCache.get(key);
  if (cached && Date.now() - cached.at < SCREEN_SIZE_CACHE_MS) return cached.size;

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
      model: GEMINI_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: FAST_MODE_CONFIG,
    })
  );
  const size = parseFloat(String(response.text || "0").trim().match(/[\d.]+/)?.[0] || "0") || 0;
  screenSizeCache.set(key, { size, at: Date.now() });
  if (size) await saveScreenSizeToSupabase(key, modelName, size);
  return size;
}

// Step 2026-09-05: batch/accurate variant used by the Add Product form.
// Instead of trusting a packaging photo's own printed "for 6.5-6.7 inch"
// text (which is often vague/rounded across a long model list and produced
// a noisy, wrong-looking range), this looks up each named model's REAL
// screen size individually — via the same cache as runScreenSizeLookup, so
// a model looked up once (from any store/product) stays instant — and
// returns the true min/max across the whole compatible-models list, in a
// single extra Gemini call for whichever models aren't already cached.
async function runScreenSizeRangeLookup(
  storeId: string | null,
  modelNames: string[]
): Promise<{ sizes: { modelName: string; size: number }[]; minSize: number; maxSize: number }> {
  const cleaned = Array.from(new Set(modelNames.map((m) => String(m || "").trim()).filter(Boolean))).slice(0, 40);
  if (cleaned.length === 0) return { sizes: [], minSize: 0, maxSize: 0 };

  const results: { modelName: string; size: number }[] = [];
  const uncached: string[] = [];
  for (const m of cleaned) {
    const key = m.toLowerCase();
    const cached = screenSizeCache.get(key);
    if (cached && Date.now() - cached.at < SCREEN_SIZE_CACHE_MS) {
      results.push({ modelName: m, size: cached.size });
      continue;
    }
    const fromDb = await getScreenSizeFromSupabase(key);
    if (fromDb) {
      screenSizeCache.set(key, { size: fromDb, at: Date.now() });
      results.push({ modelName: m, size: fromDb });
      continue;
    }
    uncached.push(m);
  }

  if (uncached.length > 0 && hasAI()) {
    const prompt = `For EACH of the following mobile phone models, give its real diagonal screen size
in inches (a single number, e.g. 6.5), based on your knowledge of that specific model — do not
guess by averaging or copying another model's size. If you genuinely don't recognize a model,
use 0 for that one instead of a guess.
Respond ONLY as compact JSON: { "sizes": [ { "modelName": string, "screenSizeInches": number } ] },
with exactly one entry per model below, in the same order, using the exact modelName given.

MODELS:
${JSON.stringify(uncached)}`;
    try {
      const response = await runWithGeminiFailover(storeId, (ai) =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: { parts: [{ text: prompt }] },
          config: {
            ...FAST_MODE_CONFIG,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                sizes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { modelName: { type: Type.STRING }, screenSizeInches: { type: Type.NUMBER } },
                  },
                },
              },
            },
          },
        })
      );
      const parsed = JSON.parse(response.text || "{}");
      const arr = Array.isArray(parsed.sizes) ? parsed.sizes : [];
      for (const item of arr) {
        const modelName = String(item.modelName || "").trim();
        const size = Number(item.screenSizeInches) || 0;
        if (!modelName) continue;
        results.push({ modelName, size });
        if (size) {
          const key = modelName.toLowerCase();
          screenSizeCache.set(key, { size, at: Date.now() });
          void saveScreenSizeToSupabase(key, modelName, size);
        }
      }
    } catch (e) {
      console.warn("runScreenSizeRangeLookup: batch AI lookup failed", e);
    }
  }

  const validSizes = results.map((r) => r.size).filter((s) => s > 0);
  const minSize = validSizes.length ? Math.min(...validSizes) : 0;
  const maxSize = validSizes.length ? Math.max(...validSizes) : 0;
  return { sizes: results, minSize, maxSize };
}

// ---------------------------------------------------------------------------
// Product photo search ("Photo Stock Finder")
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
      model: GEMINI_MODEL,
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
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
// Business insights (Owner) / Staff advice — Hinglish summaries
// ---------------------------------------------------------------------------
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
      model: GEMINI_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: FAST_MODE_CONFIG,
    })
  );
  return (response.text || "").trim();
}

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
      model: GEMINI_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: FAST_MODE_CONFIG,
    })
  );
  return (response.text || "").trim();
}

// ---------------------------------------------------------------------------
// AI Feature: Resale Price Advisor (second-hand phones)
// ---------------------------------------------------------------------------
async function runResalePriceAdvisor(storeId: string | null, input: Record<string, unknown>) {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are a pricing advisor for a small Indian second-hand mobile phone shop.
All amounts are in INR (₹). Based ONLY on the device details below, suggest a fair resale
price RANGE for reselling this phone, plus a single recommended list price. Consider brand,
model, RAM/storage, condition grade, battery health, and any market reference price given.
Respond ONLY as compact JSON with keys: minPrice (number), maxPrice (number), listPrice (number),
reasoning (a short Hinglish explanation, under 60 words, no markdown).
Never invent facts not present below.

DEVICE DATA:
${JSON.stringify(input)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            minPrice: { type: Type.NUMBER },
            maxPrice: { type: Type.NUMBER },
            listPrice: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
          },
        },
      },
    })
  );
  const parsed = JSON.parse(response.text || "{}");
  return {
    minPrice: Number(parsed.minPrice) || 0,
    maxPrice: Number(parsed.maxPrice) || 0,
    listPrice: Number(parsed.listPrice) || 0,
    reasoning: String(parsed.reasoning || "").trim(),
  };
}

// ---------------------------------------------------------------------------
// AI Feature: Customer Reply Draft (WhatsApp/Telegram inquiry assistant)
// ---------------------------------------------------------------------------
async function runCustomerReplyDraft(storeId: string | null, input: Record<string, unknown>) {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are a friendly counter staff member at a small Indian mobile phone &
digital accessories shop, replying to a customer's WhatsApp/Telegram message. Using ONLY the
customer's message and the matched product/stock info given below, write ONE short, warm,
ready-to-send reply in simple Hinglish (Hindi+English mix). Mention price/stock ONLY if given
below — never invent a price or stock count. If nothing matched, politely ask the customer for
more detail (model name, photo, etc.) instead of guessing. Keep it under 55 words, no markdown,
no bullet points — just the message text as it should be sent.

CUSTOMER MESSAGE:
${String(input.customerMessage || "")}

MATCHED PRODUCTS/STOCK (may be empty):
${JSON.stringify(input.matchedProducts || [])}

SHOP NAME: ${String(input.shopName || "our shop")}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ text: prompt }] }, config: FAST_MODE_CONFIG })
  );
  return (response.text || "").trim();
}

// ---------------------------------------------------------------------------
// AI Feature: Demand Forecast & Reorder Suggestions
// ---------------------------------------------------------------------------
async function runDemandForecast(storeId: string | null, products: unknown[]) {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are an inventory planner for a small Indian mobile phone & digital
accessories shop. Below is a list of products with their recent sales velocity and current
stock. For EACH product likely to run out soon (based on velocity vs current stock), suggest a
reorder quantity and mark urgency as "high", "medium", or "low". Ignore products with healthy
stock relative to their velocity. Respond ONLY as compact JSON: { "items": [ { "productName":
string, "suggestedReorderQty": number, "urgency": "high"|"medium"|"low", "reason": short
Hinglish phrase } ], "summary": short Hinglish overview under 50 words }. Never invent products
not present below.

PRODUCTS (name, last30DaysQtySold, currentStock, minStock):
${JSON.stringify(products)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  productName: { type: Type.STRING },
                  suggestedReorderQty: { type: Type.NUMBER },
                  urgency: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
              },
            },
            summary: { type: Type.STRING },
          },
        },
      },
    })
  );
  const parsed = JSON.parse(response.text || "{}");
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return {
    items: items.map((it: any) => ({
      productName: String(it.productName || "").trim(),
      suggestedReorderQty: Math.max(0, Math.round(Number(it.suggestedReorderQty) || 0)),
      urgency: ["high", "medium", "low"].includes(it.urgency) ? it.urgency : "low",
      reason: String(it.reason || "").trim(),
    })),
    summary: String(parsed.summary || "").trim(),
  };
}

// ---------------------------------------------------------------------------
// AI Feature: Expense Receipt OCR
// ---------------------------------------------------------------------------
function normalizeExpenseOcr(input: any) {
  const base = input || {};
  const allowedCategories = ["Rent", "Electricity", "Internet/Phone", "Salary", "Transport", "Supplier Payment", "Maintenance", "Stationery", "Food", "Other"];
  const category = allowedCategories.includes(base.category) ? base.category : "Other";
  return {
    description: String(base.description || "").trim().slice(0, 200),
    amount: Number(base.amount) || 0,
    category,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(base.date || "")) ? base.date : "",
    method: ["Cash", "UPI", "Bank Transfer", "Cheque"].includes(base.method) ? base.method : "Cash",
  };
}

async function runExpenseOcr(storeId: string | null, base64Data: string, mimeType: string) {
  if (!hasAI()) return null;
  const prompt = `Read this shop expense receipt/bill photo (electricity bill, rent receipt,
supplier bill, maintenance bill, etc. for a small Indian mobile phone shop). Extract ONLY
information visibly printed/supported by the image. Return JSON fields:
- description: a short 3-6 word description of what this expense is for.
- amount: the total amount paid, as a plain number (no currency symbol/commas).
- category: best single match from exactly: "Rent", "Electricity", "Internet/Phone", "Salary",
  "Transport", "Supplier Payment", "Maintenance", "Stationery", "Food", "Other".
- date: the bill/payment date in YYYY-MM-DD format if visible, else empty string.
- method: best guess of payment method from exactly "Cash", "UPI", "Bank Transfer", "Cheque" if
  indicated on the receipt, else "Cash".
Never invent an amount or date not visibly supported by the image.`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            date: { type: Type.STRING },
            method: { type: Type.STRING },
          },
        },
      },
    })
  );
  return normalizeExpenseOcr(JSON.parse(response.text || "{}"));
}

// ---------------------------------------------------------------------------
// AI Feature: Loyalty Churn Risk Predictor
// ---------------------------------------------------------------------------
async function runChurnRisk(storeId: string | null, customers: unknown[]) {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are a customer-retention advisor for a small Indian mobile phone &
digital accessories shop. Below is a list of repeat customers with their purchase history.
Identify customers who are at risk of churn (used to buy regularly, haven't come back in a
while, relative to their own past frequency) — do NOT flag customers with little/no history as
at-risk. For each at-risk customer, suggest a short, warm, personal win-back WhatsApp message
in Hinglish (under 40 words), mentioning a small loyalty incentive ONLY if loyaltyPoints > 0.
Respond ONLY as compact JSON: { "atRisk": [ { "name": string, "phone": string, "reason": short
Hinglish phrase, "suggestedMessage": string } ], "summary": short Hinglish overview under 50
words }. Never invent a customer not present below.

CUSTOMERS (name, phone, lastPurchaseDate, totalSpent, purchaseCount, avgDaysBetweenPurchases, loyaltyPoints):
${JSON.stringify(customers)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        ...FAST_MODE_CONFIG,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            atRisk: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  suggestedMessage: { type: Type.STRING },
                },
              },
            },
            summary: { type: Type.STRING },
          },
        },
      },
    })
  );
  const parsed = JSON.parse(response.text || "{}");
  const atRisk = Array.isArray(parsed.atRisk) ? parsed.atRisk : [];
  return {
    atRisk: atRisk.map((c: any) => ({
      name: String(c.name || "").trim(),
      phone: String(c.phone || "").trim(),
      reason: String(c.reason || "").trim(),
      suggestedMessage: String(c.suggestedMessage || "").trim(),
    })),
    summary: String(parsed.summary || "").trim(),
  };
}

// ---------------------------------------------------------------------------
// AI Feature: Scheduled Daily AI Digest (Telegram) — cron-only, no user
// session. Reads each opted-in store's mirrored app state from `store_state`
// (same JSON shape the client itself displays, already used this way by the
// Confidential Price flow above in telegram-connect), builds a one-day
// summary, asks Gemini for a short Hinglish digest, and queues it into
// `telegram_outbox` for the existing telegram-outbox-worker to actually send
// — reusing that delivery pipeline instead of duplicating Telegram API calls.
// ---------------------------------------------------------------------------
async function runDailyDigestSweep(): Promise<{ queued: number; skipped: number; errors: number }> {
  if (!supabaseAdmin) return { queued: 0, skipped: 0, errors: 0 };
  let queued = 0, skipped = 0, errors = 0;

  const { data: stores, error: storesErr } = await supabaseAdmin
    .from("stores").select("id").eq("ai_digest_enabled", true);
  if (storesErr || !stores?.length) return { queued: 0, skipped: 0, errors: storesErr ? 1 : 0 };

  for (const store of stores) {
    try {
      const { data: conn } = await supabaseAdmin
        .from("telegram_connections").select("chat_id").eq("store_id", store.id).maybeSingle();
      if (!conn?.chat_id) { skipped++; continue; }

      const { data: stateRow } = await supabaseAdmin
        .from("store_state").select("state").eq("store_id", store.id).maybeSingle();
      const state = (stateRow?.state || {}) as {
        sales?: any[]; expenses?: { shop?: any[] }; products?: any[]; settings?: { shopName?: string };
      };

      const today = new Date().toISOString().slice(0, 10);
      const todaySales = (state.sales || []).filter((s) => s?.date === today && s?.status !== "Cancelled");
      const totalSalesToday = todaySales.reduce((a, s) => a + (Number(s.total) || 0), 0);
      const todayExpenses = (state.expenses?.shop || []).filter((e) => e?.date === today);
      const totalExpensesToday = todayExpenses.reduce((a, e) => a + (Number(e.amount) || 0), 0);
      const lowStockCount = (state.products || []).filter((p) => (Number(p.stock) || 0) <= (Number(p.minStock) || 0)).length;
      const topProductQty: Record<string, number> = {};
      todaySales.forEach((s) => (s.items || []).forEach((i: any) => {
        topProductQty[i.name] = (topProductQty[i.name] || 0) + (Number(i.qty) || 0);
      }));
      const topProducts = Object.entries(topProductQty).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => `${name} x${qty}`);

      if (todaySales.length === 0 && todayExpenses.length === 0) { skipped++; continue; }

      const message = await runBusinessDigestText(store.id, {
        shopName: state.settings?.shopName || "Shop",
        date: today,
        invoiceCount: todaySales.length,
        totalSalesToday: Math.round(totalSalesToday),
        totalExpensesToday: Math.round(totalExpensesToday),
        lowStockCount,
        topProducts,
      });

      await supabaseAdmin.from("telegram_outbox").insert({
        store_id: store.id,
        chat_id: conn.chat_id,
        message,
        status: "pending",
      });
      queued++;
    } catch (e) {
      console.error("daily digest failed for store", store.id, e);
      errors++;
    }
  }
  return { queued, skipped, errors };
}

async function runBusinessDigestText(storeId: string | null, summary: Record<string, unknown>): Promise<string> {
  const prompt = `You are writing a short end-of-day WhatsApp/Telegram-style digest for the
owner of a small Indian mobile phone & digital services shop, in simple Hinglish. Using ONLY
the numbers below, write 3-5 short lines (use "-" per line, no markdown headers/bold). Cover:
today's sales total and invoice count, today's shop expenses if any, which product(s) sold most
today if any, and a low-stock item count reminder if > 0. Keep it warm and under 90 words total.
Do not invent numbers not present below.

DATA:
${JSON.stringify(summary)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ text: prompt }] }, config: FAST_MODE_CONFIG })
  );
  return `📊 ${summary.shopName} — Daily AI Digest (${summary.date})\n\n${(response.text || "").trim()}`;
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

// ---------------------------------------------------------------------------
// 2026-09-04 additions — Due-payment reminder / Repair diagnosis / Reorder
// suggestion. Same shape as business-insights/staff-advice above: a plain
// Hinglish text reply built ONLY from the numbers/text the client sends,
// never inventing figures, never touching cost/confidential prices (those
// never leave the client for these three routes).
// ---------------------------------------------------------------------------

async function runDueReminder(storeId: string | null, input: Record<string, unknown>): Promise<string> {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You write a short, polite WhatsApp payment-reminder message in simple Hinglish (Hindi+English mix)
for a small Indian mobile & digital accessories shop to send a customer who has an outstanding due balance.
Tone: respectful, friendly, never threatening or rude — this is an ongoing customer relationship. Use ONLY the
details given below; never invent a name, amount, or date not present. If a detail is missing, simply omit that
part of the message instead of guessing. Keep it under 60 words, no markdown, ready to paste directly into
WhatsApp (can use 1-2 emoji naturally, not excessive).

DETAILS:
${JSON.stringify(input)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ text: prompt }] } })
  );
  return (response.text || "").trim();
}

async function runRepairDiagnosis(storeId: string | null, input: Record<string, unknown>): Promise<string> {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You are a helpful assistant for a mobile phone repair counter in India, helping the technician/staff
think through a customer's reported problem BEFORE they open the device. Using ONLY the device and reported-issue
text given below, in simple Hinglish (Hindi+English mix), give:
1) 2-4 most likely causes, ordered most-likely first (short bullet points, "-" per line).
2) 1-2 quick, SAFE checks to try first (e.g. restart, check charging port for lint, try another cable/charger,
   check for visible screen/back-glass cracks, check if issue happens in Safe Mode) — never suggest opening the
   device, removing the battery, or anything requiring disassembly or specialised tools; that judgement call stays
   with the technician once the device is actually opened.
3) End with exactly one line: "Yeh sirf ek prathmik AI sujhav hai — final diagnosis technician khud device khol kar hi karega."
No markdown headers/bold, keep the whole reply under 130 words. Do not invent symptoms not mentioned below.

DEVICE: ${String(input.device || "").slice(0, 200)}
REPORTED ISSUE: ${String(input.issue || "").slice(0, 500)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ text: prompt }] } })
  );
  return (response.text || "").trim();
}

async function runReorderSuggestion(storeId: string | null, input: Record<string, unknown>): Promise<string> {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You help a small Indian mobile accessories shop decide how much stock to reorder for one product.
Using ONLY the numbers given below (current stock, minimum stock level, units sold in the last 7 and last 30 days,
and the shop's own simple formula-based suggestion for comparison), in simple Hinglish (Hindi+English mix):
1) One line: suggested reorder quantity (a single number), based on actual recent sale-speed, not just the static
   formula — e.g. if it's selling fast, suggest more than the static number; if it's barely selling, suggest less
   or say "abhi zaroori nahi".
2) One short line explaining why (recent sale trend in plain words).
Keep the whole reply under 50 words, no markdown, no bullet symbols needed — 2 short lines is enough. Do not
invent any sales numbers not present below.

DATA:
${JSON.stringify(input)}`;
  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ text: prompt }] } })
  );
  return (response.text || "").trim();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const route = url.pathname
    .replace(/^\/+/, "")
    .replace(/^ai-gateway\/?/, "")
    .replace(/^functions\/v1\/ai-gateway\/?/, "");

  if (route === "health") {
    return json({ ok: true, aiConfigured: hasAI() });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  const ip = clientIp(req);

  try {
    switch (route) {
      case "ocr-phone": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`ocr-phone:${ip}`)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const decoded = decodeImage(body?.image);
        if (!body?.image) return json({ success: false, error: "No image provided." }, 400);
        if (!decoded) return json({ success: false, error: "Unsupported image type." }, 415);
        const imageType = body?.imageType || "auto";

        try {
          const gemini = await runGeminiPhoneOcr(ctx.storeId, decoded.base64Data, decoded.mimeType, imageType);
          if (gemini) {
            return json({
              success: true,
              provider: "gemini",
              verified: false,
              requiresVerification: true,
              mismatches: [],
              rawText: "",
              data: gemini,
            });
          }
          return json({ success: false, error: "AI unavailable — enter manually." }, 503);
        } catch (error) {
          console.error("OCR endpoint error", error);
          return json({ success: false, error: "OCR service failed. Enter manually." }, 500);
        }
      }

      case "ocr-accessory": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`ocr-accessory:${ip}`)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const decoded = decodeImage(body?.image);
        if (!body?.image) return json({ success: false, error: "No image provided." }, 400);
        if (!decoded) return json({ success: false, error: "Unsupported image type." }, 415);

        try {
          const data = await runGeminiAccessory(ctx.storeId, decoded.base64Data, decoded.mimeType);
          if (!data) return json({ success: false, error: "AI unavailable — enter manually." }, 503);
          return json({ success: true, provider: "gemini", data });
        } catch (error) {
          console.error("Accessory OCR endpoint error", error);
          return json({ success: false, error: "AI scan failed. Enter manually." }, 500);
        }
      }

      case "screen-size-lookup": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`screen-size-lookup:${ip}`, 60_000, 30)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const modelName = body?.modelName;
        if (!modelName || typeof modelName !== "string" || modelName.trim().length < 2) {
          return json({ success: false, error: "No model name provided." }, 400);
        }

        try {
          const size = await runScreenSizeLookup(ctx.storeId, modelName.trim().slice(0, 80));
          if (!size) return json({ success: false, error: "Could not determine screen size for this model." }, 503);
          return json({ success: true, modelName: modelName.trim(), screenSizeInches: size });
        } catch (error) {
          console.error("Screen-size lookup error", error);
          return json({ success: false, error: "Lookup failed." }, 500);
        }
      }

      case "screen-size-range": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`screen-size-range:${ip}`, 60_000, 15)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const modelNames = Array.isArray(body?.modelNames)
          ? body.modelNames.filter((m: unknown) => typeof m === "string" && m.trim().length > 1)
          : null;
        if (!modelNames || modelNames.length === 0) return json({ success: false, error: "No models provided." }, 400);

        try {
          const result = await runScreenSizeRangeLookup(ctx.storeId, modelNames);
          if (!result.sizes.length) return json({ success: false, error: "Could not determine display size." }, 503);
          return json({ success: true, ...result });
        } catch (error) {
          console.error("Screen-size range lookup error", error);
          return json({ success: false, error: "Lookup failed." }, 500);
        }
      }

      case "business-insights": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`business-insights:${ip}`, 60_000, 6)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const summary = body?.summary;
        if (!summary || typeof summary !== "object") return json({ success: false, error: "No summary data provided." }, 400);

        try {
          const insights = await runBusinessInsights(ctx.storeId, summary);
          if (!insights) return json({ success: false, error: "AI unavailable — try again shortly." }, 503);
          return json({ success: true, insights });
        } catch (error) {
          console.error("Business insights endpoint error", error);
          return json({ success: false, error: "AI insights failed. Try again shortly." }, 500);
        }
      }

      case "staff-advice": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`staff-advice:${ip}`, 60_000, 10)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const summary = body?.summary;
        if (!summary || typeof summary !== "object") return json({ success: false, error: "No summary data provided." }, 400);

        try {
          const advice = await runStaffAdvice(ctx.storeId, summary);
          if (!advice) return json({ success: false, error: "AI unavailable — try again shortly." }, 503);
          return json({ success: true, advice });
        } catch (error) {
          console.error("Staff advice endpoint error", error);
          return json({ success: false, error: "AI advice failed. Try again shortly." }, 500);
        }
      }

      case "product-photo-search": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`product-photo-search:${ip}`)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const decoded = decodeImage(body?.image);
        if (!body?.image) return json({ success: false, error: "No image provided." }, 400);
        if (!decoded) return json({ success: false, error: "Unsupported image type." }, 415);

        try {
          const data = await runGeminiProductPhoto(ctx.storeId, decoded.base64Data, decoded.mimeType);
          if (!data) return json({ success: false, error: "AI unavailable — search manually." }, 503);
          return json({ success: true, provider: "gemini", data });
        } catch (error) {
          console.error("Product photo search endpoint error", error);
          return json({ success: false, error: "AI photo search failed. Search manually." }, 500);
        }
      }

      case "due-reminder": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`due-reminder:${ip}`, 60_000, 15)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const input = body?.input;
        if (!input || typeof input !== "object") return json({ success: false, error: "No details provided." }, 400);

        try {
          const message = await runDueReminder(ctx.storeId, input);
          if (!message) return json({ success: false, error: "AI unavailable — try again shortly." }, 503);
          return json({ success: true, message });
        } catch (error) {
          console.error("Due reminder endpoint error", error);
          return json({ success: false, error: "AI reminder failed. Try again shortly." }, 500);
        }
      }

      case "repair-diagnosis": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`repair-diagnosis:${ip}`, 60_000, 15)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const input = body?.input;
        if (!input?.issue || typeof input.issue !== "string" || input.issue.trim().length < 3) {
          return json({ success: false, error: "Issue description missing." }, 400);
        }

        try {
          const diagnosis = await runRepairDiagnosis(ctx.storeId, input);
          if (!diagnosis) return json({ success: false, error: "AI unavailable — try again shortly." }, 503);
          return json({ success: true, diagnosis });
        } catch (error) {
          console.error("Repair diagnosis endpoint error", error);
          return json({ success: false, error: "AI diagnosis failed. Try again shortly." }, 500);
        }
      }

      case "reorder-suggestion": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`reorder-suggestion:${ip}`, 60_000, 20)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const input = body?.input;
        if (!input || typeof input !== "object") return json({ success: false, error: "No product data provided." }, 400);

        try {
          const suggestion = await runReorderSuggestion(ctx.storeId, input);
          if (!suggestion) return json({ success: false, error: "AI unavailable — try again shortly." }, 503);
          return json({ success: true, suggestion });
        } catch (error) {
          console.error("Reorder suggestion endpoint error", error);
          return json({ success: false, error: "AI reorder suggestion failed. Try again shortly." }, 500);
        }
      }

      case "resale-price-advisor": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`resale-price-advisor:${ip}`, 60_000, 10)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const device = body?.device;
        if (!device || typeof device !== "object") return json({ success: false, error: "No device details provided." }, 400);

        try {
          const result = await runResalePriceAdvisor(ctx.storeId, device);
          return json({ success: true, data: result });
        } catch (error) {
          console.error("Resale price advisor error", error);
          return json({ success: false, error: "AI price suggestion failed. Enter manually." }, 500);
        }
      }

      case "customer-reply-draft": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`customer-reply-draft:${ip}`, 60_000, 15)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        if (!body?.customerMessage || typeof body.customerMessage !== "string") {
          return json({ success: false, error: "No customer message provided." }, 400);
        }

        try {
          const draft = await runCustomerReplyDraft(ctx.storeId, body);
          if (!draft) return json({ success: false, error: "AI unavailable — write manually." }, 503);
          return json({ success: true, draft });
        } catch (error) {
          console.error("Customer reply draft error", error);
          return json({ success: false, error: "AI reply draft failed. Write manually." }, 500);
        }
      }

      case "demand-forecast": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`demand-forecast:${ip}`, 60_000, 6)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const products = Array.isArray(body?.products) ? body.products : null;
        if (!products || products.length === 0) return json({ success: false, error: "No product sales data provided." }, 400);

        try {
          const result = await runDemandForecast(ctx.storeId, products.slice(0, 150));
          return json({ success: true, data: result });
        } catch (error) {
          console.error("Demand forecast error", error);
          return json({ success: false, error: "AI forecast failed. Try again shortly." }, 500);
        }
      }

      case "ocr-expense": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`ocr-expense:${ip}`)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const decoded = decodeImage(body?.image);
        if (!body?.image) return json({ success: false, error: "No image provided." }, 400);
        if (!decoded) return json({ success: false, error: "Unsupported image type." }, 415);

        try {
          const data = await runExpenseOcr(ctx.storeId, decoded.base64Data, decoded.mimeType);
          if (!data) return json({ success: false, error: "AI unavailable — enter manually." }, 503);
          return json({ success: true, provider: "gemini", data });
        } catch (error) {
          console.error("Expense OCR error", error);
          return json({ success: false, error: "AI scan failed. Enter manually." }, 500);
        }
      }

      case "churn-risk": {
        const ctx = await requireUserAndStore(req);
        if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
        if (!checkRateLimit(`churn-risk:${ip}`, 60_000, 6)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

        const body = await req.json().catch(() => ({}));
        const customers = Array.isArray(body?.customers) ? body.customers : null;
        if (!customers || customers.length === 0) return json({ success: false, error: "No customer data provided." }, 400);

        try {
          const result = await runChurnRisk(ctx.storeId, customers.slice(0, 200));
          return json({ success: true, data: result });
        } catch (error) {
          console.error("Churn risk error", error);
          return json({ success: false, error: "AI churn analysis failed. Try again shortly." }, 500);
        }
      }

      case "cron-daily-digest": {
        // No user session in cron context — same shared-secret pattern as
        // telegram-outbox-worker-sweep / telegram-connect's weekly report.
        const cronSecret = Deno.env.get("CRON_SECRET") || "";
        const provided = req.headers.get("x-cron-secret") || "";
        const isCronSweep = cronSecret.length > 0 && provided.length > 0 && provided === cronSecret;
        if (!isCronSweep) return json({ success: false, error: "Unauthorized." }, 401);

        try {
          const result = await runDailyDigestSweep();
          return json({ success: true, ...result });
        } catch (error) {
          console.error("Daily digest sweep error", error);
          return json({ success: false, error: "Digest sweep failed." }, 500);
        }
      }

      default:
        return json({ success: false, error: "Unknown route." }, 404);
    }
  } catch (error) {
    console.error("ai-gateway unhandled error", error);
    return json({ success: false, error: "Internal server error." }, 500);
  }
});
