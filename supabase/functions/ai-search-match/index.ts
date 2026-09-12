import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai@2";

// ---------------------------------------------------------------------------
// ai-search-match — Supabase Edge Function (Phase 8: "Add AI-powered search
// on top of normal keyword search — runs by default alongside plain
// search, not instead of it").
//
// SCOPE: this is deliberately an ADDITIVE layer, not a replacement. The
// existing instant, zero-latency client-side filter (App.tsx's
// `filteredProds` + `naturalMatch()`) stays exactly as it is — every
// keystroke still filters instantly with no network call. This function is
// called separately, debounced, after the shop pauses typing, and its
// results get UNIONED onto the instant results (never used to replace or
// narrow them) — see src/services/aiSearch.ts and its call site for the
// merge logic.
//
// WHY THIS EXISTS: the plain keyword filter (name/brand/category/SKU/
// barcode substring + a small hardcoded Hindi colour-word list) can't
// catch a search that requires actual understanding — a customer typing a
// phone MODEL NUMBER to find a compatible glass/cover whose own title
// doesn't literally contain that model name, a misspelling, a category
// description in different words ("cover" vs "back case"), etc. This
// function reasons over the catalog's actual fields (including
// compatibleModels, which is exactly where glass/cover-for-a-phone-model
// matches live) instead of pure substring matching.
//
// Deliberately conservative: only returns product IDs that are ACTUALLY
// present in the list given — never invents a product, never returns an ID
// not in the input. If nothing matches beyond what plain search already
// found, returns an empty list rather than force a result.
//
// Same multi-key failover/rate-limit/auth pattern as the other standalone
// AI Edge Functions in this project.
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_TEXT = Deno.env.get("GEMINI_MODEL_TEXT") || "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 12_000;
// No thinkingConfig here at all (see the Phase 5 root-cause note in
// ai-gateway/index.ts — gemini-3.5-flash-lite hard-rejects that param).

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
function checkRateLimit(key: string, windowMs = 60_000, max = 30): boolean {
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

// Kept short — this must never make the search experience feel slow. If
// the whole pool is struggling, better to fail fast and let the instant
// keyword results stand alone than to keep the shop waiting.
const FAILOVER_TIME_BUDGET_MS = 10_000;

async function runWithGeminiFailover<T>(storeId: string | null, fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const poolId = storeId && supabaseAdmin ? storeId : ENV_POOL_ID;
  const keys = await loadKeyPool(storeId);
  if (keys.length === 0) throw new Error("AI unavailable");

  const startedAt = Date.now();
  let activeIdx = activeKeyIndexByPool.get(poolId) || 0;
  let lastError: any = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    if (Date.now() - startedAt > FAILOVER_TIME_BUDGET_MS) throw lastError || new Error("AI search timed out");
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
      if (failure !== "unavailable") {
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

interface CatalogItem {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  compatibleModels?: string[];
}

async function runSearchMatch(storeId: string | null, query: string, items: CatalogItem[]): Promise<string[]> {
  if (!hasAI()) return [];
  const prompt = `A customer/staff at a small Indian mobile phone & accessories shop typed this search query
into the product search box: "${query}"

Below is a list of products currently in the shop's catalog (id, name, brand, category, and — for
accessories like glass/covers — the phone models they fit). A simple keyword/substring search has
ALREADY been run separately; your job is to find any ADDITIONAL products in this list that are
genuinely relevant to the query but wouldn't match on plain substring search — for example:
- The query is a phone model number/name, and an accessory's compatibleModels list includes that model
  even though the accessory's own product name/title doesn't mention it.
- The query is a common misspelling, an abbreviation, or a different wording for the same thing
  (e.g. "cover" vs "case", a model typed without spaces or with a typo).
- The query describes the product by category/purpose in different words than the title uses.

Respond ONLY as compact JSON: { "matchedIds": [ "id1", "id2", ... ] } — ONLY ids that are actually
present in the list below, and ONLY genuinely relevant ones. If nothing beyond an exact substring match
applies, or you are not confident, return an empty array. Never invent an id not in the list.

CATALOG:
${JSON.stringify(items)}`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL_TEXT,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { matchedIds: { type: Type.ARRAY, items: { type: Type.STRING } } },
        },
      },
    })
  );
  const parsed = JSON.parse(response.text || "{}");
  const ids = Array.isArray(parsed.matchedIds) ? parsed.matchedIds : [];
  const validIds = new Set(items.map((i) => i.id));
  return ids.filter((id: unknown) => typeof id === "string" && validIds.has(id));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`ai-search:${clientIp(req)}`, 60_000, 30)) {
    return json({ success: false, error: "Too many requests." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const items: CatalogItem[] = Array.isArray(body?.items) ? body.items.slice(0, 400) : [];
  if (!query || query.length < 2) return json({ success: true, matchedIds: [] });
  if (items.length === 0) return json({ success: true, matchedIds: [] });

  try {
    const matchedIds = await runSearchMatch(ctx.storeId, query, items);
    return json({ success: true, matchedIds });
  } catch (error) {
    // Never a hard failure for the caller — this is an additive layer on
    // top of instant keyword search, which already stands on its own.
    console.error("ai-search-match error", error);
    return json({ success: true, matchedIds: [], degraded: true });
  }
});
