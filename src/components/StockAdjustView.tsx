import React, { useMemo, useState } from "react";
import { Wrench, Plus, CheckCircle2, AlertTriangle, ArrowUpDown, History, Stethoscope } from "lucide-react";
import { Database, Product } from "../types";
import { todayStr, nowTimeStr, uid, addStockBatch, consumeFIFO, findStockMismatches, StockMismatch } from "../utils/fifoEngine";
import { supabase, isCloudConfigured } from "../services/supabaseClient";
import { queueOfflineOperation } from "../services/repository";

interface StockAdjustViewProps {
  db: Database;
  storeId?: string;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

// Server-side rejections (bad delta, unknown product, no permission) will
// fail again on retry — queuing those would spam the offline queue forever.
// Only network/availability errors get queued for the background worker.
function isBusinessRejection(message: string): boolean {
  return /invalid quantity|not authorized|unknown product/i.test(message);
}

export const StockAdjustView: React.FC<StockAdjustViewProps> = ({
  db,
  storeId,
  onUpdate,
  toast,
}) => {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [adjustType, setAdjustType] = useState<"SET_EXACT" | "ADD" | "SUBTRACT">("SET_EXACT");
  const [quantityInput, setQuantityInput] = useState<number>(0);
  const [reason, setReason] = useState("Physical Inventory Audit Count");
  const [notes, setNotes] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  const selectedProduct = db.products.find((p) => p.id === selectedProductId);

  const calculateNewStock = () => {
    if (!selectedProduct) return 0;
    if (adjustType === "SET_EXACT") return Math.max(0, quantityInput);
    if (adjustType === "ADD") return selectedProduct.stock + Math.max(0, quantityInput);
    if (adjustType === "SUBTRACT") return Math.max(0, selectedProduct.stock - Math.max(0, quantityInput));
    return selectedProduct.stock;
  };

  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false);
  // Step 4.1 — Stock Health Check: separate "saving" flag so a mismatch fix
  // (below) never fights the manual adjustment form's own busy state.
  const [fixingProductId, setFixingProductId] = useState<string | null>(null);
  const [isFixingAll, setIsFixingAll] = useState(false);

  const mismatches = useMemo(() => findStockMismatches(db), [db]);

  // Shared core: commits a stock correction (server RPC + local FIFO batch
  // mirror + audit-log entry) for `product`, moving it to `newStock`. Used by
  // both the manual adjustment form below and the one-click Stock Health
  // Check fix, so a mismatch reconciliation is recorded exactly the same way
  // (and shows up in the same audit log) as any other adjustment.
  const applyAdjustment = async (product: Product, newStock: number, reason: string, notes: string) => {
    const previousStock = product.stock;
    const delta = newStock - previousStock;
    if (delta === 0) return;

    const idempotencyKey = crypto.randomUUID();
    if (isCloudConfigured && storeId) {
      try {
        const { error } = await supabase.rpc("atomic_apply_stock_adjustment", {
          p_store_id: storeId,
          p_product_id: product.id,
          p_delta: delta,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
        });
        if (error) throw error;
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if (isBusinessRejection(msg)) {
          toast(msg || "Adjustment rejected by server.", "red");
          throw err;
        }
        try {
          await queueOfflineOperation(
            "stock_adjustment",
            "stock_movements",
            { adjustment: { productId: product.id, delta, reason } },
            idempotencyKey
          );
        } catch {
          toast("Adjustment safely save nahi ho paya. Dobara try karein.", "red");
          throw err;
        }
      }
    }

    product.stock = newStock;
    if (delta > 0) {
      addStockBatch(db, product.id, delta, product.purchasePrice || 0, todayStr(), {
        source: "adjustment",
        ref: reason,
      });
    } else if (delta < 0) {
      try {
        consumeFIFO(db, product.id, Math.abs(delta));
      } catch (error) {
        console.error("Stock adjustment FIFO consumption failed", error);
        // Batches already didn't cover the reduction — nothing more to
        // consume, but the product.stock correction above still applies.
      }
    }

    const adjustmentEntry = {
      id: uid("adj"),
      productId: product.id,
      productName: product.name,
      previousStock,
      newStock,
      delta,
      reason,
      notes,
      date: todayStr(),
      time: nowTimeStr(),
      createdAt: new Date().toISOString(),
    };
    if (!db.stockAdjustments) db.stockAdjustments = [];
    db.stockAdjustments.push(adjustmentEntry);
  };

