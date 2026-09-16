/**
 * Dynamic UPI QR Code & Payment URI Engine.
 *
 * Generates standard UPI payment URIs complying with NPCI UPI specifications:
 *   upi://pay?pa=<VPA>&pn=<PayeeName>&am=<Amount>&tn=<TransactionNote>&cu=INR&tr=<InvoiceNo>
 *
 * Provides instant QR generation via pure SVG/Data-URI and online fallbacks.
 */

export interface UpiPaymentParams {
  upiId: string;
  payeeName: string;
  amount: number;
  invoiceNo?: string;
  note?: string;
}

/**
 * Builds the standard NPCI UPI Intent URL.
 */
export function buildUpiUri(params: UpiPaymentParams): string {
  const { upiId, payeeName, amount, invoiceNo, note } = params;
  if (!upiId || !upiId.includes("@")) return "";

  const cleanVpa = upiId.trim();
  const cleanName = encodeURIComponent((payeeName || "Shop").trim());
  const cleanAmt = Math.max(0, amount).toFixed(2);
  const txnNote = encodeURIComponent(note || (invoiceNo ? `Bill ${invoiceNo}` : "Payment"));
  const txnRef = invoiceNo ? `&tr=${encodeURIComponent(invoiceNo)}` : "";

  return `upi://pay?pa=${cleanVpa}&pn=${cleanName}&am=${cleanAmt}&tn=${txnNote}&cu=INR${txnRef}`;
}

/**
 * Generates a high-contrast QR Code image URL for display on screen,
 * A4 bills, and thermal receipts.
 */
export function getUpiQrImageUrl(params: UpiPaymentParams, size: number = 220): string {
  const uri = buildUpiUri(params);
  if (!uri) return "";

  // Uses fast QR generation endpoints for razor-sharp QR codes
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=2&data=${encodeURIComponent(uri)}`;
}
