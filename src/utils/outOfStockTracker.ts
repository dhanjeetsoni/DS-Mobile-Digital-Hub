// Step 7.2 — Delete Policy: "Product Photos safe rahegi jab tak product
// manually delete na ho ya out-of-stock 3 mahine se zyada na ho jaaye."
//
// Stock can change from a dozen different screens (POS checkout, Stock
// Adjust, Purchases, Returns/Exchanges, Repairs, ...). Rather than having
// to remember to stamp `outOfStockSince` at every single one of those call
// sites (and risk missing one), this runs centrally — once, right before
// every save — so it is always correct no matter which screen changed the
// stock number.
//
// Called from App.tsx's saveState() on every save. Mutates the given
// products array in place (same structuredClone-then-mutate pattern used
// everywhere else in this codebase) and returns whether anything changed,
// purely so callers can log/skip work if they want — the caller should
// save the state either way since this is cheap and idempotent.
import { Product } from "../types";

export function syncOutOfStockTimestamps(products: Product[]): boolean {
  let changed = false;
  const nowIso = new Date().toISOString();
  for (const p of products) {
    if (p.stock <= 0) {
      if (!p.outOfStockSince) {
        p.outOfStockSince = nowIso;
        changed = true;
      }
    } else if (p.outOfStockSince) {
      // Back in stock — the 3-month clock resets. A product that goes
      // out-of-stock again later starts a fresh 90-day window, which is
      // the correct reading of the plan's "3 mahine se zyada" wording
      // (continuously out of stock, not cumulative).
      p.outOfStockSince = null;
      changed = true;
    }
  }
  return changed;
}
