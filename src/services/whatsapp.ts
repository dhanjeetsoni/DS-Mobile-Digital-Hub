import { Sale, Customer, Product, Settings, Supplier } from "../types";
import { inr } from "../utils/indianCurrency";

// WhatsApp "click to chat" deep links need a bare international-format number
// (country code, no +, no spaces/dashes). Assume Indian numbers when a 10-digit
// local number is given, since that is this app's primary market.
function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length > 10) return digits;
  return null;
}

export function openWhatsApp(phone: string, message: string): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export function buildInvoiceMessage(sale: Sale, settings: Settings): string {
  const shop = settings.shopName || "Our Shop";
  const lines = [
    `*${shop}*`,
    `Invoice: ${sale.invoiceNo}`,
    `Date: ${sale.date}`,
    ``,
    ...sale.items.map((i) => `${i.name} x${i.qty} — ${inr(i.price * i.qty)}`),
    ``,
    `Total: ${inr(sale.total)}`,
    sale.dueAmount > 0.005 ? `Due: ${inr(sale.dueAmount)}` : `Status: Paid in full`,
    ``,
    `Thank you for shopping with us!`,
  ];
  return lines.join("\n");
}

export function buildDueReminderMessage(customer: Customer, settings: Settings): string {
  const shop = settings.shopName || "Our Shop";
  return [
    `Hi ${customer.name},`,
    `This is a reminder from *${shop}* that you have an outstanding balance of ${inr(customer.totalDue)}.`,
    `Please clear it at your earliest convenience. Thank you!`,
  ].join("\n");
}

export function buildLowStockReorderMessage(product: Product, suggestedQty: number, settings: Settings): string {
  const shop = settings.shopName || "Our Shop";
  return [
    `Hi, this is ${shop}.`,
    `We'd like to place a reorder for:`,
    `*${product.name}* (${product.sku || "no SKU"})`,
    `Quantity: ${suggestedQty}`,
    `Please confirm availability and price. Thanks!`,
  ].join("\n");
}
