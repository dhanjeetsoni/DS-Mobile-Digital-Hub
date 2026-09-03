import React from "react";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { buildLowStockReorderMessage, openWhatsApp } from "../services/whatsapp";
import { ProductThumb } from "./ProductThumb";

interface LowStockAlertsViewProps {
  db: Database;
  showToast: (msg: string, color?: string) => void;
}

export const LowStockAlertsView: React.FC<LowStockAlertsViewProps> = ({ db, showToast }) => {
  const multiplier = db.settings.reorderMultiplier || 2;
  const lowStock = db.products
    .filter((p) => p.stock <= p.minStock)
    .map((p) => ({
      product: p,
      suggestedQty: Math.max(1, Math.round(p.minStock * multiplier) - p.stock),
      supplier: db.suppliers.find((s) => s.name.toLowerCase() === (p.supplier || "").toLowerCase()),
    }))
    .sort((a, b) => a.product.stock - b.product.stock);

  const handleReorder = (row: (typeof lowStock)[number]) => {
    const message = buildLowStockReorderMessage(row.product, row.suggestedQty, db.settings);
    if (!row.supplier?.phone) {
      showToast("No supplier phone on file for this product. Add one in Suppliers.", "amber");
      return;
    }
    const ok = openWhatsApp(row.supplier.phone, message);
    if (!ok) showToast("Supplier phone number looks invalid.", "red");
  };

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <AlertTriangle size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Low Stock &amp; Reorder Alerts
        </h2>
        <span style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 600 }}>
          {lowStock.length} item(s) at or below reorder point
        </span>
      </div>

      {lowStock.length === 0 ? (
        <div className="empty">All stock levels look healthy. Nothing to reorder right now.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Photo</th>
                <th>Product</th>
                <th>Category</th>
                <th>Current stock</th>
                <th>Min stock</th>
                <th>Suggested reorder</th>
                <th>Supplier</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((row) => (
                <tr key={row.product.id}>
                  <td><ProductThumb photo={row.product.photo} name={row.product.name} /></td>
                  <td><b className="truncate" title={row.product.name}>{row.product.name}</b></td>
                  <td>{row.product.category || "—"}</td>
                  <td style={{ fontWeight: 800, color: row.product.stock === 0 ? "var(--red)" : "var(--amber)" }}>
                    {row.product.stock}
                  </td>
                  <td>{row.product.minStock}</td>
                  <td><b>{row.suggestedQty}</b></td>
                  <td>{row.supplier?.name || row.product.supplier || "—"}</td>
                  <td>
                    <button className="btn sm blue" onClick={() => handleReorder(row)}>
                      <MessageCircle size={14} /> Reorder via WhatsApp
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
