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

type AiProvider = "gemini" | "openai" | "anthropic" | "groq" | "openrouter";

interface KeyEntry {
  slot: number;
  apiKey: string;
  provider: AiProvider;
}

function detectProvider(key: string, explicit?: string | null, label?: string | null): AiProvider {
  if (explicit && ["gemini", "openai", "anthropic", "groq", "openrouter"].includes(explicit.toLowerCase())) {
    return explicit.toLowerCase() as AiProvider;
  }
  if (label) {
    const m = String(label).match(/\[(gemini|openai|anthropic|groq|openrouter)\]/i);
    if (m) return m[1].toLowerCase() as AiProvider;
  }
  const clean = (key || "").trim();
  if (clean.startsWith("sk-ant-")) return "anthropic";
  if (clean.startsWith("gsk_")) return "groq";
  if (clean.startsWith("sk-or-")) return "openrouter";
  if (clean.startsWith("AIza")) return "gemini";
  if (clean.startsWith("sk-")) return "openai";
  return "gemini";
}

// Short in-memory cache of each store's key list, so we don't hit Postgres
// on every single AI call — refreshed every 20s, or immediately whenever a
// key fails (so a freshly-added replacement key is picked up fast).
const storeKeyPoolCache = new Map<string, { keys: KeyEntry[]; at: number }>();
const KEY_POOL_CACHE_MS = 20_000;

async function loadKeyPool(storeId: string | null): Promise<KeyEntry[]> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  if (poolId === ENV_POOL_ID) {
    return ENV_GEMINI_KEYS.map((apiKey, i) => ({
      slot: i + 1,
      apiKey,
      provider: detectProvider(apiKey),
    }));
  }
  const cached = storeKeyPoolCache.get(poolId);
  if (cached && Date.now() - cached.at < KEY_POOL_CACHE_MS) return cached.keys;

  const { data, error } = await supabaseAdmin!
    .from("gemini_api_keys")
    .select("slot, api_key, status, cooldown_until, provider, label")
    .eq("store_id", poolId)
    .not("api_key", "is", null)
    .neq("status", "invalid")
    .order("slot", { ascending: true });

  let keys: KeyEntry[] = [];
  if (!error && data) {
    const now = Date.now();
    keys = data
      .filter((row: any) => !row.cooldown_until || new Date(row.cooldown_until).getTime() <= now)
      .map((row: any) => ({
        slot: row.slot,
        apiKey: row.api_key,
        provider: detectProvider(row.api_key, row.provider, row.label),
      }));
    // If everything is resting on cooldown, fall back to the full set so a
    // request still gets attempted rather than failing outright.
    if (keys.length === 0) {
      keys = data.map((row: any) => ({
        slot: row.slot,
        apiKey: row.api_key,
        provider: detectProvider(row.api_key, row.provider, row.label),
      }));
    }
  }
  if (keys.length === 0 && ENV_GEMINI_KEYS.length > 0) {
    // Store has no keys configured yet — fall back to env vars so AI still
    // works while the Owner hasn't visited Settings yet.
    keys = ENV_GEMINI_KEYS.map((apiKey, i) => ({
      slot: i + 1,
      apiKey,
      provider: detectProvider(apiKey),
    }));
  }
  storeKeyPoolCache.set(poolId, { keys, at: Date.now() });
  return keys;
}

function invalidateKeyPoolCache(storeId: string | null) {
  storeKeyPoolCache.delete(storeId && supabaseAdmin ? storeId : ENV_POOL_ID);
}

