import React, { useState } from "react";
import { Landmark, CheckCircle2, AlertCircle, DollarSign, Search, Calendar, Building, CreditCard } from "lucide-react";
import { Database, Sale, MobileFinanceDetails } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";

interface FinanceTrackerViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, kind?: string) => void;
  onViewInvoice: (sale: Sale) => void;
}

export const FinanceTrackerView: React.FC<FinanceTrackerViewProps> = ({
  db,
  onUpdate,
  toast,
  onViewInvoice,
}) => {
  const [filterCompany, setFilterCompany] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [settlementModalSale, setSettlementModalSale] = useState<Sale | null>(null);
  const [utrInput, setUtrInput] = useState<string>("");
  const [settleDateInput, setSettleDateInput] = useState<string>(todayStr());

  const financeSales = db.sales.filter((s) => s.isFinance && s.financeDetails);

  const totalFinancedVolume = financeSales.reduce(
    (a, s) => a + (s.financeDetails?.loanAmount || 0),
    0
  );
  const pendingBankSettlements = financeSales
    .filter((s) => s.financeDetails?.payoutStatus === "Pending Bank Settlement")
    .reduce((a, s) => a + (s.financeDetails?.netBankReceivable || 0), 0);
  const settledBankTotal = financeSales
    .filter((s) => s.financeDetails?.payoutStatus === "Settled in Bank")
    .reduce((a, s) => a + (s.financeDetails?.netBankReceivable || 0), 0);

  const filteredSales = financeSales.filter((s) => {
    const f = s.financeDetails!;
    if (filterCompany !== "All" && f.company !== filterCompany) return false;
    if (filterStatus !== "All" && f.payoutStatus !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        s.invoiceNo.toLowerCase().includes(q) ||
        (s.customer?.name || "").toLowerCase().includes(q) ||
        (s.customer?.phone || "").toLowerCase().includes(q) ||
        (f.loanAccountNo || "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handleConfirmSettlement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlementModalSale || !settlementModalSale.financeDetails) return;

    settlementModalSale.financeDetails.payoutStatus = "Settled in Bank";
    settlementModalSale.financeDetails.settlementDate = settleDateInput;
    settlementModalSale.financeDetails.utrRef = utrInput.trim() || `BANK-UTR-${Date.now().toString().slice(-6)}`;

    onUpdate();
    setSettlementModalSale(null);
    setUtrInput("");
    toast(`Payout of ${inr(settlementModalSale.financeDetails.netBankReceivable)} marked as Settled in Bank!`, "green");
  };

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card">
          <h3>Total Financed Phone Sales</h3>
          <div className="big blue">{inr(totalFinancedVolume)}</div>
          <div className="foot">{financeSales.length} phones sold on 0% EMI</div>
        </div>
        <div className="card accent">
          <h3>Pending Bank Settlement (Fasa Hua Paisa)</h3>
          <div className="big red">{inr(pendingBankSettlements)}</div>
          <div className="foot">
            {financeSales.filter((s) => s.financeDetails?.payoutStatus === "Pending Bank Settlement").length} loans awaiting bank deposit
          </div>
        </div>
        <div className="card">
          <h3>Settled in Bank Account</h3>
          <div className="big green">{inr(settledBankTotal)}</div>
          <div className="foot">Successfully cleared into store bank</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Mobile Finance &amp; EMI Payout Tracker (Bajaj / TVS / Home Credit / HDB)</h2>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <input
              placeholder="Search by invoice, customer name, mobile or loan account..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: "8px" }}
            />
          </div>
          <div>
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid var(--line)", borderRadius: "8px" }}
            >
              <option value="All">All Finance Companies</option>
              <option value="Bajaj Finserv">Bajaj Finserv</option>
              <option value="TVS Credit">TVS Credit</option>
              <option value="Home Credit">Home Credit</option>
              <option value="HDB Financial">HDB Financial</option>
              <option value="Samsung Finance+">Samsung Finance+</option>
              <option value="DMI Finance">DMI Finance</option>
            </select>
          </div>
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid var(--line)", borderRadius: "8px" }}
            >
              <option value="All">All Payout Statuses</option>
              <option value="Pending Bank Settlement">Pending Settlement</option>
              <option value="Settled in Bank">Settled in Bank</option>
              <option value="Disputed / Clawback">Disputed</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          {filteredSales.length === 0 ? (
            <div className="empty">No mobile finance sales found matching current filters.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Finance Co</th>
                  <th>Loan A/c / Deal ID</th>
                  <th>Down Payment (Cash/UPI)</th>
                  <th>Loan Amount</th>
                  <th>DBD / Subvention</th>
                  <th>Net Bank Receivable</th>
                  <th>Payout Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.slice().reverse().map((sale) => {
                  const fin = sale.financeDetails!;
                  const isPending = fin.payoutStatus === "Pending Bank Settlement";
                  return (
                    <tr key={sale.id}>
                      <td>
                        <button
                          className="btn sm ghost"
                          style={{ fontWeight: 800, padding: "2px 6px" }}
                          onClick={() => onViewInvoice(sale)}
                        >
                          {sale.invoiceNo}
                        </button>
                      </td>
                      <td>{sale.date}</td>
                      <td>
                        <b>{sale.customer?.name || "Walk-in"}</b>
                        <div className="hint">{sale.customer?.phone || "—"}</div>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: "var(--blue-light)",
                            color: "var(--navy)",
                            fontWeight: 800,
                          }}
                        >
                          {fin.company}
                        </span>
                      </td>
                      <td><b>{fin.loanAccountNo || "—"}</b></td>
                      <td>{inr(fin.downPayment)}</td>
                      <td>{inr(fin.loanAmount)}</td>
                      <td>{fin.dbdAmount > 0 ? `-${inr(fin.dbdAmount)}` : "₹0"}</td>
                      <td style={{ fontWeight: 800, color: isPending ? "var(--red)" : "var(--green)" }}>
                        {inr(fin.netBankReceivable)}
                      </td>
                      <td>
                        <span className={`badge ${isPending ? "due" : "paid"}`}>
                          {fin.payoutStatus}
                        </span>
                        {fin.settlementDate && (
                          <div className="hint" style={{ fontSize: "10.5px", marginTop: "2px" }}>
                            On {fin.settlementDate}
                          </div>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {isPending ? (
                          <button
                            className="btn sm success"
                            onClick={() => {
                              setSettlementModalSale(sale);
                              setSettleDateInput(todayStr());
                              setUtrInput("");
                            }}
                          >
                            <CheckCircle2 size={12} /> Mark Settled
                          </button>
                        ) : (
                          <span className="hint" style={{ fontSize: "11px" }}>
                            UTR: {fin.utrRef || "Verified"}
                          </span>
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

      {/* Modal: Mark Settled in Bank */}
      {settlementModalSale && settlementModalSale.financeDetails && (
        <div className="overlay show">
          <div className="modal">
            <div className="modal-head">
              <h3>Confirm Bank Deposit from {settlementModalSale.financeDetails.company}</h3>
              <button onClick={() => setSettlementModalSale(null)}>&times;</button>
            </div>
            <form onSubmit={handleConfirmSettlement}>
              <div className="kv" style={{ marginBottom: "8px" }}>
                <span>Invoice No:</span>
                <b>{settlementModalSale.invoiceNo}</b>
              </div>
              <div className="kv" style={{ marginBottom: "8px" }}>
                <span>Customer:</span>
                <b>{settlementModalSale.customer?.name} ({settlementModalSale.customer?.phone})</b>
              </div>
              <div className="kv" style={{ marginBottom: "8px" }}>
                <span>Loan Account No:</span>
                <b>{settlementModalSale.financeDetails.loanAccountNo}</b>
              </div>
              <div className="kv" style={{ marginBottom: "14px" }}>
                <span>Net Amount Deposited into Bank:</span>
                <b style={{ color: "var(--green)", fontSize: "16px" }}>
                  {inr(settlementModalSale.financeDetails.netBankReceivable)}
                </b>
              </div>

              <div className="formgrid">
                <div className="field">
                  <label>Bank Settlement Date <span className="req">*</span></label>
                  <input
                    type="date"
                    value={settleDateInput}
                    onChange={(e) => setSettleDateInput(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Bank UTR / Transaction Ref</label>
                  <input
                    placeholder="e.g. UTR #984920492"
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setSettlementModalSale(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn success">
                  <CheckCircle2 size={14} /> Confirm Settlement in Bank
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
