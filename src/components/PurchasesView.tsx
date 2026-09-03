import React, { useState } from "react";
import { Receipt, Plus, Search, CheckCircle2, Download, Package, Truck, Printer } from "lucide-react";
import { Database, PurchaseRecord, StockBatch } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, uid } from "../utils/fifoEngine";
import { supabase, isCloudConfigured } from "../services/supabaseClient";
import { queueOfflineOperation } from "../services/repository";

interface PurchasesViewProps {
  db: Database;
  storeId?: string;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

// Server-side validation failures (bad qty/price, unknown product, no
// permission) will fail again on every retry — queuing those would just
// spam the offline queue forever. Only network/availability errors get
// queued for the background worker to replay once the server is reachable.
function isBusinessRejection(message: string): boolean {
  return /insufficient|invalid quantity|purchase price invalid|not authorized|unknown product/i.test(message);
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  db,
  storeId,
  onUpdate,
  toast,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // New Purchase Inward Form
  const [selectedProductId, setSelectedProductId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayStr());
  const [qty, setQty] = useState<number>(1);
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [paymentStatus, setPaymentStatus] = useState<"Paid Cash" | "Paid Online" | "Purchased on Credit (Udhaar)">("Paid Cash");
  const [notes, setNotes] = useState("");
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);

  const totalPurchasesAmount = (db.purchases || []).reduce((a, p) => a + p.total, 0);

  const [isSavingPurchase, setIsSavingPurchase] = useState(false);

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const product = db.products.find((p) => p.id === selectedProductId);
    if (!product) {
      toast("Sahi product chunein", "red");
      return;
    }
    if (qty <= 0 || purchasePrice < 0) {
      toast("Sahi quantity aur price daalein", "red");
      return;
    }

