/**
 * DS Mobile & Digital Hub Pro — AI Invoice Rules & Quotes Service (Phase 10)
 * 
 * Automatically generates or suggests product-specific terms & feel-good quotes
 * in the background using Gemini AI, with instant offline heuristic fallback.
 */

import { Product } from "../types";
import { synthesizeProductRules } from "../utils/invoiceRulesEngine";
import { supabase } from "./supabaseClient";

export interface GeneratedInvoiceRulesResponse {
  success: boolean;
  terms: string[];
  quote: string;
  categoryKey: string;
  source: "gemini" | "local_synthesizer";
  error?: string;
}

/**
 * Requests AI to generate product-specific invoice terms and a customer-facing quote.
 * Falls back seamlessly to the local rule synthesizer if offline or AI call fails.
 */
export async function generateProductInvoiceRules(
  product: Partial<Product>
): Promise<GeneratedInvoiceRulesResponse> {
  const localFallback = synthesizeProductRules(product);

  try {
    const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const token = sessionData?.session?.access_token;

    const res = await fetch("/api/generate-invoice-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        name: product.name || "",
        category: product.category || "",
        brand: product.brand || "",
        sellingPrice: product.sellingPrice || 0,
        mrp: product.mrp || 0,
        warrantyEnabled: product.warrantyEnabled || false,
        warrantyMonths: product.warrantyMonths || 0,
        notes: product.notes || "",
        isMobilePhone: product.isMobilePhone || false,
        isSparePart: product.isSparePart || false,
        isSecondHand: Boolean(product.units?.some((u) => u.isSecondHand)),
      }),
    });

    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.success && Array.isArray(json.terms) && json.terms.length > 0) {
        return {
          success: true,
          terms: json.terms,
          quote: json.quote || localFallback.quote,
          categoryKey: json.categoryKey || localFallback.categoryKey,
          source: "gemini",
        };
      }
    }
  } catch {
    // Network or server blip: proceed with local synthesizer
  }

  return {
    success: true,
    terms: localFallback.terms,
    quote: localFallback.quote,
    categoryKey: localFallback.categoryKey,
    source: "local_synthesizer",
  };
}
