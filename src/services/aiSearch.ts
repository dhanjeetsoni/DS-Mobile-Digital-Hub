// Phase 8 — "Add AI-powered search on top of normal keyword search — runs
// by default alongside plain search, not instead of it".
//
// The instant, zero-latency client-side keyword filter (naturalMatch() +
// App.tsx's filteredProds) is untouched and always runs first, on every
// keystroke, exactly as before. This is a separate, DEBOUNCED layer that
// only fires after the shop pauses typing, and whose results get UNIONED
// onto the instant results — see useAiSearch() below for the merge.

import { supabase, SUPABASE_URL } from "./supabaseClient";
import { fetchWithRetry } from "../utils/fetchWithRetry";

const AI_SEARCH_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-search-match` : "";

export interface AiSearchCatalogItem {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  compatibleModels?: string[];
}

/** Returns product ids the AI considers relevant to `query` beyond plain substring matching (model-compatibility, misspellings, different wording). Never throws to the caller in normal use — degrades to an empty array on any failure, since this is always an addition on top of working keyword search, never the only path. */
export async function findAiSearchMatches(query: string, items: AiSearchCatalogItem[]): Promise<string[]> {
  if (!AI_SEARCH_URL || !query.trim() || query.trim().length < 2 || items.length === 0) return [];
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetchWithRetry(
      AI_SEARCH_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ query: query.trim(), items }),
      },
      { retries: 1 } // search is latency-sensitive — one retry, not the usual 2
    );
    const json = await res.json().catch(() => null);
    if (!json?.success) return [];
    return Array.isArray(json.matchedIds) ? json.matchedIds : [];
  } catch {
    return [];
  }
}
