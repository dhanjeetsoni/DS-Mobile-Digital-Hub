import React, { useState } from "react";
import { User, Plus, CheckCircle2, Trash2, Calendar, DollarSign } from "lucide-react";
import { Database, Expense } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, uid } from "../utils/fifoEngine";

interface PersonalDrawingsViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

export const PersonalDrawingsView: React.FC<PersonalDrawingsViewProps> = ({
  db,
  onUpdate,
  toast,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [date, setDate] = useState(todayStr());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState("Cash");

  const personalDrawings = db.expenses?.personal || [];
  const totalDrawings = personalDrawings.reduce((a, d) => a + d.amount, 0);
  const thisMonthDrawings = personalDrawings
    .filter((d) => d.date.startsWith(todayStr().slice(0, 7)))
    .reduce((a, d) => a + d.amount, 0);

  const handleAddDrawing = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      toast("Sahi drawing amount daalein", "red");
      return;
    }

    const newDrawing: Expense = {
      id: uid("draw"),
      date,
      category: "Owner Personal Drawing",
      description: description || "Malik Kharcha (Owner Drawing)",
      amount,
      method,
    };

    if (!db.expenses) db.expenses = { shop: [], personal: [], other: [] };
    if (!db.expenses.personal) db.expenses.personal = [];

    db.expenses.personal.push(newDrawing);
    onUpdate();
    toast(`Recorded personal drawing of ${inr(amount)}`, "green");
    setIsAddModalOpen(false);

    setDescription("");
    setAmount(0);
  };

  const handleDeleteDrawing = (id: string) => {
    if (confirm("Pakka is drawing record ko delete karna hai?")) {
      db.expenses.personal = db.expenses.personal.filter((d) => d.id !== id);
      onUpdate();
      toast("Personal drawing delete ho gaya", "amber");
    }
  };

  const filteredDrawings = personalDrawings.filter((d) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (d.description || "").toLowerCase().includes(q) || d.date.includes(q);
  });

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Owner Drawings</h3>
          <div className="big purple">{inr(totalDrawings)}</div>
          <div className="foot">{personalDrawings.length} Personal Withdrawals Logged</div>
        </div>
        <div className="card">
          <h3>Drawings This Month</h3>
          <div className="big amber">{inr(thisMonthDrawings)}</div>
          <div className="foot">{todayStr().slice(0, 7)} Withdrawals</div>
        </div>
        <div className="card">
          <h3>Cash Taken from Galla</h3>
          <div className="big">
            {inr(personalDrawings.filter((d) => d.method === "Cash").reduce((a, d) => a + d.amount, 0))}
          </div>
          <div className="foot">Direct cash taken from counter</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>👤 Personal Drawings &amp; Owner Withdrawals (    / )</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Keep personal household expenses separate from shop business profits
            </span>
          </div>
          <button className="btn primary sm" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={14} /> + Record Owner Cash Drawing
          </button>
        </div>

        <div className="searchbar">
          <input
            placeholder="Search drawings by purpose, notes or date..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          {filteredDrawings.length === 0 ? (
            <div className="empty">No personal drawings recorded yet. Click above to log owner cash withdrawal.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Purpose / Reason</th>
                  <th>Payment Source</th>
                  <th>Amount (₹)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrawings.slice().reverse().map((d) => (
                  <tr key={d.id}>
                    <td>{d.date}</td>
                    <td><b>{d.description}</b></td>
                    <td>
                      <span className="badge info">{d.method}</span>
                    </td>
                    <td><b style={{ color: "var(--purple)" }}>{inr(d.amount)}</b></td>
                    <td>
                      <button
                        className="btn sm danger"
                        onClick={() => handleDeleteDrawing(d.id)}
                      >
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
              <h3>👤 Record Personal Cash Drawing</h3>
              <button onClick={() => setIsAddModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleAddDrawing}>
              <div className="formgrid">
                <div className="field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label>Amount Taken (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={amount || ""}
                    onChange={(e) => setAmount(Number(e.target.value) || 0)}
                    placeholder="0"
                    required
                  />
                </div>

                <div className="field full">
                  <label>Taken From</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option>Cash (Taken from Counter Galla)</option>
                    <option>Shop Bank Account / UPI</option>
                  </select>
                </div>

                <div className="field full">
                  <label>Purpose / Note</label>
                  <input
                    placeholder="e.g. Home groceries, child school fees, personal expense"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  <CheckCircle2 size={15} /> Save Drawing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
