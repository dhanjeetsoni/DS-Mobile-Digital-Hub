import React, { useState } from "react";
import { Calendar, TrendingUp, DollarSign, Package, Layers, Download, BarChart2 } from "lucide-react";
import { Database } from "../types";
import { inr, round2 } from "../utils/indianCurrency";
import { AiAdviceCard } from "./AiAdviceCard";
import { saleCost, xeroxCost, xeroxProfit, jobCost, jobCharge, jobProfit } from "../utils/profitEngine";
import { MiniShareBars } from "./MiniCharts";

interface MonthlyReviewViewProps {
  db: Database;
}

// Business month cycle: runs from the 2nd of a month through the 1st of the
// next month (NOT the calendar's 1st-to-end-of-month). E.g. "2026-08" here
// means 2 Aug 2026 -> 1 Sep 2026. On the 2nd, the previous cycle is done and
// a fresh one starts.
function cycleRangeFor(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m)}-02`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${pad(nextM)}-01`;
  return { start, end };
}

// Which cycle "today" currently belongs to — on the 1st of a month, we're
// still inside the PREVIOUS month's cycle (it only ends that day).
function currentCycleMonthStr(): string {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1; // 1-indexed
  if (now.getDate() === 1) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export const MonthlyReviewView: React.FC<MonthlyReviewViewProps> = ({ db }) => {
  const currentMonthStr = currentCycleMonthStr(); // "YYYY-MM" — the cycle label, 2nd->1st
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  const { start: cycleStart, end: cycleEnd } = cycleRangeFor(selectedMonth);
  const inCycle = (d: string) => d >= cycleStart && d <= cycleEnd;

  const monthSales = db.sales.filter((s) => inCycle(s.date));
  const monthReturns = db.returns.filter((r) => inCycle(r.date));
  const monthXerox = (db.xeroxEntries || []).filter((x) => inCycle(x.date));
  const monthJobs = (db.jobs || []).filter((j) => inCycle(j.receivedDate));
  const monthShopExpenses = (db.expenses?.shop || []).filter((e) => inCycle(e.date));
  const monthDrawings = (db.expenses?.personal || []).filter((d) => inCycle(d.date));
  const monthPurchases = (db.purchases || []).filter((p) => inCycle(p.date));
  const totalPurchasesThisCycle = monthPurchases.reduce((a, p) => a + p.total, 0);

  // Weekly split within the cycle (Week 1 = day 2-8, Week 2 = 9-15, etc, by
  // day-of-cycle rather than calendar week so it always lines up 2nd->1st).
  const weekOf = (dateStr: string): number => {
    const dayOfMonth = Number(dateStr.slice(8, 10));
    const dayOfCycle = dayOfMonth >= 2 ? dayOfMonth - 1 : dayOfMonth + 30; // rough, good enough for a shop-floor weekly split
    return Math.min(5, Math.ceil(dayOfCycle / 7));
  };
  const weeklyMap: { [week: number]: { sales: number; cost: number; bills: number } } = {};
  monthSales.forEach((s) => {
    const w = weekOf(s.date);
    if (!weeklyMap[w]) weeklyMap[w] = { sales: 0, cost: 0, bills: 0 };
    weeklyMap[w].sales += s.total;
    weeklyMap[w].bills += 1;
    weeklyMap[w].cost += s.items.reduce((sum, i) => sum + (i.cost || i.purchasePrice * i.qty || 0), 0);
  });
  const halfMonthly = {
    first: monthSales.filter((s) => Number(s.date.slice(8, 10)) <= 16 && Number(s.date.slice(8, 10)) >= 2).reduce((a, s) => a + s.total, 0),
    second: monthSales.filter((s) => Number(s.date.slice(8, 10)) > 16 || Number(s.date.slice(8, 10)) === 1).reduce((a, s) => a + s.total, 0),
  };

  // Calculations
  const grossSales = monthSales.reduce((a, s) => a + s.total, 0);
  const totalCost = monthSales.reduce((a, s) => a + saleCost(s), 0);
  const totalRefunds = monthReturns.reduce((a, r) => a + r.settlementAmount, 0);
  const xeroxRevenue = monthXerox.reduce((a, x) => a + x.totalAmount, 0);
  const xeroxCostTotal = monthXerox.reduce((a, x) => a + xeroxCost(x), 0);
  const xeroxProfitTotal = monthXerox.reduce((a, x) => a + xeroxProfit(x), 0);
  const jobRevenue = monthJobs.reduce((a, j) => a + jobCharge(j), 0);
  const jobCostTotal = monthJobs.reduce((a, j) => a + jobCost(j), 0);
  const jobProfitTotal = monthJobs.reduce((a, j) => a + jobProfit(j), 0);
  const netTurnover = round2(grossSales - totalRefunds + xeroxRevenue + jobRevenue);
  const productGrossProfit = round2(grossSales - totalRefunds - totalCost);
  const grossProfit = round2(productGrossProfit + xeroxProfitTotal + jobProfitTotal);
  const totalExpenses = monthShopExpenses.reduce((a, e) => a + e.amount, 0);
  const totalDrawings = monthDrawings.reduce((a, d) => a + d.amount, 0);
  const netOwnerProfit = round2(grossProfit - totalExpenses);

  // Group by day in month
  const dailyMap: { [date: string]: { sales: number; bills: number; cost: number } } = {};
  monthSales.forEach((s) => {
    if (!dailyMap[s.date]) {
      dailyMap[s.date] = { sales: 0, bills: 0, cost: 0 };
    }
    dailyMap[s.date].sales += s.total;
    dailyMap[s.date].bills += 1;
    dailyMap[s.date].cost += saleCost(s);
  });

  const dailyEntries = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2>📈 Monthly Business Review &amp; Financial Performance</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Monthly sales turnover, gross margins, expense deduction, and net owner earnings
            </span>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 700 }}>Select Cycle:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ width: "160px", padding: "6px 10px" }}
            />
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "var(--ink-soft)", marginBottom: "14px", fontWeight: 600 }}>
          📅 Is cycle ka data: <b>{cycleStart}</b> se <b>{cycleEnd}</b> tak (har mahine ki 2 tarik se shuru, agli 1 tarik ko band; 2 tarik ko naya cycle apne aap start ho jaata hai).
        </div>

        <AiAdviceCard db={db} ownerMode={true} />

        {/* 4 Financial Performance Metric Cards */}
        <div className="grid cols-4" style={{ marginBottom: "20px" }}>
          <div className="card accent">
            <h3>Monthly Net Turnover</h3>
            <div className="big blue">{inr(netTurnover)}</div>
            <div className="foot">{monthSales.length} Sales Bills + {monthXerox.length} Xerox + {monthJobs.length} Repair Jobs</div>
          </div>
          <div className="card">
            <h3>Monthly Gross Profit</h3>
            <div className="big green">{inr(grossProfit)}</div>
            <div className="foot">
              {netTurnover > 0 ? round2((grossProfit / netTurnover) * 100) : 0}% Margin
            </div>
          </div>
          <div className="card">
            <h3>Total Shop Expenses</h3>
            <div className="big red">{inr(totalExpenses)}</div>
            <div className="foot">{monthShopExpenses.length} Expense Entries</div>
          </div>
          <div className="card">
            <h3>Net Owner Profit</h3>
            <div className="big purple" style={{ color: netOwnerProfit >= 0 ? "var(--green)" : "var(--red)" }}>
              {inr(netOwnerProfit)}
            </div>
            <div className="foot">After deducting all shop expenses</div>
          </div>
        </div>

        {/* Breakdown Stats */}
        <div className="grid cols-4" style={{ gap: "16px", marginBottom: "20px" }}>
          <div className="card">
            <h3>Product Sales</h3>
            <div className="big">{inr(grossSales)}</div>
            <div className="foot">Profit: {inr(productGrossProfit)}</div>
          </div>
          <div className="card">
            <h3>Cyber &amp; Xerox Income</h3>
            <div className="big green">{inr(xeroxRevenue)}</div>
            <div className="foot">Profit: {inr(xeroxProfitTotal)} (cost {inr(xeroxCostTotal)})</div>
          </div>
          <div className="card">
            <h3>Repairs / Unlock / FRP</h3>
            <div className="big">{inr(jobRevenue)}</div>
            <div className="foot">Profit: {inr(jobProfitTotal)} (cost {inr(jobCostTotal)})</div>
          </div>
          <div className="card">
            <h3>Owner Personal Drawings</h3>
            <div className="big amber">{inr(totalDrawings)}</div>
            <div className="foot">Owner cash withdrawals</div>
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            <BarChart2 size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
            This Cycle's Profit by Revenue Source
          </h3>
          <MiniShareBars
            data={[
              { label: "Products (POS)", value: productGrossProfit },
              { label: "Cybercafe / Xerox", value: xeroxProfitTotal },
              { label: "Repairs / Unlock / FRP", value: jobProfitTotal },
            ]}
          />
        </div>

        {/* Half-monthly split */}
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>Half-Monthly Split</h3>
        <div className="grid cols-2" style={{ gap: "16px", marginBottom: "20px" }}>
          <div className="card">
            <h3>2 – 16 (First Half)</h3>
            <div className="big blue">{inr(halfMonthly.first)}</div>
          </div>
          <div className="card">
            <h3>17 – 1 (Second Half)</h3>
            <div className="big blue">{inr(halfMonthly.second)}</div>
          </div>
        </div>

        {/* Weekly split */}
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>Weekly Split (Is Cycle Ke Andar)</h3>
        <div className="table-wrap" style={{ marginBottom: "20px" }}>
          <table>
            <thead>
              <tr><th>Week</th><th>Bills</th><th>Sales</th><th>Cost</th><th>Profit</th></tr>
            </thead>
            <tbody>
              {Object.entries(weeklyMap).sort((a, b) => Number(a[0]) - Number(b[0])).map(([w, data]) => (
                <tr key={w}>
                  <td><b>Week {w}</b></td>
                  <td>{data.bills}</td>
                  <td>{inr(data.sales)}</td>
                  <td>{inr(data.cost)}</td>
                  <td style={{ color: "var(--green)", fontWeight: 700 }}>{inr(round2(data.sales - data.cost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Purchases / Stock added this cycle */}
        <div className="card" style={{ marginBottom: "20px" }}>
          <h3>Stock Purchased This Cycle</h3>
          <div className="big amber">{inr(totalPurchasesThisCycle)}</div>
          <div className="foot">{monthPurchases.length} purchase entr{monthPurchases.length === 1 ? "y" : "ies"} between {cycleStart} and {cycleEnd}</div>
        </div>

        {/* Day-by-day table */}
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
          Day-by-Day Performance in {selectedMonth} ({dailyEntries.length} Active Days)
        </h3>
        <div className="table-wrap">
          {dailyEntries.length === 0 ? (
            <div className="empty">No sales logged in this month.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoices Generated</th>
                  <th>Total Daily Sales</th>
                  <th>Estimated Cost (COGS)</th>
                  <th>Daily Gross Profit</th>
                  <th>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {dailyEntries.map(([date, data]) => {
                  const profit = round2(data.sales - data.cost);
                  const margin = data.sales > 0 ? round2((profit / data.sales) * 100) : 0;
                  return (
                    <tr key={date}>
                      <td><b>{date}</b></td>
                      <td>{data.bills} Bill(s)</td>
                      <td><b>{inr(data.sales)}</b></td>
                      <td>{inr(data.cost)}</td>
                      <td><b style={{ color: profit >= 0 ? "var(--green)" : "var(--red)" }}>{inr(profit)}</b></td>
                      <td><span className="badge ok">{margin}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
