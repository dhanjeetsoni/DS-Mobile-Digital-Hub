import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_TEXT = Deno.env.get("GEMINI_MODEL_TEXT") || "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 20_000;
const FAST_MODE_CONFIG = { thinkingConfig: { thinkingBudget: 0 } };

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        status: failureStatus,
        cooldown_until: failureStatus === "exhausted" ? new Date(Date.now() + 60_000).toISOString() : null,
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
  // 2026-09-07 (Phase 6): genuine network-transport failures (dropped
  // connection, DNS blip, fetch itself throwing) previously fell through to
  // null and got rethrown immediately without trying another key — see the
  // matching fix + full writeup in ai-gateway/index.ts's classifyGeminiFailure.
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
    if (pass === 1) {
      if (!anyUnavailable) break;
      await sleep(1500);
    }
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
        void markKeyResult(storeId, entry.slot, false, (err as any)?.message || (err instanceof GeminiTimeoutError ? "Timed out" : String(err)), failure === "invalid" ? "invalid" : "exhausted");
      }
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
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
    ai.models.generateContent({ model: GEMINI_MODEL_TEXT, contents: { parts: [{ text: prompt }] }, config: TEXT_MODE_CONFIG })
  );
  return `📊 ${summary.shopName} — Daily AI Digest (${summary.date})\n\n${(response.text || "").trim()}`;
}

/**
 * BUG FIX (2026-09-06/07): this replaces ai-gateway's old runDailyDigestSweep,
 * which read state.sales / state.products straight out of the JSON
 * store_state blob. Since the Phase 1 catalog migration, that blob's
 * products/sales arrays are always empty — the old version was silently
 * sending "0 sales" (or nothing, since it skips when there's nothing to
 * report) every single day. This version reads sales/sale_items/products
 * from the relational tables instead. Kept as a separate small function
 * (rather than editing the large ai-gateway file in place) specifically to
 * avoid risking any of ai-gateway's other, currently-working AI routes.
 */
async function runDailyDigestSweep(): Promise<{ queued: number; skipped: number; errors: number }> {
  if (!supabaseAdmin) return { queued: 0, skipped: 0, errors: 0 };
  let queued = 0, skipped = 0, errors = 0;

  const { data: stores, error: storesErr } = await supabaseAdmin.from("stores").select("id").eq("ai_digest_enabled", true);
  if (storesErr || !stores?.length) return { queued: 0, skipped: 0, errors: storesErr ? 1 : 0 };

  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayStartUtc = new Date(`${todayIST}T00:00:00+05:30`).toISOString();
  const dayEndUtc = new Date(`${todayIST}T23:59:59.999+05:30`).toISOString();

  for (const store of stores) {
    try {
      const { data: conn } = await supabaseAdmin.from("telegram_connections").select("chat_id").eq("store_id", store.id).maybeSingle();
      if (!conn?.chat_id) { skipped++; continue; }

      const { data: stateRow } = await supabaseAdmin.from("store_state").select("state").eq("store_id", store.id).maybeSingle();
      const state = (stateRow?.state || {}) as { expenses?: { shop?: any[] }; settings?: { shopName?: string } };

      const { data: todaySalesRows } = await supabaseAdmin
        .from("sales").select("id,total,status").eq("store_id", store.id)
        .neq("status", "Cancelled").gte("created_at", dayStartUtc).lte("created_at", dayEndUtc);
      const todaySales = todaySalesRows || [];
      const totalSalesToday = todaySales.reduce((a, s) => a + (Number(s.total) || 0), 0);

      const { data: topItemRows } = todaySales.length
        ? await supabaseAdmin.from("sale_items").select("quantity, products(model)").in("sale_id", todaySales.map((s) => s.id))
        : { data: [] as any[] };
      const topProductQty: Record<string, number> = {};
      (topItemRows || []).forEach((i: any) => {
        const name = i.products?.model || "Product";
        topProductQty[name] = (topProductQty[name] || 0) + (Number(i.quantity) || 0);
      });
      const topProducts = Object.entries(topProductQty).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => `${name} x${qty}`);

      const { data: allProducts } = await supabaseAdmin.from("products").select("stock_qty,min_stock").eq("store_id", store.id);
      const lowStockCount = (allProducts || []).filter((p: any) => (Number(p.stock_qty) || 0) <= (Number(p.min_stock) || 0)).length;

      const todayExpenses = (state.expenses?.shop || []).filter((e: any) => e?.date === todayIST);
      const totalExpensesToday = todayExpenses.reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0);

      if (todaySales.length === 0 && todayExpenses.length === 0) { skipped++; continue; }

      const message = await runBusinessDigestText(store.id, {
        shopName: state.settings?.shopName || "Shop",
        date: todayIST,
        invoiceCount: todaySales.length,
        totalSalesToday: Math.round(totalSalesToday),
        totalExpensesToday: Math.round(totalExpensesToday),
        lowStockCount,
        topProducts,
      });

      await supabaseAdmin.from("telegram_outbox").insert({ store_id: store.id, chat_id: conn.chat_id, message, status: "pending" });
      queued++;
    } catch (e) {
      console.error("daily digest failed for store", store.id, e);
      errors++;
    }
  }
  return { queued, skipped, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const provided = req.headers.get("x-cron-secret") || "";
  if (!(cronSecret.length > 0 && provided.length > 0 && provided === cronSecret)) {
    return json({ success: false, error: "Unauthorized." }, 401);
  }
  try {
    const result = await runDailyDigestSweep();
    return json({ success: true, ...result });
  } catch (error) {
    console.error("Daily digest sweep error", error);
    return json({ success: false, error: "Digest sweep failed." }, 500);
  }
});
