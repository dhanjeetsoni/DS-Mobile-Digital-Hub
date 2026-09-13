/**
 * Phase 8 — typo-tolerant search. Staff typing fast at the counter will
 * misspell brand/model names ("reelme" for "Realme", "iphon" for
 * "iPhone") — naturalMatch() must still find the right product, without
 * turning into a near-match-everything filter that surfaces junk results.
 */

import { describe, expect, it } from "vitest";
import { naturalMatch } from "./naturalSearch";

describe("naturalMatch — typo tolerance", () => {
  it("matches a single dropped/swapped letter in a longer brand word", () => {
    expect(naturalMatch("Realme P4", "reelme p4")).toBe(true);
    expect(naturalMatch("Realme P4", "realme p4")).toBe(true); // exact still works
    expect(naturalMatch("iPhone 15 Pro", "iphon 15 pro")).toBe(true);
    expect(naturalMatch("Samsung Galaxy S24", "samsng galaxy s24")).toBe(true);
  });

  it("still matches with word order or punctuation differences (existing substring/word behavior)", () => {
    expect(naturalMatch("Tempered Glass - Realme P4", "realme p4")).toBe(true);
  });

  it("does not fuzzy-match short words like model-number suffixes (exact only, <=3 chars)", () => {
    // "p4" vs "p5" is only 1 edit apart, but short tokens must stay exact.
    // Isolate this from the pre-existing (unrelated to this change)
    // whole-word substring check in expandSearchTerms — a query word that
    // literally appears in the haystack already matches regardless of the
    // rest of the query, so use haystacks where the longer word ALSO
    // differs, to test the fuzzy path specifically rather than that
    // earlier substring check.
    expect(naturalMatch("Redme P5", "realme p4")).toBe(false);
    expect(naturalMatch("iPhone 16", "iphonee 15")).toBe(false);
  });

  it("does not match a genuinely unrelated query", () => {
    expect(naturalMatch("Samsung Galaxy S24", "realme p4")).toBe(false);
    expect(naturalMatch("Tempered Glass", "back cover")).toBe(false);
  });

  it("requires every query word to match something (order-independent)", () => {
    expect(naturalMatch("Realme P4", "p4 reelme")).toBe(true);
    // "curved" has no match at all in the haystack -> whole query must fail.
    expect(naturalMatch("Realme P4 Tempered Glass", "reelme curved")).toBe(false);
  });

  it("longer words tolerate up to 2 edits, not unlimited", () => {
    expect(naturalMatch("OnePlus Nord", "0neplus nord")).toBe(true);
    expect(naturalMatch("OnePlus Nord", "xyzplusnrd")).toBe(false);
  });

  it("empty query still matches everything (existing behavior, unchanged)", () => {
    expect(naturalMatch("Anything", "")).toBe(true);
  });
});
