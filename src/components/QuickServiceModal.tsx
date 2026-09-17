import React, { useState } from "react";
import { Wrench, Plus, X, Sparkles, Scissors, HardDrive, Smartphone, ShieldCheck, Zap } from "lucide-react";
import { CartItem } from "../types";
import { playScanPip } from "../utils/counterAudio";

interface QuickServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddServiceToCart: (item: CartItem) => void;
  showToast: (msg: string, kind?: string) => void;
}

interface CommonServicePreset {
  title: string;
  defaultPrice: number;
  category: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}

const COMMON_PRESETS: CommonServicePreset[] = [
  { title: "SIM Nano/Micro Cutting", defaultPrice: 30, category: "SIM Services", icon: Scissors },
  { title: "Phone to Phone Data Transfer", defaultPrice: 150, category: "Software Service", icon: HardDrive },
  { title: "UV Glass Curing & Clean", defaultPrice: 50, category: "Tempered Glass", icon: Sparkles },
  { title: "Back Skin / Lamination Fit", defaultPrice: 99, category: "Mobile Accessories", icon: Smartphone },
  { title: "Mic/Speaker Dust Cleaning", defaultPrice: 100, category: "Repair Service", icon: Wrench },
  { title: "Software Flash / Reset", defaultPrice: 250, category: "Software Service", icon: Zap },
  { title: "Tempered Glass Fitting Charge", defaultPrice: 30, category: "Tempered Glass", icon: ShieldCheck },
];

export const QuickServiceModal: React.FC<QuickServiceModalProps> = ({
  isOpen,
  onClose,
  onAddServiceToCart,
  showToast,
}) => {
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState<number | "">("");
  const [serviceCategory, setServiceCategory] = useState("Counter Services");
  const [technicianNote, setTechnicianNote] = useState("");

  if (!isOpen) return null;

  const handleSelectPreset = (preset: CommonServicePreset) => {
    setServiceName(preset.title);
    setServicePrice(preset.defaultPrice);
    setServiceCategory(preset.category);
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceName.trim()) {
      showToast("Service ka naam bharein", "amber");
      return;
    }
    const priceNum = Number(servicePrice) || 0;
    if (priceNum < 0) {
      showToast("Price valid dalein", "amber");
      return;
    }

    const cartItem: CartItem = {
      productId: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: serviceName.trim(),
      category: serviceCategory.trim() || "Counter Services",
      qty: 1,
      price: priceNum,
      purchasePrice: 0, // Labor / Service has 0 stock consumption
      warrantyEnabled: false,
      warrantyMonths: 0,
      requireCustomerDetails: false,
      customQuote: technicianNote.trim() ? `Note: ${technicianNote.trim()}` : undefined,
    };

    playScanPip();
    onAddServiceToCart(cartItem);
    showToast(`Service "${serviceName}" added to cart (₹${priceNum})`, "green");
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: "540px", width: "95%", borderRadius: "14px", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            background: "var(--navy, #0f172a)",
            color: "#fff",
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Wrench size={18} color="#38bdf8" />
            <div>
              <div style={{ fontWeight: 800, fontSize: "15px" }}>
                Quick Miscellany &amp; Service Key
              </div>
              <div style={{ fontSize: "12px", opacity: 0.8 }}>
                Small counter jobs (bina product inventory ke instant bill item)
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleConfirm} style={{ padding: "16px 20px" }}>
          {/* Quick Presets */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink-soft)", marginBottom: "6px" }}>
              COMMON COUNTER JOBS (1-TAP SELECT)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {COMMON_PRESETS.map((p, idx) => {
                const Icon = p.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "5px 10px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 600,
                      background: serviceName === p.title ? "var(--brand)" : "var(--paper)",
                      color: serviceName === p.title ? "#fff" : "var(--ink)",
                      border: "1px solid var(--line)",
                      cursor: "pointer",
                    }}
                  >
                    <Icon size={12} />
                    <span>{p.title}</span>
                    <span style={{ opacity: 0.8, fontSize: "11px" }}>₹{p.defaultPrice}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 700 }}>Service / Job Title *</label>
              <input
                type="text"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="e.g. SIM Cutting, Mobile Polish, Data Backup"
                required
                autoFocus
                style={{ width: "100%", marginTop: "4px" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 700 }}>Customer Charge (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={servicePrice}
                  onChange={(e) => setServicePrice(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 50"
                  required
                  style={{ width: "100%", marginTop: "4px", fontWeight: 800, fontSize: "15px" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 700 }}>Category</label>
                <input
                  type="text"
                  value={serviceCategory}
                  onChange={(e) => setServiceCategory(e.target.value)}
                  placeholder="Counter Services"
                  style={{ width: "100%", marginTop: "4px" }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: "12px" }}>Technician / Counter Remark (Optional)</label>
              <input
                type="text"
                value={technicianNote}
                onChange={(e) => setTechnicianNote(e.target.value)}
                placeholder="e.g. Customer provided memory card, backup completed"
                style={{ width: "100%", marginTop: "4px", fontSize: "12px" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "18px" }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" style={{ fontWeight: 800 }}>
              <Plus size={15} /> Add to Cart (₹{Number(servicePrice) || 0})
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
