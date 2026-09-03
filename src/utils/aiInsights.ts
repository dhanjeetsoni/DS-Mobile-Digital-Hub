import { supabase } from "../services/supabaseClient";

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
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch("/api/business-insights", {
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
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const res = await fetch("/api/staff-advice", {
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
