// 2026-09-04 — Client helpers for three new ai-gateway routes:
// due-reminder, repair-diagnosis, reorder-suggestion. Same call shape as
// aiInsights.ts's getBusinessInsights() (auth'd fetch to the Edge Function,
// friendly error on failure) — kept in a separate file since these are
// unrelated features, not "insights".

import { supabase, SUPABASE_URL } from "./supabaseClient";

const AI_GATEWAY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-gateway` : "";

async function callAiGateway(route: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!AI_GATEWAY_URL) throw new Error("AI feature unavailable — cloud not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch(`${AI_GATEWAY_URL}/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ input }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "AI request failed. Please try again.");
  }
  return json;
}

/** Drafts a short, polite Hinglish WhatsApp due-payment reminder for one customer. */
export async function getDueReminderMessage(input: {
  customerName: string;
  dueAmount: number;
  shopName?: string;
  daysSincePurchase?: number;
}): Promise<string> {
  const json = await callAiGateway("due-reminder", input);
  return String(json.message || "");
}

/** Suggests likely causes + safe first checks for a reported repair-job issue. Never a substitute for the technician actually opening the device. */
export async function getRepairDiagnosis(input: { device: string; issue: string }): Promise<string> {
  const json = await callAiGateway("repair-diagnosis", input);
  return String(json.diagnosis || "");
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
  const json = await callAiGateway("reorder-suggestion", input);
  return String(json.suggestion || "");
}
