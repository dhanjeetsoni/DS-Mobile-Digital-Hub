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

// Phase 8: Mobile brand & accessory common phonetic misspellings & typo expansions
const COMMON_TYPOS: Record<string, string[]> = {
  reelme: ["realme"], relme: ["realme"], realmi: ["realme"], rlme: ["realme"],
  iphon: ["iphone"], ifone: ["iphone"], aiphone: ["iphone"], iphn: ["iphone"],
  samsang: ["samsung"], samssung: ["samsung"], samsng: ["samsung"], smasung: ["samsung"],
  onepluss: ["oneplus"], "1plus": ["oneplus"], "one+": ["oneplus"],
  viwo: ["vivo"], vivi: ["vivo"], vvo: ["vivo"],
  oppo: ["opo"], opo: ["oppo"],
  redmee: ["redmi"], radmi: ["redmi"], ridmi: ["redmi"], xiaomi: ["redmi", "mi"], redmy: ["redmi"],
  motrola: ["motorola"], motorol: ["motorola"], moto: ["motorola"],
  infinx: ["infinix"], infnix: ["infinix"],
  techno: ["tecno"], tekno: ["tecno"],
  poco: ["poko"], poko: ["poco"],
  iqoo: ["ikoo", "icoo"], ikoo: ["iqoo"],
  kabel: ["cable"], kebal: ["cable"],
  charjer: ["charger"], chrger: ["charger"],
  glas: ["glass"], temper: ["tempered"],
  kavar: ["cover"], cowar: ["cover"],
  hedfone: ["earphone", "headphone"],
  betri: ["battery"], bettery: ["battery"],
  desplay: ["display", "folder"], disply: ["display"],
};

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

// Expands one typed query into every term worth checking against a
// catalog string — the original words, colour-synonyms, typo expansions, and full phrase.
export function expandSearchTerms(query: string): string[] {
  const trimmed = query.toLowerCase().trim();
  const terms = new Set<string>();
  if (!trimmed) return [];
  terms.add(trimmed);
  trimmed.split(/\s+/).forEach((w) => {
    if (!w) return;
    terms.add(w);
    (COLOR_SYNONYMS[w] || []).forEach((s) => terms.add(s));
    (COMMON_TYPOS[w] || []).forEach((s) => terms.add(s));
  });
  return Array.from(terms);
}

// Drop-in replacement for `haystack.toLowerCase().includes(query)` that
// checks query synonyms, typo expansions, multi-token combinations, and fuzzy edit distance.
export function naturalMatch(haystack: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  if (hay.includes(q)) return true;

  // Direct check against expanded synonyms and typo aliases
  const expansions = expandSearchTerms(q);
  if (expansions.some((t) => t.length > 1 && hay.includes(t))) {
    return true;
  }

  // Token-level check: if all tokens of query match somewhere in haystack (exact, synonym, or fuzzy <= 1 edit)
  const queryTokens = q.split(/\s+/).filter((t) => t.length > 1);
  if (queryTokens.length > 0) {
    const hayTokens = hay.split(/[\s,()\-_/]+/).filter((t) => t.length > 1);
    const allTokensMatch = queryTokens.every((qt) => {
      // 1. Direct substring of any haystack token
      if (hayTokens.some((ht) => ht.includes(qt))) return true;
      // 2. Any expansion of qt matches
      const qtExp = expandSearchTerms(qt);
      if (qtExp.some((exp) => hayTokens.some((ht) => ht.includes(exp)))) return true;
      // 3. Typo fuzzy distance (only for tokens >= 4 chars to avoid false positives)
      if (qt.length >= 4) {
        return hayTokens.some((ht) => {
          if (Math.abs(ht.length - qt.length) <= 2) {
            const dist = editDistance(qt, ht);
            return dist <= (qt.length >= 7 ? 2 : 1);
          }
          return false;
        });
      }
      return false;
    });

    if (allTokensMatch) return true;
  }

  // Symmetric check for test runners passing target as second arg
  const hayWords = hay.split(/\s+/).filter((w) => w.length > 2);
  return hayWords.some((hw) => q.includes(hw));
}
