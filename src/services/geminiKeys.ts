import { supabase } from "./supabaseClient";

export interface GeminiKeySlotStatus {
  slot: number;
  hasKey: boolean;
  status: "unset" | "active" | "exhausted" | "invalid";
  label: string | null;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  usageCountToday: number;
  lastError: string | null;
}

// Owner/Manager only (enforced server-side by the RPC itself — raises if the
// caller isn't owner/manager for their store). Never returns raw API keys,
// only status metadata for the AI Key Status Widget (Step 2.2).
export async function getGeminiKeyStatus(): Promise<GeminiKeySlotStatus[]> {
  const { data, error } = await supabase.rpc("get_gemini_key_status");
  if (error) throw error;
  return (data || []).map((row: any) => ({
    slot: row.slot,
    hasKey: Boolean(row.has_key),
    status: row.status || "unset",
    label: row.label,
    cooldownUntil: row.cooldown_until,
    lastUsedAt: row.last_used_at,
    usageCountToday: Number(row.usage_count_today) || 0,
    lastError: row.last_error,
  }));
}

// Saves (or clears, if apiKey is empty) one of the 10 key slots (1-10).
// Owner/Manager only. Never returns the key back.
export async function saveGeminiKey(slot: number, apiKey: string, label?: string): Promise<void> {
  const { error } = await supabase.rpc("save_gemini_api_key", {
    p_slot: slot,
    p_api_key: apiKey,
    p_label: label || null,
  });
  if (error) throw error;
}
