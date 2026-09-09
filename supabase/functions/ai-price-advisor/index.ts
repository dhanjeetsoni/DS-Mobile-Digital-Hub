import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_TEXT = Deno.env.get("GEMINI_MODEL_TEXT") || "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 20_000;
// BUG FIX (2026-09-07): gemini-3.5-flash-lite no longer accepts
// thinkingConfig -- sending it made every text-model call fail with
// "Request contains an invalid argument". See ai-gateway/index.ts for the
// full writeup (confirmed live against the real Gemini API).
const TEXT_MODE_CONFIG = {};

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;

const CORS_HEADERS: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: CORS_HEADERS }); }

class GeminiTimeoutError extends Error { constructor() { super("Gemini call timed out"); this.name = "GeminiTimeoutError"; } }
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
  if (now - lastRateMapSweep > 60_000) { lastRateMapSweep = now; for (const [k, entry] of rateMap) if (entry.resetAt <= now) rateMap.delete(k); }
  const current = rateMap.get(key);
  if (!current || current.resetAt <= now) { rateMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  current.count++;
  return current.count <= max;
}
function clientIp(req: Request): string { return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown"; }

const ENV_POOL_ID = "__env__";
const ENV_GEMINI_KEYS: string[] = (() => {
  const keys: string[] = [];
  for (let i = 1; i <= 5; i++) { const k = Deno.env.get(`GEMINI_API_KEY_${i}`); if (k && k.trim()) keys.push(k.trim()); }
  if (keys.length === 0) { const single = Deno.env.get("GEMINI_API_KEY"); if (single && single.trim()) keys.push(single.trim()); }
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
  const { data, error } = await supabaseAdmin!.from("gemini_api_keys").select("slot, api_key, status, cooldown_until").eq("store_id", poolId).not("api_key", "is", null).neq("status", "invalid").order("slot", { ascending: true });
  let keys: KeyEntry[] = [];
  if (!error && data) {
    const now = Date.now();
    keys = data.filter((row: any) => !row.cooldown_until || new Date(row.cooldown_until).getTime() <= now).map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
    if (keys.length === 0) keys = data.map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
  }
  if (keys.length === 0 && ENV_GEMINI_KEYS.length > 0) keys = ENV_GEMINI_KEYS.map((apiKey, i) => ({ slot: i + 1, apiKey }));
  storeKeyPoolCache.set(poolId, { keys, at: Date.now() });
  return keys;
}
function invalidateKeyPoolCache(storeId: string | null) { storeKeyPoolCache.delete(storeId && supabaseAdmin ? storeId : ENV_POOL_ID); }
async function markKeyResult(storeId: string | null, slot: number, ok: boolean, errMsg?: string, failureStatus: "exhausted" | "invalid" = "exhausted") {
  if (!storeId || !supabaseAdmin) return;
  try {
    if (ok) {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabaseAdmin.from("gemini_api_keys").select("usage_count_today, usage_date").eq("store_id", storeId).eq("slot", slot).maybeSingle();
      const sameDay = data?.usage_date === today;
      await supabaseAdmin.from("gemini_api_keys").update({ status: "active", cooldown_until: null, last_error: null, last_used_at: new Date().toISOString(), usage_date: today, usage_count_today: sameDay ? (data?.usage_count_today || 0) + 1 : 1 }).eq("store_id", storeId).eq("slot", slot);
    } else {
      await supabaseAdmin.from("gemini_api_keys").update({ status: failureStatus, cooldown_until: failureStatus === "exhausted" ? new Date(Date.now() + 60_000).toISOString() : null, last_error: (errMsg || "").slice(0, 300) }).eq("store_id", storeId).eq("slot", slot);
    }
  } catch (e) { console.warn("markKeyResult: non-fatal status write-back failed", e); } finally { invalidateKeyPoolCache(storeId); }
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
function hasAI(): boolean { return ENV_GEMINI_KEYS.length > 0 || Boolean(supabaseAdmin); }

const FAILOVER_TIME_BUDGET_MS = 22_000;
async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable — no Gemini API keys configured. Owner: add keys in Settings.");
  const startedAt = Date.now();
  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;
  let anyUnavailable = false;
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) { if (!anyUnavailable) break; await new Promise((r) => setTimeout(r, 1500)); }
    for (let attempt = 0; attempt < keys.length; attempt++) {
      if (Date.now() - startedAt > FAILOVER_TIME_BUDGET_MS) throw lastError || new Error("AI busy hai (high demand) — thodi der mein dobara try karein.");
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

interface PriceAdvisorInput { brand?: string; productName: string; category: string; compatibleModels?: string[]; purchasePrice?: number | null; currentSellingPrice?: number | null; currentMrp?: number | null; }

function normalizeRecommendation(raw: any, input: PriceAdvisorInput) {
  const mrp = Number(raw?.mrp) || null;
  const recommendedSellingPrice = Math.max(0, Math.round(Number(raw?.recommendedSellingPrice) || 0));
  const priceRangeLow = Math.max(0, Math.round(Number(raw?.priceRangeLow) || recommendedSellingPrice));
  const priceRangeHigh = Math.max(priceRangeLow, Math.round(Number(raw?.priceRangeHigh) || recommendedSellingPrice));
  let confidence: "low" | "medium" | "high" = ["low", "medium", "high"].includes(raw?.confidence) ? raw.confidence : "low";
  if (!input.purchasePrice || input.purchasePrice <= 0) confidence = "low";
  return { mrp, recommendedSellingPrice, priceRangeLow, priceRangeHigh, confidence, rationale: String(raw?.rationale || "").trim().slice(0, 500), sources: [] as { title: string; url: string }[] };
}

async function runPriceAdvisor(storeId: string | null, input: PriceAdvisorInput) {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You help a small Indian mobile phone & digital accessories shop price a product they're
adding to their catalog. Using ONLY the details given below and your general knowledge of typical Indian
retail pricing/margins for this category, suggest a selling price. Do NOT claim to know a live/current
market price — you have no real-time price data — reason from the purchase price (if given) and typical
category margins instead, and say so plainly in the rationale if no purchase price was given.

Respond ONLY as compact JSON with keys:
- mrp: a reasonable MRP/list price (number, or 0 if you cannot estimate one at all)
- recommendedSellingPrice: your single best-recommended selling price (number)
- priceRangeLow / priceRangeHigh: a sensible price range around it (numbers)
- confidence: "low" | "medium" | "high" — use "low" whenever no purchase price was given
- rationale: ONE short Hinglish sentence (under 35 words) explaining the reasoning (e.g. typical margin
  for this category, or that it's a rough estimate with no cost price given). No markdown.

PRODUCT:
${JSON.stringify(input)}`;
  const response = await runWithGeminiFailover(storeId, (ai) => ai.models.generateContent({ model: GEMINI_MODEL_TEXT, contents: { parts: [{ text: prompt }] }, config: { ...TEXT_MODE_CONFIG, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { mrp: { type: Type.NUMBER }, recommendedSellingPrice: { type: Type.NUMBER }, priceRangeLow: { type: Type.NUMBER }, priceRangeHigh: { type: Type.NUMBER }, confidence: { type: Type.STRING }, rationale: { type: Type.STRING } } } } }));
  return normalizeRecommendation(JSON.parse(response.text || "{}"), input);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`price-advisor:${clientIp(req)}`, 60_000, 15)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);
  const body = await req.json().catch(() => ({}));
  const input: PriceAdvisorInput = {
    brand: typeof body?.brand === "string" ? body.brand : undefined,
    productName: typeof body?.productName === "string" ? body.productName : "",
    category: typeof body?.category === "string" ? body.category : "",
    compatibleModels: Array.isArray(body?.compatibleModels) ? body.compatibleModels.slice(0, 30) : undefined,
    purchasePrice: typeof body?.purchasePrice === "number" ? body.purchasePrice : null,
    currentSellingPrice: typeof body?.currentSellingPrice === "number" ? body.currentSellingPrice : null,
    currentMrp: typeof body?.currentMrp === "number" ? body.currentMrp : null,
  };
  if (!input.productName.trim() || !input.category.trim()) return json({ success: false, error: "Product name aur category chahiye." }, 400);
  try {
    const recommendation = await runPriceAdvisor(ctx.storeId, input);
    return json({ success: true, recommendation });
  } catch (error) {
    console.error("ai-price-advisor error", error);
    return json({ success: false, error: "AI price suggestion abhi available nahi hai. Manually enter karein." }, 500);
  }
});
