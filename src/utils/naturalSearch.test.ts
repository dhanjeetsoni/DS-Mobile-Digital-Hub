import { describe, expect, it } from "vitest";
import { naturalMatch, expandSearchTerms } from "./naturalSearch";

describe("naturalSearch & typo-tolerant matching (Phase 8)", () => {
  it("matches exact substrings", () => {
    expect(naturalMatch("Samsung Galaxy S24 Ultra", "samsung")).toBe(true);
    expect(naturalMatch("Realme 7 Pro", "realme 7")).toBe(true);
  });

  it("matches Hindi/Hinglish color synonyms", () => {
    expect(naturalMatch("iPhone 14 Black Case", "kala")).toBe(true);
    expect(naturalMatch("Realme Red Tempered Glass", "laal")).toBe(true);
    expect(naturalMatch("OnePlus Blue Armor Cover", "neela")).toBe(true);
  });

  it("handles fast counter typos for major brands", () => {
    // "reelme" -> Realme
    expect(naturalMatch("Realme Narzo 50 Pro", "reelme")).toBe(true);
    // "iphon" -> iPhone
    expect(naturalMatch("Apple iPhone 15 Pro Max", "iphon")).toBe(true);
    // "samsang" -> Samsung
    expect(naturalMatch("Samsung Galaxy M34", "samsang")).toBe(true);
    // "onepluss" -> OnePlus
    expect(naturalMatch("OnePlus Nord CE 3", "onepluss")).toBe(true);
    // "viwo" -> Vivo
    expect(naturalMatch("Vivo V29 5G", "viwo")).toBe(true);
    // "charjer" -> Charger
    expect(naturalMatch("Type-C 65W Fast Charger", "charjer")).toBe(true);
  });

  it("rejects completely unrelated terms", () => {
    expect(naturalMatch("Samsung S24 Ultra", "iPhone 15")).toBe(false);
    expect(naturalMatch("Vivo Y200", "Redmi Note 13")).toBe(false);
  });

  it("expands query terms with synonyms and typos", () => {
    const terms = expandSearchTerms("reelme laal");
    expect(terms).toContain("realme");
    expect(terms).toContain("red");
  });
});
