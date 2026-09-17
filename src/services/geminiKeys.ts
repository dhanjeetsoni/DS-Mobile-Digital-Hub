import { supabase } from "./supabaseClient";
import type { AiProvider } from "./aiProviderAdapters";
import { detectProviderFromKey } from "./aiProviderAdapters";

export type { AiProvider };

export interface GeminiKeySlotStatus {
  slot: number;
  hasKey: boolean;
  status: "unset" | "active" | "exhausted" | "invalid";
  label: string | null;
  provider: AiProvider;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  usageCountToday: number;
  lastError: string | null;
}

export type AiKeySlotStatus = GeminiKeySlotStatus;

// Owner/Manager only (enforced server-side by the RPC itself — raises if the
// caller isn't owner/manager for their store). Never returns raw API keys,
// only status metadata for the AI Key Status Widget.
export async function getGeminiKeyStatus(): Promise<GeminiKeySlotStatus[]> {
  const { data, error } = await supabase.rpc("get_gemini_key_status");
  if (error) throw error;
  return (data || []).map((row: any) => {
    let provider: AiProvider = "gemini";
    if (row.provider && ["gemini", "openai", "anthropic", "groq", "openrouter"].includes(row.provider)) {
      provider = row.provider as AiProvider;
    } else if (row.label) {
      const match = String(row.label).match(/\[(gemini|openai|anthropic|groq|openrouter)\]/i);
      if (match) provider = match[1].toLowerCase() as AiProvider;
    }
    const cleanLabel = row.label ? String(row.label).replace(/^\[(gemini|openai|anthropic|groq|openrouter)\]\s*/i, "") : null;

    return {
      slot: row.slot,
      hasKey: Boolean(row.has_key),
      status: row.status || "unset",
      label: cleanLabel || row.label,
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
export async function saveGeminiKey(
  slot: number,
  apiKey: string,
  label?: string,
  provider?: AiProvider
): Promise<void> {
  const chosenProvider = provider || detectProviderFromKey(apiKey);
  const compositeLabel = label ? `[${chosenProvider}] ${label}` : `[${chosenProvider}]`;

  try {
    const { error } = await supabase.rpc("save_gemini_api_key", {
      p_slot: slot,
      p_api_key: apiKey,
      p_label: compositeLabel,
      p_provider: chosenProvider,
    });
    if (error) {
      // Fallback for older RPC signature without p_provider
      const { error: fallbackError } = await supabase.rpc("save_gemini_api_key", {
        p_slot: slot,
        p_api_key: apiKey,
        p_label: compositeLabel,
      });
      if (fallbackError) throw fallbackError;
    }
  } catch (e: any) {
    if (e.message && (e.message.includes("p_provider") || e.message.includes("argument"))) {
      const { error: fallbackError } = await supabase.rpc("save_gemini_api_key", {
        p_slot: slot,
        p_api_key: apiKey,
        p_label: compositeLabel,
      });
      if (fallbackError) throw fallbackError;
    } else {
      throw e;
    }
  }
}