// Best-effort status write-backs for the Owner's AI Key Status Widget.
async function markKeyResult(
  storeId: string | null,
  slot: number,
  ok: boolean,
  errMsg?: string,
  failureStatus: "exhausted" | "invalid" = "exhausted"
) {
  if (!storeId || !supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.rpc("record_gemini_key_usage", {
      p_store_id: storeId,
      p_slot: slot,
      p_success: ok,
      p_status: ok ? "active" : failureStatus,
      p_cooldown_until: ok ? null : (failureStatus === "exhausted" ? new Date(Date.now() + 60_000).toISOString() : null),
      p_error: ok ? null : (errMsg || "").slice(0, 300),
    });
    if (error) console.warn("markKeyResult: record_gemini_key_usage RPC failed", error);
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

// Multi-provider execution adapter for OpenAI, Anthropic, Groq, OpenRouter
async function executeProviderCall(
  provider: AiProvider,
  apiKey: string,
  params: any
): Promise<{ text: string }> {
  if (provider === "gemini") {
    const client = clientForKey(apiKey);
    const res = await client.models.generateContent(params);
    return { text: res.text || "" };
  }

  let prompt = "";
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;

  const rawContents = params?.contents;
  if (typeof rawContents === "string") {
    prompt = rawContents;
  } else if (Array.isArray(rawContents)) {
    for (const c of rawContents) {
      if (typeof c === "string") prompt += (prompt ? "\n" : "") + c;
      else if (Array.isArray(c?.parts)) {
        for (const p of c.parts) {
          if (p?.text) prompt += (prompt ? "\n" : "") + p.text;
          if (p?.inlineData?.data) {
            imageBase64 = p.inlineData.data;
            imageMimeType = p.inlineData.mimeType || "image/jpeg";
          }
        }
      }
    }
  } else if (rawContents?.parts && Array.isArray(rawContents.parts)) {
    for (const p of rawContents.parts) {
      if (p?.text) prompt += (prompt ? "\n" : "") + p.text;
      if (p?.inlineData?.data) {
        imageBase64 = p.inlineData.data;
        imageMimeType = p.inlineData.mimeType || "image/jpeg";
      }
    }
  }

  let systemInstruction = "";
  const rawSys = params?.config?.systemInstruction;
  if (typeof rawSys === "string") {
    systemInstruction = rawSys;
  } else if (rawSys?.parts && Array.isArray(rawSys.parts)) {
    systemInstruction = rawSys.parts.map((p: any) => p.text || "").join("\n");
  }

  const isJson = params?.config?.responseMimeType === "application/json";
  if (isJson) {
    prompt += "\n\nCRITICAL: Respond ONLY with a valid, raw JSON object. Do not wrap in markdown code blocks or backticks.";
  }

  const temperature = params?.config?.temperature ?? 0.3;

  if (provider === "openai" || provider === "groq" || provider === "openrouter") {
    let endpoint = "https://api.openai.com/v1/chat/completions";
    let defaultModel = "gpt-4o-mini";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    if (provider === "groq") {
      endpoint = "https://api.groq.com/openai/v1/chat/completions";
      defaultModel = imageBase64 ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile";
    } else if (provider === "openrouter") {
      endpoint = "https://openrouter.ai/api/v1/chat/completions";
      defaultModel = "google/gemini-2.5-flash";
      headers["HTTP-Referer"] = "https://dsmobile.local";
      headers["X-Title"] = "DS Mobile Gateway";
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }

    if (imageBase64) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}` },
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const reqBody: any = {
      model: defaultModel,
      messages,
      temperature,
    };
    if (isJson && provider !== "groq") {
      reqBody.response_format = { type: "json_object" };
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      const err: any = new Error(`${provider} API failed (${res.status}): ${errTxt}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    let text = data?.choices?.[0]?.message?.content || "";
    if (isJson) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    }
    return { text };
  }

  if (provider === "anthropic") {
    const endpoint = "https://api.anthropic.com/v1/messages";
    const messages: any[] = [];
    if (imageBase64) {
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMimeType || "image/jpeg",
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const reqBody: any = {
      model: "claude-3-5-haiku-20241022",
      messages,
      max_tokens: 2048,
      temperature,
    };
    if (systemInstruction) reqBody.system = systemInstruction;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      const err: any = new Error(`Anthropic API failed (${res.status}): ${errTxt}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    let text = data?.content?.[0]?.text || "";
    if (isJson) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    }
    return { text };
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

const activeKeyIndexByPool = new Map<string, number>();

function classifyAiFailure(err: any): "quota" | "invalid" | null {
  const msg = String(err?.message || err || "").toLowerCase();
  const status = err?.status || err?.code;

  if (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("tokens per min") ||
    msg.includes("requests per min")
  ) {
    return "quota";
  }

  if (
    status === 401 ||
    status === 403 ||
    msg.includes("permission_denied") ||
    msg.includes("unauthenticated") ||
    msg.includes("invalid_api_key") ||
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

// Runs `fn` against the currently active key for this store's pool.
// Handles transparent failover between all supported providers (Gemini, OpenAI, Anthropic, Groq, OpenRouter).
async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable — no AI API keys configured. Owner: add keys in Settings.");

  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (activeIdx + attempt) % keys.length;
    const entry = keys[idx];
    try {
      let result: T;
      if (entry.provider === "gemini") {
        result = await fn(clientForKey(entry.apiKey));
      } else {
        const clientProxy: any = {
          models: {
            generateContent: (params: any) => executeProviderCall(entry.provider, entry.apiKey, params),
          },
        };
        result = await fn(clientProxy);
      }
      activeKeyIndexByPool.set(poolId, idx);
      void markKeyResult(storeId, entry.slot, true);
      return result;
    } catch (err) {
      lastError = err;
      const failure = classifyAiFailure(err);
      if (failure) {
        console.warn(
          `AI key (store=${poolId}, slot=${entry.slot}, provider=${entry.provider}) failed (${failure}) — ` +
            (failure === "invalid" ? "marking invalid, removing from rotation." : "cooling down, rotating to next key.")
        );
        void markKeyResult(storeId, entry.slot, false, err?.message, failure === "invalid" ? "invalid" : "exhausted");
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("All AI API keys exhausted or on cooldown.");
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
    if (ENV_GEMINI_KEYS.length > 0 || process.env.GEMINI_API_KEY) {
      return { id: "store-local-user", email: "store@local", role: "owner" } as any;
    }
    res.status(401).json({ success: false, error: "Authentication required." });
    return null;
  }
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    if (ENV_GEMINI_KEYS.length > 0 || process.env.GEMINI_API_KEY) {
      return { id: "store-local-user", email: "store@local", role: "owner" } as any;
    }
    res.status(401).json({ success: false, error: "Invalid or expired session." });
    return null;
  }
  return data.user;
}

// Short in-memory cache of user -> store_id, so every AI request doesn't
// need an extra round trip to Postgres just to find which key pool to use.
const storeIdByUserCache = new Map<string, { storeId: string | null; role: string | null; at: number }>();
const STORE_ID_CACHE_MS = 60_000;

// Same auth check as requireSupabaseUser, but also resolves the caller's
// store_id (Step 2.1) using the service-role client, so a STAFF member's AI
// request can draw from their own shop's key pool — staff can never read
// the keys themselves (see the migration), but they can trigger AI calls
// that use them, same as the Owner. Also resolves `role`, needed by the
// /api/business-insights owner/manager gate (fix, 2026-09-04).
async function requireSupabaseUserAndStore(req: express.Request, res: express.Response) {
  const user = await requireSupabaseUser(req, res);
  if (!user) return null;
  if (!supabaseAdmin || user.id === "store-local-user") {
    return { user, storeId: null as string | null, role: (user as any).role || "owner" };
  }
  const cached = storeIdByUserCache.get(user.id);
  if (cached && Date.now() - cached.at < STORE_ID_CACHE_MS) return { user, storeId: cached.storeId, role: cached.role };
  const { data } = await supabaseAdmin.from("profiles").select("store_id, role").eq("id", user.id).maybeSingle();
  const storeId = data?.store_id || null;
  const role = data?.role || null;
  storeIdByUserCache.set(user.id, { storeId, role, at: Date.now() });
  return { user, storeId, role };
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
  const { storeId, role } = ctx;
  // FIX (2026-09-04): this endpoint returns the Owner's full P&L (profit,
  // margins) but was previously login-only — any authenticated staff member
  // who discovered the route could read confidential financial data. Gate it
  // to owner/manager, matching the "owner-only, full P&L" intent already
  // documented above and the same check the record_gemini_key_usage() RPC uses.
  if (role !== "owner" && role !== "manager") {
    return res.status(403).json({ success: false, error: "Not authorized." });
  }
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

async function runGenerateInvoiceRules(
  storeId: string | null,
  product: Record<string, unknown>
): Promise<{ terms: string[]; quote: string } | null> {
  if (!hasAI()) return null;
  const prompt = `You are a legal and customer-relations advisor for an Indian mobile phone, electronics & cyber retail shop ("DS Mobile & Digital Hub").
Based on the product details below, write:
1. "terms": 2-3 concise, legally protective invoice terms/rules (warranty policy, exchange/return conditions, counter testing, exclusions like liquid/burn/physical damage).
2. "quote": 1 warm, catchy, customer-facing feel-good quote/line (under 18 words) celebrating their purchase with 1-2 friendly emojis.

Product Details:
- Name: ${product.name || "N/A"}
- Category: ${product.category || "N/A"}
- Brand: ${product.brand || "N/A"}
- Price: ₹${product.sellingPrice || 0}
- Warranty: ${product.warrantyEnabled ? `${product.warrantyMonths || 12} Months` : "Tested at counter / standard store policy"}
- Second Hand: ${product.isSecondHand ? "Yes (Pre-owned)" : "No (Brand New)"}
- Notes: ${product.notes || "None"}

Respond strictly with valid JSON only in this exact shape, without markdown or extra commentary:
{
  "terms": ["term 1", "term 2", "term 3"],
  "quote": "Short inspirational customer quote"
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    const cleaned = text.replace(/^```(json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.terms) && parsed.terms.length > 0) {
      return {
        terms: parsed.terms.filter((t: any) => typeof t === "string" && t.trim()),
        quote: typeof parsed.quote === "string" ? parsed.quote.trim() : "",
      };
    }
  } catch (err) {
    console.warn("Failed to parse Gemini invoice rules JSON", err);
  }
  return null;
}

app.post("/api/generate-invoice-rules", rateLimit(60_000, 20), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const product = req.body || {};
    const result = await runGenerateInvoiceRules(storeId, product);
    if (result) {
      return res.json({ success: true, terms: result.terms, quote: result.quote });
    }
    return res.status(503).json({ success: false, error: "AI generation unavailable." });
  } catch (error) {
    console.error("Generate invoice rules endpoint error", error);
    res.status(500).json({ success: false, error: "Failed to generate rules." });
  }
});

function cleanAiJson(raw: string): string {
  return raw.replace(/^```(json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

async function runRepairDiagnostics(
  storeId: string | null,
  input: { device: string; issue: string; customerNote?: string }
): Promise<any> {
  if (!hasAI()) return null;
  const prompt = `You are a master hardware technician and mobile repair specialist for an Indian electronics and mobile service center ("DS Mobile & Digital Hub").
Analyze the following repair case:
Device: ${input.device || "Smartphone"}
Reported Issue: ${input.issue || "Fault"}
Notes/History: ${input.customerNote || "None"}

Provide an accurate, practical bench-testing diagnosis for Indian mobile shops.
Respond strictly with valid JSON only in this exact shape:
{
  "diagnosis": "Comprehensive 2-sentence summary of the fault and technical diagnosis.",
  "likelyCauses": ["Root cause 1", "Root cause 2", "Root cause 3"],
  "recommendedParts": [
    {"name": "Part name (e.g. Charging Sub-Board)", "estimatedCost": 350, "isOptional": false}
  ],
  "difficulty": "Easy",
  "safetyPrecaution": "Crucial bench warning (e.g. isolate battery connector before testing display)",
  "estimatedTurnaroundTime": "45-60 mins",
  "customerHinglishExplanation": "Reassuring, simple 2-sentence explanation in friendly Hinglish for the customer.",
  "diagnosticChecklist": ["1. Check DC Power supply current draw", "2. Test charging flex pin voltage with multimeter", "3. Test screen on external bench unit"]
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    return JSON.parse(cleanAiJson(text));
  } catch (err) {
    console.warn("Failed to parse repair diagnosis JSON", err);
    return {
      diagnosis: text,
      likelyCauses: ["Hardware inspection required", "Component check needed"],
      recommendedParts: [],
      difficulty: "Moderate",
      safetyPrecaution: "Isolate battery power before disassembly.",
      estimatedTurnaroundTime: "1-2 hours",
      customerHinglishExplanation: "Aapka phone diagnose ho raha hai, hamari team dhyan se check kar rahi hai.",
      diagnosticChecklist: ["Perform physical and multimeter inspection."]
    };
  }
}

app.post("/api/ai-repair-diagnostics", rateLimit(60_000, 20), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const { device, issue, customerNote } = req.body || {};
    if (!issue && !device) return res.status(400).json({ success: false, error: "Device and issue required." });
    const data = await runRepairDiagnostics(storeId, { device, issue, customerNote });
    if (!data) return res.status(503).json({ success: false, error: "AI diagnostics unavailable." });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("AI repair diagnostics error", error);
    res.status(500).json({ success: false, error: "Diagnostics failed." });
  }
});

// Backward compatibility alias for ai-gateway repair-diagnosis
app.post("/api/repair-diagnosis", rateLimit(60_000, 20), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const input = req.body?.input || req.body || {};
    const data = await runRepairDiagnostics(storeId, { device: input.device, issue: input.issue });
    if (!data) return res.status(503).json({ success: false, error: "AI unavailable." });
    return res.json({ success: true, diagnosis: data.diagnosis || data.customerHinglishExplanation || "Diagnosis ready." });
  } catch (error) {
    res.status(500).json({ success: false, error: "Diagnosis failed." });
  }
});

async function runCustomerMessage(
  storeId: string | null,
  input: {
    type: string;
    customerName: string;
    phone?: string;
    amount?: number;
    deviceName?: string;
    invoiceNo?: string;
    shopName?: string;
    extraNotes?: string;
  }
): Promise<any> {
  if (!hasAI()) return null;
  const prompt = `You are a customer communication specialist for an Indian mobile store and service center ("DS Mobile & Digital Hub").
Draft 3 ready-to-send WhatsApp / SMS message options for a customer based on these details:
Type: ${input.type} (one of: dueReminder, repairReady, repairEstimate, festivalOffer, welcomeThankYou)
Customer Name: ${input.customerName || "Customer"}
Phone: ${input.phone || "N/A"}
Amount/Balance Due: ₹${input.amount || 0}
Device/Item: ${input.deviceName || ""}
Invoice/Job ID: ${input.invoiceNo || ""}
Shop Name: ${input.shopName || "DS Mobile & Digital Hub"}
Extra Notes: ${input.extraNotes || "None"}

Generate 3 tailored message styles:
1. "politeHinglish": Warm, respectful, friendly Hindi+English mix with clear UPI/payment/testing info and store greeting.
2. "professional": Clean, business-formatted English with formal salutation, item details, and receipt reference.
3. "shortInstant": 1-2 line punchy WhatsApp ping with key numbers and emojis.

Respond strictly with valid JSON only in this exact shape:
{
  "politeHinglish": "...",
  "professional": "...",
  "shortInstant": "...",
  "recommendedFollowUpDays": 3
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    return JSON.parse(cleanAiJson(text));
  } catch (err) {
    console.warn("Failed to parse customer message JSON", err);
    return {
      politeHinglish: `Namaste ${input.customerName || "Sir"} ji! ${input.shopName || "DS Mobile"} se update.`,
      professional: `Dear ${input.customerName || "Customer"}, update from ${input.shopName || "DS Mobile"}.`,
      shortInstant: `Hi ${input.customerName || ""}! Update from ${input.shopName || "DS Mobile"}.`
    };
  }
}

app.post("/api/ai-customer-message", rateLimit(60_000, 25), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const input = req.body || {};
    const data = await runCustomerMessage(storeId, input);
    if (!data) return res.status(503).json({ success: false, error: "AI messaging unavailable." });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("AI customer message error", error);
    res.status(500).json({ success: false, error: "Message composition failed." });
  }
});

// Backward compatibility alias for ai-gateway due-reminder
app.post("/api/due-reminder", rateLimit(60_000, 25), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const input = req.body?.input || req.body || {};
    const data = await runCustomerMessage(storeId, {
      type: "dueReminder",
      customerName: input.customerName,
      amount: input.dueAmount,
      shopName: input.shopName,
      extraNotes: input.daysSincePurchase ? `${input.daysSincePurchase} days overdue` : "",
    });
    return res.json({ success: true, message: data?.politeHinglish || "Namaste! Aapka baaki payment kripya clear karein." });
  } catch (error) {
    res.status(500).json({ success: false, error: "Due reminder failed." });
  }
});

async function runSecondHandValuation(
  storeId: string | null,
  input: {
    brand: string;
    modelName: string;
    storage?: string;
    cosmeticCondition?: string;
    batteryHealth?: string | number;
    hasBoxAndBill?: boolean;
    knownDefects?: string;
  }
): Promise<any> {
  if (!hasAI()) return null;
  const prompt = `You are an expert second-hand smartphone pricing and valuation specialist in the Indian wholesale/retail market (benchmarked to Nehru Place / Gaffar Market / Cashify rates).
Evaluate this used phone for buyback and resale:
Brand: ${input.brand}
Model: ${input.modelName}
Storage/Variant: ${input.storage || "Standard"}
Condition Grade: ${input.cosmeticCondition || "Good (A)"}
Battery Health: ${input.batteryHealth ? `${input.batteryHealth}%` : "Normal"}
Original Box & Bill: ${input.hasBoxAndBill ? "Yes (Full Kit)" : "No (Device Only - reduce value)"}
Known Defects: ${input.knownDefects || "Minor normal usage marks"}

Calculate realistic prices in ₹ INR that ensure the shop makes a safe 18-25% margin.
Respond strictly with valid JSON only in this exact shape:
{
  "recommendedBuybackPrice": 8500,
  "resaleTargetPrice": 11500,
  "profitMargin": 3000,
  "profitMarginPercent": 26,
  "conditionSummary": "Quick 1-sentence evaluation of this model's market demand and resale liquidity.",
  "hardwareChecklist": [
    "Test touch screen grid & multi-touch using secret dialer test (*#0*# or *#*#6484#*#*)",
    "Check battery drain on YouTube 4K playback for 5 mins",
    "Inspect frame for warping or swollen battery gap",
    "Check IMEI on CEIR (Sanchar Saathi) portal to confirm not blacklisted/stolen",
    "Verify Google FRP / Apple iCloud / Mi Account logout and perform full wipe"
  ],
  "counterNegotiationPitch": "What the shop staff should politely tell the customer to justify this buyback offer."
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    return JSON.parse(cleanAiJson(text));
  } catch (err) {
    console.warn("Failed to parse second-hand valuation JSON", err);
    return null;
  }
}

app.post("/api/ai-second-hand-valuation", rateLimit(60_000, 20), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const input = req.body || {};
    if (!input.brand || !input.modelName) return res.status(400).json({ success: false, error: "Brand and model name required." });
    const data = await runSecondHandValuation(storeId, input);
    if (!data) return res.status(503).json({ success: false, error: "AI valuation unavailable." });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("AI valuation error", error);
    res.status(500).json({ success: false, error: "Valuation calculation failed." });
  }
});

async function runProductDescAndTags(
  storeId: string | null,
  input: { name: string; category: string; brand?: string; mrp?: number; sellingPrice?: number }
): Promise<any> {
  if (!hasAI()) return null;
  const prompt = `You are a retail sales and merchandising expert for an Indian mobile accessories and electronics store.
Generate sales pitching points, a thermal barcode label tag line, and search keywords for:
Product: ${input.name}
Category: ${input.category}
Brand: ${input.brand || "General"}
MRP: ₹${input.mrp || 0}
Selling Price: ₹${input.sellingPrice || 0}

Respond strictly with valid JSON only in this exact shape:
{
  "sellingPoints": [
    "Key customer benefit 1 (e.g. Pure copper core for fast charging)",
    "Key customer benefit 2 (e.g. Unbreakable braided nylon wire)",
    "Key customer benefit 3 (e.g. 6-Month instant replacement warranty)"
  ],
  "thermalTagLine": "⚡ Fast Charge Edition",
  "searchTags": ["fast charger", "type c", "braided cable", "warp charge", "vooc"],
  "counterPitch": "Short 1-sentence pitch for sales staff to close the deal at the counter."
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    return JSON.parse(cleanAiJson(text));
  } catch (err) {
    console.warn("Failed to parse product desc JSON", err);
    return null;
  }
}

app.post("/api/ai-product-desc", rateLimit(60_000, 25), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const input = req.body || {};
    if (!input.name) return res.status(400).json({ success: false, error: "Product name required." });
    const data = await runProductDescAndTags(storeId, input);
    if (!data) return res.status(503).json({ success: false, error: "AI product generator unavailable." });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("AI product desc error", error);
    res.status(500).json({ success: false, error: "Product generation failed." });
  }
});

async function runDeadStockStrategy(
  storeId: string | null,
  input: { items: any[] }
): Promise<any> {
  if (!hasAI()) return null;
  const prompt = `You are a retail inventory strategist for an Indian mobile phone and accessories retail store.
Analyze these slow-moving / dead stock products (aged 45-90+ days without sales):
${JSON.stringify((input.items || []).slice(0, 15))}

Provide an aggressive clearance and cash-recovery plan.
Respond strictly with valid JSON only in this exact shape:
{
  "overallAdvice": "Strategic summary of how to unlock trapped working capital.",
  "bundles": [
    {
      "title": "Clearance Combo Pack",
      "bundleItems": ["Item 1", "Item 2"],
      "promoPrice": "₹299",
      "pitch": "Counter staff pitch: Get high quality tempered glass + fast cable combo at 40% off with any phone repair"
    }
  ],
  "flashClearanceItems": [
    {
      "name": "Product Name",
      "suggestedClearancePrice": 149,
      "markdownPercent": 40,
      "reason": "Liquidate at cost to free up cash for fast-moving items"
    }
  ],
  "counterStaffTip": "Practical instruction for staff to offer these clearance items during billing."
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    return JSON.parse(cleanAiJson(text));
  } catch (err) {
    console.warn("Failed to parse dead stock strategy JSON", err);
    return null;
  }
}

app.post("/api/ai-dead-stock-strategy", rateLimit(60_000, 10), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: "Items list required." });
    const data = await runDeadStockStrategy(storeId, { items });
    if (!data) return res.status(503).json({ success: false, error: "AI strategy unavailable." });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("AI dead stock strategy error", error);
    res.status(500).json({ success: false, error: "Strategy generation failed." });
  }
});

async function runPosCopilot(
  storeId: string | null,
  input: { query: string; context?: any }
): Promise<any> {
  if (!hasAI()) return null;
  const prompt = `You are 'DS Mobile Copilot', an expert retail assistant for the staff and owner of DS Mobile & Digital Hub (an Indian smartphone sales, accessories, Xerox, and repair shop).
Staff query: "${input.query}"
Shop Context: ${JSON.stringify(input.context || {})}

Guidelines:
- Give immediate, practical, accurate Indian retail answers (accessories compatibility, phone specs, repair tips, counter advice).
- If asked about screen sizes or glass compatibility, specify models.
- Keep response friendly, professional, and under 120 words.

Respond strictly with valid JSON only in this exact shape:
{
  "answer": "Clear, direct, helpful answer.",
  "quickChips": ["Related question 1", "Related question 2"]
}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    })
  );

  const text = (response.text || "").trim();
  try {
    return JSON.parse(cleanAiJson(text));
  } catch (err) {
    console.warn("Failed to parse POS copilot JSON", err);
    return { answer: text, quickChips: [] };
  }
}

