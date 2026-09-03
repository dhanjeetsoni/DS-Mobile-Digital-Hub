import React, { useMemo, useState } from "react";
import { TrendingUp, Layers, Wrench, ShoppingCart } from "lucide-react";
import { Database } from "../types";
import { inr, round2 } from "../utils/indianCurrency";
import { saleCost, xeroxCost, jobCost, jobCharge, combineDailyTotals, lastNDates } from "../utils/profitEngine";
import { MiniLineChart, MiniShareBars } from "./MiniCharts";

interface ProfitLossDashboardViewProps {
  db: Database;
}

type RangeKey = "7d" | "30d" | "thisMonth" | "all";

function withinRange(dateStr: string, range: RangeKey): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  if (range === "all") return true;
  if (range === "thisMonth") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const days = range === "7d" ? 7 : 30;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

export const ProfitLossDashboardView: React.FC<ProfitLossDashboardViewProps> = ({ db }) => {
  const [range, setRange] = useState<RangeKey>("30d");

  const stats = useMemo(() => {
    const sales = db.sales.filter((s) => withinRange(s.date, range));
    const revenue = sales.reduce((a, s) => a + s.total, 0);
    const cogs = sales.reduce((a, s) => a + saleCost(s), 0);
    const grossProfit = round2(revenue - cogs);

    const returns = db.returns.filter((r) => withinRange(r.date, range));
    const refunds = returns.reduce((a, r) => a + r.subtotalRefund, 0);

    // Cybercafe / Xerox / Digital Hub quick services (owner-only cost).
    const xeroxEntries = (db.xeroxEntries || []).filter((x) => withinRange(x.date, range));
    const xeroxRevenue = xeroxEntries.reduce((a, x) => a + x.totalAmount, 0);
    const xeroxCostTotal = xeroxEntries.reduce((a, x) => a + xeroxCost(x), 0);
    const xeroxProfitTotal = round2(xeroxRevenue - xeroxCostTotal);

    // Repair / Mobile Unlock jobs — includes FRP bypass, pattern/PIN remove,
    // software flash etc, counted on the day they were received (when the
    // money/ticket actually landed at the counter).
    const jobs = (db.jobs || []).filter((j) => withinRange(j.receivedDate, range));
    const jobRevenue = jobs.reduce((a, j) => a + jobCharge(j), 0);
    const jobCostTotal = jobs.reduce((a, j) => a + jobCost(j), 0);
    const jobProfitTotal = round2(jobRevenue - jobCostTotal);

    const shopExpenses = (db.expenses?.shop || []).filter((e) => withinRange(e.date, range)).reduce((a, e) => a + e.amount, 0);
    const netRevenue = round2(revenue - refunds + xeroxRevenue + jobRevenue);
    const combinedGrossProfit = round2(grossProfit + xeroxProfitTotal + jobProfitTotal);
    const netProfit = round2(combinedGrossProfit - refunds - shopExpenses);
    const margin = netRevenue > 0 ? round2((netProfit / netRevenue) * 100) : 0;

    const byCategory: { [cat: string]: { revenue: number; cost: number } } = {};
    sales.forEach((s) => {
      s.items.forEach((i) => {
        const cat = i.category || "General";
        if (!byCategory[cat]) byCategory[cat] = { revenue: 0, cost: 0 };
        byCategory[cat].revenue += i.price * i.qty;
        byCategory[cat].cost += i.cost || i.purchasePrice * i.qty || 0;
      });
    });
    const categoryRows = Object.entries(byCategory)
      .map(([cat, v]) => ({ cat, revenue: v.revenue, profit: round2(v.revenue - v.cost) }))
      .sort((a, b) => b.revenue - a.revenue);
    const maxCategoryRevenue = Math.max(1, ...categoryRows.map((r) => r.revenue));

    const sourceBreakdown = [
      { label: "Products (POS)", value: grossProfit, color: "var(--blue)" },
      { label: "Cybercafe / Xerox", value: xeroxProfitTotal, color: "var(--amber)" },
      { label: "Repairs / Unlock", value: jobProfitTotal, color: "var(--purple)" },
    ];

    return {
      revenue,
      cogs,
      grossProfit,
      refunds,
      shopExpenses,
      netProfit,
      margin,
      categoryRows,
      maxCategoryRevenue,
      billCount: sales.length,
      xeroxRevenue,
      xeroxCostTotal,
      xeroxProfitTotal,
      xeroxCount: xeroxEntries.length,
      jobRevenue,
      jobCostTotal,
      jobProfitTotal,
      jobCount: jobs.length,
      netRevenue,
      combinedGrossProfit,
      sourceBreakdown,
    };
  }, [db, range]);

  // Daily trend for the chart — always last 30 days of combined profit so
  // the owner can see the shape of the business regardless of which summary
  // range is selected above.
  const trend = useMemo(() => {
    const dates = lastNDates(30);
    const rows = combineDailyTotals(db, dates);
    return rows.map((r) => ({
      label: r.date.slice(5), // MM-DD
      value: r.totalProfit,
    }));
  }, [db]);

  const rangeOptions: { key: RangeKey; label: string }[] = [
    { key: "7d", label: "Last 7 days" },
    { key: "30d", label: "Last 30 days" },
    { key: "thisMonth", label: "This month" },
    { key: "all", label: "All time" },
  ];

  return (
    <div>
      <div className="section-head" style={{ marginBottom: "12px" }}>
        <h2><TrendingUp size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Profit &amp; Loss Dashboard</h2>
        <div style={{ display: "flex", gap: "6px" }}>
          {rangeOptions.map((r) => (
            <button
              key={r.key}
              className={`btn sm ${range === r.key ? "primary" : "ghost"}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid cols-4" style={{ gap: "12px", marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Revenue (all sources)</h3>
          <div className="big blue">{inr(stats.netRevenue)}</div>
          <div className="foot">{stats.billCount} bills + {stats.xeroxCount} Xerox + {stats.jobCount} jobs</div>
        </div>
        <div className="card">
          <h3>Total Cost (all sources)</h3>
          <div className="big amber">{inr(round2(stats.cogs + stats.xeroxCostTotal + stats.jobCostTotal))}</div>
          <div className="foot">Combined gross profit: {inr(stats.combinedGrossProfit)}</div>
        </div>
        <div className="card">
          <h3>Refunds &amp; expenses</h3>
          <div className="big red">{inr(round2(stats.refunds + stats.shopExpenses))}</div>
          <div className="foot">Returns {inr(stats.refunds)} + Expenses {inr(stats.shopExpenses)}</div>
        </div>
        <div className="card">
          <h3>Net profit — sab milaake (Owner)</h3>
          <div className={`big ${stats.netProfit >= 0 ? "green" : "red"}`}>{inr(stats.netProfit)}</div>
          <div className="foot">Margin: {stats.margin}%</div>
        </div>
      </div>

      {/* Revenue-source breakdown: Products vs Cybercafe vs Repairs */}
      <div className="grid cols-3" style={{ gap: "12px", marginBottom: "16px" }}>
        <div className="card">
          <h3><ShoppingCart size={13} style={{ verticalAlign: "-2px", marginRight: "4px" }} />Product Sales Profit</h3>
          <div className="big" style={{ color: stats.grossProfit >= 0 ? "var(--green)" : "var(--red)" }}>{inr(stats.grossProfit)}</div>
          <div className="foot">Revenue {inr(stats.revenue)} − Cost {inr(stats.cogs)}</div>
        </div>
        <div className="card">
          <h3><Layers size={13} style={{ verticalAlign: "-2px", marginRight: "4px" }} />Cybercafe / Xerox Profit</h3>
          <div className="big" style={{ color: stats.xeroxProfitTotal >= 0 ? "var(--green)" : "var(--red)" }}>{inr(stats.xeroxProfitTotal)}</div>
          <div className="foot">Revenue {inr(stats.xeroxRevenue)} − Cost {inr(stats.xeroxCostTotal)}</div>
        </div>
        <div className="card">
          <h3><Wrench size={13} style={{ verticalAlign: "-2px", marginRight: "4px" }} />Repairs / Unlock Profit</h3>
          <div className="big" style={{ color: stats.jobProfitTotal >= 0 ? "var(--green)" : "var(--red)" }}>{inr(stats.jobProfitTotal)}</div>
          <div className="foot">Revenue {inr(stats.jobRevenue)} − Cost {inr(stats.jobCostTotal)}</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ gap: "18px", marginBottom: "16px" }}>
        <div className="section" style={{ margin: 0 }}>
          <div className="section-head">
            <h2>Profit by Revenue Source</h2>
          </div>
          <MiniShareBars data={stats.sourceBreakdown} />
        </div>

        <div className="section" style={{ margin: 0 }}>
          <div className="section-head">
            <h2>Last 30 Days — Daily Profit Trend</h2>
          </div>
          <MiniLineChart data={trend} />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Revenue &amp; profit by product category</h2>
        </div>
        {stats.categoryRows.length === 0 ? (
          <div className="empty">No product sales in this period.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {stats.categoryRows.map((r) => (
              <div key={r.cat}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "4px" }}>
                  <span><b>{r.cat}</b></span>
                  <span>{inr(r.revenue)} · profit {inr(r.profit)}</span>
                </div>
                <div style={{ background: "var(--surface-soft, #eee)", borderRadius: "6px", height: "10px", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.max(2, (r.revenue / stats.maxCategoryRevenue) * 100)}%`,
                      background: r.profit >= 0 ? "var(--green)" : "var(--red)",
                      height: "100%",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
