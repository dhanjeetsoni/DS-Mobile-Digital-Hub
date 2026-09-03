import React, { useState } from "react";
import { PlusCircle, CheckCircle2, Trash2, Calendar } from "lucide-react";
import { Database, Expense } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, uid } from "../utils/fifoEngine";

interface ExtraIncomeViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

const INCOME_CATEGORIES = [
  "Old Box / Scrap Sold",
  "Commission Received",
  "Shelf / Space Rent Received",
  "Recharge / Bill Payment Commission",
  "Old Device Buyback Resale",
  "Miscellaneous / Other Income",
];

export const ExtraIncomeView: React.FC<ExtraIncomeViewProps> = ({ db, onUpdate, toast }) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const [incomeDate, setIncomeDate] = useState(todayStr());
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const extraIncome = db.extraIncome || [];
  const totalExtraIncome = extraIncome.reduce((a, e) => a + e.amount, 0);
  const thisMonthIncome = extraIncome
    .filter((e) => e.date.startsWith(todayStr().slice(0, 7)))
    .reduce((a, e) => a + e.amount, 0);
  const cashInHandExtra = extraIncome.filter((e) => e.method === "Cash").reduce((a, e) => a + e.amount, 0);

  const handleAddIncome = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      toast("Sahi income amount daalein", "red");
      return;
    }

    const newIncome: Expense = {
      id: uid("inc_extra"),
      date: incomeDate,
      category,
      description: description || category,
      amount,
      method: paymentMethod,
    };

    if (!db.extraIncome) db.extraIncome = [];
    db.extraIncome.push(newIncome);
    onUpdate();
    toast(`Recorded extra income: ${inr(amount)} — ${category}`, "green");
    setIsAddModalOpen(false);
    setDescription("");
    setAmount(0);
  };

  const handleDeleteIncome = (id: string) => {
    if (confirm("Is income record ko delete karein?")) {
      db.extraIncome = (db.extraIncome || []).filter((e) => e.id !== id);
      onUpdate();
      toast("Income record delete ho gaya", "amber");
    }
  };

  const filteredIncome = extraIncome.filter((e) => {
    if (categoryFilter !== "ALL" && e.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (e.description || "").toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q) ||
        e.date.includes(q)
      );
    }
    return true;
  });

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Extra Income</h3>
          <div className="big green">{inr(totalExtraIncome)}</div>
          <div className="foot">{extraIncome.length} Income Entries Recorded</div>
        </div>
        <div className="card">
          <h3>This Month ({todayStr().slice(0, 7)})</h3>
          <div className="big green">{inr(thisMonthIncome)}</div>
          <div className="foot">Current billing cycle</div>
        </div>
        <div className="card">
          <h3>Added to Counter Cash</h3>
          <div className="big">{inr(cashInHandExtra)}</div>
          <div className="foot">Included in Daily Galla cash-in-hand</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>➕ Extra / Miscellaneous Income</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Log any money that comes in outside a normal POS sale — scrap, commission, rent, etc.
            </span>
          </div>
          <button className="btn primary sm" onClick={() => setIsAddModalOpen(true)}>
            <PlusCircle size={14} /> + Add Extra Income
          </button>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: "220px", padding: "6px 10px" }}>
            <option value="ALL">All Income Categories</option>
            {INCOME_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <div style={{ flex: 1 }}>
            <input placeholder="Search by description, date..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ padding: "6px 12px" }} />
          </div>
        </div>

        <div className="table-wrap">
          {filteredIncome.length === 0 ? (
            <div className="empty">No extra income logged yet. Click above to add one.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Payment Mode</th>
                  <th>Amount (₹)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncome.slice().reverse().map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td><span className="badge info">{e.category || "General"}</span></td>
                    <td><b>{e.description}</b></td>
                    <td><span className="badge ok">{e.method}</span></td>
                    <td><b style={{ color: "var(--green)" }}>{inr(e.amount)}</b></td>
                    <td>
                      <button className="btn sm danger" onClick={() => handleDeleteIncome(e.id)}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {isAddModalOpen && (
        <div className="overlay">
          <div className="modal">
            <div className="modal-head">
              <h3>➕ Record Extra Income</h3>
              <button onClick={() => setIsAddModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleAddIncome}>
              <div className="formgrid">
                <div className="field full">
                  <label>Income Category <span className="req">*</span></label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                    {INCOME_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label><Calendar size={12} /> Date</label>
                  <input type="date" value={incomeDate} onChange={(e) => setIncomeDate(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Amount (₹) <span className="req">*</span></label>
                  <input type="number" min="1" step="1" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="0" required />
                </div>
                <div className="field full">
                  <label>Received Via (Payment Method)</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option>Cash (Added to Counter Galla)</option>
                    <option>UPI / Online Transfer</option>
                    <option>Bank Account / Cheque</option>
                  </select>
                </div>
                <div className="field full">
                  <label>Description / Note</label>
                  <input placeholder="e.g. Sold old cardboard boxes to scrap dealer" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn primary"><CheckCircle2 size={15} /> Save Income</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
