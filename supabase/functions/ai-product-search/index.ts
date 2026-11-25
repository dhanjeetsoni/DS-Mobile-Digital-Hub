import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_TEXT = Deno.env.get("GEMINI_MODEL_TEXT") || "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 12_000;
// Text-route Gemini calls must NOT send thinkingConfig -- gemini-3.5-flash-lite
// hard-rejects it with 400 INVALID_ARGUMENT (root-caused live 2026-09-08 in
// ai-gateway; same model, same fix applies here). Also this route needs to
// feel fast (it runs as-you-type, debounced) so a short timeout matters more
// here than on the other AI routes.
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
function checkRateLimit(key: string, windowMs = 60_000, max = 30): boolean {
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

const FAILOVER_TIME_BUDGET_MS = 11_000;
async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable");
  const startedAt = Date.now();
  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    if (Date.now() - startedAt > FAILOVER_TIME_BUDGET_MS) throw lastError || new Error("AI busy hai.");
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
      if (failure === "unavailable") continue;
      void markKeyResult(storeId, entry.slot, false, (err as any)?.message || String(err), failure === "invalid" ? "invalid" : "exhausted");
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

const storeIdByUserCache = new Map<string, { storeId: string | null; at: number }>();
const STORE_ID_CACHE_MS = 60_000;
async function requireUserAndStore(req: Request): Promise<{userId:string;storeId:string|null}|null>{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const clientKey=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
  if(!token||!SUPABASE_URL||!supabaseAdmin||!clientKey)return null;
  const {data,error}=await supabaseAdmin.auth.getUser(token);
  if(error||!data.user)return null;
  const caller=createClient(SUPABASE_URL,clientKey,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
  const {data:allowed,error:accessError}=await caller.rpc("current_account_allowed");
  if(accessError||allowed!==true)return null;
  const {data:profile,error:profileError}=await supabaseAdmin.from("profiles").select("store_id").eq("id",data.user.id).maybeSingle();
  if(profileError||!profile?.store_id)return null;
  return {userId:data.user.id,storeId:profile.store_id};
}

// Phase 8: "Add AI-powered search on top of normal keyword search -- runs
// by default alongside plain search, not instead of it". The existing
// naturalMatch() (see src/utils/naturalSearch.ts) stays exactly as-is and
// keeps showing results instantly on every keystroke with zero network
// calls -- this is a genuinely separate, additive, debounced layer that
// understands things plain substring/synonym matching can't: a phone model
// number mentioned in compatibleModels rather than the product name, a
// Hindi/Hinglish description of what the item is for, etc. Results from
// this get MERGED into the plain-search result set client-side, never used
// to replace it.
async function runProductSearch(storeId: string | null, query: string, products: { id: string; name: string; brand: string; category: string; compatibleModels?: string[] }[]) {
  if (!hasAI()) return [];
  const prompt = `A staff member at a small Indian mobile phone & digital accessories shop typed this
into the product search box: "${query}"

Below is the shop's current in-stock product list (id, name, brand, category, and for glass/cover
accessories the phone models they fit). Return the ids of every product that's a genuinely
relevant match for what they typed -- including matches a plain text search would miss, such as:
- the phone model they typed appearing in a glass/cover's compatibleModels list, not its name
- a Hindi/Hinglish or colloquial description of the item (e.g. "naya wala iphone cover")
- an obvious brand/model misspelling or shorthand (e.g. "redmi" for "Redmi", "i phone" for "iPhone")
Do NOT include a product just because it's vaguely in the same category -- only genuine matches
for what was actually typed. If nothing is a real match, return an empty array.

Respond ONLY as compact JSON: { "matchedIds": string[] }

PRODUCTS:
${JSON.stringify(products)}`;
  const response = await runWithGeminiFailover(storeId, (ai) => ai.models.generateContent({ model: GEMINI_MODEL_TEXT, contents: { parts: [{ text: prompt }] }, config: { ...TEXT_MODE_CONFIG, responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { matchedIds: { type: Type.ARRAY, items: { type: Type.STRING } } } } } }));
  const parsed = JSON.parse(response.text || "{}");
  const validIds = new Set(products.map((p) => p.id));
  return (Array.isArray(parsed.matchedIds) ? parsed.matchedIds : []).filter((id: unknown) => typeof id === "string" && validIds.has(id));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`product-search:${clientIp(req)}`)) return json({ success: false, error: "Too many requests." }, 429);
  const body = await req.json().catch(() => ({}));
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const products = Array.isArray(body?.products) ? body.products.slice(0, 400) : [];
  if (!query || query.length < 2 || products.length === 0) return json({ success: true, matchedIds: [] });
  try {
    const matchedIds = await runProductSearch(ctx.storeId, query, products);
    return json({ success: true, matchedIds });
  } catch (error) {
    console.error("ai-product-search error", error);
    // Fail soft -- this is an additive layer on top of instant plain search,
    // which already covers the request either way. Never surface an error
    // to the user for this; just contribute nothing extra this time.
    return json({ success: true, matchedIds: [] });
  }
});
