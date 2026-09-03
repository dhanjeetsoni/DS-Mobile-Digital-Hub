import React, { useState } from "react";
import { Gift, Search } from "lucide-react";
import { Database, Product } from "../types";
import { inr } from "../utils/indianCurrency";
import { ProductThumb } from "./ProductThumb";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface AddGiftModalProps {
  db: Database;
  // Product ids already sitting in the cart as a gift — hidden from results
  // so the same product can't accidentally be gifted twice in one bill.
  excludeGiftedProductIds: string[];
  onSelect: (product: Product) => void;
  onClose: () => void;
}

// Step 5.2 — Gifts System: "Gift add karte waqt poore stock mein se search
// karke koi bhi product select kar sakte ho (Earbuds, Glass, etc.)". This is
// deliberately a plain, category-blind search across every in-stock product
// (not just accessories) — the plan gives Earbuds/Glass only as examples,
// not a restriction.
export const AddGiftModal: React.FC<AddGiftModalProps> = ({ db, excludeGiftedProductIds, onSelect, onClose }) => {
  const [query, setQuery] = useState("");
  const { closing, requestClose, runClosing } = useAnimatedClose(onClose);

  const results = db.products
    .filter((p) => p.stock > 0 && !excludeGiftedProductIds.includes(p.id))
    .filter((p) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    })
    .slice(0, 60);

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`} style={{ maxWidth: "560px" }}>
        <div className="modal-head">
          <h3>
            <Gift size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            Add Gift — Poore Stock Mein Se Dhoondein
          </h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        <p className="hint" style={{ marginBottom: "10px" }}>
          Jo product select karoge wo customer ko <b>free (₹0)</b> diya jaayega — uski 1 quantity stock se kam ho
          jaayegi, bina paisa liye. Invoice par "🎁 Complimentary Gift" ke saath dikhega.
        </p>

        <div style={{ position: "relative", marginBottom: "12px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "11px", color: "var(--ink-soft)" }} />
          <input
            autoFocus
            placeholder="Gift product search karein (naam, brand, category, SKU)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: "100%", padding: "8px 10px 8px 30px", borderRadius: "8px", border: "1px solid var(--line)" }}
          />
        </div>

        <div style={{ maxHeight: "360px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          {results.length === 0 && <div className="empty">Koi matching (in-stock) product nahi mila.</div>}
          {results.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                padding: "8px 10px",
              }}
            >
              <ProductThumb photo={p.photo} name={p.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div className="hint">
                  {p.category} • Stock: {p.stock} • MRP {p.mrp ? inr(p.mrp) : "—"}
                </div>
              </div>
              <button className="btn sm primary" onClick={() => runClosing(() => onSelect(p))}>
                <Gift size={13} /> Gift Karein
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: "14px" }}>
          <button className="btn ghost" onClick={requestClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};
