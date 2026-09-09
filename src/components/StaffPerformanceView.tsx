import React, { useEffect, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { getStaffPerformance, StaffPerformanceRow } from "../services/repository";

interface StaffPerformanceViewProps {
  showToast: (msg: string, color?: string) => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthStr(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export const StaffPerformanceView: React.FC<StaffPerformanceViewProps> = ({ showToast }) => {
  const [startDate, setStartDate] = useState(firstOfMonthStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [rows, setRows] = useState<StaffPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getStaffPerformance(startDate, endDate);
      setRows(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Staff performance load nahi ho paya.", "red");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSalesAll = rows.reduce((a, r) => a + Number(r.total_sales || 0), 0);

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <TrendingUp size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Staff Performance
        </h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ fontSize: "12px" }} />
          <span style={{ fontSize: "12px" }}>se</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ fontSize: "12px" }} />
          <button className="btn sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 0 }}>
        Chuni gayi date range mein har staff member ne kitni sales ki — invoice count, total ₹ aur
        average sale value. Sirf owner/manager ko ye dikhta hai.
      </p>

      {loading && rows.length === 0 ? (
        <div className="empty">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="empty">Is date range mein koi sale record nahi mila.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Invoices</th>
                <th>Total Sales (₹)</th>
                <th>Avg Sale (₹)</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staff_id}>
                  <td style={{ fontWeight: 700 }}>{r.staff_name}</td>
                  <td>{r.invoice_count}</td>
                  <td>₹{Number(r.total_sales).toLocaleString("en-IN")}</td>
                  <td>₹{Number(r.avg_sale_value).toLocaleString("en-IN")}</td>
                  <td>{totalSalesAll > 0 ? `${Math.round((Number(r.total_sales) / totalSalesAll) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
