import React, { useMemo, useState } from "react";
import { Search, Download, Send, Copy, Printer, Users, Sparkles, MessageCircle } from "lucide-react";
import { Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";
import { sendTelegramReport } from "../services/telegram";
import { getDueReminderMessage } from "../services/aiOps";
import { openWhatsApp } from "../services/whatsapp";
import { downloadCsv } from "../utils/csvExport";

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
  // Phase 6: Customer profile — full purchase history. Sales/returns/
  // exchanges/warranty claims embed their own `{ name, phone }` snapshot
  // rather than a customer-record id (see types.ts), so phone number is the
  // only reliable join key back to the directory here — same assumption
  // CustomerKhata/DailyGallaModal already make elsewhere in this codebase.
  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null);
  // 2026-09-04: AI-drafted WhatsApp due-payment reminder, one draft at a time
  // (keyed by customer id) shown inline under the row rather than a modal —
  // this is a short list of customers, not worth a popup per item.
  const [reminderState, setReminderState] = useState<Record<string, { loading: boolean; text: string; error: string }>>({});

  const handleAiReminder = async (customerId: string, name: string, phone: string, dueAmount: number) => {
    setReminderState((prev) => ({ ...prev, [customerId]: { loading: true, text: "", error: "" } }));
    try {
      const message = await getDueReminderMessage({
        customerName: name,
        dueAmount,
        shopName: db.settings.shopName,
      });
      setReminderState((prev) => ({ ...prev, [customerId]: { loading: false, text: message, error: "" } }));
    } catch (e) {
      setReminderState((prev) => ({
        ...prev,
        [customerId]: { loading: false, text: "", error: e instanceof Error ? e.message : "AI reminder failed." },
      }));
    }
  };

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

  const profileCustomer = useMemo(() => {
    if (!profileCustomerId) return null;
    const c = (db.customers || []).find((x) => x.id === profileCustomerId);
    if (!c) return null;
    const phone = (c.phone || "").trim();
    const sales = phone
      ? (db.sales || [])
          .filter((s) => (s.customer?.phone || "").trim() === phone && s.status !== "Cancelled")
          .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      : [];
    const returns = phone ? (db.returns || []).filter((r) => (r.customer?.phone || "").trim() === phone) : [];
    const totalSpent = sales.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const totalRefunded = returns.reduce((a, r) => a + (Number(r.settlementAmount) || 0), 0);
    const visitCount = sales.length;
    const avgOrderValue = visitCount > 0 ? totalSpent / visitCount : 0;
    return { customer: c, sales, returns, totalSpent, totalRefunded, visitCount, avgOrderValue };
  }, [profileCustomerId, db.customers, db.sales, db.returns]);

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

  const handleExportExcel = () => {
    if (filtered.length === 0) { toast("Is filter mein koi customer nahi mila", "amber"); return; }
    downloadCsv(
      `customers-${rangeLabel.replace(/[^a-z0-9]+/gi, "-")}`,
      ["Name", "Mobile Number", "Address", "Added On", "Outstanding Due", "Loyalty Points"],
      filtered.map((c) => [c.name, c.phone, c.address || "", ymd(c.createdAt), c.totalDue || 0, c.loyaltyPoints || 0])
    );
    toast("Excel (CSV) file download ho gayi", "green");
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
            <button className="btn sm" onClick={handleExportExcel}>
              <Download size={14} /> Export Excel
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
                <th>Reminder</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="clickable-row" style={{ cursor: "pointer" }} onClick={() => setProfileCustomerId(c.id)}>
                  <td><b className="truncate" title={c.name}>{c.name}</b></td>
                  <td>{c.phone}</td>
                  <td>{c.address || "—"}</td>
                  <td>{ymd(c.createdAt) || "—"}</td>
                  <td style={{ fontWeight: 800, color: (c.totalDue || 0) > 0 ? "var(--red)" : "var(--green)" }}>
                    {inr(c.totalDue || 0)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {(c.totalDue || 0) > 0 ? (
                      <div style={{ minWidth: "180px" }}>
                        {!reminderState[c.id] && (
                          <button
                            className="btn sm"
                            style={{ fontSize: "11px", padding: "3px 8px" }}
                            onClick={() => handleAiReminder(c.id, c.name, c.phone, c.totalDue || 0)}
                          >
                            <Sparkles size={12} /> AI Reminder
                          </button>
                        )}
                        {reminderState[c.id]?.loading && (
                          <span style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Likh rahe hain...</span>
                        )}
                        {reminderState[c.id]?.error && (
                          <div style={{ fontSize: "11px", color: "var(--red)" }}>
                            {reminderState[c.id].error}{" "}
                            <button
                              className="btn sm"
                              style={{ fontSize: "10px", padding: "2px 6px" }}
                              onClick={() => handleAiReminder(c.id, c.name, c.phone, c.totalDue || 0)}
                            >
                              Retry
                            </button>
                          </div>
                        )}
                        {reminderState[c.id]?.text && (
                          <div>
                            <div style={{ fontSize: "11px", color: "var(--ink-soft)", whiteSpace: "pre-line", marginBottom: "4px" }}>
                              {reminderState[c.id].text}
                            </div>
                            <button
                              className="btn sm green"
                              style={{ fontSize: "11px", padding: "3px 8px" }}
                              onClick={() => {
                                const ok = openWhatsApp(c.phone, reminderState[c.id].text);
                                if (!ok) toast("Phone number invalid lag raha hai.", "red");
                              }}
                            >
                              <MessageCircle size={12} /> WhatsApp par bhejo
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: "20px" }}>Is filter mein koi customer nahi mila</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {profileCustomer && (
        <div className="overlay show">
          <div className="modal wide">
            <div className="modal-head">
              <h3>{profileCustomer.customer.name} — Purchase History</h3>
              <button onClick={() => setProfileCustomerId(null)}>&times;</button>
            </div>

            <div style={{ padding: "4px 0 14px" }}>
              <div className="hint" style={{ marginBottom: "10px" }}>
                {profileCustomer.customer.phone}
                {profileCustomer.customer.address ? ` • ${profileCustomer.customer.address}` : ""}
                {profileCustomer.customer.email ? ` • ${profileCustomer.customer.email}` : ""}
              </div>

              <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "16px" }}>
                <div className="stat-card">
                  <div className="hint">Lifetime Spend</div>
                  <div style={{ fontWeight: 800, fontSize: "16px" }}>{inr(profileCustomer.totalSpent)}</div>
                </div>
                <div className="stat-card">
                  <div className="hint">Total Visits</div>
                  <div style={{ fontWeight: 800, fontSize: "16px" }}>{profileCustomer.visitCount}</div>
                </div>
                <div className="stat-card">
                  <div className="hint">Avg. Order Value</div>
                  <div style={{ fontWeight: 800, fontSize: "16px" }}>{inr(profileCustomer.avgOrderValue)}</div>
                </div>
                <div className="stat-card">
                  <div className="hint">Outstanding Due</div>
                  <div style={{ fontWeight: 800, fontSize: "16px", color: (profileCustomer.customer.totalDue || 0) > 0 ? "var(--red)" : "var(--green)" }}>
                    {inr(profileCustomer.customer.totalDue || 0)}
                  </div>
                </div>
              </div>

              {(profileCustomer.customer.loyaltyPoints || 0) > 0 && (
                <div className="hint" style={{ marginBottom: "12px" }}>
                  🎁 Loyalty Points: <b>{profileCustomer.customer.loyaltyPoints}</b>
                </div>
              )}

              <h4 style={{ margin: "0 0 8px" }}>All Purchases ({profileCustomer.sales.length})</h4>
              <div className="table-wrap" style={{ maxHeight: "320px", overflowY: "auto" }}>
                {profileCustomer.sales.length === 0 ? (
                  <div className="empty">Is customer ka abhi tak koi purchase record nahi hai.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Invoice #</th>
                        <th>Items</th>
                        <th>Payment</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profileCustomer.sales.map((s) => (
                        <tr key={s.id}>
                          <td>{s.date} <span className="hint">{s.time}</span></td>
                          <td><b>{s.invoiceNo}</b></td>
                          <td style={{ maxWidth: "260px", fontSize: "12px" }}>
                            {s.items.map((i) => `${i.name} (x${i.qty})`).join(", ")}
                          </td>
                          <td><span className="badge info">{s.payment}</span></td>
                          <td style={{ fontWeight: 700 }}>{inr(s.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {profileCustomer.returns.length > 0 && (
                <>
                  <h4 style={{ margin: "16px 0 8px" }}>Returns ({profileCustomer.returns.length}, {inr(profileCustomer.totalRefunded)} refunded)</h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Return #</th>
                          <th>Invoice Ref</th>
                          <th>Refund</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profileCustomer.returns.map((r) => (
                          <tr key={r.id}>
                            <td>{r.date}</td>
                            <td>{r.returnNo}</td>
                            <td>{r.invoiceNo}</td>
                            <td style={{ color: "var(--red)", fontWeight: 700 }}>{inr(r.settlementAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setProfileCustomerId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

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
