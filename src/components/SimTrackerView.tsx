import React, { useState } from "react";
import { Radio, Plus, CheckCircle2, DollarSign, RefreshCw, Smartphone, TrendingUp, AlertCircle } from "lucide-react";
import { Database, SIMActivation, LapuWalletRecord } from "../types";
import { inr } from "../utils/indianCurrency";
import { uid, todayStr } from "../utils/fifoEngine";

interface SimTrackerViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, kind?: string) => void;
}

export const SimTrackerView: React.FC<SimTrackerViewProps> = ({ db, onUpdate, toast }) => {
  const [activeTab, setActiveTab] = useState<"activations" | "lapu">("activations");
  const [isAddSimModalOpen, setIsAddSimModalOpen] = useState(false);
  const [isAddLapuModalOpen, setIsAddLapuModalOpen] = useState(false);

  // Form states
  const [simForm, setSimForm] = useState({
    customerName: "",
    customerPhone: "",
    simNumber: "",
    operator: "Jio" as const,
    type: "New SIM" as const,
    frcPlan: "₹299 (1.5GB/Day)",
    frcAmount: 299,
    targetCommission: 120,
    distributorName: "Jio Telelink Agency",
    commissionStatus: "Pending from DLR" as const,
    notes: "",
  });

  const [lapuForm, setLapuForm] = useState({
    operator: "Airtel Mitra" as const,
    openingBalance: 0,
    topupAdded: 0,
    rechargesDone: 0,
    actualBalance: 0,
    notes: "",
  });

  const totalSimsAll = db.simActivations.length;
  const pendingCommissions = db.simActivations
    .filter((s) => s.commissionStatus === "Pending from DLR")
    .reduce((a, s) => a + (s.targetCommission || 0), 0);
  const totalEarnedCommissions = db.simActivations
    .filter((s) => s.commissionStatus === "Received" || s.commissionStatus === "Deducted / Settled")
    .reduce((a, s) => a + (s.targetCommission || 0), 0);

  const handleAddSim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simForm.customerName.trim() || !simForm.customerPhone.trim()) {
      toast("Customer ka naam aur mobile number daalna zaroori hai", "red");
      return;
    }

    const actNo = `SIM-${String(db.simSeq || 1).padStart(5, "0")}`;
    db.simSeq = (db.simSeq || 1) + 1;

    const newSim: SIMActivation = {
      id: uid("sim"),
      actNo,
      date: todayStr(),
      customerName: simForm.customerName.trim(),
      customerPhone: simForm.customerPhone.trim(),
      simNumber: simForm.simNumber.trim(),
      operator: simForm.operator,
      type: simForm.type,
      frcPlan: simForm.frcPlan,
      frcAmount: Number(simForm.frcAmount) || 0,
      targetCommission: Number(simForm.targetCommission) || 0,
      distributorName: simForm.distributorName.trim(),
      commissionStatus: simForm.commissionStatus,
      notes: simForm.notes.trim(),
    };

    db.simActivations.push(newSim);
    onUpdate();
    setIsAddSimModalOpen(false);
    setSimForm({
      customerName: "",
      customerPhone: "",
      simNumber: "",
      operator: "Jio",
      type: "New SIM",
      frcPlan: "₹299 (1.5GB/Day)",
      frcAmount: 299,
      targetCommission: 120,
      distributorName: "Jio Telelink Agency",
      commissionStatus: "Pending from DLR",
      notes: "",
    });
    toast(`SIM Activation ${actNo} recorded!`, "green");
  };

  const handleMarkCommissionReceived = (sim: SIMActivation) => {
    sim.commissionStatus = "Received";
    sim.commissionReceivedDate = todayStr();
    onUpdate();
    toast(`Commission of ${inr(sim.targetCommission)} marked as Received for ${sim.customerName}`, "green");
  };

  const handleAddLapuReconciliation = (e: React.FormEvent) => {
    e.preventDefault();
    const open = Number(lapuForm.openingBalance) || 0;
    const topup = Number(lapuForm.topupAdded) || 0;
    const recharges = Number(lapuForm.rechargesDone) || 0;
    const actual = Number(lapuForm.actualBalance) || 0;
    const expected = open + topup - recharges;
    const diff = actual - expected;

    const lapuRec: LapuWalletRecord = {
      id: uid("lapu"),
      date: todayStr(),
      operator: lapuForm.operator,
      openingBalance: open,
      topupAdded: topup,
      rechargesDone: recharges,
      expectedBalance: expected,
      actualBalance: actual,
      difference: diff,
      notes: lapuForm.notes.trim(),
    };

    if (!db.lapuWallets) db.lapuWallets = [];
    db.lapuWallets.push(lapuRec);
    onUpdate();
    setIsAddLapuModalOpen(false);
    setLapuForm({
      operator: "Airtel Mitra",
      openingBalance: actual,
      topupAdded: 0,
      rechargesDone: 0,
      actualBalance: 0,
      notes: "",
    });
    toast(`Lapu Wallet reconciled for ${lapuForm.operator}`, diff === 0 ? "green" : "amber");
  };

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card">
          <h3>Total SIMs Activated</h3>
          <div className="big blue">{totalSimsAll} SIMs</div>
          <div className="foot">New &amp; MNP Portings</div>
        </div>
        <div className="card">
          <h3>Pending DLR Commissions</h3>
          <div className="big amber">{inr(pendingCommissions)}</div>
          <div className="foot">
            {db.simActivations.filter((s) => s.commissionStatus === "Pending from DLR").length} SIMs pending payment from distributor
          </div>
        </div>
        <div className="card accent">
          <h3>Total Earned Commissions</h3>
          <div className="big green">{inr(totalEarnedCommissions)}</div>
          <div className="foot">Settled into shop profits</div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: "14px" }}>
        <button
          className={activeTab === "activations" ? "active" : ""}
          onClick={() => setActiveTab("activations")}
        >
          📶 SIM Activations &amp; DLR Commission Log
        </button>
        <button
          className={activeTab === "lapu" ? "active" : ""}
          onClick={() => setActiveTab("lapu")}
        >
          💳 Lapu Wallet Reconciler (Mitra / JioPOS)
        </button>
      </div>

      {activeTab === "activations" ? (
        <div className="section">
          <div className="section-head">
            <h2>SIM Card Activations &amp; Portings (MNP)</h2>
            <button className="btn primary sm" onClick={() => setIsAddSimModalOpen(true)}>
              <Plus size={14} /> Log New SIM / MNP Activation
            </button>
          </div>

          <div className="table-wrap">
            {db.simActivations.length === 0 ? (
              <div className="empty">No SIM activations logged yet. Click above to add your first activation.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Act #</th>
                    <th>Date</th>
                    <th>Customer Name</th>
                    <th>Mobile No</th>
                    <th>Operator</th>
                    <th>Type</th>
                    <th>FRC Plan</th>
                    <th>Target Commission</th>
                    <th>Distributor / DLR</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {db.simActivations
                    .slice()
                    .reverse()
                    .map((s) => {
                      const isPending = s.commissionStatus === "Pending from DLR";
                      return (
                        <tr key={s.id}>
                          <td><b>{s.actNo}</b></td>
                          <td>{s.date}</td>
                          <td><b className="truncate" title={s.customerName}>{s.customerName}</b></td>
                          <td>{s.customerPhone}</td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background:
                                  s.operator === "Jio"
                                    ? "var(--blue-light)"
                                    : s.operator === "Airtel"
                                    ? "var(--red-light)"
                                    : "var(--amber-light)",
                                color:
                                  s.operator === "Jio"
                                    ? "var(--blue)"
                                    : s.operator === "Airtel"
                                    ? "var(--red)"
                                    : "var(--amber)",
                                fontWeight: 800,
                              }}
                            >
                              {s.operator}
                            </span>
                          </td>
                          <td>{s.type}</td>
                          <td>{s.frcPlan}</td>
                          <td style={{ fontWeight: 700, color: "var(--green)" }}>
                            {inr(s.targetCommission)}
                          </td>
                          <td>{s.distributorName}</td>
                          <td>
                            <span className={`badge ${isPending ? "due" : "paid"}`}>
                              {s.commissionStatus}
                            </span>
                          </td>
                          <td>
                            {isPending && (
                              <button
                                className="btn sm success"
                                onClick={() => handleMarkCommissionReceived(s)}
                              >
                                <CheckCircle2 size={12} /> Mark Received
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="section">
          <div className="section-head">
            <h2>Recharge Lapu Wallet Daily Balance Reconciler</h2>
            <button className="btn primary sm" onClick={() => setIsAddLapuModalOpen(true)}>
              <Plus size={14} /> Close Daily Lapu Balance
            </button>
          </div>

          <p className="hint" style={{ marginBottom: "14px" }}>
            Verify opening balance, top-ups, and completed recharges for Airtel Mitra, JioPOS Plus, and Vi Smart Lapu wallets each day.
          </p>

          <div className="table-wrap">
            {(!db.lapuWallets || db.lapuWallets.length === 0) ? (
              <div className="empty">No Lapu wallet records found. Click above to record daily closing balance.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Lapu Wallet</th>
                    <th>Opening Bal</th>
                    <th>Topup Added</th>
                    <th>Recharges Done</th>
                    <th>Expected Closing</th>
                    <th>Actual Closing</th>
                    <th>Difference</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {db.lapuWallets
                    .slice()
                    .reverse()
                    .map((l) => (
                      <tr key={l.id}>
                        <td>{l.date}</td>
                        <td><b>{l.operator}</b></td>
                        <td>{inr(l.openingBalance)}</td>
                        <td>+{inr(l.topupAdded)}</td>
                        <td>-{inr(l.rechargesDone)}</td>
                        <td><b>{inr(l.expectedBalance)}</b></td>
                        <td style={{ fontWeight: 800 }}>{inr(l.actualBalance)}</td>
                        <td
                          style={{
                            fontWeight: 800,
                            color: l.difference === 0 ? "var(--green)" : "var(--red)",
                          }}
                        >
                          {l.difference === 0 ? "✔ Match (₹0)" : `${l.difference > 0 ? "+" : ""}${inr(l.difference)}`}
                        </td>
                        <td>{l.notes || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal: New SIM Activation */}
      {isAddSimModalOpen && (
        <div className="overlay show">
          <div className="modal">
            <div className="modal-head">
              <h3>Log SIM Card Activation / MNP Port</h3>
              <button onClick={() => setIsAddSimModalOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddSim}>
              <div className="formgrid">
                <div className="field">
                  <label>Customer Full Name <span className="req">*</span></label>
                  <input
                    value={simForm.customerName}
                    onChange={(e) => setSimForm({ ...simForm, customerName: e.target.value })}
                    placeholder="Customer name"
                    required
                  />
                </div>
                <div className="field">
                  <label>Mobile Number Activated <span className="req">*</span></label>
                  <input
                    value={simForm.customerPhone}
                    onChange={(e) => setSimForm({ ...simForm, customerPhone: e.target.value })}
                    placeholder="10-digit number"
                    required
                  />
                </div>
                <div className="field">
                  <label>Telecom Operator</label>
                  <select
                    value={simForm.operator}
                    onChange={(e) => setSimForm({ ...simForm, operator: e.target.value as any })}
                  >
                    <option>Jio</option>
                    <option>Airtel</option>
                    <option>Vi</option>
                    <option>BSNL</option>
                  </select>
                </div>
                <div className="field">
                  <label>Activation Type</label>
                  <select
                    value={simForm.type}
                    onChange={(e) => setSimForm({ ...simForm, type: e.target.value as any })}
                  >
                    <option>New SIM</option>
                    <option>MNP (Port)</option>
                  </select>
                </div>
                <div className="field">
                  <label>FRC Plan Selected</label>
                  <input
                    value={simForm.frcPlan}
                    onChange={(e) => setSimForm({ ...simForm, frcPlan: e.target.value })}
                    placeholder="e.g. ₹299 (1.5GB/Day) or ₹239"
                  />
                </div>
                <div className="field">
                  <label>Target Commission Expected (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={simForm.targetCommission || ""}
                    onChange={(e) => setSimForm({ ...simForm, targetCommission: Number(e.target.value) })}
                    placeholder="e.g. 150"
                    required
                  />
                </div>
                <div className="field">
                  <label>SIM Card Number (20-Digit / Last 4)</label>
                  <input
                    value={simForm.simNumber}
                    onChange={(e) => setSimForm({ ...simForm, simNumber: e.target.value })}
                    placeholder="SIM Barcode or Last 4 digits"
                  />
                </div>
                <div className="field">
                  <label>Distributor / DLR Agency</label>
                  <input
                    value={simForm.distributorName}
                    onChange={(e) => setSimForm({ ...simForm, distributorName: e.target.value })}
                    placeholder="e.g. Jio Telelink Agency"
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsAddSimModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn primary">Save SIM Activation</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Lapu Wallet Reconciliation */}
      {isAddLapuModalOpen && (
        <div className="overlay show">
          <div className="modal">
            <div className="modal-head">
              <h3>Daily Lapu Wallet Reconciler</h3>
              <button onClick={() => setIsAddLapuModalOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddLapuReconciliation}>
              <div className="formgrid">
                <div className="field full">
                  <label>Lapu Wallet App</label>
                  <select
                    value={lapuForm.operator}
                    onChange={(e) => setLapuForm({ ...lapuForm, operator: e.target.value as any })}
                  >
                    <option>Airtel Mitra</option>
                    <option>JioPOS Plus</option>
                    <option>Vi Smart</option>
                    <option>BSNL Pay</option>
                  </select>
                </div>
                <div className="field">
                  <label>Opening Lapu Balance (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={lapuForm.openingBalance || ""}
                    onChange={(e) => setLapuForm({ ...lapuForm, openingBalance: Number(e.target.value) })}
                    placeholder="Morning starting balance"
                  />
                </div>
                <div className="field">
                  <label>Topup / Auto-Refill Added (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={lapuForm.topupAdded || ""}
                    onChange={(e) => setLapuForm({ ...lapuForm, topupAdded: Number(e.target.value) })}
                    placeholder="Added during day"
                  />
                </div>
                <div className="field">
                  <label>Total Customer Recharges Done (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={lapuForm.rechargesDone || ""}
                    onChange={(e) => setLapuForm({ ...lapuForm, rechargesDone: Number(e.target.value) })}
                    placeholder="Sum of recharges"
                  />
                </div>
                <div className="field">
                  <label>Actual Closing Lapu Balance (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    step="0.01"
                    value={lapuForm.actualBalance || ""}
                    onChange={(e) => setLapuForm({ ...lapuForm, actualBalance: Number(e.target.value) })}
                    placeholder="Current wallet balance"
                    required
                  />
                </div>
                <div className="field full">
                  <label>Notes</label>
                  <input
                    value={lapuForm.notes}
                    onChange={(e) => setLapuForm({ ...lapuForm, notes: e.target.value })}
                    placeholder="Remarks / Ref"
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsAddLapuModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn success">Save &amp; Verify Lapu Balance</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
