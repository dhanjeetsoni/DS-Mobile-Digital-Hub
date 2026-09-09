import { supabase } from "./supabaseClient";

export interface PriceSuggestion {
  mrp: number | null;
  recommendedSellingPrice: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
  sources: { title: string; url: string }[];
}

export interface StaffPerformanceRow {
  profile_id: string;
  staff_name: string;
  sale_count: number;
  total_sales: number;
  total_profit: number;
  average_sale: number;
  rank: number;
}

export interface CustomerHistoryRow {
  sale_id: string;
  invoice_no: string;
  created_at: string;
  total: number;
  payment_method: string;
  status: string;
  items: { product_name: string; quantity: number; unit_price: number }[];
}

export interface ReturnApprovalRequest {
  id: string;
  return_no: string;
  sale_id: string | null;
  requested_by: string;
  requester_name: string;
  customer_id: string | null;
  return_type: string;
  reason: string;
  refund_method: string;
  notes: string;
  items: any[];
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export async function suggestProductPrice(input: {
  brand?: string;
  productName: string;
  category: string;
  compatibleModels?: string[];
  purchasePrice?: number | null;
  currentSellingPrice?: number | null;
  currentMrp?: number | null;
}): Promise<PriceSuggestion> {
  // 2026-09-07 (Phase 6, "better Gemini key pool handling"): a couple of
  // quick retries on a transient network blip, same reasoning as
  // fetchWithRetry.ts (used by the other AI call sites, which go through
  // raw fetch() instead of supabase.functions.invoke() here) — a dropped
  // connection or Edge Function cold start shouldn't be a hard failure the
  // first time.
  let lastError: unknown;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-price-advisor", { body: input });
      if (error) throw error;
      if (!data?.recommendation) throw new Error("AI price suggestion did not return a valid recommendation.");
      return data.recommendation as PriceSuggestion;
    } catch (err) {
      lastError = err;
      if (attempt === 2) break;
      await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

export async function getStaffPerformance(storeId: string, from: Date, to: Date): Promise<StaffPerformanceRow[]> {
  const { data, error } = await supabase.rpc("get_staff_sales_performance", {
    p_store_id: storeId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return (data || []) as StaffPerformanceRow[];
}

export async function getCustomerPurchaseHistory(storeId: string, customerId: string): Promise<CustomerHistoryRow[]> {
  const { data, error } = await supabase.rpc("get_customer_purchase_history", {
    p_store_id: storeId,
    p_customer_id: customerId,
  });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...row,
    items: Array.isArray(row.items) ? row.items : [],
  })) as CustomerHistoryRow[];
}

export async function getPriceHistory(storeId: string, productId: string) {
  const { data, error } = await supabase.rpc("get_product_price_history", {
    p_store_id: storeId,
    p_product_id: productId,
    p_limit: 100,
  });
  if (error) throw error;
  return data || [];
}

export async function listReturnApprovalRequests(storeId: string, status: "pending" | "approved" | "rejected" | null = "pending") {
  const { data, error } = await supabase.rpc("list_return_approval_requests", {
    p_store_id: storeId,
    p_status: status,
  });
  if (error) throw error;
  return (data || []) as ReturnApprovalRequest[];
}

export async function approveReturn(requestId: string, approve: boolean, note = "") {
  const { data, error } = await supabase.rpc("approve_return_approval", {
    p_request_id: requestId,
    p_approve: approve,
    p_review_note: note || null,
  });
  if (error) throw error;
  return data as string;
}

export async function remindWarrantyClaimNow(storeId: string, claimId: string) {
  const { data, error } = await supabase.rpc("remind_warranty_claim_now", {
    p_store_id: storeId,
    p_claim_id: claimId,
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function setProductPhotos(storeId: string, productId: string, photos: string[]) {
  const { data, error } = await supabase.rpc("set_product_photos", {
    p_store_id: storeId,
    p_product_id: productId,
    p_photos: photos,
  });
  if (error) throw error;
  return data as string;
}

export async function getMyStaffAccessPolicy() {
  const { data, error } = await supabase.rpc("get_my_staff_access_policy");
  if (error) throw error;
  return data || null;
}

export async function upsertStaffAccessPolicy(input: {
  staffProfileId: string;
  dailyStart: string | null;
  dailyEnd: string | null;
  sessionMinutes: number | null;
  allowedSections: string[];
  allowedData: Record<string, boolean>;
}) {
  const { data, error } = await supabase.rpc("upsert_staff_access_policy", {
    p_staff_profile_id: input.staffProfileId,
    p_daily_start: input.dailyStart,
    p_daily_end: input.dailyEnd,
    p_session_minutes: input.sessionMinutes,
    p_allowed_sections: input.allowedSections,
    p_allowed_data: input.allowedData,
  });
  if (error) throw error;
  return data;
}

export async function forceLogoutStaff(profileId: string) {
  const { data, error } = await supabase.rpc("admin_force_logout_profile", {
    p_target_profile_id: profileId,
  });
  if (error) throw error;
  return data as string;
}

export async function updateWarrantyStatus(storeId: string, claimId: string, status: string, resolution = "") {
  const { data, error } = await supabase.rpc("update_warranty_claim_status", {
    p_store_id: storeId,
    p_claim_id: claimId,
    p_status: status,
    p_resolution: resolution || null,
  });
  if (error) throw error;
  return data as string;
}

export async function setStaffProfileAccess(profileId: string, values: {
  access_enabled: boolean;
  access_mode: string;
  access_expires_at: string | null;
  visibility_from: string | null;
}) {
  const { error } = await supabase
    .from("profiles")
    .update(values)
    .eq("id", profileId);
  if (error) throw error;
}

export async function setStaffAccessConfig(profileId: string, input: {
  accessEnabled: boolean;
  accessMode: string;
  accessExpiresAt: string | null;
  visibilityFrom: string | null;
  dailyStart: string | null;
  dailyEnd: string | null;
  sessionMinutes: number | null;
  allowedSections: string[];
  allowedData: Record<string, boolean>;
}) {
  await setStaffProfileAccess(profileId, {
    access_enabled: input.accessEnabled,
    access_mode: input.accessMode,
    access_expires_at: input.accessExpiresAt,
    visibility_from: input.visibilityFrom,
  });
  return upsertStaffAccessPolicy({
    staffProfileId: profileId,
    dailyStart: input.dailyStart,
    dailyEnd: input.dailyEnd,
    sessionMinutes: input.sessionMinutes,
    allowedSections: input.allowedSections,
    allowedData: input.allowedData,
  });
}

// 2026-09-09: @tauri-apps/plugin-biometric is now a real installed
// dependency (npm install done, Cargo.toml has a mobile-only target
// dependency on tauri-plugin-biometric, lib.rs registers it under
// #[cfg(mobile)], capabilities/default.json grants "biometric:default",
// and the CI workflow injects the USE_BIOMETRIC/USE_FINGERPRINT Android
// manifest permissions the plugin's own bundled manifest doesn't declare
// — verified against the plugin's actual published source, not assumed).
// A plain static import is safe on Windows too: the JS bindings package
// bundles fine everywhere (it's pure JS), and on desktop, where the Rust
// plugin is never registered, a call simply fails at the Tauri IPC layer
// — which biometricCheck()'s catch below already turns into a clean
// "not available" instead of an uncaught error.
import { checkStatus, authenticate } from "@tauri-apps/plugin-biometric";

export async function biometricCheck() {
  try {
    return await checkStatus();
  } catch {
    return { isAvailable: false, biometryType: 0 };
  }
}

export async function authenticateBiometric(reason = "Unlock DS Mobile & Digital Hub") {
  await authenticate(reason, { allowDeviceCredential: true });
}