  // Step 4.1 — Stock Health Check: reconciles product.stock to match the
  // real FIFO batch total (the source checkout now trusts — see
  // getAvailableStock in utils/fifoEngine.ts). Fixing here means the
  // denormalized counter shown everywhere else in the app (product cards,
  // low-stock alerts, POS search) also stops lying, not just the checkout gate.
  const handleFixMismatch = async (m: StockMismatch) => {
    const product = db.products.find((p) => p.id === m.productId);
    if (!product) return;
    setFixingProductId(m.productId);
    try {
      await applyAdjustment(product, m.batchStock, "Stock Health Check — Auto Reconcile", "System stock synced to real FIFO batch total");
      onUpdate();
      toast(`${product.name}: stock synced ${m.systemStock} ➔ ${m.batchStock}`, "green");
    } catch {
      // applyAdjustment already toasted the reason.
    } finally {
      setFixingProductId(null);
    }
  };

  const handleFixAllMismatches = async () => {
    if (mismatches.length === 0) return;
    setIsFixingAll(true);
    let fixed = 0;
    try {
      for (const m of mismatches) {
        const product = db.products.find((p) => p.id === m.productId);
        if (!product) continue;
        try {
          await applyAdjustment(product, m.batchStock, "Stock Health Check — Auto Reconcile", "System stock synced to real FIFO batch total");
          fixed++;
        } catch {
          // Keep going — one rejected product shouldn't stop the rest.
        }
      }
      onUpdate();
      toast(`Stock Health Check: ${fixed} of ${mismatches.length} product(s) synced`, fixed === mismatches.length ? "green" : "amber");
    } finally {
      setIsFixingAll(false);
    }
  };

