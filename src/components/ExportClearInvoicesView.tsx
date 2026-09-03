// Step 7.2 — Delete Policy: "Invoices/PDFs kabhi auto-delete nahi hongi.
// Owner ke paas 'Export & Clear' tool — jaise 'last 1/3 month ka combined
// PDF banao' → phir purane individual records delete karo. Yeh sirf Owner
// kar sakta hai, manually."
//
// Design notes:
// - Nothing here EVER deletes automatically. The delete button only turns
//   on after the owner has actually triggered the combined print/PDF.
// - Only sales whose Step-4-correction-window has already passed are
//   selectable — a sale that could still be edited/cancelled has no
//   business being archived out of the working data yet, and this reuses
//   the exact same `isSaleWithinCorrectionWindow` the rest of the app
//   already trusts for "is this sale still live".
// - Uses the app's existing #print-area + @media print CSS (same pattern
//   as InvoiceViewerModal) instead of pulling in a PDF library — the
//   owner's browser "Save as PDF" print dialog IS the export.
import React, { useMemo, useState } from "react";
import { Archive, Printer, Trash2, AlertTriangle } from "lucide-react";
import { Database, Sale } from "../types";
import { inr } from "../utils/indianCurrency";

interface ExportClearInvoicesViewProps {
  db: Database;
  isSaleWithinCorrectionWindow: (s: Sale) => boolean;
  onClear: (saleIds: string[]) => void;
  toast?: (msg: string, type?: "green" | "red" | "amber") => void;
}

