// Step 6.3 — Micro-AI Helpers: "natural-language-ish" search matching.
//
// Deliberately NOT a Gemini/network call. Search boxes need this on every
// keystroke, and the plan itself is explicit that these small helpers must
// feel invisible/seamless — "AI processing ho raha hai" jaisa clunky wait
// nahi lagna chahiye. A network round-trip per character would be the exact
// opposite of that. Instead this expands whatever the staff/customer typed
// into every catalog-language word it could plausibly mean, so a common
// Hindi/Hinglish colour word still matches an English product name already
// in the catalog — this is the plan's own worked example: typing "wo laal
// wala glass" should still find a "Red Tempered Glass" listing.
//
// Scope kept honest and narrow: only well-known, unambiguous everyday
// colour words that customers actually use to describe a phone case/glass
// at the counter. Not a translation engine, and deliberately does not guess
// at product-type slang (a wrong guess there would return bad matches,
// which is worse than no help at all).

const COLOR_SYNONYMS: Record<string, string[]> = {
  laal: ["red"], lal: ["red"], red: ["laal", "lal"],
  kala: ["black"], kaala: ["black"], kaali: ["black"], black: ["kala", "kaala", "kaali"],
  safed: ["white"], safaid: ["white"], white: ["safed", "safaid"],
  neela: ["blue"], nila: ["blue"], neel: ["blue"], blue: ["neela", "nila"],
  hara: ["green"], harra: ["green"], hari: ["green"], green: ["hara", "harra", "hari"],
  peela: ["yellow"], pila: ["yellow"], yellow: ["peela", "pila"],
  gulabi: ["pink"], pink: ["gulabi"],
  sunehra: ["gold", "golden"], sunhera: ["gold", "golden"], golden: ["sunehra", "sunhera"], gold: ["sunehra", "sunhera"],
  chandi: ["silver"], chaandi: ["silver"], silver: ["chandi", "chaandi"],
  bhoora: ["brown"], bhura: ["brown"], brown: ["bhoora", "bhura"],
  naarangi: ["orange"], narangi: ["orange"], orange: ["naarangi", "narangi"],
  baingani: ["purple"], purple: ["baingani"],
  sunahara: ["gold", "golden"],
};

// Expands one typed query into every term worth checking against a
// catalog string — the original words, any known colour-synonym for each
// word, and the untouched full phrase (so exact multi-word matches like an
// existing SKU or model number still work exactly as before).
export function expandSearchTerms(query: string): string[] {
  const trimmed = query.toLowerCase().trim();
  const terms = new Set<string>();
  if (!trimmed) return [];
  terms.add(trimmed);
  trimmed.split(/\s+/).forEach((w) => {
    if (!w) return;
    terms.add(w);
    (COLOR_SYNONYMS[w] || []).forEach((s) => terms.add(s));
  });
  return Array.from(terms);
}

// Drop-in replacement for `haystack.toLowerCase().includes(query)` that
// also checks the query's known synonym expansions. Skips 1-character
// synonym noise so this never turns into a near-match-everything filter.
export function naturalMatch(haystack: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  if (hay.includes(q)) return true;
  return expandSearchTerms(q).some((t) => t.length > 1 && hay.includes(t));
}
