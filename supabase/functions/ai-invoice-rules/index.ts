import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai@2";

// ---------------------------------------------------------------------------
// ai-invoice-rules — Supabase Edge Function (Phase 10: "AI decides/
// generates the right rules+quote per product by default").
//
// Given a product category (and optionally the shop's existing universal
// rules, for tone/style consistency), suggests: a short category-specific
// invoice rule/term (the kind of thing that genuinely differs by category —
// warranty scope, return handling, as-applied-basis clauses) and one
// short customer-facing feel-good line for that category. This is a
// SUGGESTION the owner reviews and can edit/reject before it's saved
// anywhere — same review-before-apply pattern as the Phase 6 price
// suggestion and Phase 7 photo enhancement. Nothing here writes to the
// database directly; the client owns applying (or not) the result.
//
// Same multi-key failover/rate-limit/auth pattern as the other standalone
// AI Edge Functions in this project.
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_TEXT = Deno.env.get("GEMINI_MODEL_TEXT") || "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 15_000;
// No thinkingConfig (see the Phase 5 root-cause note in ai-gateway/index.ts
// — gemini-3.5-flash-lite hard-rejects that param).

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
function checkRateLimit(key: string, windowMs = 60_000, max = 15): boolean {
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

const FAILOVER_TIME_BUDGET_MS = 13_000;

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

async function runInvoiceRulesSuggest(storeId: string | null, category: string, shopName: string): Promise<{ rule: string; quote: string }> {
  if (!hasAI()) throw new Error("AI unavailable");
  const prompt = `A small Indian mobile phone & digital accessories shop ("${shopName}") needs invoice text
specific to ONE product category: "${category}".

Suggest:
1. "rule": ONE short, practical invoice term/condition specific to what's actually different about
   THIS category (e.g. tempered glass is sold as-applied with no breakage warranty; second-hand phones
   have a return handling charge; new phones go through brand service centers; repairs have their own
   parts-warranty scope). Do not repeat generic boilerplate every category already needs elsewhere
   (like "preserve this invoice") — only what's genuinely specific to "${category}". Plain English,
   one sentence, no numbering.
2. "quote": ONE short, warm, customer-facing feel-good line to print near the bottom of the invoice for
   a purchase in this category — plain English, one sentence, not corporate-sounding.

Respond ONLY as compact JSON: { "rule": string, "quote": string }`;

  const response = await runWithGeminiFailover(storeId, (ai) =>
    ai.models.generateContent({
      model: GEMINI_MODEL_TEXT,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { rule: { type: Type.STRING }, quote: { type: Type.STRING } },
        },
      },
    })
  );
  const parsed = JSON.parse(response.text || "{}");
  return {
    rule: String(parsed.rule || "").trim().slice(0, 300),
    quote: String(parsed.quote || "").trim().slice(0, 200),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`invoice-rules:${clientIp(req)}`, 60_000, 15)) {
    return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const shopName = typeof body?.shopName === "string" ? body.shopName.trim() : "the shop";
  if (!category) return json({ success: false, error: "Category chahiye." }, 400);

  try {
    const result = await runInvoiceRulesSuggest(ctx.storeId, category, shopName);
    return json({ success: true, ...result });
  } catch (error) {
    console.error("ai-invoice-rules error", error);
    return json({ success: false, error: error instanceof Error ? error.message : "AI suggestion fail ho gaya. Manually likh sakte hain." }, 500);
  }
});
