import React, { useState, useEffect } from "react";
import { Clock, Trash2, ArrowRight, PauseCircle, ShoppingBag, X, User, Phone, FileText } from "lucide-react";
import { ParkedCart, getParkedCarts, deleteParkedCart, parkCart } from "../services/parkedCartsService";
import { CartItem } from "../types";
import { playHoldTone } from "../utils/counterAudio";

interface ParkedCartsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCart: CartItem[];
  currentDiscount: number;
  currentCustomerName: string;
  currentCustomerPhone: string;
  onRestoreCart: (cart: ParkedCart) => void;
  onClearCurrentCart: () => void;
  showToast: (msg: string, kind?: string) => void;
}

export const ParkedCartsModal: React.FC<ParkedCartsModalProps> = ({
  isOpen,
  onClose,
  currentCart,
  currentDiscount,
  currentCustomerName,
  currentCustomerPhone,
  onRestoreCart,
  onClearCurrentCart,
  showToast,
}) => {
  const [parkedCarts, setParkedCarts] = useState<ParkedCart[]>([]);
  const [parkNote, setParkNote] = useState("");
  const [showParkInput, setShowParkInput] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setParkedCarts(getParkedCarts());
      setShowParkInput(false);
      setParkNote("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleParkCurrent = () => {
    if (currentCart.length === 0) {
      showToast("Current cart is empty. Kuch items cart me dalein.", "amber");
      return;
    }
    const saved = parkCart({
      items: currentCart,
      customerName: currentCustomerName,
      customerPhone: currentCustomerPhone,
      note: parkNote,
      discount: currentDiscount,
    });
    playHoldTone();
    onClearCurrentCart();
    setParkedCarts(getParkedCarts());
    setShowParkInput(false);
    showToast(`Cart #${saved.id.slice(-4)} Parked successfully! Current counter free ho gaya.`, "green");
  };

  const handleRestore = (cart: ParkedCart) => {
    if (currentCart.length > 0) {
      const confirmOverride = window.confirm(
        "Current cart me items hain. Kya aap current cart ko replace karna chahte hain? (Tip: Pehle current cart ko Park kar lijiye agar baad me bechna ho)"
      );
      if (!confirmOverride) return;
    }
    onRestoreCart(cart);
    deleteParkedCart(cart.id);
    playHoldTone();
    showToast(`Cart restore ho gaya (₹${cart.total.toLocaleString("en-IN")})`, "green");
    onClose();
  };

  const handleDelete = (id: string) => {
    const updated = deleteParkedCart(id);
    setParkedCarts(updated);
    showToast("Parked cart deleted", "amber");
  };

  const formatElapsed = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return `${diffSec}s pehle`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m pehle`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h pehle`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: "620px", width: "95%", borderRadius: "14px", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            background: "var(--navy, #0f172a)",
            color: "#fff",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <PauseCircle size={20} color="#38bdf8" />
            <div>
              <div style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "0.2px" }}>
                Draft / Parked Carts (Hold Ledger)
              </div>
              <div style={{ fontSize: "12px", opacity: 0.8 }}>
                Jab customer phone choose kar raha ho, billing hold karke naya bill banayein (F4/F5)
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "4px" }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "18px 20px", maxHeight: "70vh", overflowY: "auto" }}>
          {/* Action to park current cart */}
          {currentCart.length > 0 && (
            <div
              style={{
                background: "var(--paper, #f8fafc)",
                border: "1px dashed var(--brand, #2563eb)",
                borderRadius: "10px",
                padding: "14px",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--brand, #2563eb)" }}>
                  Active Counter Cart ({currentCart.length} items • ₹{currentCart.reduce((s, i) => s + i.price * i.qty, 0) - currentDiscount})
                </div>
                {!showParkInput && (
                  <button
                    className="btn primary sm"
                    onClick={() => setShowParkInput(true)}
                    style={{ fontSize: "12px", fontWeight: 700 }}
                  >
                    <PauseCircle size={13} /> Hold / Park This Cart (F4)
                  </button>
                )}
              </div>

              {showParkInput && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                  <input
                    type="text"
                    placeholder="Customer naam ya note (e.g. Blue shirt bhaiya / Screen guard testing)"
                    value={parkNote}
                    onChange={(e) => setParkNote(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleParkCurrent();
                    }}
                    style={{ width: "100%", fontSize: "13px" }}
                  />
                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                    <button className="btn sm" onClick={() => setShowParkInput(false)}>
                      Cancel
                    </button>
                    <button className="btn primary sm" onClick={handleParkCurrent}>
                      Confirm Park Cart
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Parked Carts List */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink-soft)" }}>
              SAVED HELD CARTS ({parkedCarts.length})
            </span>
          </div>

          {parkedCarts.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "36px 16px",
                color: "var(--ink-soft)",
                background: "var(--paper, #f8fafc)",
                borderRadius: "10px",
              }}
            >
              <ShoppingBag size={36} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
              <div style={{ fontWeight: 700, fontSize: "14px" }}>Koi Parked Cart Nahi Hai</div>
              <div style={{ fontSize: "12px", marginTop: "4px" }}>
                Active billing ke waqt <b>F4</b> dabayein ya <b>"Hold Cart"</b> click karein.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {parkedCarts.map((cart) => (
                <div
                  key={cart.id}
                  style={{
                    border: "1px solid var(--line, #e2e8f0)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    background: "var(--bg, #fff)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          background: "#e0f2fe",
                          color: "#0369a1",
                          fontSize: "11px",
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: "4px",
                        }}
                      >
                        #{cart.id.slice(-4)}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: "4px" }}>
                        <Clock size={12} /> {formatElapsed(cart.timestamp)}
                      </span>
                    </div>

                    <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--ink)" }}>
                      ₹{cart.total.toLocaleString("en-IN")}
                    </div>
                  </div>

                  {/* Customer tag / note */}
                  {(cart.customerName || cart.customerPhone || cart.note) && (
                    <div
                      style={{
                        fontSize: "12px",
                        background: "var(--paper)",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      {cart.customerName && (
                        <span style={{ display: "flex", alignItems: "center", gap: "3px", fontWeight: 600 }}>
                          <User size={11} /> {cart.customerName}
                        </span>
                      )}
                      {cart.customerPhone && (
                        <span style={{ display: "flex", alignItems: "center", gap: "3px", opacity: 0.8 }}>
                          <Phone size={11} /> {cart.customerPhone}
                        </span>
                      )}
                      {cart.note && (
                        <span style={{ display: "flex", alignItems: "center", gap: "3px", color: "var(--brand)" }}>
                          <FileText size={11} /> {cart.note}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Cart preview pills */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {cart.items.map((it, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: "11px",
                          padding: "2px 8px",
                          borderRadius: "12px",
                          background: "var(--paper)",
                          color: "var(--ink)",
                          border: "1px solid var(--line)",
                        }}
                      >
                        {it.name} <b style={{ color: "var(--brand)" }}>x{it.qty}</b>
                      </span>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
                    <button
                      className="btn sm"
                      onClick={() => handleDelete(cart.id)}
                      style={{ color: "#ef4444", borderColor: "#fecaca" }}
                      title="Discard this hold"
                    >
                      <Trash2 size={13} /> Discard
                    </button>
                    <button
                      className="btn primary sm"
                      onClick={() => handleRestore(cart)}
                      style={{ fontWeight: 700 }}
                    >
                      <ArrowRight size={13} /> Resume &amp; Bill (Restore)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