app.post("/api/ai-pos-copilot", rateLimit(60_000, 30), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const { query, context } = req.body || {};
    if (!query || typeof query !== "string" || !query.trim()) return res.status(400).json({ success: false, error: "Query required." });
    const data = await runPosCopilot(storeId, { query: query.trim(), context });
    if (!data) return res.status(503).json({ success: false, error: "Copilot unavailable." });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("AI copilot error", error);
    res.status(500).json({ success: false, error: "Copilot query failed." });
  }
});

async function runAiSearchMatch(
  storeId: string | null,
  query: string,
  items: any[]
): Promise<string[]> {
  if (!hasAI() || !query.trim() || !items.length) return [];
  const prompt = `You are an intelligent search matcher for an Indian mobile store.
Query: "${query}"
Catalog items:
${JSON.stringify(items.slice(0, 50).map((i: any) => ({ id: i.id, name: i.name, brand: i.brand, category: i.category, models: i.compatibleModels })))}

Return the IDs of items that are relevant to this query (e.g. matching model compatibility, synonyms like cover/case, glass/screen guard, charger/cable, or spelling typos).
Respond strictly with valid JSON only:
{
  "matchedIds": ["id1", "id2"]
}`;

  try {
    const response = await runWithGeminiFailover(storeId, (ai) =>
      ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" },
      })
    );
    const parsed = JSON.parse(cleanAiJson((response.text || "").trim()));
    return Array.isArray(parsed?.matchedIds) ? parsed.matchedIds : [];
  } catch {
    return [];
  }
}

