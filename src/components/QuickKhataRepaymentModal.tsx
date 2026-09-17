// Udhaar Repayment Quick Modal (5-Second Fast Entry)
// Only 2 fields: [ Amount Paid ] + [ Cash / UPI / Bank ] + 1-Tap Full Settlement

import React, { useState } from "react";
import { CheckCircle2, DollarSign, Smartphone, Banknote, QrCode, X, Sparkles, MessageCircle } from "lucide-react";
import { Customer, Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, uid } from "../utils/fifoEngine";
import { openWhatsApp } from "../services/whatsapp";

interface QuickKhataRepaymentModalProps {
  customer: Customer;
  db: Database;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedCustomer: Customer) => void;
  toast: (msg: string, kind?: string) => void;
}

export const QuickKhataRepaymentModal: React.FC<QuickKhataRepaymentModalProps> = ({
  customer,
  db,
  isOpen,
  onClose,
  onSuccess,
  toast,
}) => {
  const currentDue = customer.totalDue || 0;
  const [amountPaid, setAmountPaid] = useState<number | "">(currentDue > 0 ? currentDue : "");
  const [paymentMode, setPaymentMode] = useState<"Cash" | "UPI" | "Bank Transfer">("Cash");
  const [note, setNote] = useState("");
  const [sendWhatsAppReceipt, setSendWhatsAppReceipt] = useState(true);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const paidNum = Number(amountPaid) || 0;
    if (paidNum <= 0) {
      toast("Please enter a valid amount paid", "amber");
      return;
    }

    const newDue = Math.max(0, currentDue - paidNum);

    // Create payment entry in customer ledger
    const paymentRecord = {
      id: uid("pay"),
      date: todayStr(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      amount: paidNum,
      paymentMode,
      note: note.trim() || "Khata Udhaar Repayment",
      balanceAfter: newDue,
    };

    // Update customer in DB
    const custIndex = (db.customers || []).findIndex((c) => c.id === customer.id);
    const updatedCustomer: Customer = {
      ...customer,
      totalDue: newDue,
    };

    if (custIndex >= 0) {
      db.customers[custIndex] = updatedCustomer;
    }

    toast(`✅ ₹${paidNum} repayment recorded for ${customer.name}! New Due: ${inr(newDue)}`, "green");

    // Optional instant WhatsApp confirmation
    if (sendWhatsAppReceipt && customer.phone) {
      const msg =
        `*🙏 PAYMENT RECEIVED — ${db.settings.shopName || "DS Mobile Hub"}*\n\n` +
        `Dear *${customer.name}*,\n` +
        `Aapka *${inr(paidNum)}* ka payment (${paymentMode}) safaltapoorvak jama ho gaya hai.\n\n` +
        `💰 *Amount Paid:* ${inr(paidNum)}\n` +
        `📋 *Remaining Khata Due:* ${inr(newDue)}\n` +
        `📅 *Date:* ${todayStr()}\n\n` +
        `Dhanyawad! ✨\n` +
        `📞 *${db.settings.phone || ""}*`;

      openWhatsApp(customer.phone, msg);
    }

    onSuccess(updatedCustomer);
    onClose();
  };

  return (
    <div className="overlay show" style={{ zIndex: 10000 }}>
      <div className="modal" style={{ maxWidth: "440px" }}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: "#dcfce7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#16a34a",
              }}
            >
              <CheckCircle2 size={16} />
            </div>
            <h3 style={{ margin: 0 }}>Quick Khata Jama / Repayment</h3>
          </div>
          <button onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSave} style={{ padding: "4px 0 10px" }}>
          {/* Customer Summary Card */}
          <div
            style={{
              background: "var(--paper, #f8fafc)",
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: "10px",
              padding: "10px 14px",
              marginBottom: "14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: "14px", color: "var(--ink)" }}>{customer.name}</div>
              <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>📱 {customer.phone}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", color: "var(--ink-soft)", textTransform: "uppercase" }}>Current Due</div>
              <div style={{ fontSize: "16px", fontWeight: 900, color: "var(--red, #ef4444)" }}>
                {inr(currentDue)}
              </div>
            </div>
          </div>

          {/* Field 1: Amount Paid */}
          <div className="field" style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <label style={{ fontWeight: 800 }}>1. Amount Paid (₹) <span className="req">*</span></label>
              {currentDue > 0 && (
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ fontSize: "11px", padding: "2px 6px", color: "var(--brand)" }}
                  onClick={() => setAmountPaid(currentDue)}
                >
                  ⚡ Full Settle ({inr(currentDue)})
                </button>
              )}
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Enter amount paid"
              autoFocus
              required
              style={{ fontSize: "18px", fontWeight: 800, padding: "8px 12px" }}
            />
          </div>

          {/* Field 2: Payment Mode */}
          <div className="field" style={{ marginBottom: "14px" }}>
            <label style={{ fontWeight: 800 }}>2. Payment Mode <span className="req">*</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "4px" }}>
              {(["Cash", "UPI", "Bank Transfer"] as const).map((mode) => {
                const isSelected = paymentMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    style={{
                      padding: "8px 4px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 700,
                      border: "1.5px solid",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "4px",
                      background: isSelected ? "var(--brand, #2563eb)" : "var(--paper, #f8fafc)",
                      color: isSelected ? "#ffffff" : "var(--ink, #0f172a)",
                      borderColor: isSelected ? "var(--brand, #2563eb)" : "var(--line, #cbd5e1)",
                    }}
                  >
                    {mode === "Cash" && <Banknote size={16} />}
                    {mode === "UPI" && <QrCode size={16} />}
                    {mode === "Bank Transfer" && <DollarSign size={16} />}
                    <span>{mode}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Note */}
          <div className="field" style={{ marginBottom: "12px" }}>
            <label style={{ fontSize: "12px" }}>Note (Optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Google Pay se bheja / Dukaan par aake diya"
            />
          </div>

          {/* WhatsApp Checkbox */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              cursor: "pointer",
              marginBottom: "16px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              padding: "8px 12px",
              borderRadius: "8px",
            }}
          >
            <input
              type="checkbox"
              checked={sendWhatsAppReceipt}
              onChange={(e) => setSendWhatsAppReceipt(e.target.checked)}
            />
            <span style={{ fontWeight: 700, color: "#166534" }}>
              💬 Send instant WhatsApp receipt message to customer
            </span>
          </label>

          {/* Actions */}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              style={{ background: "#16a34a", color: "#ffffff", border: "none", fontWeight: 800 }}
            >
              <CheckCircle2 size={15} /> Save Repayment (5 sec)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
