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
  if (expandSearchTerms(q).some((t) => t.length > 1 && hay.includes(t))) return true;
  return fuzzyMatch(hay, q);
}

// Phase 8 — typo-tolerant search: shop staff typing fast under pressure at
// the counter will misspell brand/model names ("reelme" for "Realme",
// "iphon" for "iPhone"). Deliberately kept as plain JS Levenshtein
// distance, not an AI/network call — same reasoning as the rest of this
// file's header comment: a search box needs this on every keystroke, so it
// has to be instant and free.
//
// Every query word must find SOME word in the haystack within its
// length-scaled edit-distance budget (order-independent, so "p4 reelme"
// still matches "Realme P4"). Short words (<=3 chars) require an exact
// match — fuzzy-matching "p4"/"s24"-style short model suffixes would
// produce far more false positives than it fixes typos.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  // Two-row DP — these are short catalog words, no need for the full matrix.
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

function fuzzyBudgetForLength(len: number): number {
  if (len <= 3) return 0; // exact only — e.g. "p4", "s24"
  if (len <= 6) return 1; // e.g. "realme"/"reelme", "iphone"/"iphon"
  return 2; // longer brand/model words can absorb 2 typos
}

function fuzzyMatch(haystack: string, query: string): boolean {
  const queryWords = query.split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return false;
  const haystackWords = haystack.split(/[\s,/()-]+/).filter(Boolean);
  if (haystackWords.length === 0) return false;

  return queryWords.every((qw) => {
    const budget = fuzzyBudgetForLength(qw.length);
    if (budget === 0) {
      // 2026-09-14 fix: the old code just returned false here, on the
      // assumption an exact match had already been tried and failed. That
      // assumption only holds for a single-word query — the earlier exact/
      // synonym checks in naturalMatch() run against the WHOLE query
      // phrase (and against synonym expansions of length > 1), so a short
      // word (e.g. "7") embedded inside a longer multi-word query (e.g.
      // "reelme 7") was never actually checked on its own before landing
      // here, and always silently failed the whole match as a result —
      // even though the exact word genuinely exists in the haystack.
      return haystackWords.includes(qw);
    }
    return haystackWords.some((hw) => {
      // Skip pairs whose length gap alone already exceeds the budget —
      // avoids wasted DP work and prevents e.g. "app" fuzzy-matching a
      // completely different 8-letter word just because budget=1 isn't
      // enough anyway once you account for the length difference.
      if (Math.abs(hw.length - qw.length) > budget) return false;
      return editDistance(hw, qw) <= budget;
    });
  });
}
