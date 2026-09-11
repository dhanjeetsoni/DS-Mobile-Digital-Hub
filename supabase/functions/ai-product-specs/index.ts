import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_TEXT = Deno.env.get("GEMINI_MODEL_TEXT") || "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 20_000;
// Text-route Gemini calls must NOT send thinkingConfig -- gemini-3.5-flash-lite
// hard-rejects it with 400 INVALID_ARGUMENT (root-caused live 2026-09-08 in
// ai-gateway; same model, same fix applies here).
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
function checkRateLimit(key: string, windowMs = 60_000, max = 15): boolean {
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

function normalizeSpecsAndHighlights(input: any) {
  const rawSpecs: unknown = input?.specifications;
  const specifications = (Array.isArray(rawSpecs) ? rawSpecs : [])
    .map((s: any) => ({ label: String(s?.label || "").trim().slice(0, 60), value: String(s?.value || "").trim().slice(0, 200) }))
    .filter((s: any) => s.label && s.value)
    .slice(0, 20);
  // Phase 7 (2026-09-10): "AI auto-designs the rest of the product page
  // layout (feature highlights...)" — short, punchy, customer-facing
  // bullets, distinct from the structured label/value spec sheet above
  // (e.g. "6.7-inch AMOLED display" rather than "Display: 6.7-inch AMOLED").
  const rawHighlights: unknown = input?.featureHighlights;
  const featureHighlights = (Array.isArray(rawHighlights) ? rawHighlights : [])
    .map((h: any) => String(h || "").trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 8);
  const confidence: "low" | "medium" | "high" = ["low", "medium", "high"].includes(input?.confidence) ? input.confidence : "low";
  return { specifications, featureHighlights, confidence };
}

// Phase 7: "AI auto-fills full specifications for a product when added
// (extends Phase 6's photo-scan work)" + "AI auto-designs the rest of the
// product page layout (feature highlights...)". Phase 6's OCR reads text
// actually printed on a box/label (ai-gateway's ocr-phone/ocr-accessory);
// this instead reasons from general knowledge of the named product (same
// non-live-data pattern as ai-price-advisor) to fill a structured spec
// sheet AND a short highlight-bullet list for the product detail page,
// explicitly caveated in the prompt as not authoritative/live data.
async function runProductSpecsAndHighlights(storeId: string | null, input: Record<string, unknown>) {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `You help a small Indian mobile phone & digital accessories shop fill in a
structured specification sheet AND a short list of customer-facing feature highlights, for a
product they're adding to their catalog. Using ONLY the product details given below and your
general knowledge of this specific product/model (or, if you don't recognize the exact model,
typical specifications for this category of product):

1. specifications: key specifications as label/value pairs — the kind a customer would want to
   see (e.g. for a phone: Display, Processor, RAM, Storage, Rear Camera, Front Camera, Battery,
   Charging, OS; for an accessory: Material, Compatibility, Protection/Feature, Warranty).
2. featureHighlights: 4-6 short, punchy, marketing-style bullet points for a product detail page
   (like Amazon/Flipkart's "About this item" bullets) — each under 12 words, highlighting the
   single most appealing fact per bullet (e.g. "6.7-inch AMOLED display", "5000mAh long-lasting
   battery", "Fits snugly, precise cutouts for camera and ports"). These are DIFFERENT from the
   specifications above — punchy customer-facing phrases, not a label/value table.

You have NO live/real-time data — never claim a spec or highlight is confirmed if you're only
estimating from general knowledge of the category; use confidence "low" whenever you don't
specifically recognize the exact model named.

Respond ONLY as compact JSON with keys:
- specifications: array of { label: string, value: string }, 5-12 items, most important first
- featureHighlights: array of strings, 4-6 items, most appealing first
- confidence: "low" | "medium" | "high" (recognizing the specific named model = higher confidence;
  guessing from category alone = "low")

Never invent a specific number (e.g. exact mAh, exact MP) you aren't reasonably confident about —
prefer a slightly more general value (e.g. "12MP+2MP dual camera" rather than a precise but
made-up number) over a confident-sounding fabrication.

PRODUCT:
${JSON.stringify(input)}`;
  const response = await runWithGeminiFailover(storeId, (ai) => ai.models.generateContent({
    model: GEMINI_MODEL_TEXT,
    contents: { parts: [{ text: prompt }] },
    config: {
      ...TEXT_MODE_CONFIG,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          specifications: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, value: { type: Type.STRING } } } },
          featureHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.STRING },
        },
      },
    },
  }));
  return normalizeSpecsAndHighlights(JSON.parse(response.text || "{}"));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`product-specs:${clientIp(req)}`)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);
  const body = await req.json().catch(() => ({}));
  const productName = typeof body?.productName === "string" ? body.productName : "";
  const category = typeof body?.category === "string" ? body.category : "";
  if (!productName.trim() || !category.trim()) return json({ success: false, error: "Product name aur category chahiye." }, 400);
  try {
    const result = await runProductSpecsAndHighlights(ctx.storeId, {
      brand: typeof body?.brand === "string" ? body.brand : undefined,
      productName,
      category,
      compatibleModels: Array.isArray(body?.compatibleModels) ? body.compatibleModels.slice(0, 30) : undefined,
    });
    return json({ success: true, ...result });
  } catch (error) {
    console.error("ai-product-specs error", error);
    return json({ success: false, error: "AI specifications suggestion abhi available nahi hai. Manually enter karein." }, 500);
  }
});
