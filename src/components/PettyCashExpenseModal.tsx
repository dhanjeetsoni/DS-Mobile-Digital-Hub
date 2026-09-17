import React, { useState } from "react";
import {
  Coffee,
  Truck,
  Sparkles,
  Zap,
  Wrench,
  Package,
  FileText,
  DollarSign,
  Plus,
  CheckCircle2,
  Printer,
} from "lucide-react";
import { Database, Expense, PettyCashPreset } from "../types";
import { inr } from "../utils/indianCurrency";

interface PettyCashExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: Database;
  onUpdateDb: (updater: (prev: Database) => Database) => void;
  currentStaffName?: string;
}

const QUICK_PRESETS: PettyCashPreset[] = [
  { id: "chai-20", label: "Chai & Biscuits", amount: 20, category: "Refreshment / Chai", icon: "☕" },
  { id: "chai-50", label: "Staff Tea / Snacks", amount: 50, category: "Refreshment / Chai", icon: "☕" },
  { id: "courier-100", label: "Courier / Speed Post", amount: 100, category: "Delivery & Transport", icon: "🛵" },
  { id: "auto-150", label: "Spare Part Auto Fare", amount: 150, category: "Spares Transport", icon: "🛺" },
  { id: "cleaning-100", label: "Shop Cleaning / Broom", amount: 100, category: "Shop Cleaning / Maintenance", icon: "🧹" },
  { id: "tape-50", label: "Packaging Tape & Roll", amount: 50, category: "Miscellaneous", icon: "📦" },
];

export const PettyCashExpenseModal: React.FC<PettyCashExpenseModalProps> = ({
  isOpen,
  onClose,
  db,
  onUpdateDb,
  currentStaffName = "Staff",
}) => {
  const [selectedPreset, setSelectedPreset] = useState<PettyCashPreset | null>(null);
  const [customDesc, setCustomDesc] = useState("");
  const [customAmount, setCustomAmount] = useState<number | "">("");
  const [customCategory, setCustomCategory] = useState<PettyCashPreset["category"]>("Refreshment / Chai");
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "UPI">("Cash");
  const [recordedVoucher, setRecordedVoucher] = useState<{ id: string; amount: number; desc: string; date: string } | null>(null);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: PettyCashPreset) => {
    setSelectedPreset(preset);
    setCustomDesc(preset.label);
    setCustomAmount(preset.amount);
    setCustomCategory(preset.category);
  };

  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customAmount || Number(customAmount) <= 0 || !customDesc.trim()) {
      alert("Kripya valid description aur amount enter karein.");
      return;
    }

    const newExpense: Expense = {
      id: `EXP-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      description: `[Petty Cash] ${customDesc.trim()} (By: ${currentStaffName})`,
      amount: Number(customAmount),
      method: paymentMethod,
      category: customCategory,
    };

    onUpdateDb((prev) => ({
      ...prev,
      expenses: {
        ...prev.expenses,
        shop: [newExpense, ...(prev.expenses.shop || [])],
      },
    }));

    setRecordedVoucher({
      id: newExpense.id,
      amount: Number(customAmount),
      desc: customDesc.trim(),
      date: new Date().toLocaleString("en-IN"),
    });
  };

  const handleReset = () => {
    setSelectedPreset(null);
    setCustomDesc("");
    setCustomAmount("");
    setRecordedVoucher(null);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "460px" }}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Coffee size={20} color="#f59e0b" />
            <h3 style={{ margin: 0 }}>Daily Expense & Petty Cash Voucher</h3>
          </div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        {recordedVoucher ? (
          <div style={{ textAlign: "center", padding: "16px 8px" }}>
            <CheckCircle2 size={48} color="#10b981" style={{ margin: "0 auto 12px auto" }} />
            <h4 style={{ fontSize: "17px", fontWeight: 700, color: "#10b981", margin: 0 }}>
              Petty Cash Voucher Created!
            </h4>
            <p style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", marginTop: "4px" }}>
              Amount automatic Cash Galla balance se deduct ho gaya hai.
            </p>

            <div
              style={{
                background: "var(--bg-card, rgba(255,255,255,0.04))",
                border: "1px dashed var(--border, rgba(255,255,255,0.15))",
                borderRadius: "12px",
                padding: "14px",
                margin: "16px 0",
                textAlign: "left",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ color: "var(--text-muted, #94a3b8)" }}>Voucher No:</span>
                <strong>{recordedVoucher.id}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ color: "var(--text-muted, #94a3b8)" }}>Description:</span>
                <strong>{recordedVoucher.desc}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ color: "var(--text-muted, #94a3b8)" }}>Amount Paid:</span>
                <strong style={{ color: "#ef4444", fontSize: "14px" }}>-{inr(recordedVoucher.amount)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted, #94a3b8)" }}>Paid Via:</span>
                <strong>{paymentMethod} (By {currentStaffName})</strong>
              </div>
            </div>

            <div className="modal-actions" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={handleReset}>
                + Add Another Expense
              </button>
              <button className="btn" onClick={onClose}>
                Done & Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveExpense} style={{ marginTop: "12px" }}>
            {/* Quick 1-Tap Preset Buttons */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted, #94a3b8)" }}>
                ⚡ 1-Tap Quick Expenses (Chai, Courier, Cleaning)
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "8px",
                  marginTop: "8px",
                }}
              >
                {QUICK_PRESETS.map((p) => {
                  const isSelected = selectedPreset?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyPreset(p)}
                      style={{
                        padding: "10px",
                        borderRadius: "10px",
                        background: isSelected ? "rgba(245, 158, 11, 0.2)" : "var(--bg-card, rgba(255,255,255,0.03))",
                        border: `1px solid ${isSelected ? "#f59e0b" : "var(--border, rgba(255,255,255,0.08))"}`,
                        color: isSelected ? "#fbbf24" : "var(--text, #f8fafc)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>{p.icon}</span>
                        <span style={{ fontWeight: 500 }}>{p.label}</span>
                      </div>
                      <span style={{ fontWeight: 700, color: "#f59e0b" }}>{inr(p.amount)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Expense Inputs */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                  Expense Description / Purpose
                </label>
                <input
                  type="text"
                  placeholder="e.g. Afternoon tea & samosa for client"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  required
                  style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 50"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    required
                    style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                  >
                    <option value="Cash">Cash in Galla (Deduct)</option>
                    <option value="UPI">UPI / Online QR</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                  Expense Category
                </label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value as any)}
                  style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                >
                  <option value="Refreshment / Chai">Refreshment / Chai / Snacks</option>
                  <option value="Delivery & Transport">Delivery & Courier</option>
                  <option value="Spares Transport">Spare Part Transport</option>
                  <option value="Shop Cleaning / Maintenance">Shop Cleaning / Maintenance</option>
                  <option value="Utilities & Bills">Utilities & Bills</option>
                  <option value="Miscellaneous">Miscellaneous</option>
                </select>
              </div>

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" style={{ background: "#f59e0b", borderColor: "#f59e0b" }}>
                  Save & Deduct from Galla
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
