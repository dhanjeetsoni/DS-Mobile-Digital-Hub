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
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.7-flash";

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
    msg.includes("has not been used")
  ) {
    return "invalid";
  }

  return null;
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
    try {
      const result = await fn(clientForKey(entry.apiKey));
      activeKeyIndexByPool.set(poolId, idx);
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
        continue;
      }
      throw err;
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
    })
  );
  const size = parseFloat(String(response.text || "0").trim().match(/[\d.]+/)?.[0] || "0") || 0;
  screenSizeCache.set(key, { size, at: Date.now() });
  if (size) await saveScreenSizeToSupabase(key, modelName, size);
  return size;
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
    })
  );
  return (response.text || "").trim();
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

      default:
        return json({ success: false, error: "Unknown route." }, 404);
    }
  } catch (error) {
    console.error("ai-gateway unhandled error", error);
    return json({ success: false, error: "Internal server error." }, 500);
  }
});
