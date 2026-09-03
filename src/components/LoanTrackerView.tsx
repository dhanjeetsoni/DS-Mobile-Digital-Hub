import React, { useMemo, useState } from "react";
import {
  Percent,
  Plus,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Landmark,
} from "lucide-react";
import { Database, MoneyLender, LenderTransaction } from "../types";
import { inr } from "../utils/indianCurrency";
import { uid, todayStr } from "../utils/fifoEngine";
import { getBusinessInsights, BusinessInsightsSummary } from "../utils/aiInsights";

interface LoanTrackerViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

const thisMonthKey = todayStr().slice(0, 7); // YYYY-MM

export const LoanTrackerView: React.FC<LoanTrackerViewProps> = ({ db, onUpdate, toast }) => {
  const lenders = db.moneyLenders || [];
  const txns = db.lenderTransactions || [];

  const [isLenderModalOpen, setIsLenderModalOpen] = useState(false);
  const [isTxnModalOpen, setIsTxnModalOpen] = useState(false);
  const [activeLender, setActiveLender] = useState<MoneyLender | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiError, setAiError] = useState("");

  const [lenderForm, setLenderForm] = useState({
    name: "",
    phone: "",
    principalAmount: 0,
    monthlyInterestAmount: 0,
    interestDueDay: 1,
    startDate: todayStr(),
    notes: "",
  });

  const [txnForm, setTxnForm] = useState({
    type: "Interest Paid" as LenderTransaction["type"],
    amount: 0,
    method: "Cash" as LenderTransaction["method"],
    date: todayStr(),
    notes: "",
  });

  // ---- Derived totals ----
  const activeLenders = lenders.filter((l) => l.status === "Active");
  const totalPrincipalOutstanding = activeLenders.reduce((a, l) => a + (l.principalAmount || 0), 0);
  const totalMonthlyInterestDue = activeLenders.reduce((a, l) => a + (l.monthlyInterestAmount || 0), 0);

  const interestPaidThisMonth = txns
    .filter((t) => t.type === "Interest Paid" && (t.forMonth === thisMonthKey || t.date.startsWith(thisMonthKey)))
    .reduce((a, t) => a + t.amount, 0);
  const interestPendingThisMonth = Math.max(0, totalMonthlyInterestDue - interestPaidThisMonth);

  const principalRepaidLifetime = txns.filter((t) => t.type === "Principal Repayment").reduce((a, t) => a + t.amount, 0);

  // ---- Overall "total hisaab" — sales, expenses (incl. byaj interest), profit ----
  const salesThisMonth = db.sales.filter((s) => s.date.startsWith(thisMonthKey));
  const totalSalesThisMonth = salesThisMonth.reduce((a, s) => a + s.total, 0);
  const cogsThisMonth = salesThisMonth.reduce(
    (a, s) => a + s.items.reduce((sum, i) => sum + (i.cost || i.purchasePrice * i.qty || 0), 0),
    0
  );
  const shopExpensesThisMonth = (db.expenses?.shop || [])
    .filter((e) => e.date.startsWith(thisMonthKey))
    .reduce((a, e) => a + e.amount, 0);
  const otherExpensesThisMonth = (db.expenses?.other || [])
    .filter((e) => e.date.startsWith(thisMonthKey))
    .reduce((a, e) => a + e.amount, 0);
  const interestExpenseThisMonth = interestPaidThisMonth;

  const totalExpensesThisMonth = shopExpensesThisMonth + otherExpensesThisMonth + interestExpenseThisMonth;
  const profitThisMonth = totalSalesThisMonth - cogsThisMonth - totalExpensesThisMonth;

  const supplierPayableOutstanding = db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0);

  // Suggested monthly savings toward clearing muldhan: this month's interest (must-pay)
  // plus a modest 5% chip-away at the outstanding principal, on top of supplier dues.
  const suggestedPrincipalSaving = Math.round(totalPrincipalOutstanding * 0.05);
  const suggestedMonthlySavingsTarget = totalMonthlyInterestDue + suggestedPrincipalSaving;

  // ---- What's selling well / reorder suggestions (for AI + on-screen card) ----
  const topSellingProducts = useMemo(() => {
    const counts: { [productId: string]: { name: string; qty: number } } = {};
    salesThisMonth.forEach((s) =>
      s.items.forEach((i) => {
        if (!counts[i.productId]) counts[i.productId] = { name: i.name, qty: 0 };
        counts[i.productId].qty += i.qty;
      })
    );
    return Object.values(counts).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [salesThisMonth]);

  const lowStockProducts = db.products
    .filter((p) => p.stock <= p.minStock)
    .map((p) => ({ name: p.name, stock: p.stock, minStock: p.minStock }))
    .slice(0, 8);

  // ---- Handlers ----
  const handleSaveLender = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lenderForm.name.trim()) {
      toast("Lender ka naam daalein", "red");
      return;
    }
    if (lenderForm.principalAmount <= 0) {
      toast("Muldhan (principal) amount sahi bharein", "red");
      return;
    }
    const newLender: MoneyLender = {
      id: uid("lender"),
      name: lenderForm.name.trim(),
      phone: lenderForm.phone.trim(),
      principalAmount: Number(lenderForm.principalAmount) || 0,
      monthlyInterestAmount: Number(lenderForm.monthlyInterestAmount) || 0,
      interestDueDay: Number(lenderForm.interestDueDay) || 1,
      startDate: lenderForm.startDate,
      status: "Active",
      notes: lenderForm.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    if (!db.moneyLenders) db.moneyLenders = [];
    db.moneyLenders.push(newLender);
    onUpdate();
    toast(`${newLender.name} add ho gaye — ${inr(newLender.monthlyInterestAmount)}/month byaj`, "green");
    setIsLenderModalOpen(false);
    setLenderForm({ name: "", phone: "", principalAmount: 0, monthlyInterestAmount: 0, interestDueDay: 1, startDate: todayStr(), notes: "" });
  };

  const openTxnModal = (lender: MoneyLender, type: LenderTransaction["type"] = "Interest Paid") => {
    setActiveLender(lender);
    setTxnForm({ type, amount: type === "Interest Paid" ? lender.monthlyInterestAmount : 0, method: "Cash", date: todayStr(), notes: "" });
    setIsTxnModalOpen(true);
  };

  const handleSaveTxn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLender) return;
    if (txnForm.amount <= 0) {
      toast("Sahi amount daalein", "red");
      return;
    }
    const txn: LenderTransaction = {
      id: uid("ltxn"),
      lenderId: activeLender.id,
      lenderName: activeLender.name,
      date: txnForm.date,
      type: txnForm.type,
      amount: Number(txnForm.amount) || 0,
      method: txnForm.method,
      forMonth: txnForm.type === "Interest Paid" ? txnForm.date.slice(0, 7) : undefined,
      notes: txnForm.notes.trim(),
    };
    if (!db.lenderTransactions) db.lenderTransactions = [];
    db.lenderTransactions.push(txn);

    if (txnForm.type === "Principal Repayment") {
      activeLender.principalAmount = Math.max(0, (activeLender.principalAmount || 0) - txn.amount);
      if (activeLender.principalAmount === 0) activeLender.status = "Closed";
    } else if (txnForm.type === "Additional Principal Taken") {
      activeLender.principalAmount = (activeLender.principalAmount || 0) + txn.amount;
    }

    onUpdate();
    toast(`${txn.type} of ${inr(txn.amount)} recorded for ${activeLender.name}`, "green");
    setIsTxnModalOpen(false);
    setActiveLender(null);
  };

  const handleGetAiInsights = async () => {
    setAiBusy(true);
    setAiError("");
    setAiText("");
    const summary: BusinessInsightsSummary = {
      monthLabel: thisMonthKey,
      totalSalesThisMonth: Math.round(totalSalesThisMonth),
      totalExpensesThisMonth: Math.round(totalExpensesThisMonth),
      profitThisMonth: Math.round(profitThisMonth),
      totalMonthlyInterestDue: Math.round(totalMonthlyInterestDue),
      totalPrincipalOutstanding: Math.round(totalPrincipalOutstanding),
      supplierPayableOutstanding: Math.round(supplierPayableOutstanding),
      topSellingProducts,
      lowStockProducts,
    };
    try {
      const insights = await getBusinessInsights(summary);
      setAiText(insights);
    } catch (err: any) {
      setAiError(err?.message || "AI insights abhi available nahi hai. Baad me try karein.");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid cols-4" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Muldhan Outstanding</h3>
          <div className="big red">{inr(totalPrincipalOutstanding)}</div>
          <div className="foot">{activeLenders.length} Active Lender(s)</div>
        </div>
        <div className="card">
          <h3>Monthly Byaj (Interest) Due</h3>
          <div className="big amber">{inr(totalMonthlyInterestDue)}</div>
          <div className="foot">Har mahine ki {activeLenders[0]?.interestDueDay || 1} tarikh ko due</div>
        </div>
        <div className="card">
          <h3>Is Mahine Byaj Paid / Pending</h3>
          <div className="big green">{inr(interestPaidThisMonth)}</div>
          <div className="foot">
            {interestPendingThisMonth > 0 ? <span style={{ color: "var(--red)" }}>{inr(interestPendingThisMonth)} pending</span> : "Sab paid ✓"}
          </div>
        </div>
        <div className="card">
          <h3>Suggested Monthly Savings</h3>
          <div className="big blue">{inr(suggestedMonthlySavingsTarget)}</div>
          <div className="foot">Byaj + muldhan chukane ke liye</div>
        </div>
      </div>

      {/* Total Hisaab (this month) */}
      <div className="section" style={{ marginBottom: "16px" }}>
        <div className="section-head">
          <div>
            <h2><Wallet size={16} style={{ verticalAlign: "-2px" }} /> Is Mahine Ka Total Hisaab</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Sales, expenses (rent/other/byaj) aur profit — {thisMonthKey}
            </span>
          </div>
          <button className="btn sm" onClick={() => window.print()}>
            <Printer size={13} /> Print Hisaab
          </button>
        </div>

        <div id="print-area" className="grid cols-2" style={{ gap: "18px" }}>
          <div style={{ background: "var(--paper)", padding: "18px", borderRadius: "10px" }}>
            <div className="kv"><span>Total Sales (Is Mahine)</span><b>{inr(totalSalesThisMonth)}</b></div>
            <div className="kv"><span>Cost of Goods Sold</span><b>-{inr(cogsThisMonth)}</b></div>
            <div className="kv"><span>Shop Expenses (Rent, Bijli, etc.)</span><b>-{inr(shopExpensesThisMonth)}</b></div>
            <div className="kv"><span>Other Expenses</span><b>-{inr(otherExpensesThisMonth)}</b></div>
            <div className="kv"><span>Byaj (Interest) Paid</span><b>-{inr(interestExpenseThisMonth)}</b></div>
            <div className="kv" style={{ fontWeight: 800, fontSize: "15px", color: profitThisMonth >= 0 ? "var(--green)" : "var(--red)", borderTop: "2px solid var(--line)", paddingTop: "8px", marginTop: "8px" }}>
              <span>Net Profit Bacha Hua:</span>
              <b>{inr(profitThisMonth)}</b>
            </div>
          </div>

          <div style={{ background: "var(--paper)", padding: "18px", borderRadius: "10px" }}>
            <div className="kv"><span>Muldhan Outstanding (Lenders)</span><b style={{ color: "var(--red)" }}>{inr(totalPrincipalOutstanding)}</b></div>
            <div className="kv"><span>Lifetime Muldhan Repaid</span><b style={{ color: "var(--green)" }}>{inr(principalRepaidLifetime)}</b></div>
            <div className="kv"><span>Supplier / Saman Ka Baaki (Udhaar)</span><b style={{ color: "var(--red)" }}>{inr(supplierPayableOutstanding)}</b></div>
            <div className="kv" style={{ fontWeight: 800, borderTop: "2px solid var(--line)", paddingTop: "8px", marginTop: "8px" }}>
              <span>Is Mahine Bachana Hai:</span>
              <b>{inr(suggestedMonthlySavingsTarget)}</b>
            </div>
            <p className="hint" style={{ marginTop: "10px" }}>
              Byaj pehle chukayein, phir thoda-thoda muldhan bhi kam karte rahein taaki total udhaar khatam ho sake.
            </p>
          </div>
        </div>
      </div>

      {/* AI Business Insights */}
      <div className="section" style={{ marginBottom: "16px" }}>
        <div className="section-head">
          <div>
            <h2><Sparkles size={16} style={{ verticalAlign: "-2px" }} /> AI Business Insights</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Gemini AI se sales, kharcha, byaj aur reorder ka quick summary
            </span>
          </div>
          <button className="btn primary sm" onClick={handleGetAiInsights} disabled={aiBusy}>
            {aiBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {aiBusy ? "Soch raha hai…" : "Get AI Insights"}
          </button>
        </div>
        {aiError && (
          <div style={{ color: "var(--red)", fontSize: "12.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <AlertTriangle size={13} /> {aiError}
          </div>
        )}
        {aiText && (
          <div style={{ background: "var(--paper)", padding: "16px", borderRadius: "10px", whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.6 }}>
            {aiText}
          </div>
        )}
        {!aiText && !aiError && !aiBusy && (
          <p className="hint">Button dabaayein — AI aapke is mahine ke numbers dekh kar salaah dega.</p>
        )}
      </div>

      {/* Lenders List */}
      <div className="section">
        <div className="section-head">
          <div>
            <h2><Landmark size={16} style={{ verticalAlign: "-2px" }} /> Byaj Wale Lenders (Loan Ledger)</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Har lender ka muldhan, monthly byaj aur payment history
            </span>
          </div>
          <button className="btn primary sm" onClick={() => setIsLenderModalOpen(true)}>
            <Plus size={14} /> + New Lender
          </button>
        </div>

        <div className="table-wrap">
          {lenders.length === 0 ? (
            <div className="empty">Abhi tak koi lender add nahi kiya. Upar button se add karein.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lender</th>
                  <th>Muldhan (Principal)</th>
                  <th>Monthly Byaj</th>
                  <th>Due Day</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lenders.slice().reverse().map((l) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                      {l.phone && <div className="hint">{l.phone}</div>}
                    </td>
                    <td style={{ fontWeight: 800, color: "var(--red)" }}>{inr(l.principalAmount)}</td>
                    <td>{inr(l.monthlyInterestAmount)}/mo</td>
                    <td>{l.interestDueDay}</td>
                    <td>
                      <span className={`badge ${l.status === "Active" ? "amber" : "ok"}`}>{l.status}</span>
                    </td>
                    <td>
                      {l.status === "Active" && (
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button className="btn sm" onClick={() => openTxnModal(l, "Interest Paid")}>
                            <DollarSign size={12} /> Byaj Paid
                          </button>
                          <button className="btn sm" onClick={() => openTxnModal(l, "Principal Repayment")}>
                            <TrendingDown size={12} /> Muldhan Repay
                          </button>
                          <button className="btn sm" onClick={() => openTxnModal(l, "Additional Principal Taken")}>
                            <TrendingUp size={12} /> Aur Liya
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Transaction History */}
      <div className="section" style={{ marginTop: "16px" }}>
        <div className="section-head">
          <h2>Transaction History</h2>
        </div>
        <div className="table-wrap">
          {txns.length === 0 ? (
            <div className="empty">Koi transaction record nahi hai.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Lender</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {txns.slice().reverse().slice(0, 50).map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td>{t.lenderName}</td>
                    <td>
                      <span className={`badge ${t.type === "Interest Paid" ? "info" : t.type === "Principal Repayment" ? "ok" : "amber"}`}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ fontWeight: 800 }}>{inr(t.amount)}</td>
                    <td>{t.method}</td>
                    <td className="hint">{t.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Lender Modal */}
      {isLenderModalOpen && (
        <div className="overlay">
          <div className="modal wide">
            <div className="modal-head">
              <h3><Percent size={16} /> Naya Lender / Byaj Add Karein</h3>
              <button onClick={() => setIsLenderModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveLender}>
              <div className="formgrid">
                <div className="field">
                  <label>Lender Ka Naam <span className="req">*</span></label>
                  <input value={lenderForm.name} onChange={(e) => setLenderForm({ ...lenderForm, name: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={lenderForm.phone} onChange={(e) => setLenderForm({ ...lenderForm, phone: e.target.value })} />
                </div>
                <div className="field">
                  <label>Muldhan / Principal Amount (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    min="0"
                    value={lenderForm.principalAmount || ""}
                    onChange={(e) => setLenderForm({ ...lenderForm, principalAmount: Number(e.target.value) || 0 })}
                    placeholder="e.g. 250000"
                    required
                  />
                </div>
                <div className="field">
                  <label>Monthly Byaj / Interest Amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={lenderForm.monthlyInterestAmount || ""}
                    onChange={(e) => setLenderForm({ ...lenderForm, monthlyInterestAmount: Number(e.target.value) || 0 })}
                    placeholder="e.g. 5000"
                  />
                </div>
                <div className="field">
                  <label>Interest Due Day (1-28)</label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={lenderForm.interestDueDay}
                    onChange={(e) => setLenderForm({ ...lenderForm, interestDueDay: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="field">
                  <label>Start Date</label>
                  <input type="date" value={lenderForm.startDate} onChange={(e) => setLenderForm({ ...lenderForm, startDate: e.target.value })} />
                </div>
                <div className="field full">
                  <label>Notes</label>
                  <input value={lenderForm.notes} onChange={(e) => setLenderForm({ ...lenderForm, notes: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsLenderModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn primary"><CheckCircle2 size={16} /> Save Lender</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Transaction Modal */}
      {isTxnModalOpen && activeLender && (
        <div className="overlay">
          <div className="modal">
            <div className="modal-head">
              <h3>{activeLender.name} — Record Transaction</h3>
              <button onClick={() => setIsTxnModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveTxn}>
              <div className="formgrid">
                <div className="field full">
                  <label>Transaction Type</label>
                  <select value={txnForm.type} onChange={(e) => setTxnForm({ ...txnForm, type: e.target.value as any })}>
                    <option>Interest Paid</option>
                    <option>Principal Repayment</option>
                    <option>Additional Principal Taken</option>
                  </select>
                </div>
                <div className="field">
                  <label>Amount (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    min="0"
                    value={txnForm.amount || ""}
                    onChange={(e) => setTxnForm({ ...txnForm, amount: Number(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={txnForm.date} onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Method</label>
                  <select value={txnForm.method} onChange={(e) => setTxnForm({ ...txnForm, method: e.target.value as any })}>
                    <option>Cash</option>
                    <option>UPI</option>
                    <option>Bank Transfer</option>
                  </select>
                </div>
                <div className="field full">
                  <label>Notes</label>
                  <input value={txnForm.notes} onChange={(e) => setTxnForm({ ...txnForm, notes: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsTxnModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn primary"><CheckCircle2 size={16} /> Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
