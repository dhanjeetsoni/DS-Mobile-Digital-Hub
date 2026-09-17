import React, { useState } from "react";
import {
  QrCode,
  Send,
  Copy,
  CheckCircle2,
  DollarSign,
  Smartphone,
  MessageCircle,
  X,
  Sparkles,
  Zap,
} from "lucide-react";
import { Database, Customer } from "../types";
import { inr } from "../utils/indianCurrency";
import { openWhatsApp } from "../services/whatsapp";
import { WhatsAppPreviewBubble } from "./WhatsAppPreviewBubble";
import { QuickKhataRepaymentModal } from "./QuickKhataRepaymentModal";

interface CustomerKhataUpiModalProps {
  customer: Customer;
  db: Database;
  onClose: () => void;
  showToast: (msg: string, kind?: "green" | "red" | "amber") => void;
}

export const CustomerKhataUpiModal: React.FC<CustomerKhataUpiModalProps> = ({
  customer,
  db,
  onClose,
  showToast,
}) => {
  const dueAmount = customer.totalDue || 0;
  const [amountToRequest, setAmountToRequest] = useState<number>(dueAmount);
  const [templateType, setTemplateType] = useState<"polite" | "standard" | "urgent">("polite");
  const [copied, setCopied] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false);

  const shopName = db.settings.shopName || "DS Mobile Hub";
  const upiId = db.settings.upiId || "shop@upi";

  // Dynamic UPI Deep-link
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    shopName
  )}&am=${amountToRequest}&cu=INR&tn=${encodeURIComponent(`Khata Due - ${customer.name}`)}`;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    upiUrl
  )}`;

  // Message templates
  const messages = {
    polite:
      `*🙏 Namaste ${customer.name} ji,*\n\n` +
      `Aapke *${shopName}* par *${inr(amountToRequest)}* ka balance pending hai.\n\n` +
      `Aap neeche diye gaye link ya UPI ID par payment kar sakte hain:\n` +
      `🔗 *Direct UPI Payment Link:* ${upiUrl}\n` +
      `📲 *Shop UPI ID:* \`${upiId}\`\n\n` +
      `Payment hone ke baad screenshot bhejna na bhoolein. Dhanyawad! ✨\n` +
      `📞 *${db.settings.phone || ""}*`,

    standard:
      `*📢 PAYMENT REMINDER — ${shopName}*\n\n` +
      `Dear *${customer.name}*,\n` +
      `This is a friendly reminder regarding your outstanding bill amount of *${inr(
        amountToRequest
      )}* at our store.\n\n` +
      `Pay directly via UPI:\n` +
      `🔗 *Pay Link:* ${upiUrl}\n` +
      `UPI ID: \`${upiId}\`\n\n` +
      `Thank you for your cooperation!`,

    urgent:
      `*⚠️ PENDING BALANCE DUE ALERT — ${shopName}*\n\n` +
      `Shri *${customer.name}* ji,\n` +
      `Aapke khate ka *${inr(
        amountToRequest
      )}* ka udhaar bacha hua hai. Kripya clearance karein taaki hum aapko aage bhi credit suvidha de sakein.\n\n` +
      `💳 *Instant UPI Pay:* ${upiUrl}\n` +
      `UPI: \`${upiId}\`\n\n` +
      `Kripya sampark karein: ${db.settings.phone || ""}`,
  };

  const selectedMessage = messages[templateType];

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(upiUrl);
      setCopied(true);
      showToast("UPI Payment Link copied to clipboard!", "green");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      showToast("Failed to copy link", "red");
    }
  };

  return (
    <div className="overlay show" style={{ zIndex: 9999 }}>
      <div className="modal" style={{ maxWidth: "560px" }}>
        <div className="modal-head">
          <h3>
            <Smartphone size={18} style={{ color: "var(--brand)" }} />
            WhatsApp Khata Reminder &amp; Dynamic UPI Link
          </h3>
          <button onClick={onClose}>&times;</button>
        </div>

        <div style={{ padding: "4px 0 16px" }}>
          {/* Customer Summary Card */}
          <div
            style={{
              background: "var(--paper)",
              borderRadius: "10px",
              padding: "12px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
            }}
          >
            <div>
              <div style={{ fontSize: "14px", fontWeight: 800 }}>{customer.name}</div>
              <div className="hint" style={{ fontSize: "12px" }}>📱 {customer.phone}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="hint" style={{ fontSize: "11px", textTransform: "uppercase" }}>Total Udhaar Due</div>
              <div style={{ fontSize: "17px", fontWeight: 800, color: "var(--red)" }}>{inr(dueAmount)}</div>
              <button
                type="button"
                className="btn sm"
                onClick={() => setShowRepayModal(true)}
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  background: "#dcfce7",
                  color: "#15803d",
                  border: "1px solid #86efac",
                  fontWeight: 800,
                  marginTop: "3px",
                }}
              >
                <Zap size={10} /> ⚡ Jama / Settle
              </button>
            </div>
          </div>

          {/* Amount and Tone selector */}
          <div className="grid cols-2" style={{ gap: "10px", marginBottom: "14px" }}>
            <div className="field">
              <label>Reminder Amount (₹)</label>
              <input
                type="number"
                value={amountToRequest}
                onChange={(e) => setAmountToRequest(Number(e.target.value) || 0)}
              />
            </div>

            <div className="field">
              <label>Message Tone</label>
              <select value={templateType} onChange={(e) => setTemplateType(e.target.value as any)}>
                <option value="polite">🙏 Polite Hindi (Respectful)</option>
                <option value="standard">📢 Standard English</option>
                <option value="urgent">⚠️ Urgent Due Reminder</option>
              </select>
            </div>
          </div>

          {/* Dynamic QR Code & UPI Details */}
          <div
            style={{
              display: "flex",
              gap: "16px",
              alignItems: "center",
              background: "#fff",
              border: "1.5px solid var(--line)",
              borderRadius: "12px",
              padding: "14px",
              marginBottom: "14px",
              color: "#000",
            }}
          >
            <img
              src={qrCodeUrl}
              alt="UPI QR Code"
              style={{
                width: "100px",
                height: "100px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                padding: "4px",
                background: "#fff",
              }}
            />

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: 700 }}>DIRECT SCAN &amp; PAY</div>
              <div style={{ fontSize: "16px", fontWeight: 900, color: "#111827", margin: "2px 0 4px" }}>
                {inr(amountToRequest)}
              </div>
              <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#374151", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px", display: "inline-block", marginBottom: "6px" }}>
                {upiId}
              </div>

              <div>
                <button className="btn sm ghost" onClick={handleCopyLink} style={{ fontSize: "11px", padding: "2px 8px" }}>
                  {copied ? <CheckCircle2 size={12} style={{ color: "var(--green)" }} /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy UPI Link"}
                </button>
              </div>
            </div>
          </div>

          {/* Interactive WhatsApp Chat Preview Bubble */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
              💬 WhatsApp Message Preview (Real Chat View)
            </label>
            <WhatsAppPreviewBubble
              recipientPhone={customer.phone}
              recipientName={customer.name}
              messageText={selectedMessage}
              shopName={shopName}
              toast={showToast}
              onSent={onClose}
            />
          </div>

          {/* Close button */}
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {showRepayModal && (
        <QuickKhataRepaymentModal
          customer={customer}
          db={db}
          isOpen={true}
          onClose={() => setShowRepayModal(false)}
          onSuccess={(updated) => {
            onClose();
          }}
          toast={showToast}
        />
      )}
    </div>
  );
};
