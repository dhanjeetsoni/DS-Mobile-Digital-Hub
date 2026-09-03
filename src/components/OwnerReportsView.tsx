import React, { useState } from "react";
import { ShieldCheck, Download, Printer, TrendingUp, DollarSign, Package, PieChart, Layers, Send } from "lucide-react";
import { Database } from "../types";
import { inr, round2 } from "../utils/indianCurrency";
import { AiAdviceCard } from "./AiAdviceCard";
import { saleCost, xeroxCost, xeroxProfit, jobCost, jobCharge, jobProfit } from "../utils/profitEngine";
import { MiniShareBars } from "./MiniCharts";
import { buildWeeklyReport } from "../utils/weeklyReport";
import { sendWeeklyReportToTelegram } from "../services/telegram";

interface OwnerReportsViewProps {
  db: Database;
  onUpdate?: () => void;
  toast?: (msg: string, type?: "green" | "red" | "amber") => void;
}

export const OwnerReportsView: React.FC<OwnerReportsViewProps> = ({ db, onUpdate, toast }) => {
  // NOTE: this page is only ever mounted for owner/manager — App.tsx already
  // redirects any non-owner-mode navigation away before this component
  // renders (see the `ownerOnly` route guard in App.tsx/Sidebar.tsx). An
  // earlier version of this file had its own second, independent PIN-gate
  // here (`isUnlocked`/`enteredPin`), but its `isUnlocked` state was always
  // initialized to `true` and had no code path that ever set it back to
  // `false` — so the gate below could never actually render. It was dead
  // code that looked like a real security layer but wasn't one. Removed;
  // the App-level `ownerOnly` guard is the single real gate for this page.
  const [isSendingReport, setIsSendingReport] = useState(false);
  // Step 5.3 — Owner Reports "Gifts Cost" section. Two numbers, each on
  // three filters (Total/This Month/This Year), per the plan: (a) what the
  // gifts actually cost the shop (Original/purchase-price basis — this is
  // the same number that already silently reduces sale profit via the
  // profit engine, surfaced here on its own instead of buried inside every
  // individual sale's margin), and (b) what the gifts were worth at normal
  // retail (Selling-price basis — the "goodwill value" given away).
  const [giftRange, setGiftRange] = useState<"all" | "thisMonth" | "thisYear">("all");

  const handleSendWeeklyReport = async () => {
    setIsSendingReport(true);
    try {
      const report = buildWeeklyReport(db);
      await sendWeeklyReportToTelegram(report);
      db.settings.lastWeeklyReportSentAt = new Date().toISOString();
      onUpdate?.();
      toast?.("Weekly report Telegram par bhej diya gaya", "green");
    } catch (err: any) {
      toast?.(err?.message || "Telegram connect karke dobara try karein", "red");
    } finally {
      setIsSendingReport(false);
    }
  };

  // 1. Inventory Valuation
  const totalStockUnits = db.products.reduce((a, p) => a + p.stock, 0);
  const totalCostValuation = db.products.reduce((a, p) => a + (p.purchasePrice || 0) * p.stock, 0);
  const totalRetailValuation = db.products.reduce((a, p) => a + p.sellingPrice * p.stock, 0);
  const unrealizedProfit = round2(totalRetailValuation - totalCostValuation);

  // 2. Financial Balance Sheet Assets & Liabilities
  const totalCustomerUdhaar = db.customers.reduce((a, c) => a + (c.dueAmount || 0), 0);
  const totalSupplierPayable = db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0);
  const netBusinessAssets = round2(totalCostValuation + totalCustomerUdhaar - totalSupplierPayable);

  // 3. Lifetime Cumulative P&L
  const lifetimeSales = db.sales.reduce((a, s) => a + s.total, 0);
  const lifetimeCost = db.sales.reduce((a, s) => a + saleCost(s), 0);
  const lifetimeGrossProfit = round2(lifetimeSales - lifetimeCost);

  // Lifetime Cybercafe / Xerox and Repair / Unlock / FRP job profit — now
  // rolled into the owner's true retained-profit figure below instead of
  // being tracked nowhere.
  const lifetimeXeroxRevenue = (db.xeroxEntries || []).reduce((a, x) => a + x.totalAmount, 0);
  const lifetimeXeroxCost = (db.xeroxEntries || []).reduce((a, x) => a + xeroxCost(x), 0);
  const lifetimeXeroxProfit = (db.xeroxEntries || []).reduce((a, x) => a + xeroxProfit(x), 0);
  const lifetimeJobRevenue = (db.jobs || []).reduce((a, j) => a + jobCharge(j), 0);
  const lifetimeJobCost = (db.jobs || []).reduce((a, j) => a + jobCost(j), 0);
  const lifetimeJobProfit = (db.jobs || []).reduce((a, j) => a + jobProfit(j), 0);
  const lifetimeCombinedProfit = round2(lifetimeGrossProfit + lifetimeXeroxProfit + lifetimeJobProfit);

  const lifetimeShopExpenses = (db.expenses?.shop || []).reduce((a, e) => a + e.amount, 0);
  const lifetimePersonalDrawings = (db.expenses?.personal || []).reduce((a, d) => a + d.amount, 0);
  const netRetainedProfit = round2(lifetimeCombinedProfit - lifetimeShopExpenses - lifetimePersonalDrawings);
  // Never resets — sum of every purchase record ever entered (db.purchases
  // is append-only; it only moves if an existing entry is corrected/edited,
  // e.g. an accidental extra-qty purchase being fixed).
  const lifetimeTotalPurchases = (db.purchases || []).reduce((a, p) => a + p.total, 0);

  // Category-wise Breakdown
  const categoryStats: { [cat: string]: { units: number; costVal: number; retailVal: number } } = {};
  db.products.forEach((p) => {
    const cat = p.category || "General";
    if (!categoryStats[cat]) {
      categoryStats[cat] = { units: 0, costVal: 0, retailVal: 0 };
    }
    categoryStats[cat].units += p.stock;
    categoryStats[cat].costVal += (p.purchasePrice || 0) * p.stock;
    categoryStats[cat].retailVal += p.sellingPrice * p.stock;
  });

  // Step 5.3 — Gifts Cost totals for the selected range.
  const now = new Date();
  const salesInGiftRange = db.sales.filter((s) => {
    if (s.status === "Cancelled") return false;
    if (giftRange === "all") return true;
    const d = new Date(s.date);
    if (Number.isNaN(d.getTime())) return giftRange === "all";
    if (giftRange === "thisMonth") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    return d.getFullYear() === now.getFullYear(); // thisYear
  });
  let giftCount = 0;
  let giftOriginalCostTotal = 0;
  let giftSellingValueTotal = 0;
  salesInGiftRange.forEach((s) => {
    s.items.forEach((i) => {
      if (!i.isGift) return;
      giftCount += i.qty;
      giftOriginalCostTotal += i.cost || 0;
      giftSellingValueTotal += (i.giftSellingPrice || 0) * i.qty;
    });
  });
  giftOriginalCostTotal = round2(giftOriginalCostTotal);
  giftSellingValueTotal = round2(giftSellingValueTotal);

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2>💼 Owner Executive Financial Reports &amp; Balance Sheet</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Confidential balance sheet, real-time inventory valuation, and net business capital overview
            </span>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn sm" disabled={isSendingReport} onClick={handleSendWeeklyReport}>
              <Send size={13} /> {isSendingReport ? "Bhej raha hai..." : "Weekly Report Telegram Par Bhejein"}
            </button>
            <button className="btn sm" onClick={() => window.print()}>
              <Printer size={13} /> Print Financial Audit Sheet
            </button>
          </div>
        </div>

        <AiAdviceCard db={db} ownerMode={true} />

        {/* 4 Asset & Net Worth Cards */}
        <div className="grid cols-4" style={{ marginBottom: "20px" }}>
          <div className="card accent">
            <h3>Total Stock Inventory (Cost)</h3>
            <div className="big blue">{inr(totalCostValuation)}</div>
            <div className="foot">{totalStockUnits} Total Units in Stock</div>
          </div>
          <div className="card">
            <h3>Stock Retail Valuation</h3>
            <div className="big green">{inr(totalRetailValuation)}</div>
            <div className="foot">+{inr(unrealizedProfit)} Potential Profit</div>
          </div>
          <div className="card">
            <h3>Market Khata Receivable</h3>
            <div className="big">{inr(totalCustomerUdhaar)}</div>
            <div className="foot">Owed by {db.customers.filter((c) => c.dueAmount > 0).length} Customers</div>
          </div>
          <div className="card">
            <h3>Net Business Net Worth</h3>
            <div className="big purple" style={{ color: "var(--accent)" }}>
              {inr(netBusinessAssets)}
            </div>
            <div className="foot">Stock + Khata - Supplier Dues</div>
          </div>
        </div>

        {/* Lifetime Profit & Loss Summary */}
        <div className="grid cols-2" style={{ gap: "18px", marginBottom: "20px" }}>
          <div style={{ background: "var(--paper)", padding: "18px", borderRadius: "10px" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
              📊 Cumulative P&amp;L Statement
            </h3>
            <div className="kv"><span>Total Lifetime Sales Turnover</span><b>{inr(lifetimeSales)}</b></div>
            <div className="kv"><span>Total Lifetime Purchases (Kharidari — never resets)</span><b>{inr(lifetimeTotalPurchases)}</b></div>
            <div className="kv"><span>Total Cost of Goods Sold (COGS)</span><b>-{inr(lifetimeCost)}</b></div>
            <div className="kv" style={{ fontWeight: 800, color: "var(--blue)" }}>
              <span>Product Sales Gross Margin:</span>
              <b>{inr(lifetimeGrossProfit)}</b>
            </div>
            <div className="kv"><span>Cybercafe / Xerox Revenue</span><b>+{inr(lifetimeXeroxRevenue)}</b></div>
            <div className="kv"><span>Cybercafe / Xerox Cost</span><b>-{inr(lifetimeXeroxCost)}</b></div>
            <div className="kv"><span>Repair / Unlock / FRP Job Charges</span><b>+{inr(lifetimeJobRevenue)}</b></div>
            <div className="kv"><span>Repair / Unlock / FRP Job Cost</span><b>-{inr(lifetimeJobCost)}</b></div>
            <div className="kv" style={{ fontWeight: 800, color: "var(--blue)" }}>
              <span>Total Gross Margin (all sources):</span>
              <b>{inr(lifetimeCombinedProfit)}</b>
            </div>
            <div className="kv"><span>Total Shop Expenses Deducted</span><b>-{inr(lifetimeShopExpenses)}</b></div>
            <div className="kv"><span>Owner Personal Drawings Taken</span><b>-{inr(lifetimePersonalDrawings)}</b></div>
            <div className="kv" style={{ fontWeight: 800, fontSize: "15px", color: "var(--green)", borderTop: "2px solid var(--line)", paddingTop: "8px", marginTop: "8px" }}>
              <span>Net Retained Business Capital:</span>
              <b>{inr(netRetainedProfit)}</b>
            </div>
          </div>

          <div style={{ background: "var(--paper)", padding: "18px", borderRadius: "10px" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
              ⚖️ Balance Sheet Liabilities &amp; Payables
            </h3>
            <div className="kv"><span>Customer Udhaar to Collect (Asset)</span><b style={{ color: "var(--green)" }}>+{inr(totalCustomerUdhaar)}</b></div>
            <div className="kv"><span>Supplier Inward Dues to Pay (Liability)</span><b style={{ color: "var(--red)" }}>-{inr(totalSupplierPayable)}</b></div>
            <div className="kv"><span>Active Repair Advances in Galla</span><b>{inr(db.jobs.filter((j) => j.status !== "Delivered").reduce((a, j) => a + (j.advance || 0), 0))}</b></div>
            <div className="kv"><span>Pending SIM DLR Commissions</span><b>{inr(db.simActivations.filter((s) => s.commissionStatus === "Pending from DLR").reduce((a, s) => a + (s.targetCommission || 0), 0))}</b></div>
          </div>
        </div>

        {/* Category-wise Inventory Valuation Table */}
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
          Lifetime Profit by Revenue Source
        </h3>
        <div style={{ marginBottom: "20px" }}>
          <MiniShareBars
            data={[
              { label: "Products (POS)", value: lifetimeGrossProfit },
              { label: "Cybercafe / Xerox", value: lifetimeXeroxProfit },
              { label: "Repairs / Unlock / FRP", value: lifetimeJobProfit },
            ]}
          />
        </div>

        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
          Category-wise Inventory Stock Value Breakdown
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>In-Stock Units</th>
                <th>Purchase Cost Value (₹)</th>
                <th>Selling Retail Value (₹)</th>
                <th>Estimated Profit (₹)</th>
                <th>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(categoryStats).map(([cat, data]) => {
                const profit = round2(data.retailVal - data.costVal);
                const margin = data.retailVal > 0 ? round2((profit / data.retailVal) * 100) : 0;
                return (
                  <tr key={cat}>
                    <td><b>{cat}</b></td>
                    <td>{data.units} Units</td>
                    <td>{inr(data.costVal)}</td>
                    <td><b>{inr(data.retailVal)}</b></td>
                    <td><b style={{ color: "var(--green)" }}>{inr(profit)}</b></td>
                    <td><span className="badge ok">{margin}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Step 5.3 — Gifts Cost */}
        <div className="section-head" style={{ marginTop: "8px" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            🎁 Gifts Cost — Free Products Diye Gaye Customers Ko
          </h3>
          <div style={{ display: "flex", gap: "6px" }}>
            <button className={`btn sm${giftRange === "all" ? " primary" : ""}`} onClick={() => setGiftRange("all")}>
              Total (All-Time)
            </button>
            <button className={`btn sm${giftRange === "thisMonth" ? " primary" : ""}`} onClick={() => setGiftRange("thisMonth")}>
              This Month
            </button>
            <button className={`btn sm${giftRange === "thisYear" ? " primary" : ""}`} onClick={() => setGiftRange("thisYear")}>
              This Year
            </button>
          </div>
        </div>
        <div className="grid cols-2" style={{ gap: "18px", marginBottom: "8px" }}>
          <div className="card">
            <h3>Gift Cost — Original Price Basis</h3>
            <div className="big" style={{ color: "var(--red)" }}>{inr(giftOriginalCostTotal)}</div>
            <div className="foot">Yeh amount har sale ke profit se already ghat chuka hai — yahan sirf alag se dikhaya gaya hai</div>
          </div>
          <div className="card">
            <h3>Gift Value — Selling Price Basis</h3>
            <div className="big blue">{inr(giftSellingValueTotal)}</div>
            <div className="foot">{giftCount} gift item{giftCount === 1 ? "" : "s"} customers ko diye gaye (normal retail value par)</div>
          </div>
        </div>
      </div>
    </div>
  );
};
