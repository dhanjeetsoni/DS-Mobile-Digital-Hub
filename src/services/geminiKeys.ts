import { supabase } from "./supabaseClient";
import type { AiProvider } from "./aiProviderAdapters";
import { detectProviderFromKey } from "./aiProviderAdapters";

export type { AiProvider };

export interface GeminiKeySlotStatus {
  slot: number;
  hasKey: boolean;
  status: "unset" | "active" | "exhausted" | "invalid";
  label: string | null;
  /** Phase 11: which AI provider this key belongs to (gemini/openai/anthropic/groq/openrouter). */
  provider: AiProvider;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  usageCountToday: number;
  lastError: string | null;
}

/** Alias kept for call sites that read better as "AI key" than "Gemini key". */
export type AiKeySlotStatus = GeminiKeySlotStatus;

const KNOWN_PROVIDERS: AiProvider[] = ["gemini", "openai", "anthropic", "groq", "openrouter"];

// Owner/Manager only (enforced server-side by the RPC itself — raises if the
// caller isn't owner/manager for their store). Never returns raw API keys,
// only status metadata for the AI Key Status Widget (Step 2.2).
export async function getGeminiKeyStatus(): Promise<GeminiKeySlotStatus[]> {
  const { data, error } = await supabase.rpc("get_gemini_key_status");
  if (error) throw error;
  return (data || []).map((row: any) => {
    // The `provider` column (migration v41) is authoritative. The label-prefix
    // fallback below only exists for rows written by an older build that
    // encoded the provider as a "[openai] My key" label prefix before that
    // column existed — read those correctly rather than showing them all as
    // Gemini, and strip the prefix so it never leaks into the UI either way.
    let provider: AiProvider = "gemini";
    if (row.provider && KNOWN_PROVIDERS.includes(row.provider)) {
      provider = row.provider as AiProvider;
    } else if (row.label) {
      const match = String(row.label).match(/^\[(gemini|openai|anthropic|groq|openrouter)\]/i);
      if (match) provider = match[1].toLowerCase() as AiProvider;
    }
    const cleanLabel = row.label
      ? String(row.label).replace(/^\[(gemini|openai|anthropic|groq|openrouter)\]\s*/i, "").trim() || null
      : null;

    return {
      slot: row.slot,
      hasKey: Boolean(row.has_key),
      status: row.status || "unset",
      label: cleanLabel,
      provider,
      cooldownUntil: row.cooldown_until,
      lastUsedAt: row.last_used_at,
      usageCountToday: Number(row.usage_count_today) || 0,
      lastError: row.last_error,
    };
  });
}

// Saves (or clears, if apiKey is empty) one of the 10 key slots (1-10).
// Owner/Manager only. Never returns the key back.
//
// `provider` is optional — when omitted it's auto-detected from the key's
// prefix (sk-ant- → anthropic, gsk_ → groq, etc), matching what the
// detect_ai_provider() SQL function does server-side.
export async function saveGeminiKey(
  slot: number,
  apiKey: string,
  label?: string,
  provider?: AiProvider,
): Promise<void> {
  const chosenProvider = provider || detectProviderFromKey(apiKey);
  const { error } = await supabase.rpc("save_gemini_api_key", {
    p_slot: slot,
    p_api_key: apiKey,
    p_label: label || null,
    p_provider: chosenProvider,
  });
  if (error) throw error;
}