    setIsSavingPurchase(true);
    try {
      const total = qty * purchasePrice;
      const resolvedSupplier = supplierName || product.supplier || "General Distributor";
      const resolvedInvoiceRef = invoiceRef || `BILL-${Date.now().toString().slice(-4)}`;
      const idempotencyKey = crypto.randomUUID();

      // If purchased on credit, resolve/auto-create the supplier record first —
      // its id (when it's a real, already-synced record) gets linked on the purchase.
      // BUG FIX: this previously only updated an EXISTING supplier match by name,
      // so any credit purchase from a supplier not already in the Supplier Khata
      // (e.g. a new/one-off distributor, or a name typed slightly differently)
      // silently recorded no payable anywhere — the shop would owe money that
      // never showed up in Supplier Udhaar. Now it auto-creates the supplier
      // record, same as how walk-in customers get auto-created on sale.
      let supplierId: string | undefined;
      if (paymentStatus === "Purchased on Credit (Udhaar)" && supplierName.trim()) {
        let supp = db.suppliers.find(
          (s) => s.name.toLowerCase() === supplierName.trim().toLowerCase()
        );
        if (!supp) {
          supp = {
            id: uid("supp"),
            name: supplierName.trim(),
            phone: "",
            category: "General",
            totalPayable: 0,
            createdAt: new Date().toISOString(),
          };
          db.suppliers.push(supp);
        }
        supp.totalPayable = (supp.totalPayable || 0) + total;
        supplierId = supp.id;
      }

      // Cloud side: commit purchase + line item + FIFO batch + stock update
      // atomically in Postgres (mirrors how sales are recorded — see
      // atomic_complete_sale). Falls back to the offline queue on any
      // network/availability failure so the inward is never lost; the local
      // ledger below is always written either way and stays the offline cache.
      if (isCloudConfigured && storeId) {
        const purchasePayload = {
          supplier: resolvedSupplier,
          supplierId,
          invoiceRef: resolvedInvoiceRef,
          notes,
          paymentStatus,
          items: [{ productId: product.id, qty, purchasePrice }],
        };
        try {
          const { error } = await supabase.rpc("atomic_complete_purchase", {
            p_store_id: storeId,
            p_supplier: purchasePayload.supplier,
            p_supplier_id: null, // local supplier ids aren't Postgres uuids yet — text name is the source of truth
            p_invoice_ref: purchasePayload.invoiceRef,
            p_notes: purchasePayload.notes,
            p_payment_status: purchasePayload.paymentStatus,
            p_idempotency_key: idempotencyKey,
            p_items: [{ product_id: product.id, quantity: qty, purchase_price: purchasePrice }],
          });
          if (error) throw error;
        } catch (err: any) {
          const msg = String(err?.message || err || "");
          if (isBusinessRejection(msg)) {
            toast(msg || "Purchase rejected by server.", "red");
            return;
          }
          try {
            await queueOfflineOperation("purchase", "purchases", { purchase: purchasePayload }, idempotencyKey);
          } catch {
            toast("Purchase safely save nahi ho paya. Dobara try karein.", "red");
            return;
          }
        }
      }

      const newPurchase: PurchaseRecord = {
        id: uid("pur"),
        productId: product.id,
        productName: product.name,
        qty,
        purchasePrice,
        total,
        supplier: resolvedSupplier,
        supplierId,
        date: purchaseDate,
        notes,
        invoiceRef: resolvedInvoiceRef,
        paymentStatus,
      };

      if (!db.purchases) db.purchases = [];
      db.purchases.push(newPurchase);

      // Increase Product Stock & Update Cost Price
      product.stock += qty;
      product.purchasePrice = purchasePrice;

      // Record StockBatch for FIFO Engine
      const newBatch: StockBatch = {
        id: uid("batch"),
        productId: product.id,
        qty,
        remainingQty: qty,
        purchasePrice,
        date: purchaseDate,
        supplier: resolvedSupplier,
        source: "purchase",
        ref: resolvedInvoiceRef || newPurchase.id,
        createdAt: new Date().toISOString(),
      };
      if (!db.stockBatches) db.stockBatches = [];
      db.stockBatches.push(newBatch);

      onUpdate();
      toast(`Inward recorded: +${qty} units of ${product.name}`, "green");
      setIsAddModalOpen(false);

      // Reset Form
      setSelectedProductId("");
      setQty(1);
      setPurchasePrice(0);
      setInvoiceRef("");
      setNotes("");
    } finally {
      setIsSavingPurchase(false);
    }
  };

  const filteredPurchases = (db.purchases || []).filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.productName?.toLowerCase().includes(q) ||
      p.supplier?.toLowerCase().includes(q) ||
      p.invoiceRef?.toLowerCase().includes(q) ||
      p.date?.includes(q)
    );
  });

  return (
    <div>
      {/* Top Metrics Banner */}
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Purchases</h3>
          <div className="big blue">{inr(totalPurchasesAmount)}</div>
          <div className="foot">{(db.purchases || []).length} Inward Bill(s) Logged</div>
        </div>
        <div className="card">
          <h3>Registered Suppliers</h3>
          <div className="big green">{db.suppliers.length}</div>
          <div className="foot">Distributors &amp; DLR Partners</div>
        </div>
        <div className="card">
          <h3>Supplier Udhaar Payable</h3>
          <div className="big amber">
            {inr(db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0))}
          </div>
          <div className="foot">Pending Inward Invoices</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>📦 Purchase History &amp; Stock Inward</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Record stock arrivals from distributors, update FIFO batches, and track supplier payables
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn sm" onClick={() => setIsPdfPreviewOpen(true)}>
              <Download size={13} /> Download Purchase List (PDF)
            </button>
            <button className="btn primary sm" onClick={() => setIsAddModalOpen(true)}>
              <Plus size={14} /> + New Stock Inward / Purchase Bill
            </button>
          </div>
        </div>

        <div className="searchbar">
          <input
            placeholder="🔍 Search purchases by product, supplier, invoice bill number, or date..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          {filteredPurchases.length === 0 ? (
            <div className="empty">No purchase inward records found. Click above to log a new purchase bill.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill / Ref #</th>
                  <th>Product Name</th>
                  <th>Supplier / DLR</th>
                  <th>Qty Inward</th>
                  <th>Cost / Unit</th>
                  <th>Total Bill (₹)</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.slice().reverse().map((p) => (
                  <tr key={p.id}>
                    <td>{p.date}</td>
                    <td><b>{p.invoiceRef || "—"}</b></td>
                    <td><b>{p.productName}</b></td>
                    <td>
                      <span className="badge info">{p.supplier || "Distributor"}</span>
                    </td>
                    <td><b style={{ color: "var(--green)" }}>+{p.qty}</b></td>
                    <td>{inr(p.purchasePrice)}</td>
                    <td style={{ fontWeight: 800 }}>{inr(p.total)}</td>
                    <td>
                      <span className={`badge ${p.paymentStatus === "Purchased on Credit (Udhaar)" ? "amber" : "ok"}`}>
                        {p.paymentStatus === "Purchased on Credit (Udhaar)" ? "Baaki / Due" : "Paid"}
                      </span>
                    </td>
                    <td className="hint">{p.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* New Purchase Inward Modal */}
      {isAddModalOpen && (
        <div className="overlay">
          <div className="modal wide">
            <div className="modal-head">
              <h3>📦 Add Stock Inward / Purchase Bill</h3>
              <button onClick={() => setIsAddModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleCreatePurchase}>
              <div className="formgrid">
                <div className="field full">
                  <label>Select Product to Inward <span className="req">*</span></label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      const p = db.products.find((x) => x.id === e.target.value);
                      if (p && p.purchasePrice) {
                        setPurchasePrice(p.purchasePrice);
                      }
                    }}
                    required
                  >
                    <option value="">-- Choose Product --</option>
                    {db.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.category}) — Current Stock: {p.stock}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Supplier / Distributor Name</label>
                  <input
                    placeholder="e.g. Anand Telecom, Shreeji Mobiles"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    list="supplier-list"
                  />
                  <datalist id="supplier-list">
                    {db.suppliers.map((s) => (
                      <option key={s.id} value={s.name} />
                    ))}
                  </datalist>
                </div>

                <div className="field">
                  <label>Supplier Invoice / Bill No</label>
                  <input
                    placeholder="e.g. GST-8921"
                    value={invoiceRef}
                    onChange={(e) => setInvoiceRef(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label>Quantity Inward (Units)</label>
                  <input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value) || 1)}
                    required
                  />
                </div>

                <div className="field">
                  <label>Purchase / Cost Price Per Unit (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchasePrice || ""}
                    onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)}
                    placeholder="0"
                    required
                  />
                </div>

                <div className="field">
                  <label>Payment Terms / Method</label>
                  <select
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value as any)}
                  >
                    <option>Paid Cash</option>
                    <option>Paid Online</option>
                    <option>Purchased on Credit (Udhaar)</option>
                  </select>
                </div>

                <div className="field full">
                  <label>Notes / Batch Remarks</label>
                  <input
                    placeholder="e.g. 50pcs Tempered glass box received"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div
                style={{
                  background: "var(--paper)",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  marginTop: "16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <span style={{ fontSize: "11px", color: "var(--ink-soft)", textTransform: "uppercase" }}>
                    Total Inward Bill Value:
                  </span>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--blue)" }}>
                    {inr(qty * purchasePrice)}
                  </div>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => setIsAddModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={isSavingPurchase}>
                    <CheckCircle2 size={16} /> {isSavingPurchase ? "Saving..." : "Save Inward & Restock"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purchase List — Print / Download as PDF (Owner only, all product/model details) */}
      {isPdfPreviewOpen && (
        <div className="overlay">
          <div className="modal wide">
            <div className="modal-head">
              <h3><Printer size={16} /> Purchase List — Download as PDF</h3>
              <button onClick={() => setIsPdfPreviewOpen(false)}>✕</button>
            </div>

            <p className="hint" style={{ marginBottom: "10px" }}>
              Print dialog khulega — usme "Save as PDF" chunkar file download kar sakte hain. Sab amount ₹ (INR) mein hain.
            </p>

            <div id="print-area">
              <div className="invoice-paper" style={{ padding: "20px" }}>
                <div className="status-strip ok">COMPLETE STOCK / SAMAN KHARIDARI LIST — {db.settings.shopName || "SHOP"}</div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "12px 0" }}>
                  <span>Generated: {todayStr()}</span>
                  <span>Total Bills: {(db.purchases || []).length}</span>
                </div>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Bill #</th>
                      <th>Product / Model</th>
                      <th>Supplier</th>
                      <th>Qty</th>
                      <th>Cost/Unit (₹)</th>
                      <th>Total (₹)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(db.purchases || []).map((p) => (
                      <tr key={p.id}>
                        <td>{p.date}</td>
                        <td>{p.invoiceRef || "—"}</td>
                        <td>{p.productName}</td>
                        <td>{p.supplier || "—"}</td>
                        <td>{p.qty}</td>
                        <td>{inr(p.purchasePrice)}</td>
                        <td>{inr(p.total)}</td>
                        <td>{p.paymentStatus === "Purchased on Credit (Udhaar)" ? "Baaki / Due" : "Paid"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: "14px", fontWeight: 800, textAlign: "right" }}>
                  Grand Total: {inr(totalPurchasesAmount)} &nbsp;|&nbsp; Supplier Baaki: {inr(db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0))}
                </div>
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: "16px" }}>
              <button type="button" className="btn" onClick={() => setIsPdfPreviewOpen(false)}>Close</button>
              <button type="button" className="btn primary" onClick={() => window.print()}>
                <Download size={14} /> Download / Save as PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
