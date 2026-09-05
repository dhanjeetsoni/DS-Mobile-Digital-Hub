import React, { useState } from "react";
import { AlertTriangle, MessageCircle, Sparkles } from "lucide-react";
import { Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { buildLowStockReorderMessage, openWhatsApp } from "../services/whatsapp";
import { getReorderSuggestion } from "../services/aiOps";
import { ProductThumb } from "./ProductThumb";

interface LowStockAlertsViewProps {
  db: Database;
  showToast: (msg: string, color?: string) => void;
}

export const LowStockAlertsView: React.FC<LowStockAlertsViewProps> = ({ db, showToast }) => {
  const multiplier = db.settings.reorderMultiplier || 2;
  // 2026-09-04: per-product AI reorder suggestion (loading / text), keyed by
  // product id — a real sale-velocity-aware suggestion alongside the
  // existing static minStock*multiplier formula, not a replacement for it
  // (the static one still works instantly/offline; AI is an optional extra
  // opinion fetched on demand).
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { loading: boolean; text: string; error: string }>>({});

  const salesInWindow = (productId: string, days: number): number => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let qty = 0;
    for (const sale of db.sales) {
      if (sale.status === "Cancelled") continue;
      const t = new Date(sale.createdAt || sale.date).getTime();
      if (Number.isNaN(t) || t < cutoff) continue;
      for (const item of sale.items) {
        if (item.productId === productId) qty += item.qty;
      }
    }
    return qty;
  };

  const handleAiSuggest = async (row: { product: Database["products"][number]; suggestedQty: number }) => {
    setAiSuggestions((prev) => ({ ...prev, [row.product.id]: { loading: true, text: "", error: "" } }));
    try {
      const text = await getReorderSuggestion({
        productName: row.product.name,
        category: row.product.category,
        currentStock: row.product.stock,
        minStock: row.product.minStock,
        unitsSoldLast7Days: salesInWindow(row.product.id, 7),
        unitsSoldLast30Days: salesInWindow(row.product.id, 30),
        currentStaticSuggestion: row.suggestedQty,
      });
      setAiSuggestions((prev) => ({ ...prev, [row.product.id]: { loading: false, text, error: "" } }));
    } catch (e) {
      setAiSuggestions((prev) => ({ ...prev, [row.product.id]: { loading: false, text: "", error: e instanceof Error ? e.message : "AI suggestion failed." } }));
    }
  };

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
                  <td>
                    <b>{row.suggestedQty}</b>
                    <div style={{ marginTop: "4px" }}>
                      {!aiSuggestions[row.product.id] && (
                        <button
                          className="btn sm"
                          style={{ fontSize: "11px", padding: "3px 8px" }}
                          onClick={() => handleAiSuggest(row)}
                        >
                          <Sparkles size={12} /> AI Suggest
                        </button>
                      )}
                      {aiSuggestions[row.product.id]?.loading && (
                        <span style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Sochte hue...</span>
                      )}
                      {aiSuggestions[row.product.id]?.error && (
                        <div style={{ fontSize: "11px", color: "var(--red)" }}>
                          {aiSuggestions[row.product.id].error}
                          <button
                            className="btn sm"
                            style={{ fontSize: "10px", padding: "2px 6px", marginLeft: "6px" }}
                            onClick={() => handleAiSuggest(row)}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      {aiSuggestions[row.product.id]?.text && (
                        <div style={{ fontSize: "11px", color: "var(--ink-soft)", maxWidth: "220px", whiteSpace: "pre-line" }}>
                          🤖 {aiSuggestions[row.product.id].text}
                        </div>
                      )}
                    </div>
                  </td>
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
