import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2";

// Phase 7: "AI sources/generates good-quality product photos automatically
// (not only what the owner uploads)". Deliberately a *generated, generic
// representative* studio photo (brand+model+category+color -> image),
// never claimed as an exact photo of the specific physical unit in stock --
// the client marks it with Product.photoIsAiGenerated so every screen can
// show an "AI photo" badge instead of silently passing it off as a real
// photo of the exact item. Owner can always replace it with a real one.
//
// Standalone function (same reasoning as ai-price-advisor/ai-product-specs):
// keeps the large ai-gateway file untouched.
//
// LIVE-TESTED before shipping (2026-09-09): gemini-2.5-flash-image is a
// real, reachable model via generateContent() on a plain Gemini API key
// (NOT gemini-3.5-flash-image, which 404s -- doesn't exist yet on this API
// version; NOT the Imagen models via generateImages(), which are Vertex-AI-
// only and reject a plain API key entirely). However EVERY key in this
// store's pool returned 429 (quota exceeded) on this specific model when
// tested -- image generation appears to sit on a separate, much stricter
// free-tier quota than the text/vision models already in use elsewhere in
// this app. The code below is correct and will work once quota allows; it
// could not be end-to-end verified with a real successful image today.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const GEMINI_MODEL_IMAGE = Deno.env.get("GEMINI_MODEL_IMAGE") || "gemini-2.5-flash-image";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS")) || 25_000;

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
function checkRateLimit(key: string, windowMs = 60_000, max = 8): boolean {
  const now = Date.now();
  const current = rateMap.get(key);
  if (!current || current.resetAt <= now) { rateMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  current.count++;
  return current.count <= max;
}
function clientIp(req: Request): string { return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown"; }

interface KeyEntry { slot: number; apiKey: string }
async function loadKeyPool(storeId: string | null): Promise<KeyEntry[]> {
  if (!storeId || !supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("gemini_api_keys")
    .select("slot, api_key, status, cooldown_until")
    .eq("store_id", storeId)
    .not("api_key", "is", null)
    .neq("status", "invalid")
    .order("slot", { ascending: true });
  if (error || !data) return [];
  const now = Date.now();
  let keys = data.filter((row: any) => !row.cooldown_until || new Date(row.cooldown_until).getTime() <= now).map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
  if (keys.length === 0) keys = data.map((row: any) => ({ slot: row.slot, apiKey: row.api_key }));
  return keys;
}
async function markKeyResult(storeId: string | null, slot: number, ok: boolean, errMsg?: string, failureStatus: "exhausted" | "invalid" = "exhausted") {
  if (!storeId || !supabaseAdmin) return;
  try {
    if (ok) {
      await supabaseAdmin.from("gemini_api_keys").update({ status: "active", cooldown_until: null, last_error: null, last_used_at: new Date().toISOString() }).eq("store_id", storeId).eq("slot", slot);
    } else {
      await supabaseAdmin.from("gemini_api_keys").update({ status: failureStatus, cooldown_until: failureStatus === "exhausted" ? new Date(Date.now() + 60_000).toISOString() : null, last_error: (errMsg || "").slice(0, 300) }).eq("store_id", storeId).eq("slot", slot);
    }
  } catch (e) { console.warn("markKeyResult failed", e); }
}

function classifyGeminiFailure(err: any): "quota" | "invalid" | "unavailable" | null {
  if (err instanceof GeminiTimeoutError) return "quota";
  const msg = String(err?.message || err || "").toLowerCase();
  const status = err?.status || err?.code;
  if (status === 429 || msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("rate limit")) return "quota";
  if (status === 401 || status === 403 || msg.includes("permission_denied") || msg.includes("api key not valid") || msg.includes("api_key_invalid")) return "invalid";
  if (status === 503 || msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded")) return "unavailable";
  return null;
}

async function requireUserAndStore(req: Request): Promise<{ userId: string; storeId: string | null } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("store_id").eq("id", data.user.id).maybeSingle();
  return { userId: data.user.id, storeId: profile?.store_id || null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  const ctx = await requireUserAndStore(req);
  if (!ctx) return json({ success: false, error: "Authentication required." }, 401);
  if (!checkRateLimit(`ai-product-photo:${clientIp(req)}`)) return json({ success: false, error: "Too many requests. Please try again shortly." }, 429);

  const body = await req.json().catch(() => ({}));
  const productName = typeof body?.productName === "string" ? body.productName.trim().slice(0, 120) : "";
  const brand = typeof body?.brand === "string" ? body.brand.trim().slice(0, 60) : "";
  const category = typeof body?.category === "string" ? body.category.trim().slice(0, 60) : "";
  const color = typeof body?.color === "string" ? body.color.trim().slice(0, 40) : "";

  if (!productName && !brand) return json({ success: false, error: "Product name ya brand chahiye." }, 400);

  const keys = await loadKeyPool(ctx.storeId);
  if (keys.length === 0) return json({ success: false, error: "AI unavailable — no Gemini API keys configured. Owner: add keys in Settings." }, 503);

  const subject = [brand, productName].filter(Boolean).join(" ");
  const prompt = `Generate a single, clean, professional e-commerce studio product photo\nof: ${subject}${category ? ` (category: ${category})` : ""}${color ? `, colour: ${color}` : ""}.\nPlain white/light-grey seamless background, soft even studio lighting, the product centred and\nfilling most of the frame, no text, no watermark, no logo overlays, no packaging/box unless the\nproduct itself IS packaging. Photorealistic, high quality, square-ish composition.`;

  let lastError: any = null;
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const ai = new GoogleGenAI({ apiKey: entry.apiKey });
    try {
      const response: any = await callWithTimeout(
        ai.models.generateContent({ model: GEMINI_MODEL_IMAGE, contents: { parts: [{ text: prompt }] } }),
        GEMINI_TIMEOUT_MS
      );
      const parts = response?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p: any) => p.inlineData);
      if (imgPart?.inlineData?.data) {
        void markKeyResult(ctx.storeId, entry.slot, true);
        return json({
          success: true,
          imageDataUrl: `data:${imgPart.inlineData.mimeType || "image/png"};base64,${imgPart.inlineData.data}`,
        });
      }
      lastError = new Error("No image returned");
    } catch (err) {
      lastError = err;
      const failure = classifyGeminiFailure(err);
      if (failure === "quota" || failure === "unavailable") {
        void markKeyResult(ctx.storeId, entry.slot, false, (err as any)?.message || String(err), "exhausted");
        continue;
      }
      if (failure === "invalid") {
        void markKeyResult(ctx.storeId, entry.slot, false, (err as any)?.message || String(err), "invalid");
        continue;
      }
      break;
    }
  }

  console.error("ai-product-photo: all keys failed", lastError);
  const failure = classifyGeminiFailure(lastError);
  const friendly = failure === "quota"
    ? "AI photo abhi available nahi hai (daily limit khatam) — thodi der baad try karein ya khud photo upload karein."
    : "AI photo generate nahi ho paayi — khud photo upload karein.";
  return json({ success: false, error: friendly }, 503);
});
