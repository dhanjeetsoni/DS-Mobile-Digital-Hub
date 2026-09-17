// High-Resolution Canvas Digital Invoice Card Generator
// Creates a clean, branded, readable PNG card for direct 1-tap WhatsApp sharing without PDF viewer friction

import { Sale, Database } from "../types";
import { inr } from "./indianCurrency";

export interface ReceiptImageOptions {
  sale: Sale;
  db: Database;
  watermark?: boolean;
}

/**
 * Generates a PNG Data URL representing an authentic, high-contrast digital receipt card.
 */
export async function generateReceiptImageCard({
  sale,
  db,
}: ReceiptImageOptions): Promise<string> {
  const width = 640;
  const padding = 28;
  const contentWidth = width - padding * 2;

  // Measure dynamic height
  const baseHeight = 440;
  const itemHeight = (sale.items || []).length * 42;
  const hasImeis = (sale.items || []).some((i) => i.selectedImeis && i.selectedImeis.length > 0);
  const extraHeight = hasImeis ? (sale.items || []).reduce((acc, i) => acc + (i.selectedImeis?.length || 0) * 18, 0) : 0;
  const height = baseHeight + itemHeight + extraHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // Background gradient
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Top header bar (Navy / Brand)
  const headerGrad = ctx.createLinearGradient(0, 0, width, 120);
  headerGrad.addColorStop(0, "#0f172a");
  headerGrad.addColorStop(1, "#1e293b");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, width, 100);

  // Accent top ribbon
  ctx.fillStyle = "#3b82f6";
  ctx.fillRect(0, 0, width, 5);

  // Shop Name & Subtext
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(db.settings.shopName || "DS MOBILE HUB", padding, 42);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  const shopAddr = db.settings.address ? `${db.settings.address} • Tel: ${db.settings.phone || ""}` : `Phone: ${db.settings.phone || ""}`;
  ctx.fillText(shopAddr.slice(0, 60), padding, 64);

  if (db.settings.gstin) {
    ctx.fillText(`GSTIN: ${db.settings.gstin}`, padding, 82);
  }

  // Invoice Badge right aligned
  ctx.fillStyle = "#3b82f6";
  ctx.beginPath();
  ctx.roundRect(width - padding - 150, 24, 150, 52, 8);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TAX INVOICE", width - padding - 75, 42);
  ctx.font = "bold 14px monospace";
  ctx.fillText(sale.invoiceNo, width - padding - 75, 62);

  // Customer & Bill Info Bar
  let y = 130;
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(padding, y, contentWidth, 68, 8);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#64748b";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.fillText("BILLED TO:", padding + 14, y + 22);
  ctx.fillText("DATE & TIME:", padding + contentWidth / 2 + 10, y + 22);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  const custName = sale.customer?.name || "Cash Customer (Retail)";
  ctx.fillText(custName, padding + 14, y + 42);

  ctx.fillStyle = "#475569";
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  const custPhone = sale.customer?.phone ? `📱 ${sale.customer.phone}` : "Walk-in";
  ctx.fillText(custPhone, padding + 14, y + 58);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.fillText(`${sale.date}  ${sale.time || ""}`, padding + contentWidth / 2 + 10, y + 42);

  ctx.fillStyle = "#0284c7";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.fillText(`Mode: ${sale.payment.toUpperCase()}`, padding + contentWidth / 2 + 10, y + 58);

  // Table Headers
  y += 90;
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(padding, y, contentWidth, 28);
  ctx.fillStyle = "#334155";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ITEM DESCRIPTION", padding + 10, y + 18);
  ctx.textAlign = "center";
  ctx.fillText("QTY", padding + contentWidth - 140, y + 18);
  ctx.textAlign = "right";
  ctx.fillText("PRICE", padding + contentWidth - 75, y + 18);
  ctx.fillText("AMOUNT", padding + contentWidth - 10, y + 18);

  // Table Rows
  y += 28;
  (sale.items || []).forEach((item, idx) => {
    ctx.fillStyle = idx % 2 === 0 ? "#ffffff" : "#fcfcfd";
    ctx.fillRect(padding, y, contentWidth, 36);

    ctx.textAlign = "left";
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${idx + 1}. ${item.name}`.slice(0, 38), padding + 10, y + 22);

    ctx.textAlign = "center";
    ctx.fillStyle = "#334155";
    ctx.font = "12px system-ui, -apple-system, sans-serif";
    ctx.fillText(String(item.qty), padding + contentWidth - 140, y + 22);

    ctx.textAlign = "right";
    ctx.fillText(inr(item.price), padding + contentWidth - 75, y + 22);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.fillText(inr(item.price * item.qty), padding + contentWidth - 10, y + 22);

    y += 36;

    // Render IMEIs if any
    if (item.selectedImeis && item.selectedImeis.length > 0) {
      item.selectedImeis.forEach((im) => {
        ctx.fillStyle = "#64748b";
        ctx.font = "10.5px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`   ↳ IMEI/SN: ${im}`, padding + 12, y + 12);
        y += 18;
      });
    }

    // Divider
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + contentWidth, y);
    ctx.stroke();
  });

  // Summary Totals Box
  y += 14;
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.roundRect(padding + contentWidth - 280, y, 280, 110, 8);
  ctx.fill();
  ctx.stroke();

  const sumX = padding + contentWidth - 265;
  const valX = padding + contentWidth - 15;

  ctx.textAlign = "left";
  ctx.fillStyle = "#475569";
  ctx.font = "11.5px system-ui, -apple-system, sans-serif";
  ctx.fillText("Subtotal:", sumX, y + 24);
  ctx.textAlign = "right";
  ctx.fillText(inr(sale.subtotal), valX, y + 24);

  if (sale.discount > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#16a34a";
    ctx.fillText("Discount:", sumX, y + 46);
    ctx.textAlign = "right";
    ctx.fillText(`- ${inr(sale.discount)}`, valX, y + 46);
  }

  // Grand Total Highlight
  ctx.strokeStyle = "#0f172a";
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(padding + contentWidth - 280, y + 62, 280, 48);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
  ctx.fillText("GRAND TOTAL:", sumX, y + 92);

  ctx.textAlign = "right";
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 18px system-ui, -apple-system, sans-serif";
  ctx.fillText(inr(sale.total), valX, y + 92);

  // Footer Note & Thank You
  y += 140;
  ctx.textAlign = "center";
  ctx.fillStyle = "#10b981";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.fillText("✅ PAID IN FULL — THANK YOU FOR SHOPPING!", width / 2, y);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.fillText("Visit Again • Genuine Products • Instant Digital Bill", width / 2, y + 18);

  return canvas.toDataURL("image/png");
}

/**
 * Downloads the receipt image directly.
 */
export async function downloadReceiptImage(sale: Sale, db: Database) {
  const dataUrl = await generateReceiptImageCard({ sale, db });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `Bill_${sale.invoiceNo}_${sale.date}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
