import { Database, StockBatch } from "../types";
import { round2 } from "./indianCurrency";

export function uid(prefix: string): string {
  // UUID-backed identifiers avoid collisions across tabs/devices.
  return `${prefix}_${crypto.randomUUID()}`;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowTimeStr(): string {
  return new Date().toTimeString().slice(0, 5);
}

export function genSku(prefix = "DSM"): string {
  // Collision-resistant client candidate. The database must still enforce UNIQUE(sku).
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

// Generates a scannable 12-digit numeric barcode (EAN-13 style, self-check
// digit) for a brand-new product. Saved on the product once and reused for
// every future POS scan of that item.
export function genBarcode(): string {
  let digits = "2"; // "2" prefix = in-store generated code, never collides with real manufacturer EAN codes
  for (let i = 0; i < 11; i++) digits += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return digits + checkDigit;
}

export function addStockBatch(
  db: Database,
  productId: string,
  qty: number,
  purchasePrice: number,
  date: string,
  meta?: { supplier?: string; source?: string; ref?: string }
): StockBatch {
  const b: StockBatch = {
    id: uid("batch"),
    productId,
    qty: Number(qty) || 0,
    remainingQty: Number(qty) || 0,
    purchasePrice: Number(purchasePrice) || 0,
    date: date || todayStr(),
    supplier: meta?.supplier || "",
    source: meta?.source || "purchase",
    ref: meta?.ref || "",
    createdAt: new Date().toISOString(),
  };
  db.stockBatches.push(b);
  return b;
}

export function getBatchesForProduct(db: Database, productId: string): StockBatch[] {
  return db.stockBatches
    .filter((b) => b.productId === productId && b.remainingQty > 0.0001)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1
    );
}

export function consumeFIFO(
  db: Database,
  productId: string,
  qty: number
): { batchId: string | null; qty: number; purchasePrice: number }[] {
  let remaining = round2(qty);
  const consumed: { batchId: string | null; qty: number; purchasePrice: number }[] = [];
  for (const b of getBatchesForProduct(db, productId)) {
    if (remaining <= 0.0001) break;
    const take = Math.min(b.remainingQty, remaining);
    b.remainingQty = round2(b.remainingQty - take);
    consumed.push({ batchId: b.id, qty: take, purchasePrice: b.purchasePrice });
    remaining = round2(remaining - take);
  }
  if (remaining > 0.0001) {
    throw new Error("Insufficient stock / inventory mismatch.");
  }
  return consumed;
}

export function fifoCostTotal(
  consumed?: { batchId: string | null; qty: number; purchasePrice: number }[]
): number {
  return round2((consumed || []).reduce((a, c) => a + (c.purchasePrice || 0) * c.qty, 0));
}

// ---------------------------------------------------------------------------
// Step 4.1 — "Insufficient Stock / Inventory Mismatch" bug fix
//
// `product.stock` is a denormalized counter that is *supposed* to always
// equal the sum of that product's stockBatches[].remainingQty, but nothing
// enforces that at every call site (a manual edit that touched one and not
// the other, a purchase/adjustment/return path that missed one side, etc.),
// so the two can silently drift apart. Checkout used to trust
// `product.stock` directly for its "is there enough?" gate and only found
// out the batches disagreed *after* already telling the customer the sale
// was fine — that's exactly how "stock shows available but the sale still
// gets blocked" (batches short of what stock claims) or the opposite
// (a valid sale wrongly refused because stock understates what the batches
// actually have) used to happen. getAvailableStock() re-derives the real,
// sellable quantity straight from the batches every time, so checkout has
// one honest source of truth instead of two numbers that can disagree.
export function getAvailableStock(db: Database, productId: string): number {
  return round2(
    db.stockBatches
      .filter((b) => b.productId === productId)
      .reduce((sum, b) => sum + Math.max(0, b.remainingQty), 0)
  );
}

// Owner-facing "Stock Health Check" (Step 4.1): every product whose
// denormalized `stock` field disagrees with the real FIFO batch total, so
// a mismatch can be reviewed and reconciled in one click instead of only
// being discovered later as a confusing failed/blocked sale.
export interface StockMismatch {
  productId: string;
  productName: string;
  systemStock: number;
  batchStock: number;
  /** batchStock - systemStock — what a one-click fix would add (+) or subtract (-) to product.stock. */
  diff: number;
}

export function findStockMismatches(db: Database): StockMismatch[] {
  const out: StockMismatch[] = [];
  for (const p of db.products) {
    const batchStock = getAvailableStock(db, p.id);
    const diff = round2(batchStock - (p.stock || 0));
    if (Math.abs(diff) > 0.0001) {
      out.push({ productId: p.id, productName: p.name, systemStock: p.stock || 0, batchStock, diff });
    }
  }
  return out;
}
