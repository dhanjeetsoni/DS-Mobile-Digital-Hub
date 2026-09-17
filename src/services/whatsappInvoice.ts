import { openWhatsApp } from "./whatsapp";
import { inr } from "../utils/indianCurrency";

export interface SendWhatsAppInvoiceParams {
  customerPhone: string;
  customerName: string;
  invoiceNo: string;
  total: number;
  amountPaid: number;
  dueAmount: number;
  shopName: string;
  items: { name: string; qty: number; price: number }[];
  storeId?: string;
}

export async function sendInvoiceWhatsApp(params: SendWhatsAppInvoiceParams): Promise<{ success: boolean; message?: string }> {
  try {
    const { customerPhone, customerName, invoiceNo, total, amountPaid, dueAmount, shopName, items } = params;

    const messageLines = [
      `🧾 *TAX INVOICE & WARRANTY RECEIPT*`,
      `🏪 *${shopName}*`,
      `--------------------------------`,
      `📄 *Bill No:* ${invoiceNo}`,
      `👤 *Customer:* ${customerName}`,
      `📅 *Date:* ${new Date().toLocaleDateString("en-IN")}`,
      `--------------------------------`,
      `🛍️ *Items:*`,
      ...items.map((i, idx) => `${idx + 1}. ${i.name} (Qty: ${i.qty}) — ${inr(i.price * i.qty)}`),
      `--------------------------------`,
      `💰 *Total Amount:* ${inr(total)}`,
      `✅ *Paid:* ${inr(amountPaid)}`,
      ...(dueAmount > 0.5 ? [`⚠️ *Balance Due:* ${inr(dueAmount)}`] : [`🎉 *Status:* Paid in Full`]),
      `--------------------------------`,
      `🛡️ *Warranty & Support:*`,
      `Please save this digital bill for warranty replacement & servicing.`,
      `✨ *Thank you for your business!*`,
    ];

    const message = messageLines.join("\n");
    const opened = openWhatsApp(customerPhone, message);

    return { success: opened, message: opened ? "Dispatched" : "Could not open WhatsApp" };
  } catch (err: any) {
    console.error("sendInvoiceWhatsApp failed:", err);
    return { success: false, message: err?.message || "Failed" };
  }
}
