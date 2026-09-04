import { supabase, SUPABASE_URL } from "../services/supabaseClient";

// These AI/OCR calls used to hit a relative "/api/..." path, which only ever
// worked when the Express server.ts (npm start, local machine only) was also
// serving the frontend. The packaged Tauri .exe bundles ONLY the static
// frontend (no backend), so "/api/..." resolved to the app's own index.html
// there — "Unexpected token '<'" when the client tried to JSON.parse it.
// AI/OCR now lives in the ai-gateway Supabase Edge Function, so these calls
// go to a real, always-on HTTPS endpoint in every environment (browser,
// Windows .exe, Android) instead of a path that only exists on localhost.
const AI_GATEWAY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-gateway` : "";

// Every AI endpoint requires a logged-in Supabase user (requireUserAndStore
// in ai-gateway/index.ts). This helper attaches the session token to every
// call in this file.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export interface OcrPhoneResult {
  brand: string;
  modelName: string;
  imei1: string;
  imei2?: string;
  serialNo?: string;
  color?: string;
  ramStorage?: string;
  mrp?: number;
  sellingPriceSuggested?: number;
  androidVersion?: string;
  batteryHealth?: string;
  detectedCategory: "New Mobile" | "Second-Hand Mobile" | "Accessory";
  notes?: string;
  rawConfidence?: string;
  verified?: boolean;
  requiresVerification?: boolean;
  mismatches?: string[];
  rawText?: string;
}

export interface OcrAccessoryResult {
  brand: string;
  productName: string;
  category: string;
  compatibleModels: string[];
  notes?: string;
  // Step 3.4b: min (or exact, if no range) screen size in inches.
  screenSizeInches?: number;
  // Step 3.4b: only present/non-zero when the pack covers a genuine RANGE
  // of screen sizes (e.g. a universal-fit / curved glass "For 6.5-6.7 inch
  // mobiles") — otherwise omitted, meaning min === max === screenSizeInches.
  screenSizeMaxInches?: number;
}

// Asks the AI for a phone model's screen size (inches) — used as a fallback
// match in ModelSearchView when a customer's exact model isn't listed under
// any glass/cover's compatibleModels. Step 3.4d: results are cached
// server-side in Supabase (not just in-memory), so a model looked up once
// stays instantly matchable — including across server restarts/instances —
// without hitting Gemini again.
export async function lookupScreenSize(modelName: string): Promise<number> {
  if (!AI_GATEWAY_URL) return 0;
  const res = await fetch(`${AI_GATEWAY_URL}/screen-size-lookup`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ modelName }),
  });
  if (res.ok) {
    const json = await res.json();
    if (json.success) return Number(json.screenSizeInches) || 0;
  }
  return 0;
}

// Scans an accessory pack photo (tempered glass / back cover / charger /
// cable box) and returns the brand, product name, suggested category and the
// FULL list of compatible phone models printed on it. Used to auto-fill the
// "Add New Product" form so one photo -> one catalog item with many models,
// instead of the staff typing every model by hand.
export async function processAccessoryOcr(imageDataUrl: string): Promise<OcrAccessoryResult> {
  if (!AI_GATEWAY_URL) throw new Error("AI unavailable — cloud not configured.");
  const res = await fetch(`${AI_GATEWAY_URL}/ocr-accessory`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ image: imageDataUrl }),
  });

  if (res.ok) {
    const json = await res.json();
    if (json.success && json.data) {
      return {
        brand: json.data.brand || "",
        productName: json.data.productName || "",
        category: json.data.category || "Accessories",
        compatibleModels: Array.isArray(json.data.compatibleModels) ? json.data.compatibleModels : [],
        notes: json.data.notes || "",
        screenSizeInches: Number(json.data.screenSizeInches) || 0,
        screenSizeMaxInches: Number(json.data.screenSizeMaxInches) || 0,
      };
    }
  }
  const msg = await res.json().catch(() => null);
  throw new Error(msg?.error || "AI unavailable — enter manually.");
}

export interface ProductPhotoResult {
  itemType: string;
  brand: string;
  productName: string;
  color: string;
  searchKeywords: string[];
  notes?: string;
}

// Identifies ANY shop item from a photo (phone, glass, cover, charger,
// cable, earphones, power bank, etc.) and returns short search keywords the
// client uses to search the shop's OWN product catalog — used by the staff
// "Photo Stock Finder" so a staff member can snap a photo of something and
// jump straight to matching in-stock items to sell, instead of typing.
export async function identifyProductPhoto(imageDataUrl: string): Promise<ProductPhotoResult> {
  if (!AI_GATEWAY_URL) throw new Error("AI unavailable — cloud not configured.");
  const res = await fetch(`${AI_GATEWAY_URL}/product-photo-search`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ image: imageDataUrl }),
  });

  if (res.ok) {
    const json = await res.json();
    if (json.success && json.data) {
      return {
        itemType: json.data.itemType || "",
        brand: json.data.brand || "",
        productName: json.data.productName || "",
        color: json.data.color || "",
        searchKeywords: Array.isArray(json.data.searchKeywords) ? json.data.searchKeywords : [],
        notes: json.data.notes || "",
      };
    }
  }
  const msg = await res.json().catch(() => null);
  throw new Error(msg?.error || "AI unavailable — search manually.");
}

export async function processPhoneOcr(
  imageDataUrl: string,
  imageType: "box" | "about_screen" | "auto" = "auto"
): Promise<OcrPhoneResult> {
  try {
    if (!AI_GATEWAY_URL) throw new Error("AI unavailable — cloud not configured.");
    const res = await fetch(`${AI_GATEWAY_URL}/ocr-phone`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ image: imageDataUrl, imageType }),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        return {
          brand: json.data.brand || "",
          modelName: json.data.modelName || "",
          imei1: (json.data.imei1 || "").replace(/\D/g, "").slice(0, 15),
          imei2: (json.data.imei2 || "").replace(/\D/g, "").slice(0, 15),
          serialNo: json.data.serialNo || "",
          color: json.data.color || "",
          ramStorage: json.data.ramStorage || "",
          mrp: Number(json.data.mrp) || 0,
          sellingPriceSuggested: Number(json.data.sellingPriceSuggested) || 0,
          androidVersion: json.data.androidVersion || "",
          batteryHealth: json.data.batteryHealth || "",
          detectedCategory: json.data.detectedCategory || (imageType === "about_screen" ? "Second-Hand Mobile" : "New Mobile"),
          notes: json.data.notes || "",
          rawConfidence: json.provider || "AI Vision",
          verified: Boolean(json.verified),
          requiresVerification: Boolean(json.requiresVerification),
          mismatches: Array.isArray(json.mismatches) ? json.mismatches : [],
          rawText: json.rawText || "",
        };
      }
    }
  } catch (err) {
    console.warn("AI/OCR service unavailable:", err);
  }
  throw new Error("AI unavailable — enter manually.");

}

