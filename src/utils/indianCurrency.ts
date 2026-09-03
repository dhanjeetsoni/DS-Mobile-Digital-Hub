export function round2(n: number | string | null | undefined): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

// BUG FIX: gstEnabled/gstPercent existed in Settings but were never used anywhere,
// so a GST-registered shop's invoices silently never added tax to the total.
// This centralizes the calculation so POS checkout, the cart summary and the
// finance down-payment estimate can never drift apart again.
export function computeSaleTotals(
  subtotal: number,
  discount: number,
  gstEnabled: boolean | undefined,
  gstPercent: number | undefined
): { subtotal: number; discount: number; taxableAmount: number; taxAmount: number; total: number } {
  const sub = round2(subtotal);
  const disc = Math.min(round2(discount) || 0, sub);
  const taxableAmount = round2(Math.max(0, sub - disc));
  const taxAmount = gstEnabled ? round2((taxableAmount * (Number(gstPercent) || 0)) / 100) : 0;
  const total = round2(taxableAmount + taxAmount);
  return { subtotal: sub, discount: disc, taxableAmount, taxAmount, total };
}

// Step 5.1 — Discount % = (MRP − Selling/Sold Price) / MRP × 100, always
// auto-calculated, never a manually-typed field anywhere in the app. Used
// both by the Stocks list (MRP vs Selling Price) and by the Invoice (MRP vs
// actual Sold Price for that line). Returns null when there's no MRP to
// compare against (nothing meaningful to show) — clamped to a 0 floor so a
// price that's actually *above* MRP never displays as a confusing negative
// discount.
export function computeDiscountPercent(
  mrp: number | null | undefined,
  actualPrice: number | null | undefined
): number | null {
  const m = Number(mrp || 0);
  if (m <= 0) return null;
  const price = Number(actualPrice || 0);
  return round2(Math.max(0, ((m - price) / m) * 100));
}

export function inr(n: number | string | null | undefined): string {
  const num = round2(n);
  const neg = num < 0;
  const abs = Math.abs(num);
  const parts = abs.toFixed(2).split(".");
  const intPart = parts[0];
  const dec = parts[1];
  let last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  if (rest !== "") last3 = "," + last3;
  const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + last3;
  if (dec === "00") return (neg ? "-" : "") + "₹" + formatted;
  return (neg ? "-" : "") + "₹" + formatted + "." + dec;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}

function threeDigitWords(n: number): string {
  let s = "";
  if (n >= 100) {
    s += ONES[Math.floor(n / 100)] + " Hundred";
    n %= 100;
    if (n) s += " ";
  }
  if (n > 0) s += twoDigitWords(n);
  return s;
}

export function numberToWordsIndian(num: number | string | null | undefined): string {
  let n = Math.round(Number(num || 0));
  if (n === 0) return "Zero Rupees Only";
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const rest = n;
  const parts: string[] = [];
  if (crore) parts.push(threeDigitWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitWords(thousand) + " Thousand");
  if (rest) parts.push(threeDigitWords(rest));
  return parts.join(" ") + " Rupees Only";
}