type RangePreset = "last1m" | "last3m" | "custom";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const ExportClearInvoicesView: React.FC<ExportClearInvoicesViewProps> = ({
  db,
  isSaleWithinCorrectionWindow,
  onClear,
  toast,
}) => {
  const [preset, setPreset] = useState<RangePreset>("last3m");
  const [fromDate, setFromDate] = useState(isoDaysAgo(90));
  const [toDate, setToDate] = useState(isoDaysAgo(0));
  const [hasPrinted, setHasPrinted] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const effectiveFrom = preset === "last1m" ? isoDaysAgo(30) : preset === "last3m" ? isoDaysAgo(90) : fromDate;
  const effectiveTo = preset === "custom" ? toDate : isoDaysAgo(0);

  // Eligible = inside the chosen date range AND its correction window has
  // already expired (permanently locked, per Step 4's plan) — this tool
  // is for archiving old, settled history, never active/editable sales.
  const matchingSales = useMemo(() => {
    return db.sales
      .filter((s) => s.date >= effectiveFrom && s.date <= effectiveTo)
      .filter((s) => !isSaleWithinCorrectionWindow(s))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, [db.sales, effectiveFrom, effectiveTo, isSaleWithinCorrectionWindow]);

  const totalValue = matchingSales.reduce((a, s) => a + (s.total || 0), 0);

  // Changing the range invalidates any earlier print/confirm state — the
  // owner must re-print if they widen/narrow the selection, so the PDF
  // they saved always actually matches what they're about to delete.
  const resetGate = () => {
    setHasPrinted(false);
    setConfirmChecked(false);
  };

  const handlePrint = () => {
    if (!matchingSales.length) return;
    setHasPrinted(true);
    // Let the print-area render with the new content before printing.
    setTimeout(() => window.print(), 50);
  };

  const handleClear = () => {
    if (!hasPrinted || !confirmChecked || !matchingSales.length) return;
    const ok = window.confirm(
      `${matchingSales.length} invoice record(s) permanently delete karein? Combined PDF pehle se print/save ho chuka hai. Yeh undo nahi ho sakta.`
    );
    if (!ok) return;
    onClear(matchingSales.map((s) => s.id));
    toast?.(`${matchingSales.length} purane invoice records clear kar diye gaye.`, "green");
    resetGate();
  };

  return (
    <div className="section">
      <div className="section-head">
        <h2><Archive size={18} style={{ verticalAlign: "-3px", marginRight: "6px" }} />Export & Clear Old Invoices</h2>
      </div>

      <div className="card" style={{ marginBottom: "16px" }}>
        <p className="hint" style={{ marginTop: 0 }}>
          Purane invoices kabhi apne aap delete nahi hote — yeh sirf Owner ka manual tool hai. Pehle ek combined
          PDF print/save karo, uske baad hi individual records delete karne ka option milega. Sirf woh invoices
          yahan dikhte hain jinki correction window (Settings mein set) khatam ho chuki hai — abhi editable/live
          sale kabhi delete nahi hota.
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          <button
            className={`btn sm${preset === "last1m" ? " primary" : ""}`}
            onClick={() => { setPreset("last1m"); resetGate(); }}
          >
            Last 1 Month
          </button>
          <button
            className={`btn sm${preset === "last3m" ? " primary" : ""}`}
            onClick={() => { setPreset("last3m"); resetGate(); }}
          >
            Last 3 Months
          </button>
          <button
            className={`btn sm${preset === "custom" ? " primary" : ""}`}
            onClick={() => { setPreset("custom"); resetGate(); }}
          >
            Custom Range
          </button>
        </div>

        {preset === "custom" && (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
            <label>
              From:{" "}
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); resetGate(); }}
              />
            </label>
            <label>
              To:{" "}
              <input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); resetGate(); }}
              />
            </label>
          </div>
        )}

        <div className="stat-row" style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
          <div><b>{matchingSales.length}</b> invoice(s) is range mein, lock ho chuki (deletable)</div>
          <div>Total value: <b>{inr(totalValue)}</b></div>
        </div>
      </div>

      {matchingSales.length === 0 ? (
        <div className="empty">Is range mein koi bhi eligible (locked) invoice nahi mila.</div>
      ) : (
        <>
          <div className="table-wrap" style={{ marginBottom: "16px" }}>
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {matchingSales.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.invoiceNo}</b></td>
                    <td>{s.date}</td>
                    <td>{s.customer?.name || "Walk-in"}</td>
                    <td>{inr(s.total)}</td>
                    <td>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <button className="btn primary" onClick={handlePrint}>
                <Printer size={14} /> Combined PDF Print / Save karo ({matchingSales.length} invoices)
              </button>
              {hasPrinted && <span className="badge ok">✅ Print ho chuka hai is session mein</span>}
            </div>

            {hasPrinted && (
              <div className="alert amber" style={{ marginBottom: "12px" }}>
                <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
                Aage badhne se pehle confirm karo ki PDF safely save/print ho gaya hai — delete hone ke baad yeh
                records wapas nahi aayenge (backup sirf weekly Telegram export mein rahega).
                <div style={{ marginTop: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={confirmChecked}
                      onChange={(e) => setConfirmChecked(e.target.checked)}
                    />
                    Haan, maine combined PDF safely save/print kar liya hai.
                  </label>
                </div>
              </div>
            )}

            <button
              className="btn sm danger"
              disabled={!hasPrinted || !confirmChecked}
              onClick={handleClear}
            >
              <Trash2 size={12} /> Ab In {matchingSales.length} Records Ko Delete Karo
            </button>
          </div>
        </>
      )}

      {/* Combined printable area — only populated/visible via @media print,
          matching InvoiceViewerModal's existing #print-area pattern. */}
      <div id="print-area" style={{ display: hasPrinted ? "block" : "none" }}>
        <h2>{db.settings.shopName || "DS Mobile & Digital Hub"} — Combined Invoice Export</h2>
        <p>
          Range: {effectiveFrom} to {effectiveTo} &nbsp;|&nbsp; {matchingSales.length} invoices &nbsp;|&nbsp;
          Total: {inr(totalValue)}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Invoice #</th>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Date</th>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Customer</th>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Items</th>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Payment</th>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Total</th>
              <th style={{ border: "1px solid #999", padding: "4px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {matchingSales.map((s) => (
              <tr key={s.id}>
                <td style={{ border: "1px solid #999", padding: "4px" }}>{s.invoiceNo}</td>
                <td style={{ border: "1px solid #999", padding: "4px" }}>{s.date}</td>
                <td style={{ border: "1px solid #999", padding: "4px" }}>{s.customer?.name || "Walk-in"}</td>
                <td style={{ border: "1px solid #999", padding: "4px" }}>
                  {s.items.map((it) => `${it.name} x${it.qty}`).join(", ")}
                </td>
                <td style={{ border: "1px solid #999", padding: "4px" }}>{s.payment}</td>
                <td style={{ border: "1px solid #999", padding: "4px" }}>{inr(s.total)}</td>
                <td style={{ border: "1px solid #999", padding: "4px" }}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
