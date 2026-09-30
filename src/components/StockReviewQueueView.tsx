import React, { useState } from "react";
import { CheckCircle2, Trash2, Pencil, Inbox } from "lucide-react";
import { Database, Product } from "../types";
import { inr } from "../utils/indianCurrency";
import { setProductReviewStatus } from "../services/repository";
import { EditProductModal } from "./EditProductModal";

interface StockReviewQueueViewProps {
  db: Database;
  storeId?: string;
  ownerMode: boolean;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

/**
 * Phase 19 — the Windows-side other half of the owner's DS Mobile "Fast
 * Stock Add" (QuickStockAddModal.tsx): every product added from the phone
 * lands here first (reviewStatus "pending_review") instead of the normal
 * catalog, invisible to Sell/search/Today's Stock/Low Stock the whole
 * time (see catalogProducts in App.tsx). This screen is where the owner
 * actually looks at what AI filled in, fixes anything wrong (reusing the
 * existing EditProductModal rather than building a second edit form), and
 * either approves it (now live/sellable everywhere) or rejects it
 * (deletes it outright — e.g. a duplicate, or a photo of the wrong item).
 *
 * Reads db.products directly (not catalogProducts) on purpose — this is
 * the one screen that's SUPPOSED to see pending items.
 */
export const StockReviewQueueView: React.FC<StockReviewQueueViewProps> = ({ db, storeId, ownerMode, onUpdate, toast }) => {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = db.products.filter((p) => p.reviewStatus === "pending_review");

  const handleApprove = async (product: Product) => {
    setBusyId(product.id);
    try {
      if (storeId) await setProductReviewStatus(storeId, product.id, true);
      product.reviewStatus = "live";
      onUpdate();
      toast(`${product.name} ab Live hai — Sell mein dikhega`, "green");
    } catch (err: any) {
      toast(err?.message || "Approve nahi ho paya, dobara try karein", "red");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (product: Product) => {
    if (!window.confirm(`"${product.name}" ko hata dein? Yeh wapas nahi aayega.`)) return;
    setBusyId(product.id);
    try {
      if (storeId) await setProductReviewStatus(storeId, product.id, false);
      db.products = db.products.filter((p) => p.id !== product.id);
      db.stockBatches = (db.stockBatches || []).filter((b) => b.productId !== product.id);
      onUpdate();
      toast("Item hata diya gaya", "green");
    } catch (err: any) {
      toast(err?.message || "Reject nahi ho paya, dobara try karein", "red");
    } finally {
      setBusyId(null);
    }
  };

  if (!ownerMode) {
    return <div className="hint">Ye sirf owner dekh sakte hain.</div>;
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>📋 Stock Review Queue ({pending.length})</h2>
        </div>
        <div className="hint" style={{ marginBottom: "14px" }}>
          Phone se "Fast Stock Add" ke through jo bhi items add hue hain, wo
          yahan pending rehte hain — jab tak verify/approve nahi karoge, ye
          Sell ya Today's Stock mein kahin nahi dikhenge.
        </div>

        {pending.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", opacity: 0.7 }}>
            <Inbox size={36} style={{ margin: "0 auto 8px" }} />
            <div>Koi pending item nahi hai.</div>
          </div>
        ) : (
          <div className="grid cols-3" style={{ gap: "14px" }}>
            {pending.map((p) => (
              <div key={p.id} className="card" style={{ padding: "14px" }}>
                {p.photo && (
                  <img src={p.photo} alt="" style={{ width: "100%", height: "140px", objectFit: "contain", borderRadius: "8px", marginBottom: "8px" }} />
                )}
                <div style={{ fontWeight: 800 }}>{p.name}</div>
                <div className="hint">{[p.brand, p.category].filter(Boolean).join(" · ")}</div>
                <div style={{ marginTop: "8px", fontSize: "13px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                  <div>Qty: <strong>{p.stock}</strong></div>
                  <div>Selling: <strong>{inr(p.sellingPrice)}</strong></div>
                  {ownerMode && <div>Confidential: {p.confidentialPrice ? inr(p.confidentialPrice) : "—"}</div>}
                  {ownerMode && <div>Original: {p.purchasePrice ? inr(p.purchasePrice) : "—"}</div>}
                  <div>MRP: {p.mrp ? inr(p.mrp) : "—"}</div>
                </div>
                {p.compatibleModels?.length > 0 && (
                  <div className="hint" style={{ marginTop: "6px" }}>
                    {p.compatibleModels.length} model(s): {p.compatibleModels.slice(0, 3).join(", ")}
                    {p.compatibleModels.length > 3 ? "…" : ""}
                  </div>
                )}
                <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
                  <button className="btn sm" onClick={() => setEditingProduct(p)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button className="btn sm primary" disabled={busyId === p.id} onClick={() => handleApprove(p)}>
                    <CheckCircle2 size={13} /> Verify &amp; Live Karo
                  </button>
                  <button className="btn sm" style={{ color: "#ef4444" }} disabled={busyId === p.id} onClick={() => handleReject(p)}>
                    <Trash2 size={13} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <EditProductModal
        isOpen={!!editingProduct}
        product={editingProduct}
        ownerMode={ownerMode}
        db={db}
        storeId={storeId}
        onClose={() => setEditingProduct(null)}
        onSaved={() => { setEditingProduct(null); onUpdate(); }}
        toast={toast}
      />
    </div>
  );
};
