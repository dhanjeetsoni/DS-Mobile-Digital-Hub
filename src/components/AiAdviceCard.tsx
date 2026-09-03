import React, { useState } from "react";
import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { Database } from "../types";
import { getBusinessInsights, getStaffAdvice } from "../utils/aiInsights";
import { round2 } from "../utils/indianCurrency";

interface AiAdviceCardProps {
  db: Database;
  ownerMode: boolean;
}

// One reusable "AI advice" widget, used across the app (Dashboard, Owner
// Reports, Monthly Review). Deliberately on-demand (button click, not
// auto-fetch) since every click is a real Gemini call:
// - Owner mode: full P&L/loan/supplier numbers -> getBusinessInsights().
// - Staff mode: only sales-count + stock-level numbers, no cost/profit data
//   ever leaves the client -> getStaffAdvice().
export const AiAdviceCard: React.FC<AiAdviceCardProps> = ({ db, ownerMode }) => {
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState("");
  const [error, setError] = useState("");

  const monthKey = new Date().toISOString().slice(0, 7);
  const todayStr = new Date().toISOString().slice(0, 10);

  const lowStockProducts = db.products
    .filter((p) => p.stock <= p.minStock)
    .slice(0, 8)
    .map((p) => ({ name: p.name, stock: p.stock, minStock: p.minStock }));

  const topProductQty: Record<string, number> = {};
  db.sales.forEach((s) => {
    s.items.forEach((i) => {
      topProductQty[i.name] = (topProductQty[i.name] || 0) + i.qty;
    });
  });
  const topSellingProducts = Object.entries(topProductQty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, qty]) => ({ name, qty }));

  const fetchOwnerAdvice = async () => {
    setLoading(true);
    setError("");
    setAdvice("");
    try {
      const monthSales = db.sales.filter((s) => s.date.startsWith(monthKey));
      const totalSalesThisMonth = monthSales.reduce((a, s) => a + s.total, 0);
      const shopExpenses = (db.expenses?.shop || []).filter((e) => e.date.startsWith(monthKey)).reduce((a, e) => a + e.amount, 0);
      const cogs = monthSales.reduce((a, s) => a + s.items.reduce((sum, i) => sum + (i.cost || i.purchasePrice * i.qty || 0), 0), 0);
      const totalExpensesThisMonth = shopExpenses;
      const profitThisMonth = round2(totalSalesThisMonth - cogs - totalExpensesThisMonth);
      const activeLenders = (db.moneyLenders || []).filter((l) => l.status === "Active");
      const totalMonthlyInterestDue = activeLenders.reduce((a, l) => a + (l.monthlyInterestAmount || 0), 0);
      const totalPrincipalOutstanding = activeLenders.reduce((a, l) => a + (l.principalAmount || 0), 0);
      const supplierPayableOutstanding = db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0);

      const result = await getBusinessInsights({
        monthLabel: monthKey,
        totalSalesThisMonth: round2(totalSalesThisMonth),
        totalExpensesThisMonth: round2(totalExpensesThisMonth),
        profitThisMonth,
        totalMonthlyInterestDue,
        totalPrincipalOutstanding,
        supplierPayableOutstanding,
        topSellingProducts,
        lowStockProducts,
      });
      setAdvice(result);
    } catch (err: any) {
      setError(err.message || "AI insights unavailable right now.");
    } finally {
      setLoading(false);
    }
  };

  const fetchStaffAdvice = async () => {
    setLoading(true);
    setError("");
    setAdvice("");
    try {
      const todaySales = db.sales.filter((s) => s.date === todayStr);
      const result = await getStaffAdvice({
        todaySalesSoFar: round2(todaySales.reduce((a, s) => a + s.total, 0)),
        todayInvoiceCount: todaySales.length,
        topMovingProducts: topSellingProducts,
        lowStockProducts,
      });
      setAdvice(result);
    } catch (err: any) {
      setError(err.message || "AI advice unavailable right now.");
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => (ownerMode ? fetchOwnerAdvice() : fetchStaffAdvice());

  return (
    <div className="section" style={{ background: "var(--paper)", borderRadius: "12px", padding: "16px 18px", marginBottom: "16px" }}>
      <div className="section-head" style={{ marginBottom: advice || error || loading ? "10px" : 0 }}>
        <div>
          <h2 style={{ fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={16} style={{ color: "var(--glow)" }} />
            {ownerMode ? "AI Business Advisor" : "AI Shift Advice"}
          </h2>
          <span style={{ fontSize: "11.5px", color: "var(--ink-soft)" }}>
            {ownerMode
              ? "Is mahine ka hisaab, byaj savings aur reorder suggestions"
              : "Aaj sales badhane ke liye kya karein — AI se puchein"}
          </span>
        </div>
        <button className="btn primary sm" onClick={handleClick} disabled={loading}>
          {loading ? <RefreshCw size={13} style={{ animation: "spinCheck 1s linear infinite" }} /> : <Sparkles size={13} />}
          {loading ? "Soch raha hai..." : advice ? "Refresh Advice" : "Get AI Advice"}
        </button>
      </div>

      {error && (
        <div className="alert red">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {advice && (
        <div style={{ fontSize: "13px", lineHeight: 1.7, whiteSpace: "pre-line", background: "var(--card)", borderRadius: "8px", padding: "12px 14px" }}>
          {advice}
        </div>
      )}
    </div>
  );
};