  const handleApplyAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      toast("Adjust karne ke liye product chunein", "red");
      return;
    }

    const previousStock = selectedProduct.stock;
    const newStock = calculateNewStock();
    const delta = newStock - previousStock;

    if (delta === 0) {
      toast("Stock quantity mein koi badlaav nahi hai", "amber");
      return;
    }

    setIsSavingAdjustment(true);
    try {
      await applyAdjustment(selectedProduct, newStock, reason, notes);
      onUpdate();
      toast(`Stock for ${selectedProduct.name} updated: ${previousStock} ➔ ${newStock}`, "green");
      setQuantityInput(0);
      setNotes("");
    } catch {
      // applyAdjustment already toasted the reason.
    } finally {
      setIsSavingAdjustment(false);
    }
  };

  const filteredHistory = (db.stockAdjustments || []).filter((a: any) => {
    if (!filterSearch) return true;
    const q = filterSearch.toLowerCase();
    return (
      a.productName?.toLowerCase().includes(q) ||
      a.reason?.toLowerCase().includes(q) ||
      a.notes?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2>⚙️ Stock Adjustment &amp; Physical Audit</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Manually correct physical inventory counts, write off damaged/broken goods, or reconcile stock discrepancies
            </span>
          </div>
        </div>

        {/* Step 4.1 — Stock Health Check: surfaces every product where the
            denormalized `stock` counter disagrees with the real FIFO batch
            total (the number checkout now actually trusts). Owner can fix
            one product or all of them in a click, instead of a mismatch only
            ever surfacing later as a confusing "insufficient stock" error at
            the POS counter. */}
        <div
          style={{
            background: mismatches.length > 0 ? "var(--red-light, #fdecea)" : "var(--card)",
            border: `1px solid ${mismatches.length > 0 ? "var(--red-border, #f3b4ae)" : "var(--line)"}`,
            borderRadius: "10px",
            padding: "14px 16px",
            marginBottom: "18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Stethoscope size={18} style={{ color: mismatches.length > 0 ? "var(--red)" : "var(--green)" }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: "14px" }}>
                  Stock Health Check
                  {mismatches.length > 0 ? (
                    <span className="badge" style={{ marginLeft: "8px", background: "var(--red)", color: "#fff" }}>
                      {mismatches.length} mismatch{mismatches.length > 1 ? "es" : ""} found
                    </span>
                  ) : (
                    <span className="badge" style={{ marginLeft: "8px", background: "var(--green)", color: "#fff" }}>
                      All in sync
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--ink-soft)", marginTop: "2px" }}>
                  {mismatches.length > 0
                    ? "System stock and the real FIFO batch total disagree on these products — this is exactly what can cause a valid sale to get wrongly blocked (or a sale to go through when it shouldn't)."
                    : "System stock matches the real FIFO batch total for every product. No action needed."}
                </div>
              </div>
            </div>
            {mismatches.length > 0 && (
              <button type="button" className="btn sm danger" onClick={handleFixAllMismatches} disabled={isFixingAll}>
                <Wrench size={14} /> {isFixingAll ? "Fixing..." : `Fix All (${mismatches.length})`}
              </button>
            )}
          </div>

          {mismatches.length > 0 && (
            <div className="table-wrap" style={{ marginTop: "12px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>System Stock</th>
                    <th>Real Batch Stock</th>
                    <th>Difference</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {mismatches.map((m) => (
                    <tr key={m.productId}>
                      <td><b>{m.productName}</b></td>
                      <td>{m.systemStock}</td>
                      <td><b style={{ color: "var(--blue)" }}>{m.batchStock}</b></td>
                      <td>
                        <b style={{ color: m.diff >= 0 ? "var(--green)" : "var(--red)" }}>
                          {m.diff >= 0 ? `+${m.diff}` : m.diff}
                        </b>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() => handleFixMismatch(m)}
                          disabled={fixingProductId === m.productId || isFixingAll}
                        >
                          <CheckCircle2 size={13} /> {fixingProductId === m.productId ? "Fixing..." : "Fix"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form onSubmit={handleApplyAdjustment} style={{ background: "var(--paper)", padding: "18px", borderRadius: "10px", marginBottom: "20px" }}>
          <div className="formgrid">
            <div className="field full">
              <label>Select Product to Adjust</label>
              <select
                value={selectedProductId}
                onChange={(e) => {
                  setSelectedProductId(e.target.value);
                  const p = db.products.find((x) => x.id === e.target.value);
                  if (p) setQuantityInput(p.stock);
                }}
                required
              >
                <option value="">-- Choose Product from Inventory --</option>
                {db.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.category}) — Current Stock: {p.stock} {p.sku ? `[${p.sku}]` : ""}
                  </option>
                ))}
              </select>
            </div>

            {selectedProduct && (
              <>
                <div className="field">
                  <label>Adjustment Mode</label>
                  <select value={adjustType} onChange={(e) => setAdjustType(e.target.value as any)}>
                    <option value="SET_EXACT">Set Exact Physical Count</option>
                    <option value="ADD">+ Add Stock / Found Extra</option>
                    <option value="SUBTRACT">- Subtract Stock / Damage / Loss (/)</option>
                  </select>
                </div>

                <div className="field">
                  <label>
                    {adjustType === "SET_EXACT" ? "Actual Physical Count in Shop" : "Adjustment Quantity"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(Number(e.target.value) || 0)}
                    required
                  />
                </div>

                <div className="field">
                  <label>Reason for Adjustment</label>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option>Physical Inventory Audit Count</option>
                    <option>Damaged / Broken in Shop Display</option>
                    <option>Defective / Vendor Warranty Return</option>
                    <option>Theft / Shrinkage Loss</option>
                    <option>Given as Free Sample / Promo</option>
                    <option>Data Entry Mistake Correction</option>
                  </select>
                </div>

                <div className="field">
                  <label>Audit Notes / Remarks</label>
                  <input
                    placeholder="e.g. Counted during Sunday audit"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="field full" style={{ marginTop: "6px" }}>
                  <div
                    style={{
                      background: "var(--card)",
                      padding: "12px 16px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>Stock Summary:</span>
                      <div style={{ fontSize: "15px", fontWeight: 700, marginTop: "2px" }}>
                        Current System Stock: <b>{selectedProduct.stock}</b> ➔ New Stock:{" "}
                        <b style={{ color: "var(--blue)" }}>{calculateNewStock()}</b>{" "}
                        <span style={{ fontSize: "12.5px", color: calculateNewStock() - selectedProduct.stock >= 0 ? "var(--green)" : "var(--red)" }}>
                          ({calculateNewStock() - selectedProduct.stock >= 0 ? `+${calculateNewStock() - selectedProduct.stock}` : calculateNewStock() - selectedProduct.stock})
                        </span>
                      </div>
                    </div>

                    <button type="submit" className="btn primary" disabled={isSavingAdjustment}>
                      <CheckCircle2 size={16} /> {isSavingAdjustment ? "Saving..." : "Save Stock Adjustment"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </form>

        {/* Audit Log Table */}
        <div className="section-head" style={{ marginTop: "16px" }}>
          <h3>📋 Stock Adjustment History Log ({filteredHistory.length})</h3>
          <input
            placeholder="Search audit log..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            style={{ maxWidth: "240px", padding: "6px 10px" }}
          />
        </div>

        <div className="table-wrap">
          {filteredHistory.length === 0 ? (
            <div className="empty">No stock adjustments recorded yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>Product</th>
                  <th>Old Stock</th>
                  <th>Change (Delta)</th>
                  <th>New Stock</th>
                  <th>Reason</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.slice().reverse().map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.date} {a.time}</td>
                    <td><b>{a.productName}</b></td>
                    <td>{a.previousStock}</td>
                    <td>
                      <b style={{ color: a.delta >= 0 ? "var(--green)" : "var(--red)" }}>
                        {a.delta >= 0 ? `+${a.delta}` : a.delta}
                      </b>
                    </td>
                    <td><b>{a.newStock}</b></td>
                    <td><span className="badge info">{a.reason}</span></td>
                    <td className="hint">{a.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
