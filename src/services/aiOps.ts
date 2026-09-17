// Client helpers for backend & edge AI services:
// - repair diagnosis & bench checklist
// - WhatsApp & SMS customer message drafts
// - second-hand mobile buyback valuation & margins
// - product thermal tag lines & merchandising points
// - dead stock clearance bundles & strategies
// - POS Copilot assistant
// - semantic catalog search
// - due reminder & restock suggestions

import { supabase, SUPABASE_URL } from "./supabaseClient";
import { fetchWithRetry } from "../utils/fetchWithRetry";

const AI_GATEWAY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-gateway` : "";

/**
 * Universal caller that tries the local Express server (/api/...) first or falls back to Edge Function.
 * Seamlessly handles authentication and error recovery.
 */
async function callAiService(endpoint: string, payload: Record<string, unknown>): Promise<any> {
  let token = "";
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData?.session?.access_token || "";
  } catch {
    // offline or local mock mode
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // 1. Try local Express backend (/api/...) first
  try {
    const res = await fetchWithRetry(`/api/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json && (json.success || json.diagnosis || json.message || json.suggestion || json.terms)) {
        return json;
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Fallback to Supabase Edge Function if configured
  if (AI_GATEWAY_URL) {
    try {
      const res = await fetchWithRetry(`${AI_GATEWAY_URL}/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: payload }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.success) return json;
      }
    } catch {
      // Continue to error
    }
  }

  throw new Error("AI service temporarily unavailable. Please verify connection or API keys.");
}

/** Drafts a short, polite Hinglish WhatsApp due-payment reminder for one customer. */
export async function getDueReminderMessage(input: {
  customerName: string;
  dueAmount: number;
  shopName?: string;
  daysSincePurchase?: number;
}): Promise<string> {
  const json = await callAiService("due-reminder", input);
  return String(json.message || json.politeHinglish || "");
}

/** Suggests likely causes + safe first checks for a reported repair-job issue. Backward compatible. */
export async function getRepairDiagnosis(input: { device: string; issue: string; customerNote?: string }): Promise<string> {
  const json = await callAiService("ai-repair-diagnostics", input);
  return String(json.diagnosis || json.customerHinglishExplanation || "");
}

export interface DetailedRepairDiagnostics {
  diagnosis: string;
  likelyCauses: string[];
  recommendedParts: { name: string; estimatedCost: number; isOptional?: boolean }[];
  difficulty: "Easy" | "Moderate" | "Advanced (BGA / Micro-soldering)";
  safetyPrecaution: string;
  estimatedTurnaroundTime: string;
  customerHinglishExplanation: string;
  diagnosticChecklist: string[];
}

/** Comprehensive repair diagnosis with technician checklist, part costs, and customer explanation. */
export async function getDetailedRepairDiagnostics(input: {
  device: string;
  issue: string;
  customerNote?: string;
}): Promise<DetailedRepairDiagnostics> {
  const json = await callAiService("ai-repair-diagnostics", input);
  return {
    diagnosis: json.diagnosis || "Inspection recommended.",
    likelyCauses: Array.isArray(json.likelyCauses) ? json.likelyCauses : [],
    recommendedParts: Array.isArray(json.recommendedParts) ? json.recommendedParts : [],
    difficulty: json.difficulty || "Moderate",
    safetyPrecaution: json.safetyPrecaution || "Disconnect battery prior to board inspection.",
    estimatedTurnaroundTime: json.estimatedTurnaroundTime || "45-60 mins",
    customerHinglishExplanation: json.customerHinglishExplanation || "Device check ho raha hai.",
    diagnosticChecklist: Array.isArray(json.diagnosticChecklist) ? json.diagnosticChecklist : [],
  };
}

export interface CustomerMessageOptions {
  politeHinglish: string;
  professional: string;
  shortInstant: string;
  recommendedFollowUpDays: number;
}

/** Generates 3 styles of ready-to-send customer WhatsApp/SMS messages. */
export async function getCustomerMessageDrafts(input: {
  type: "dueReminder" | "repairReady" | "repairEstimate" | "festivalOffer" | "welcomeThankYou";
  customerName: string;
  phone?: string;
  amount?: number;
  deviceName?: string;
  invoiceNo?: string;
  shopName?: string;
  extraNotes?: string;
}): Promise<CustomerMessageOptions> {
  const json = await callAiService("ai-customer-message", input);
  return {
    politeHinglish: json.politeHinglish || "",
    professional: json.professional || "",
    shortInstant: json.shortInstant || "",
    recommendedFollowUpDays: json.recommendedFollowUpDays || 3,
  };
}

export interface SecondHandValuationResult {
  recommendedBuybackPrice: number;
  resaleTargetPrice: number;
  profitMargin: number;
  profitMarginPercent: number;
  conditionSummary: string;
  hardwareChecklist: string[];
  counterNegotiationPitch: string;
}

/** Valuation for used smartphones based on Indian wholesale/resale rates. */
export async function getSecondHandValuation(input: {
  brand: string;
  modelName: string;
  storage?: string;
  cosmeticCondition?: string;
  batteryHealth?: string | number;
  hasBoxAndBill?: boolean;
  knownDefects?: string;
}): Promise<SecondHandValuationResult> {
  const json = await callAiService("ai-second-hand-valuation", input);
  return {
    recommendedBuybackPrice: Number(json.recommendedBuybackPrice) || 0,
    resaleTargetPrice: Number(json.resaleTargetPrice) || 0,
    profitMargin: Number(json.profitMargin) || 0,
    profitMarginPercent: Number(json.profitMarginPercent) || 0,
    conditionSummary: json.conditionSummary || "",
    hardwareChecklist: Array.isArray(json.hardwareChecklist) ? json.hardwareChecklist : [],
    counterNegotiationPitch: json.counterNegotiationPitch || "",
  };
}

export interface ProductDescResult {
  sellingPoints: string[];
  thermalTagLine: string;
  searchTags: string[];
  counterPitch: string;
}

/** Generates product merchandising points, thermal barcode label tagline, and search keywords. */
export async function getProductDescAndTags(input: {
  name: string;
  category: string;
  brand?: string;
  mrp?: number;
  sellingPrice?: number;
}): Promise<ProductDescResult> {
  const json = await callAiService("ai-product-desc", input);
  return {
    sellingPoints: Array.isArray(json.sellingPoints) ? json.sellingPoints : [],
    thermalTagLine: json.thermalTagLine || "",
    searchTags: Array.isArray(json.searchTags) ? json.searchTags : [],
    counterPitch: json.counterPitch || "",
  };
}

export interface DeadStockClearanceResult {
  overallAdvice: string;
  bundles: { title: string; bundleItems: string[]; promoPrice: string; pitch: string }[];
  flashClearanceItems: { name: string; suggestedClearancePrice: number; markdownPercent: number; reason: string }[];
  counterStaffTip: string;
}

/** Actionable clearance bundles and liquidation plan for slow-moving stock. */
export async function getDeadStockStrategy(items: any[]): Promise<DeadStockClearanceResult> {
  const json = await callAiService("ai-dead-stock-strategy", { items });
  return {
    overallAdvice: json.overallAdvice || "",
    bundles: Array.isArray(json.bundles) ? json.bundles : [],
    flashClearanceItems: Array.isArray(json.flashClearanceItems) ? json.flashClearanceItems : [],
    counterStaffTip: json.counterStaffTip || "",
  };
}

/** Direct Copilot assistant for retail and repair staff. */
export async function askPosCopilot(query: string, context?: any): Promise<{ answer: string; quickChips: string[] }> {
  const json = await callAiService("ai-pos-copilot", { query, context });
  return {
    answer: json.answer || "No response received.",
    quickChips: Array.isArray(json.quickChips) ? json.quickChips : [],
  };
}

/** Suggests a reorder quantity for a low-stock product, based on recent sale velocity rather than just the static minStock formula. */
export async function getReorderSuggestion(input: {
  productName: string;
  category?: string;
  currentStock: number;
  minStock: number;
  unitsSoldLast7Days: number;
  unitsSoldLast30Days: number;
  currentStaticSuggestion: number;
}): Promise<string> {
  const json = await callAiService("reorder-suggestion", input);
  return String(json.suggestion || "");
}
