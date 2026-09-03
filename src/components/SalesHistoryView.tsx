import React, { useState } from "react";
import { TrendingUp, Search, Download, Calendar, Filter, Eye, DollarSign } from "lucide-react";
import { Database, Sale } from "../types";
import { inr, round2 } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";

interface SalesHistoryViewProps {
  db: Database;
  onViewInvoice: (s: Sale) => void;
}

export const SalesHistoryView: React.FC<SalesHistoryViewProps> = ({
  db,
  onViewInvoice,
}) => {
  const [dateRange, setDateRange] = useState<"ALL" | "TODAY" | "THIS_MONTH" | "CUSTOM">("ALL");
  const [customStartDate, setCustomStartDate] = useState(todayStr());
  const [customEndDate, setCustomEndDate] = useState(todayStr());
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSales = db.sales.filter((s) => {
    // Date filter
    if (dateRange === "TODAY" && s.date !== todayStr()) return false;
    if (dateRange === "THIS_MONTH") {
      const currentMonthPrefix = todayStr().slice(0, 7); // "YYYY-MM"
      if (!s.date.startsWith(currentMonthPrefix)) return false;
    }
    if (dateRange === "CUSTOM") {
      if (s.date < customStartDate || s.date > customEndDate) return false;
    }

    // Payment Filter
    if (paymentFilter !== "ALL") {
      if (paymentFilter === "Finance" && !s.isFinance) return false;
      if (paymentFilter !== "Finance" && s.payment !== paymentFilter) return false;
    }

    // Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchInv = s.invoiceNo.toLowerCase().includes(q);
      const matchCust = (s.customer?.name || "").toLowerCase().includes(q) || (s.customer?.phone || "").includes(q);
      const matchItem = s.items.some((i) => i.name.toLowerCase().includes(q));
      return matchInv || matchCust || matchItem;
    }

    return true;
  });

  // Calculate Metrics
  const totalRevenue = filteredSales.reduce((a, s) => a + s.total, 0);
  const totalCost = filteredSales.reduce((a, s) => {
    const saleCost = s.items.reduce((sum, item) => sum + (item.cost || (item.purchasePrice * item.qty) || 0), 0);
    return a + saleCost;
  }, 0);
  const totalGrossProfit = round2(totalRevenue - totalCost);
  const marginPercent = totalRevenue > 0 ? round2((totalGrossProfit / totalRevenue) * 100) : 0;

  const exportCSV = () => {
    const headers = ["Invoice No", "Date", "Customer", "Phone", "Items Count", "Payment Mode", "Subtotal", "Discount", "Total", "Cost", "Gross Profit", "Status"];
    const rows = filteredSales.map((s) => {
      const cost = s.items.reduce((sum, item) => sum + (item.cost || (item.purchasePrice * item.qty) || 0), 0);
      return [
        s.invoiceNo,
        s.date,
        `"${s.customer?.name || "Walk-in"}"`,
        s.customer?.phone || "",
        s.items.length,
        s.payment,
        s.subtotal,
        s.discount,
        s.total,
        cost,
        round2(s.total - cost),
        s.status,
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sales-report-${todayStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      {/* 4 Financial Performance Metric Cards */}
      <div className="grid cols-4" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Sales Revenue</h3>
          <div className="big blue">{inr(totalRevenue)}</div>
          <div className="foot">{filteredSales.length} Invoices Generated</div>
        </div>
        <div className="card">
          <h3>Cost of Goods Sold (COGS)</h3>
          <div className="big">{inr(totalCost)}</div>
          <div className="foot">Purchase &amp; FIFO Cost</div>
        </div>
        <div className="card">
          <h3>Gross Profit</h3>
          <div className="big green">{inr(totalGrossProfit)}</div>
          <div className="foot">{marginPercent}% Overall Profit Margin</div>
        </div>
        <div className="card">
          <h3>Customer Udhaar Invoices</h3>
          <div className="big red">
            {inr(filteredSales.reduce((a, s) => a + (s.dueAmount || 0), 0))}
          </div>
          <div className="foot">Uncollected Udhaar in Range</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>📊 Sales Breakdown &amp; Itemized P&amp;L Ledger</h2>
            <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
              Filter by date, examine item-by-item profit margin, and download CSV reports
            </span>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button className="btn sm" onClick={exportCSV}>
              <Download size={13} /> Export CSV
            </button>
          </div>
        </div>

        {/* Filters Controls */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px", background: "var(--paper)", padding: "12px", borderRadius: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "11.5px", fontWeight: 700 }}>Date Range:</span>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              style={{ width: "130px", padding: "4px 8px" }}
            >
              <option value="ALL">All Time</option>
              <option value="TODAY">Today Only</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="CUSTOM">Custom Range</option>
            </select>
          </div>

          {dateRange === "CUSTOM" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={{ width: "130px", padding: "4px" }}
              />
              <span style={{ fontSize: "12px" }}>to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={{ width: "130px", padding: "4px" }}
              />
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "11.5px", fontWeight: 700 }}>Payment:</span>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              style={{ width: "130px", padding: "4px 8px" }}
            >
              <option value="ALL">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Credit / Udhaar">Udhaar</option>
              <option value="Finance">Mobile Finance</option>
            </select>
          </div>

          <div style={{ flex: 1, minWidth: "200px" }}>
            <input
              placeholder="Search invoice #, customer name, phone, item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: "5px 10px", fontSize: "13px" }}
            />
          </div>
        </div>

        {/* Detailed Sales Table */}
        <div className="table-wrap">
          {filteredSales.length === 0 ? (
            <div className="empty">No sales records matching selected filters.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date &amp; Time</th>
                  <th>Customer</th>
                  <th>Billed Items</th>
                  <th>Payment Mode</th>
                  <th>Total Billed</th>
                  <th>Cost (COGS)</th>
                  <th>Gross Profit</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.slice().reverse().map((s) => {
                  const saleCost = s.items.reduce(
                    (sum, item) => sum + (item.cost || item.purchasePrice * item.qty || 0),
                    0
                  );
                  const saleProfit = round2(s.total - saleCost);

                  return (
                    <tr key={s.id}>
                      <td><b>{s.invoiceNo}</b></td>
                      <td>
                        {s.date} <span className="hint">{s.time}</span>
                      </td>
                      <td>
                        <b>{s.customer?.name || "Walk-in"}</b>
                        {s.customer?.phone && <div className="hint">{s.customer.phone}</div>}
                      </td>
                      <td>
                        <div style={{ maxWidth: "240px", fontSize: "12px" }}>
                          {s.items.map((i) => `${i.name} (x${i.qty})`).join(", ")}
                        </div>
                      </td>
                      <td>
                        <span className="badge info">{s.payment}</span>
                      </td>
                      <td><b>{inr(s.total)}</b></td>
                      <td>{inr(saleCost)}</td>
                      <td>
                        <b style={{ color: saleProfit >= 0 ? "var(--green)" : "var(--red)" }}>
                          {inr(saleProfit)}
                        </b>
                      </td>
                      <td>
                        <button
                          className="btn sm primary"
                          onClick={() => onViewInvoice(s)}
                        >
                          <Eye size={12} /> View Bill
                        </button>
                      </td>
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
