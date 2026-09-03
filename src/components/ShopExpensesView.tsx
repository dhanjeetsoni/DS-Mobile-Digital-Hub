import React, { useState } from "react";
import { DollarSign, Plus, CheckCircle2, Search, Trash2, Calendar, Tag } from "lucide-react";
import { Database, Expense } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, uid } from "../utils/fifoEngine";

interface ShopExpensesViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

const EXPENSE_CATEGORIES = [
  "Electricity & Power Bill",
  "Shop Rent",
  "Staff Salary / Daily Wages",
  "Tea & Refreshments",
  "Paper, Toner & Stationery",
  "Shop Maintenance & Repairs",
  "Internet & Broadband Bill",
  "Packaging, Poly Bags & Tape",
  "Marketing & Banner Printing",
  "Miscellaneous / Other Expense",
];

export const ShopExpensesView: React.FC<ShopExpensesViewProps> = ({
  db,
  onUpdate,
  toast,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  // Form State
  const [expenseDate, setExpenseDate] = useState(todayStr());
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const shopExpenses = db.expenses?.shop || [];
  const totalShopExpenses = shopExpenses.reduce((a, e) => a + e.amount, 0);

  const thisMonthExpenses = shopExpenses
    .filter((e) => e.date.startsWith(todayStr().slice(0, 7)))
    .reduce((a, e) => a + e.amount, 0);

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      toast("Sahi expense amount daalein", "red");
      return;
    }

    const newExpense: Expense = {
      id: uid("exp_shop"),
      date: expenseDate,
      category,
      description: description || category,
      amount,
      method: paymentMethod,
    };

    if (!db.expenses) {
      db.expenses = { shop: [], personal: [], other: [] };
    }
    if (!db.expenses.shop) {
      db.expenses.shop = [];
    }

    db.expenses.shop.push(newExpense);
    onUpdate();
    toast(`Recorded expense: ${inr(amount)} for ${category}`, "green");
    setIsAddModalOpen(false);

    // Reset
    setDescription("");
    setAmount(0);
  };

  const handleDeleteExpense = (id: string) => {
    if (confirm("Pakka is expense record ko delete karna hai?")) {
      db.expenses.shop = db.expenses.shop.filter((e) => e.id !== id);
      onUpdate();
      toast("Expense record delete ho gaya", "amber");
    }
  };

  const filteredExpenses = shopExpenses.filter((e) => {
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
      {/* 3 Metric Cards */}
      <div className="grid cols-3" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Shop Expenses</h3>
          <div className="big red">{inr(totalShopExpenses)}</div>
          <div className="foot">{shopExpenses.length} Expense Logs Recorded</div>
        </div>
        <div className="card">
          <h3>Expenses This Month ({todayStr().slice(0, 7)})</h3>
          <div className="big amber">{inr(thisMonthExpenses)}</div>
          <div className="foot">Current billing cycle</div>
        </div>
        <div className="card">
          <h3>Paid from Counter Cash</h3>
          <div className="big">
            {inr(shopExpenses.filter((e) => e.method === "Cash").reduce((a, e) => a + e.amount, 0))}
          </div>
          <div className="foot">Deducted from daily cash balance</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>💸 Shop Operational Expenses</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Track electricity, rent, wages, tea/snacks, paper and operating costs for accurate P&amp;L
            </span>
          </div>
          <button className="btn primary sm" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={14} /> + Record Shop Expense
          </button>
        </div>

        {/* Filter Bar */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ width: "220px", padding: "6px 10px" }}
          >
            <option value="ALL">All Expense Categories</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <div style={{ flex: 1 }}>
            <input
              placeholder="Search by description, date..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: "6px 12px" }}
            />
          </div>
        </div>

        <div className="table-wrap">
          {filteredExpenses.length === 0 ? (
            <div className="empty">No shop expenses logged matching query. Click above to add an expense.</div>
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
                {filteredExpenses.slice().reverse().map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td>
                      <span className="badge info">{e.category || "General"}</span>
                    </td>
                    <td><b>{e.description}</b></td>
                    <td>
                      <span className="badge ok">{e.method}</span>
                    </td>
                    <td><b style={{ color: "var(--red)" }}>{inr(e.amount)}</b></td>
                    <td>
                      <button
                        className="btn sm danger"
                        onClick={() => handleDeleteExpense(e.id)}
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

      {/* Add Expense Modal */}
      {isAddModalOpen && (
        <div className="overlay">
          <div className="modal">
            <div className="modal-head">
              <h3>💸 Record Shop Expense</h3>
              <button onClick={() => setIsAddModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleAddExpense}>
              <div className="formgrid">
                <div className="field full">
                  <label>Expense Category <span className="req">*</span></label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label>Amount (₹) <span className="req">*</span></label>
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
                  <label>Paid Via (Payment Method)</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option>Cash (Deducted from Counter Galla)</option>
                    <option>UPI / Online Transfer</option>
                    <option>Bank Account / Cheque</option>
                  </select>
                </div>

                <div className="field full">
                  <label>Description / Note</label>
                  <input
                    placeholder="e.g. 2 boxes A4 Xerox paper bought from market"
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
                  <CheckCircle2 size={15} /> Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
