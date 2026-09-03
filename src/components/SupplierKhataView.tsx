import React, { useState } from "react";
import { BookOpen, Plus, DollarSign, Search, CheckCircle2, Building, Phone, ArrowUpRight } from "lucide-react";
import { Database, Supplier, SupplierPayment } from "../types";
import { inr } from "../utils/indianCurrency";
import { uid, todayStr } from "../utils/fifoEngine";
import { queueOfflineOperation } from "../services/repository";

interface SupplierKhataViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, kind?: string) => void;
}

export const SupplierKhataView: React.FC<SupplierKhataViewProps> = ({ db, onUpdate, toast }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // Form states
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    phone: "",
    category: "Mobile Distributor" as const,
    address: "",
    gstin: "",
    openingPayable: 0,
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    method: "UPI" as const,
    invoiceRef: "",
    notes: "",
  });

  const totalPayableAll = db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0);
  const filteredSuppliers = db.suppliers.filter((s) =>
    (s.name + " " + s.phone + " " + s.category).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplier.name.trim()) {
      toast("Supplier ka naam daalna zaroori hai", "red");
      return;
    }
    const sup: Supplier = {
      id: uid("sup"),
      name: newSupplier.name.trim(),
      phone: newSupplier.phone.trim(),
      category: newSupplier.category,
      address: newSupplier.address.trim(),
      gstin: newSupplier.gstin.trim(),
      totalPayable: Number(newSupplier.openingPayable) || 0,
      createdAt: new Date().toISOString(),
    };
    db.suppliers.push(sup);
    onUpdate();
    // Cloud mirror — fire-and-forget, never blocks the local save (same
    // offline-first fallback pattern as everywhere else in this app: local
    // state is instant and authoritative, cloud sync happens in background
    // and retries via the offline queue if it fails right now).
    queueOfflineOperation("supplier", "suppliers", { kind: "upsert", supplier: sup }).catch(() => {});
    setIsAddModalOpen(false);
    setNewSupplier({
      name: "",
      phone: "",
      category: "Mobile Distributor",
      address: "",
      gstin: "",
      openingPayable: 0,
    });
    toast(`Supplier ${sup.name} added!`, "green");
  };

  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    const amt = Number(paymentForm.amount);
    if (!amt || amt <= 0) {
      toast("Sahi payment amount daalein", "red");
      return;
    }

    const payRecord: SupplierPayment = {
      id: uid("spay"),
      supplierId: selectedSupplier.id,
      supplierName: selectedSupplier.name,
      date: todayStr(),
      amount: amt,
      method: paymentForm.method,
      invoiceRef: paymentForm.invoiceRef.trim(),
      notes: paymentForm.notes.trim(),
    };

    if (!db.supplierPayments) db.supplierPayments = [];
    db.supplierPayments.push(payRecord);

    selectedSupplier.totalPayable = Math.max(0, (selectedSupplier.totalPayable || 0) - amt);
    onUpdate();
    queueOfflineOperation("supplier", "supplier_transactions", {
      kind: "payment",
      payment: { supplierId: selectedSupplier.id, supplierName: selectedSupplier.name, amount: amt, method: paymentForm.method, invoiceRef: payRecord.invoiceRef, notes: payRecord.notes },
    }).catch(() => {});
    setIsPaymentModalOpen(false);
    setPaymentForm({ amount: 0, method: "UPI", invoiceRef: "", notes: "" });
    toast(`Payment of ${inr(amt)} recorded for ${selectedSupplier.name}`, "green");
  };

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card">
          <h3>Total Supplier Payables (Dena Baaki)</h3>
          <div className="big red">{inr(totalPayableAll)}</div>
          <div className="foot">Outstanding across all distributors</div>
        </div>
        <div className="card">
          <h3>Registered Suppliers</h3>
          <div className="big blue">{db.suppliers.length}</div>
          <div className="foot">Mobile, DLR &amp; Accessory Vendors</div>
        </div>
        <div className="card">
          <h3>Suppliers with Balance Due</h3>
          <div className="big amber">
            {db.suppliers.filter((s) => (s.totalPayable || 0) > 0).length}
          </div>
          <div className="foot">Needs settlement</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Supplier &amp; Distributor Khata</h2>
          <button className="btn primary sm" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={14} /> Add New Supplier / Distributor
          </button>
        </div>

        <div className="searchbar">
          <input
            placeholder="Search by supplier name, mobile, or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          {filteredSuppliers.length === 0 ? (
            <div className="empty">No suppliers found. Click "Add New Supplier" to register.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Supplier / Distributor</th>
                  <th>Category</th>
                  <th>Contact</th>
                  <th>Pending Payable (Dena Hai)</th>
                  <th>Repayment Plan</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s) => {
                  const hasDue = (s.totalPayable || 0) > 0;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b className="truncate" title={s.name}>{s.name}</b>
                        {s.address && <div className="hint">{s.address}</div>}
                      </td>
                      <td>
                        <span className="badge none">{s.category}</span>
                      </td>
                      <td>
                        {s.phone || "—"}
                        {s.gstin && <div className="hint">GST: {s.gstin}</div>}
                      </td>
                      <td style={{ fontWeight: 800, color: hasDue ? "var(--red)" : "var(--green)" }}>
                        {inr(s.totalPayable || 0)}
                      </td>
                      <td style={{ minWidth: "150px" }}>
                        {hasDue ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <select
                              value={s.repaymentFrequency || "Monthly"}
                              onChange={(e) => {
                                s.repaymentFrequency = e.target.value as any;
                                onUpdate();
                              }}
                              style={{ fontSize: "11px", padding: "3px 4px" }}
                            >
                              <option>Weekly</option>
                              <option>Half-Monthly</option>
                              <option>Monthly</option>
                              <option>One-Time</option>
                            </select>
                            <input
                              type="date"
                              value={s.nextRepaymentDueDate || ""}
                              onChange={(e) => {
                                s.nextRepaymentDueDate = e.target.value;
                                onUpdate();
                              }}
                              style={{ fontSize: "11px", padding: "3px 4px" }}
                            />
                          </div>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${hasDue ? "due" : "paid"}`}>
                          {hasDue ? "PAYABLE PENDING" : "ALL SETTLED"}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button
                          className="btn sm primary"
                          onClick={() => {
                            setSelectedSupplier(s);
                            setPaymentForm({ amount: s.totalPayable || 0, method: "UPI", invoiceRef: "", notes: "" });
                            setIsPaymentModalOpen(true);
                          }}
                        >
                          <DollarSign size={12} /> Pay Supplier
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent Payments Section */}
      <div className="section">
        <div className="section-head">
          <h2>Recent Supplier Payment History</h2>
        </div>
        <div className="table-wrap">
          {(!db.supplierPayments || db.supplierPayments.length === 0) ? (
            <div className="empty">No supplier payments logged yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Amount Paid</th>
                  <th>Payment Mode</th>
                  <th>Bill / Invoice Ref</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {db.supplierPayments
                  .slice(-10)
                  .reverse()
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.date}</td>
                      <td><b>{p.supplierName}</b></td>
                      <td style={{ fontWeight: 700, color: "var(--green)" }}>{inr(p.amount)}</td>
                      <td><span className="badge ok">{p.method}</span></td>
                      <td>{p.invoiceRef || "—"}</td>
                      <td>{p.notes || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal: Add Supplier */}
      {isAddModalOpen && (
        <div className="overlay show">
          <div className="modal">
            <div className="modal-head">
              <h3>Register New Supplier / Distributor</h3>
              <button onClick={() => setIsAddModalOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddSupplier}>
              <div className="formgrid">
                <div className="field">
                  <label>Supplier / Agency Name <span className="req">*</span></label>
                  <input
                    value={newSupplier.name}
                    onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                    placeholder="e.g. Jio Telelink Agency / Balaji Mobile Wholesale"
                    required
                  />
                </div>
                <div className="field">
                  <label>Category</label>
                  <select
                    value={newSupplier.category}
                    onChange={(e) => setNewSupplier({ ...newSupplier, category: e.target.value as any })}
                  >
                    <option>Mobile Distributor</option>
                    <option>SIM &amp; LAPU DLR</option>
                    <option>Spare Parts</option>
                    <option>Accessories</option>
                    <option>General</option>
                  </select>
                </div>
                <div className="field">
                  <label>Phone / WhatsApp Number</label>
                  <input
                    value={newSupplier.phone}
                    onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                    placeholder="Distributor contact"
                  />
                </div>
                <div className="field">
                  <label>Opening Payable Balance (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newSupplier.openingPayable || ""}
                    onChange={(e) => setNewSupplier({ ...newSupplier, openingPayable: Number(e.target.value) })}
                    placeholder="0 if all settled"
                  />
                </div>
                <div className="field full">
                  <label>Address / Wholesale Market</label>
                  <input
                    value={newSupplier.address}
                    onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                    placeholder="Shop/Office Address"
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn primary">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Pay Supplier */}
      {isPaymentModalOpen && selectedSupplier && (
        <div className="overlay show">
          <div className="modal">
            <div className="modal-head">
              <h3>Record Payment to {selectedSupplier.name}</h3>
              <button onClick={() => setIsPaymentModalOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleRecordPayment}>
              <div className="kv" style={{ marginBottom: "14px" }}>
                <span>Current Total Payable</span>
                <b style={{ color: "var(--red)", fontSize: "16px" }}>{inr(selectedSupplier.totalPayable || 0)}</b>
              </div>
              <div className="formgrid">
                <div className="field">
                  <label>Payment Amount (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentForm.amount || ""}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Payment Method</label>
                  <select
                    value={paymentForm.method}
                    onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value as any })}
                  >
                    <option>UPI</option>
                    <option>Bank Transfer</option>
                    <option>Cash</option>
                    <option>Cheque</option>
                  </select>
                </div>
                <div className="field">
                  <label>Bill / Purchase Invoice Ref</label>
                  <input
                    value={paymentForm.invoiceRef}
                    onChange={(e) => setPaymentForm({ ...paymentForm, invoiceRef: e.target.value })}
                    placeholder="e.g. Inv #8492"
                  />
                </div>
                <div className="field">
                  <label>Payment Remarks / UTR</label>
                  <input
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                    placeholder="e.g. Paid via Google Pay UTR 12345"
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsPaymentModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn success">
                  <CheckCircle2 size={14} /> Confirm &amp; Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
