import { useMemo, useState } from "react";

// Shared display logic for a "compatible models" list (e.g. a Tempered
// Glass that fits 40+ phones). Per Master Plan 3.2: never dump the whole
// list in the UI at once (that's what made big lists confusing AND caused
// UI slow/crash — see Step 10). Instead:
//   - show only the first `defaultVisible` (default 5) by default
//   - offer a small type-to-filter box to search within THIS product's list
//   - a "Sabhi N Models Dekhein" button reveals the rest, on demand
// This is a hook (not a component) so each usage keeps its own independent
// expanded/search state — safe to use once per row inside a list.
export function useCompatibleModelsDisplay(models: string[], defaultVisible = 5) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, query]);

  const isSearching = query.trim().length > 0;
  // While searching, show every match (already narrowed by the query so it
  // can't blow back up to 40+ unfiltered items). Otherwise respect the
  // collapsed/expanded state.
  const visible = isSearching || expanded ? filtered : filtered.slice(0, defaultVisible);
  const hiddenCount = isSearching ? 0 : Math.max(0, models.length - defaultVisible);
  const canExpand = !isSearching && models.length > defaultVisible;

  return {
    query,
    setQuery,
    expanded,
    setExpanded,
    visible,
    hiddenCount,
    canExpand,
    isSearching,
    total: models.length,
  };
}
