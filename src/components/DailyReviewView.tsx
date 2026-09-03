import React, { useState } from "react";
import { Calendar, Printer, DollarSign, ShoppingCart, Layers, Wrench, ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { Database } from "../types";
import { inr, round2 } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";
import { saleCost, xeroxCost, jobCost, jobCharge, jobProfit } from "../utils/profitEngine";
import { MiniShareBars } from "./MiniCharts";

interface DailyReviewViewProps {
  db: Database;
}

export const DailyReviewView: React.FC<DailyReviewViewProps> = ({ db }) => {
  const [selectedDate, setSelectedDate] = useState(todayStr());

  // Filter entities for the selected date
  const daySales = db.sales.filter((s) => s.date === selectedDate);
  const dayReturns = db.returns.filter((r) => r.date === selectedDate);
  const dayXerox = (db.xeroxEntries || []).filter((x) => x.date === selectedDate);
  // Repair/unlock jobs (incl. FRP bypass etc) counted on the day the ticket
  // was received — that's when the money/advance actually landed.
  const dayJobs = db.jobs.filter((j) => j.receivedDate === selectedDate);
  const dayExpenses = (db.expenses?.shop || []).filter((e) => e.date === selectedDate);
  const dayDrawings = (db.expenses?.personal || []).filter((e) => e.date === selectedDate);

  // Sales Totals
  const grossSales = daySales.reduce((a, s) => a + s.total, 0);
  const totalCost = daySales.reduce((a, s) => a + saleCost(s), 0);
  const totalRefunds = dayReturns.reduce((a, r) => a + r.settlementAmount, 0);
  const netSales = round2(grossSales - totalRefunds);
  const productProfit = round2(netSales - totalCost);

  // Cybercafe / Xerox — now cost-aware. Falls back to 0 cost (full amount =
  // profit) for any entry the owner never priced a cost for, same as before.
  const xeroxRevenue = dayXerox.reduce((a, x) => a + x.totalAmount, 0);
  const xeroxCostTotal = dayXerox.reduce((a, x) => a + xeroxCost(x), 0);
  const xeroxProfitTotal = round2(xeroxRevenue - xeroxCostTotal);

  // Repair jobs / Mobile Unlock incl. FRP bypass — was missing from this
  // report entirely before; now counted like every other revenue stream.
  const jobRevenue = dayJobs.reduce((a, j) => a + jobCharge(j), 0);
  const jobCostTotal = dayJobs.reduce((a, j) => a + jobCost(j), 0);
  const jobProfitTotal = round2(jobRevenue - jobCostTotal);

  const grossProfit = round2(productProfit + xeroxProfitTotal + jobProfitTotal);

  // Cash Inflows for the day
  const cashSales = daySales.filter((s) => !s.isFinance && s.payment === "Cash").reduce((a, s) => a + s.amountPaid, 0);
  const cashXerox = dayXerox.filter((x) => x.paymentMethod === "Cash").reduce((a, x) => a + x.totalAmount, 0);
  const upiSales = daySales.filter((s) => !s.isFinance && s.payment === "UPI").reduce((a, s) => a + s.amountPaid, 0);
  const upiXerox = dayXerox.filter((x) => x.paymentMethod === "UPI").reduce((a, x) => a + x.totalAmount, 0);
  const jobAdvanceCash = dayJobs.reduce((a, j) => a + (j.advance || 0), 0);

  // Cash Outflows
  const cashExpenses = dayExpenses.filter((e) => e.method === "Cash").reduce((a, e) => a + e.amount, 0);
  const cashDrawings = dayDrawings.filter((d) => d.method === "Cash").reduce((a, d) => a + d.amount, 0);
  const totalDayExpenses = dayExpenses.reduce((a, e) => a + e.amount, 0);
  const netDayProfit = round2(grossProfit - totalDayExpenses);

  const sourceBreakdown = [
    { label: "Product Sales", value: productProfit, color: "var(--blue)" },
    { label: "Cybercafe / Xerox", value: xeroxProfitTotal, color: "var(--amber)" },
    { label: "Repairs / Unlock", value: jobProfitTotal, color: "var(--purple)" },
  ];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2>📅 Daily Business Review &amp; EOD Closing Slip</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Complete End-of-Day cash reconciliation, sales turnover, and operational report
            </span>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ width: "160px", padding: "6px 10px" }}
            />
            <button className="btn primary sm" onClick={handlePrint}>
              <Printer size={14} /> Print Daily EOD Report
            </button>
          </div>
        </div>

        {/* 4 Summary Cards */}
        <div className="grid cols-4" style={{ marginBottom: "20px" }}>
          <div className="card accent">
            <h3>Total Day Turnover</h3>
            <div className="big blue">{inr(grossSales + xeroxRevenue + jobRevenue)}</div>
            <div className="foot">{daySales.length} Invoices + {dayXerox.length} Xerox + {dayJobs.length} Jobs</div>
          </div>
          <div className="card">
            <h3>Cash Received at Counter</h3>
            <div className="big green">{inr(cashSales + cashXerox + jobAdvanceCash)}</div>
            <div className="foot">Direct Cash Inflow to Galla (incl. job advances)</div>
          </div>
          <div className="card">
            <h3>Digital UPI / Bank Inflow</h3>
            <div className="big purple">{inr(upiSales + upiXerox)}</div>
            <div className="foot">Settled directly in Bank</div>
          </div>
          <div className="card">
            <h3>Total Profit Today — Sab Milaake</h3>
            <div className="big" style={{ color: netDayProfit >= 0 ? "var(--green)" : "var(--red)" }}>
              {inr(netDayProfit)}
            </div>
            <div className="foot">Products + Cybercafe + Repairs, minus expenses</div>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="grid cols-2" style={{ gap: "18px" }}>
          {/* Revenue Breakdown */}
          <div style={{ background: "var(--paper)", padding: "16px", borderRadius: "10px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
              🛒 1. Sales &amp; Counter Income Breakdown
            </h3>
            <div className="kv"><span>Product Sales Gross Revenue</span><b>{inr(grossSales)}</b></div>
            <div className="kv"><span>Cost of Products Sold (COGS)</span><b>-{inr(totalCost)}</b></div>
            <div className="kv"><span>Customer Returns &amp; Refunds</span><b>-{inr(totalRefunds)}</b></div>
            <div className="kv"><span>Xerox &amp; Cyber Services Income</span><b>+{inr(xeroxRevenue)}</b></div>
            <div className="kv"><span>Xerox &amp; Cyber Services Cost</span><b>-{inr(xeroxCostTotal)}</b></div>
            <div className="kv"><span>Repairs / Unlock (incl. FRP) Income</span><b>+{inr(jobRevenue)}</b></div>
            <div className="kv"><span>Repairs / Unlock Cost (parts + other)</span><b>-{inr(jobCostTotal)}</b></div>
            <div className="kv" style={{ fontWeight: 800, color: "var(--blue)" }}>
              <span>Gross Counter Profit (all sources):</span>
              <b>{inr(grossProfit)}</b>
            </div>
          </div>

          {/* Cash Drawer Flow */}
          <div style={{ background: "var(--paper)", padding: "16px", borderRadius: "10px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
              💰 2. Counter Cash Movement
            </h3>
            <div className="kv"><span>Cash from POS Sales</span><b>+{inr(cashSales)}</b></div>
            <div className="kv"><span>Cash from Xerox / Cyber</span><b>+{inr(cashXerox)}</b></div>
            <div className="kv"><span>Cash Advance from Repair/Unlock Jobs</span><b>+{inr(jobAdvanceCash)}</b></div>
            <div className="kv"><span>Cash Paid for Shop Expenses</span><b>-{inr(cashExpenses)}</b></div>
            <div className="kv"><span>Cash Taken for Personal Drawings</span><b>-{inr(cashDrawings)}</b></div>
            <div className="kv" style={{ fontWeight: 800, color: "var(--green)" }}>
              <span>Net Cash Generated Today:</span>
              <b>{inr(cashSales + cashXerox + jobAdvanceCash - cashExpenses - cashDrawings)}</b>
            </div>
          </div>
        </div>

        {/* Profit by source chart */}
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            <TrendingUp size={14} style={{ verticalAlign: "-2px", marginRight: "5px" }} />
            Today's Profit by Source
          </h3>
          <MiniShareBars data={sourceBreakdown} />
        </div>

        {/* Activity Tables */}
        <div style={{ marginTop: "20px" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Invoices Generated on {selectedDate} ({daySales.length})
          </h3>
          <div className="table-wrap">
            {daySales.length === 0 ? (
              <div className="empty">No sales invoices recorded on this date.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Mode</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {daySales.map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.invoiceNo}</b></td>
                      <td>{s.time}</td>
                      <td>{s.customer?.name || "Walk-in"}</td>
                      <td>{s.items.length} item(s)</td>
                      <td><span className="badge info">{s.payment}</span></td>
                      <td><b>{inr(s.total)}</b></td>
                      <td><span className={`badge ${s.dueAmount > 0.005 ? "due" : "paid"}`}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Repair / Unlock jobs table for the day, with profit */}
        {dayJobs.length > 0 && (
          <div style={{ marginTop: "20px" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
              <Wrench size={14} style={{ verticalAlign: "-2px", marginRight: "5px" }} />
              Repair &amp; Unlock Tickets on {selectedDate} ({dayJobs.length})
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job #</th>
                    <th>Customer</th>
                    <th>Issue / Service</th>
                    <th>Charge</th>
                    <th>Cost</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {dayJobs.map((j) => (
                    <tr key={j.id}>
                      <td><b>{j.jobNo}</b></td>
                      <td>{j.customerName}</td>
                      <td>{j.issue}</td>
                      <td>{inr(jobCharge(j))}</td>
                      <td>{inr(jobCost(j))}</td>
                      <td style={{ fontWeight: 800, color: jobProfit(j) >= 0 ? "var(--green)" : "var(--red)" }}>{inr(jobProfit(j))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
