import React, { useState } from "react";
import { DollarSign, Printer, CheckCircle2, ChevronDown, ChevronUp, Smartphone } from "lucide-react";
import { Database, DailyGallaClosing } from "../types";
import { inr } from "../utils/indianCurrency";
import { uid, todayStr, nowTimeStr } from "../utils/fifoEngine";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface DailyGallaModalProps {
  db: Database;
  onClose: () => void;
  onSaveGalla: (closing: DailyGallaClosing) => void;
  selectedDate?: string;
}

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const ONLINE_METHODS = ["UPI", "Card", "Bank Transfer"];

export const DailyGallaModal: React.FC<DailyGallaModalProps> = ({
  db,
  onClose,
  onSaveGalla,
  selectedDate = todayStr(),
}) => {
  // Auto-carry-forward: yesterday's cash left in the drawer is today's
  // opening balance automatically — owner/staff no longer has to
  // remember or re-type it every day.
  const priorClosings = (db.gallaClosings || [])
    .filter((g) => g.date < selectedDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const previousClosing = priorClosings[0];
  const autoOpeningCash = previousClosing
    ? previousClosing.actualCashCounted
    : db.settings.openingCashDefault || 0;

  const [openingCash, setOpeningCash] = useState<number>(autoOpeningCash);
  const [cashInGalla, setCashInGalla] = useState<string>("");
  const [onlinePayment, setOnlinePayment] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [showNoteCount, setShowNoteCount] = useState(false);
  const [denomsCount, setDenomsCount] = useState<{ [key: number]: number }>({
    500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 2: 0, 1: 0,
  });
  const [isSaved, setIsSaved] = useState(false);
  const [savedRecord, setSavedRecord] = useState<DailyGallaClosing | null>(null);
  const { closing, requestClose } = useAnimatedClose(onClose);

  // ---- Everything below is calculated automatically from today's sales,
  // khata collections, xerox, repairs & expenses. Owner/staff never has
  // to type any of it in — matches "jitna selling ho automatically add ho jaye". ----

  const salesToday = db.sales.filter((s) => s.date === selectedDate);
  const isOnlineMethod = (m?: string) => !!m && ONLINE_METHODS.includes(m);

  const cashSales = salesToday.reduce((a, s) => {
    if (s.isFinance) return a + (s.financeDetails?.downPayment || 0);
    if (s.payment === "Cash") return a + (s.amountPaid || s.total);
    return a;
  }, 0);
  const onlineSales = salesToday.reduce((a, s) => {
    if (s.isFinance) return a;
    if (isOnlineMethod(s.payment)) return a + (s.amountPaid || s.total);
    return a;
  }, 0);

  let cashKhata = 0;
  let onlineKhata = 0;
  db.customers.forEach((c) => {
    (c.payments || []).forEach((p) => {
      if (p.date !== selectedDate) return;
      if (isOnlineMethod(p.method)) onlineKhata += p.amount;
      else if (!p.method || p.method === "Cash") cashKhata += p.amount;
    });
  });

  const xeroxToday = (db.xeroxEntries || []).filter((x) => x.date === selectedDate);
  const cashXerox = xeroxToday.filter((x) => x.paymentMethod === "Cash").reduce((a, x) => a + x.totalAmount, 0);
  const onlineXerox = xeroxToday.filter((x) => isOnlineMethod(x.paymentMethod)).reduce((a, x) => a + x.totalAmount, 0);

  const cashRepairs = db.jobs.filter((j) => j.receivedDate === selectedDate || j.deliveredDate === selectedDate).reduce((a, j) => {
    let amt = 0;
    if (j.receivedDate === selectedDate) amt += j.advance || 0;
    if (j.deliveredDate === selectedDate && (!j.deliveryPaymentMethod || j.deliveryPaymentMethod === "Cash")) {
      amt += Math.max(0, (j.finalCharge || j.estCost || 0) - (j.advance || 0));
    }
    return a + amt;
  }, 0);
  const onlineRepairs = db.jobs.filter((j) => j.deliveredDate === selectedDate && isOnlineMethod(j.deliveryPaymentMethod)).reduce((a, j) => {
    return a + Math.max(0, (j.finalCharge || j.estCost || 0) - (j.advance || 0));
  }, 0);

  const cashExpenses = (db.expenses.shop || []).concat(db.expenses.personal || [], db.expenses.other || [])
    .filter((e) => e.date === selectedDate && (!e.method || e.method === "Cash")).reduce((a, e) => a + e.amount, 0);
  const cashSupplierPaid = (db.supplierPayments || []).filter((p) => p.date === selectedDate && p.method === "Cash").reduce((a, p) => a + p.amount, 0);
  const cashRefunds = db.returns.filter((r) => r.date === selectedDate && r.refundMethod === "Cash").reduce((a, r) => a + (r.settlementAmount || 0), 0);
  const cashExtraIncome = (db.extraIncome || []).filter((e) => e.date === selectedDate && (!e.method || e.method === "Cash")).reduce((a, e) => a + e.amount, 0);

  const totalCashIn = cashSales + cashKhata + cashXerox + cashRepairs + cashExtraIncome;
  const totalCashOut = cashExpenses + cashSupplierPaid + cashRefunds;
  const expectedCashInGalla = openingCash + totalCashIn - totalCashOut;
  const expectedOnline = onlineSales + onlineKhata + onlineXerox + onlineRepairs;

  const actualCashCounted = showNoteCount
    ? DENOMS.reduce((a, d) => a + d * (denomsCount[d] || 0), 0)
    : Number(cashInGalla) || 0;
  const onlineReceived = Number(onlinePayment) || 0;

  const cashDiff = actualCashCounted - expectedCashInGalla;
  const onlineDiff = onlineReceived - expectedOnline;

  const handleSaveClosing = () => {
    const existing = (db.gallaClosings || []).find((g) => g.date === selectedDate);
    if (existing) {
      const confirmReplace = window.confirm(
        `${selectedDate} pehle se close ho chuka hai (${existing.closedAt} par record hua tha). Is naye count se purana closing replace karein?`
      );
      if (!confirmReplace) return;
      db.gallaClosings = (db.gallaClosings || []).filter((g) => g.date !== selectedDate);
    }

    const closing: DailyGallaClosing = {
      id: uid("galla"),
      date: selectedDate,
      closedAt: nowTimeStr(),
      openingCash,
      cashSales,
      cashKhataCollected: cashKhata,
      cashXeroxTotal: cashXerox,
      cashRepairCollected: cashRepairs,
      cashExtraIncome,
      cashExpensesPaid: cashExpenses,
      cashSupplierPaid,
      cashRefundsPaid: cashRefunds,
      expectedCash: expectedCashInGalla,
      actualCashCounted,
      overageOrShortage: cashDiff,
      onlinePaymentReceived: onlineReceived,
      expectedOnlinePayment: expectedOnline,
      onlineDiff,
      denominations: showNoteCount ? (denomsCount as any) : undefined,
      status: "Closed & Verified",
      notes,
    };

    if (!db.gallaClosings) db.gallaClosings = [];
    db.gallaClosings.push(closing);
    setSavedRecord(closing);
    setIsSaved(true);
    onSaveGalla(closing);
  };

  const diffBadge = (diff: number) => (
    <b style={{ color: diff === 0 ? "var(--green)" : diff > 0 ? "var(--blue)" : "var(--red)" }}>
      {diff === 0 ? "✔ Match" : diff > 0 ? `+${inr(diff)} (Extra)` : `-${inr(Math.abs(diff))} (Kam)`}
    </b>
  );

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`}>
        <div className="modal-head">
          <h3>
            <DollarSign size={18} style={{ color: "var(--glow)", marginRight: "8px", verticalAlign: "middle" }} />
            Daily Galla Closing — {selectedDate}
          </h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        {isSaved && savedRecord ? (
          <div id="print-area">
            <div className="invoice-paper" style={{ padding: "24px" }}>
              <div className="status-strip ok">DAILY GALLA CLOSING VOUCHER</div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: "12px", marginTop: "12px" }}>
                <div>
                  <h2 style={{ margin: 0, color: "var(--navy)" }}>{db.settings.shopName}</h2>
                  <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>{db.settings.address} • Ph: {db.settings.phone}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: "15px" }}>Date: {savedRecord.date}</div>
                  <div style={{ fontSize: "12px" }}>Closed At: {savedRecord.closedAt}</div>
                </div>
              </div>

              <div className="grid cols-2" style={{ gap: "16px", marginTop: "16px" }}>
                <div>
                  <div className="kv"><span>Opening Balance</span><b>{inr(savedRecord.openingCash)}</b></div>
                  <div className="kv"><span>+ Today's Sales/Collections (Cash)</span><b>+{inr(savedRecord.cashSales + savedRecord.cashKhataCollected + savedRecord.cashXeroxTotal + savedRecord.cashRepairCollected + (savedRecord.cashExtraIncome || 0))}</b></div>
                  <div className="kv"><span>- Today's Expenses/Payments (Cash)</span><b>-{inr(savedRecord.cashExpensesPaid + savedRecord.cashSupplierPaid + savedRecord.cashRefundsPaid)}</b></div>
                  <div className="kv" style={{ fontWeight: 800, background: "var(--blue-light)", padding: "8px" }}>
                    <span>Expected Closing Balance:</span>
                    <b style={{ color: "var(--navy)" }}>{inr(savedRecord.expectedCash)}</b>
                  </div>
                </div>
                <div>
                  <div className="kv"><span>Cash Physically in Galla:</span><b>{inr(savedRecord.actualCashCounted)}</b></div>
                  <div className="kv"><span>Cash Overage/Shortage:</span>{diffBadge(savedRecord.overageOrShortage)}</div>
                  <div className="kv" style={{ marginTop: "10px" }}><span>Online Payment Received:</span><b>{inr(savedRecord.onlinePaymentReceived)}</b></div>
                  <div className="kv"><span>Expected Online (system):</span><b>{inr(savedRecord.expectedOnlinePayment)}</b></div>
                  <div className="kv"><span>Online Overage/Shortage:</span>{diffBadge(savedRecord.onlineDiff)}</div>
                </div>
              </div>

              {savedRecord.notes && (
                <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--ink-soft)" }}>
                  <b>Notes:</b> {savedRecord.notes}
                </div>
              )}

              <div className="invoice-foot-grid" style={{ marginTop: "30px" }}>
                <div className="sign-box"><div className="sign-line">Cashier / Staff Signature</div></div>
                <div className="sign-box"><div className="sign-line">Owner Verification Signature</div></div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ background: "var(--blue-light)", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "var(--ink-soft)", textTransform: "uppercase", marginBottom: "6px" }}>
                Auto-calculated from today's sales — nothing to type here
              </div>
              <div className="grid cols-2" style={{ gap: "4px 20px" }}>
                <div className="kv" style={{ fontSize: "13px" }}><span>Opening Balance (yesterday's cash carried forward)</span><b>{inr(openingCash)}</b></div>
                <div className="kv" style={{ fontSize: "13px" }}><span>Today's Cash Sales/Collections Added</span><b style={{ color: "var(--green)" }}>+{inr(totalCashIn)}</b></div>
                <div className="kv" style={{ fontSize: "13px" }}><span>Today's Cash Expenses/Payments Subtracted</span><b style={{ color: "var(--red)" }}>-{inr(totalCashOut)}</b></div>
                <div className="kv" style={{ fontSize: "13px" }}><span>= Expected Closing Balance</span><b style={{ color: "var(--navy)" }}>{inr(expectedCashInGalla)}</b></div>
              </div>
              {!previousClosing && (
                <div className="field" style={{ marginTop: "8px", maxWidth: "220px" }}>
                  <label style={{ fontSize: "11px" }}>First time? Set today's opening balance manually</label>
                  <input type="number" min="0" value={openingCash} onChange={(e) => setOpeningCash(Number(e.target.value))} />
                </div>
              )}
            </div>

            <div className="grid cols-2" style={{ gap: "16px" }}>
              <div className="field">
                <label style={{ fontSize: "14px", fontWeight: 800 }}>💵 Kitna Cash Galla Mein Hai? (Cash physically in drawer)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 8500"
                  value={cashInGalla}
                  onChange={(e) => setCashInGalla(e.target.value)}
                  style={{ fontSize: "18px", fontWeight: 700, padding: "12px" }}
                />
                {cashInGalla !== "" && (
                  <div className="kv" style={{ marginTop: "6px", fontSize: "12.5px" }}>
                    <span>vs Expected {inr(expectedCashInGalla)}:</span>{diffBadge(cashDiff)}
                  </div>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: "8px", fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setShowNoteCount(!showNoteCount)}
                >
                  {showNoteCount ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{" "}
                  {showNoteCount ? "Hide note-by-note counting" : "Count note-by-note instead (optional)"}
                </button>
                {showNoteCount && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "10px" }}>
                    {DENOMS.map((d) => (
                      <div key={d} style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--paper)", padding: "5px 8px", borderRadius: "6px" }}>
                        <span style={{ width: "42px", fontWeight: 800, fontSize: "12px" }}>₹{d} ×</span>
                        <input
                          type="number" min="0" step="1"
                          value={denomsCount[d] || ""}
                          placeholder="0"
                          onChange={(e) => setDenomsCount({ ...denomsCount, [d]: Math.max(0, parseInt(e.target.value) || 0) })}
                          style={{ width: "50px", padding: "3px", fontSize: "12px", textAlign: "center" }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="field">
                <label style={{ fontSize: "14px", fontWeight: 800 }}>
                  <Smartphone size={14} style={{ verticalAlign: "middle", marginRight: "4px" }} />
                  Kitna Online Payment Mein Gaya? (UPI/Card/Bank)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder={`System detected ${inr(expectedOnline)}`}
                  value={onlinePayment}
                  onChange={(e) => setOnlinePayment(e.target.value)}
                  style={{ fontSize: "18px", fontWeight: 700, padding: "12px" }}
                />
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: "8px", fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setOnlinePayment(String(expectedOnline))}
                >
                  Use system-detected amount ({inr(expectedOnline)})
                </button>
                {onlinePayment !== "" && (
                  <div className="kv" style={{ marginTop: "10px", fontSize: "12.5px" }}>
                    <span>vs Expected {inr(expectedOnline)}:</span>{diffBadge(onlineDiff)}
                  </div>
                )}
              </div>
            </div>

            <div className="field full" style={{ marginTop: "14px" }}>
              <label>Remarks / Notes (optional)</label>
              <input placeholder="e.g. Verified by Ramesh at 9:30 PM" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: "16px" }}>
          <button className="btn" onClick={requestClose}>{isSaved ? "Done" : "Cancel"}</button>
          {isSaved ? (
            <button className="btn primary" onClick={() => window.print()}>
              <Printer size={14} /> Print Closing Slip
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={cashInGalla === "" || onlinePayment === ""}
              onClick={handleSaveClosing}
            >
              <CheckCircle2 size={14} /> Lock &amp; Save Today's Galla Closing
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
