import { supabase, SUPABASE_URL } from "../services/supabaseClient";

// See aiOcr.ts for why this points at the ai-gateway Edge Function instead
// of a relative "/api/..." path (that path only ever existed on a local
// `npm start` Express server, never in the packaged Tauri .exe).
const AI_GATEWAY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-gateway` : "";

export interface BusinessInsightsSummary {
  monthLabel: string;
  totalSalesThisMonth: number;
  totalExpensesThisMonth: number;
  profitThisMonth: number;
  totalMonthlyInterestDue: number;
  totalPrincipalOutstanding: number;
  supplierPayableOutstanding: number;
  topSellingProducts: { name: string; qty: number }[];
  lowStockProducts: { name: string; stock: number; minStock: number }[];
}

// Calls the Gemini-powered /api/business-insights endpoint with an aggregated,
// non-sensitive numeric summary (no raw customer/IMEI/personal data is sent).
export async function getBusinessInsights(summary: BusinessInsightsSummary): Promise<string> {
  if (!AI_GATEWAY_URL) throw new Error("AI insights unavailable — cloud not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch(`${AI_GATEWAY_URL}/business-insights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ summary }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "AI insights unavailable. Please try again.");
  }
  return json.insights as string;
}

export interface StaffAdviceSummary {
  todaySalesSoFar: number;
  todayInvoiceCount: number;
  topMovingProducts: { name: string; qty: number }[];
  lowStockProducts: { name: string; stock: number; minStock: number }[];
}

// Staff-facing counterpart to getBusinessInsights() above. Deliberately never
// sends or asks for profit/margin/cost/expense figures — only sales-count and
// stock-level data a staff member is already allowed to see.
export async function getStaffAdvice(summary: StaffAdviceSummary): Promise<string> {
  if (!AI_GATEWAY_URL) throw new Error("AI advice unavailable — cloud not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch(`${AI_GATEWAY_URL}/staff-advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ summary }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "AI advice unavailable. Please try again.");
  }
  return json.advice as string;
}
