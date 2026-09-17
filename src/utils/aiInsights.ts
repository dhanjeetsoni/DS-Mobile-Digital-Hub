import { supabase, SUPABASE_URL } from "../services/supabaseClient";
import { fetchWithRetry } from "./fetchWithRetry";

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

// Calls the Gemini-powered business-insights endpoint with an aggregated,
// non-sensitive numeric summary (no raw customer/IMEI/personal data is sent).
export async function getBusinessInsights(summary: BusinessInsightsSummary): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Try local server first
  try {
    const res = await fetchWithRetry(`/api/business-insights`, {
      method: "POST",
      headers,
      body: JSON.stringify({ summary }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.success && json?.insights) return json.insights;
    }
  } catch {
    // try edge gateway
  }

  if (AI_GATEWAY_URL) {
    const res = await fetchWithRetry(`${AI_GATEWAY_URL}/business-insights`, {
      method: "POST",
      headers,
      body: JSON.stringify({ summary }),
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      return json.insights as string;
    }
  }

  throw new Error("AI insights unavailable. Please verify API configuration.");
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
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Try local server first
  try {
    const res = await fetchWithRetry(`/api/staff-advice`, {
      method: "POST",
      headers,
      body: JSON.stringify({ summary }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.success && json?.advice) return json.advice;
    }
  } catch {
    // try edge gateway
  }

  if (AI_GATEWAY_URL) {
    const res = await fetchWithRetry(`${AI_GATEWAY_URL}/staff-advice`, {
      method: "POST",
      headers,
      body: JSON.stringify({ summary }),
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      return json.advice as string;
    }
  }

  throw new Error("AI advice unavailable. Please verify API configuration.");
}
