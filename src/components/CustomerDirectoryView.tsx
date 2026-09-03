import React, { useMemo, useState } from "react";
import { Search, Download, Send, Copy, Printer, Users } from "lucide-react";
import { Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";
import { sendTelegramReport } from "../services/telegram";

interface CustomerDirectoryViewProps {
  db: Database;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

type RangeMode = "all" | "today" | "month" | "custom";

function ymd(d: string) {
  // createdAt is stored as an ISO string; Sale/Customer date-only fields are
  // plain YYYY-MM-DD. Normalize both to YYYY-MM-DD for comparison.
  return (d || "").slice(0, 10);
}

export const CustomerDirectoryView: React.FC<CustomerDirectoryViewProps> = ({ db, toast }) => {
  const [search, setSearch] = useState("");
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const monthStart = todayStr().slice(0, 7) + "-01";

  const filtered = useMemo(() => {
    let list = [...(db.customers || [])];

    if (rangeMode === "today") {
      list = list.filter((c) => ymd(c.createdAt) === todayStr());
    } else if (rangeMode === "month") {
      list = list.filter((c) => ymd(c.createdAt) >= monthStart);
    } else if (rangeMode === "custom" && (customFrom || customTo)) {
      list = list.filter((c) => {
        const d = ymd(c.createdAt);
        if (customFrom && d < customFrom) return false;
        if (customTo && d > customTo) return false;
        return true;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone || "").includes(q) ||
          (c.address || "").toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [db.customers, rangeMode, customFrom, customTo, search, monthStart]);

  const rangeLabel =
    rangeMode === "today" ? `Today (${todayStr()})` :
    rangeMode === "month" ? `This Month (${monthStart.slice(0, 7)})` :
    rangeMode === "custom" ? `${customFrom || "…"} to ${customTo || "…"}` :
    "All Time";

  const buildReportText = () => {
    const shop = db.settings.shopName || "Our Shop";
    const lines = [
      `📋 *Customer List — ${shop}*`,
      `Range: ${rangeLabel}`,
      ``,
      ...filtered.map((c, i) => `${i + 1}. ${c.name} — ${c.phone}${c.address ? ` — ${c.address}` : ""}`),
      ``,
      `Total: ${filtered.length} customer(s)`,
    ];
    return lines.join("\n");
  };

  const handleCopyForWhatsApp = async () => {
    if (filtered.length === 0) { toast("Is filter mein koi customer nahi mila", "amber"); return; }
    try {
      await navigator.clipboard.writeText(buildReportText());
      toast("Copy ho gaya — ab WhatsApp group mein paste kar dijiye", "green");
    } catch {
      toast("Copy nahi ho paya — browser permission check karein", "red");
    }
  };

  const handleSendTelegram = async () => {
    if (filtered.length === 0) { toast("Is filter mein koi customer nahi mila", "amber"); return; }
    setIsSending(true);
    try {
      await sendTelegramReport(buildReportText());
      toast("Telegram par customer list bhej di gayi", "green");
    } catch (e: any) {
      toast(e?.message || "Telegram bhejne mein error aayi — pehle Settings mein Telegram connect karein", "red");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2><Users size={18} style={{ verticalAlign: "middle", marginRight: "6px" }} />Customer Directory</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn sm" onClick={handleCopyForWhatsApp}>
              <Copy size={14} /> Copy for WhatsApp
            </button>
            <button className="btn sm" onClick={handleSendTelegram} disabled={isSending}>
              <Send size={14} /> {isSending ? "Sending..." : "Send to Telegram"}
            </button>
            <button className="btn primary sm" onClick={() => setIsPrintOpen(true)}>
              <Download size={14} /> Export PDF
            </button>
          </div>
        </div>

        <div className="filter-bar" style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", margin: "12px 0" }}>
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "10px", opacity: 0.5 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Naam, mobile ya address se dhundein"
              style={{ paddingLeft: "30px", width: "100%" }}
            />
          </div>

          <div className="mode-pill">
            <button className={rangeMode === "all" ? "on" : ""} onClick={() => setRangeMode("all")}>All</button>
            <button className={rangeMode === "today" ? "on" : ""} onClick={() => setRangeMode("today")}>Today</button>
            <button className={rangeMode === "month" ? "on" : ""} onClick={() => setRangeMode("month")}>This Month</button>
            <button className={rangeMode === "custom" ? "on" : ""} onClick={() => setRangeMode("custom")}>Custom</button>
          </div>

          {rangeMode === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="hint">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
        </div>

        <div className="hint" style={{ marginBottom: "8px" }}>{filtered.length} customer(s) — {rangeLabel}</div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile Number</th>
                <th>Address</th>
                <th>Added On</th>
                <th>Outstanding Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><b className="truncate" title={c.name}>{c.name}</b></td>
                  <td>{c.phone}</td>
                  <td>{c.address || "—"}</td>
                  <td>{ymd(c.createdAt) || "—"}</td>
                  <td style={{ fontWeight: 800, color: (c.totalDue || 0) > 0 ? "var(--red)" : "var(--green)" }}>
                    {inr(c.totalDue || 0)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "20px" }}>Is filter mein koi customer nahi mila</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isPrintOpen && (
        <div className="overlay show">
          <div className="modal wide">
            <div className="modal-head">
              <h3>Customer List — Print / Save as PDF</h3>
              <button onClick={() => setIsPrintOpen(false)}>&times;</button>
            </div>

            <div id="print-area" style={{ padding: "16px", background: "#fff", color: "#111" }}>
              <h2 style={{ marginBottom: "2px" }}>{db.settings.shopName || "Our Shop"}</h2>
              <div style={{ fontSize: "12px", marginBottom: "10px" }}>Customer List — {rangeLabel} — Generated {todayStr()}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ border: "1px solid #ccc", padding: "6px", textAlign: "left" }}>#</th>
                    <th style={{ border: "1px solid #ccc", padding: "6px", textAlign: "left" }}>Name</th>
                    <th style={{ border: "1px solid #ccc", padding: "6px", textAlign: "left" }}>Mobile Number</th>
                    <th style={{ border: "1px solid #ccc", padding: "6px", textAlign: "left" }}>Address</th>
                    <th style={{ border: "1px solid #ccc", padding: "6px", textAlign: "left" }}>Added On</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.id}>
                      <td style={{ border: "1px solid #ccc", padding: "6px" }}>{i + 1}</td>
                      <td style={{ border: "1px solid #ccc", padding: "6px" }}>{c.name}</td>
                      <td style={{ border: "1px solid #ccc", padding: "6px" }}>{c.phone}</td>
                      <td style={{ border: "1px solid #ccc", padding: "6px" }}>{c.address || "—"}</td>
                      <td style={{ border: "1px solid #ccc", padding: "6px" }}>{ymd(c.createdAt) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: "10px", fontSize: "12px" }}>Total: {filtered.length} customer(s)</div>
            </div>

            <div className="modal-actions" style={{ marginTop: "16px" }}>
              <button className="btn" onClick={() => setIsPrintOpen(false)}>Close</button>
              <button className="btn primary" onClick={() => window.print()}>
                <Printer size={14} /> Print / Save as PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
