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

// Packaged Windows/Android app: window.open() has nowhere to go inside
// the webview, so the shell plugin (registered in src-tauri/src/lib.rs)
// hands the link to the OS instead. Falls back to window.open() in the
// plain browser dev server, where the plugin isn't injected — same
// pattern as telegram.ts's openExternalLink().
async function openExternalLink(url: string): Promise<void> {
  const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
  if (isTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch {
      // Plugin not available for some reason — fall through to window.open()
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openWhatsApp(phone: string, message: string): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  void openExternalLink(url);
  return true;
}

export function buildInvoiceMessage(sale: Sale, settings: Settings): string {
  const shop = settings.shopName || "Our Shop";
  const phone = settings.phone ? `Ph: ${settings.phone}` : "";
  const address = settings.address ? `${settings.address}` : "";

  const lines = [
    `🧾 *DIGITAL TAX INVOICE & WARRANTY CARD*`,
    `🏪 *${shop}*`,
    ...(address ? [address] : []),
    ...(phone ? [phone] : []),
    `--------------------------------`,
    `📄 *Invoice No:* ${sale.invoiceNo}`,
    `📅 *Date & Time:* ${sale.date} ${sale.time || ""}`,
    `👤 *Customer:* ${sale.customer?.name || "Cash Customer"} ${sale.customer?.phone ? `(${sale.customer.phone})` : ""}`,
    `💳 *Payment Mode:* ${sale.payment}`,
    `--------------------------------`,
    `📦 *PURCHASED ITEMS:*`,
    ...sale.items.map((i, idx) => {
      const imeis = i.selectedImeis && i.selectedImeis.length > 0 ? `\n   📱 IMEI: ${i.selectedImeis.join(", ")}` : "";
      const gift = i.isGift ? " 🎁 [FREE GIFT]" : "";
      return `${idx + 1}. *${i.name}*${gift}\n   Qty: ${i.qty} × ${i.isGift ? "FREE" : inr(i.price)} = *${i.isGift ? "FREE" : inr(i.price * i.qty)}*${imeis}`;
    }),
    `--------------------------------`,
    `💵 *Subtotal:* ${inr(sale.subtotal)}`,
    ...(sale.discount ? [`🏷️ *Discount:* -${inr(sale.discount)}`] : []),
    ...(sale.taxAmount ? [`🏛️ *GST:* ${inr(sale.taxAmount)}`] : []),
    `💰 *GRAND TOTAL:* *${inr(sale.total)}*`,
    `✅ *Amount Paid:* ${inr(sale.amountPaid)}`,
    ...(sale.dueAmount > 0.5 ? [`⚠️ *Balance Due:* *${inr(sale.dueAmount)}*`] : [`🎉 *Status:* Paid in Full`]),
    `--------------------------------`,
    `🛡️ *WARRANTY & SERVICE POLICY:*`,
    `• Keep this digital invoice for all warranty claims.`,
    `• Physical damage, water log & screen burn not covered under warranty.`,
    `• 100% Genuine & Quality Tested Products.`,
    ``,
    `✨ _Thank you for shopping with ${shop}! Visit again._`,
  ];
  return lines.join("\n");
}

export function buildBulkSupplierReorderMessage(
  supplier: Supplier | null,
  items: { product: Product; reorderQty: number }[],
  settings: Settings
): string {
  const shop = settings.shopName || "Our Shop";
  const shopPhone = settings.phone ? ` (${settings.phone})` : "";
  const totalQty = items.reduce((acc, i) => acc + i.reorderQty, 0);

  const lines = [
    `📦 *PURCHASE ORDER — ${shop}*${shopPhone}`,
    `📅 *Date:* ${new Date().toLocaleDateString("en-IN")}`,
    ...(supplier ? [`🏢 *Supplier:* ${supplier.name}`] : []),
    `--------------------------------`,
    `Bhaiya, please pack and dispatch the following order:`,
    ``,
    ...items.map((item, idx) => {
      const sku = item.product.sku ? ` [SKU: ${item.product.sku}]` : "";
      const brand = item.product.brand ? ` (${item.product.brand})` : "";
      return `${idx + 1}. *${item.product.name}*${brand}${sku}\n   👉 *Required Qty: ${item.reorderQty} units*`;
    }),
    `--------------------------------`,
    `📊 *Total Items:* ${items.length} (${totalQty} units total)`,
    ``,
    `Please confirm stock availability, bill total & delivery schedule. Thanks!`,
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

export function buildDailyGallaEodMessage(
  closing: import("../types").DailyGallaClosing,
  settings: Settings
): string {
  const shop = settings.shopName || "Our Shop";
  const diffCash = closing.overageOrShortage;
  const cashStatus =
    diffCash === 0
      ? "✅ Matched Exact"
      : diffCash > 0
      ? `🟢 Extra +${inr(diffCash)}`
      : `🔴 Shortage -${inr(Math.abs(diffCash))}`;

  const diffOnline = closing.onlineDiff;
  const onlineStatus =
    diffOnline === 0
      ? "✅ Matched Exact"
      : diffOnline > 0
      ? `🟢 Extra +${inr(diffOnline)}`
      : `🔴 Shortage -${inr(Math.abs(diffOnline))}`;

  const totalInflow =
    closing.cashSales +
    closing.cashKhataCollected +
    closing.cashXeroxTotal +
    closing.cashRepairCollected +
    (closing.cashExtraIncome || 0);

  const totalOutflow =
    closing.cashExpensesPaid +
    closing.cashSupplierPaid +
    closing.cashRefundsPaid;

  const lines = [
    `🌙 *DAILY GALLA & DAY-END CLOSING REPORT*`,
    `🏪 *${shop}*`,
    `📅 *Date:* ${closing.date} | *Time:* ${closing.closedAt}`,
    `--------------------------------`,
    `💵 *CASH DRAWER RECONCILIATION:*`,
    `• Opening Cash: *${inr(closing.openingCash)}*`,
    `• Total Cash In: *+${inr(totalInflow)}*`,
    `   └ Cash Sales: ${inr(closing.cashSales)}`,
    `   └ Khata Collected: ${inr(closing.cashKhataCollected)}`,
    `   └ Xerox/Prints: ${inr(closing.cashXeroxTotal)}`,
    `   └ Repairs: ${inr(closing.cashRepairCollected)}`,
    ...(closing.cashExtraIncome ? [`   └ Extra Income: ${inr(closing.cashExtraIncome)}`] : []),
    `• Total Cash Out: *-${inr(totalOutflow)}*`,
    `   └ Shop Expenses: ${inr(closing.cashExpensesPaid)}`,
    `   └ Supplier Paid: ${inr(closing.cashSupplierPaid)}`,
    `   └ Refunds: ${inr(closing.cashRefundsPaid)}`,
    `👉 *Expected Drawer Cash:* *${inr(closing.expectedCash)}*`,
    `👉 *Actual Cash Counted:* *${inr(closing.actualCashCounted)}*`,
    `📊 *Cash Match Status:* *${cashStatus}*`,
    `--------------------------------`,
    `📱 *DIGITAL & ONLINE PAYMENTS (UPI/Card):*`,
    `• Expected Online: *${inr(closing.expectedOnlinePayment)}*`,
    `• Recorded Online: *${inr(closing.onlinePaymentReceived)}*`,
    `📊 *Online Status:* *${onlineStatus}*`,
    `--------------------------------`,
    ...(closing.notes ? [`📝 *Remarks:* _${closing.notes}_`, `--------------------------------`] : []),
    `🔒 _Auto-generated by DS Mobile Hub POS & Verified at store close._`,
  ];
  return lines.join("\n");
}