app.post("/api/ai-search-match", rateLimit(60_000, 40), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const { query, items } = req.body || {};
    if (!query || !Array.isArray(items)) return res.json({ success: true, matchedIds: [] });
    const matchedIds = await runAiSearchMatch(storeId, query, items);
    return res.json({ success: true, matchedIds });
  } catch (error) {
    return res.json({ success: true, matchedIds: [] });
  }
});

// Backward compatibility alias for ai-gateway reorder-suggestion
app.post("/api/reorder-suggestion", rateLimit(60_000, 20), async (req, res) => {
  const ctx = await requireSupabaseUserAndStore(req, res);
  const storeId = ctx?.storeId || null;
  try {
    const input = req.body?.input || req.body || {};
    if (!hasAI()) return res.json({ success: true, suggestion: `Suggest ordering ${Number(input.minStock || 5) * 2} units.` });
    const prompt = `You are an inventory restock advisor for an Indian mobile store.
Product: ${input.productName}
Category: ${input.category || "General"}
Current Stock: ${input.currentStock}
Minimum Stock: ${input.minStock}
Last 7 Days Sold: ${input.unitsSoldLast7Days}
Last 30 Days Sold: ${input.unitsSoldLast30Days}

Suggest an exact reorder quantity with a 1-sentence rationale considering sales velocity.
Respond strictly with valid JSON only:
{
  "suggestion": "Order X units because..."
}`;
    const response = await runWithGeminiFailover(storeId, (ai) =>
      ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" },
      })
    );
    const parsed = JSON.parse(cleanAiJson((response.text || "").trim()));
    return res.json({ success: true, suggestion: parsed?.suggestion || `Suggest ordering ${Number(input.minStock || 5) * 2} units.` });
  } catch {
    return res.json({ success: true, suggestion: "Suggest restocking standard batch." });
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

  app.listen(PORT, "0.0.0.0", () => console.log(`DS Mobile & Digital Hub running on http://0.0.0.0:${PORT}`));
}

start().catch((error) => {
  console.error("Server startup failed", error);
  process.exit(1);
});
