// Phase 7 — "AI sources/generates good-quality product photos
// automatically". Scoped to AI *enhancement* of the shop's own uploaded
// photo (clean background, centered, studio lighting) — never sources or
// reproduces another retailer's copyrighted product photography. See
// supabase/functions/enhance-product-photo/index.ts for the full scope
// writeup.

import { supabase, SUPABASE_URL } from "./supabaseClient";
import { fetchWithRetry } from "../utils/fetchWithRetry";

const ENHANCE_PHOTO_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/enhance-product-photo` : "";

/** Sends a product photo (data: URL) to be cleaned up into an e-commerce-style shot. Returns a NEW data: URL — the original is never modified, so callers should always let the shop review/compare before replacing anything. */
export async function enhanceProductPhoto(imageDataUrl: string): Promise<string> {
  if (!ENHANCE_PHOTO_URL) throw new Error("AI photo enhance unavailable — cloud not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetchWithRetry(ENHANCE_PHOTO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ image: imageDataUrl }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "AI photo enhance fail ho gaya.");
  }
  return json.image as string;
}
