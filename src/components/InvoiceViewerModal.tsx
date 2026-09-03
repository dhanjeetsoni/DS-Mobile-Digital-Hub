import React, { useState } from "react";
import { Printer, MessageCircle, RotateCcw, RefreshCw, X, ShieldCheck, Sparkles, Gift } from "lucide-react";
import { Database, Sale, ReturnRecord, ExchangeRecord } from "../types";
import { inr, numberToWordsIndian, computeDiscountPercent } from "../utils/indianCurrency";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

const MOTIVATIONAL_LINES = [
  "Great choice! Take care of it well and it'll take care of you for years. 📱✨",
  "Thank you for trusting us with your purchase — your happiness is our best sale.",
  "Small shops, big promises kept. Thanks for shopping local with us!",
  "Every device we sell comes with our word — genuine products, honest pricing.",
  "Your trust today is our motivation for tomorrow. Visit again!",
  "Technology changes fast — our commitment to you never does.",
  "We don't just sell mobiles, we build relationships. Thank you!",
  "Handled with care, sold with pride. Enjoy your new device!",
];

function motivationalLineFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return MOTIVATIONAL_LINES[hash % MOTIVATIONAL_LINES.length];
}

interface InvoiceViewerModalProps {
  db: Database;
  sale?: Sale | null;
  creditNote?: ReturnRecord | null;
  exchange?: ExchangeRecord | null;
  onClose: () => void;
  onOpenReturn?: (sale: Sale) => void;
  onOpenExchange?: (sale: Sale) => void;
}

export const InvoiceViewerModal: React.FC<InvoiceViewerModalProps> = ({
  db,
  sale,
  creditNote,
  exchange,
  onClose,
  onOpenReturn,
  onOpenExchange,
}) => {
  const { closing, requestClose } = useAnimatedClose(onClose);
  const [printFormat, setPrintFormat] = useState<"a4" | "thermal">(
    db.settings.thermalDefault ? "thermal" : "a4"
  );

  if (!sale && !creditNote && !exchange) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsAppShare = () => {
    if (!sale) return;
    const s = db.settings;
    const phone = (sale.customer?.phone || "").replace(/\D/g, "");
    const itemsList = sale.items
      .map((i) => `• ${i.name} (Qty: ${i.qty}) - ${inr(i.price * i.qty)}`)
      .join("\n");
    const imeiDetails = sale.items
      .filter((i) => i.selectedImeis && i.selectedImeis.length > 0)
      .map((i) => `IMEI: ${i.selectedImeis?.join(", ")}`)
      .join("\n");

    const text = `*${s.shopName}*\n🧾 Invoice: *${sale.invoiceNo}*\n📅 Date: ${sale.date}\n👤 Customer: ${
      sale.customer?.name || "Customer"
    }\n\n*Items:*\n${itemsList}\n${imeiDetails ? `\n${imeiDetails}\n` : ""}\n💰 Total Amount: *${inr(
      sale.total
    )}*\n💳 Payment: ${sale.payment}${
      sale.dueAmount > 0.005 ? `\n⚠️ Balance Due: *${inr(sale.dueAmount)}*` : "\n✔ Status: Paid in Full"
    }\n\nThank you for shopping with us! Visit again.`;

    const targetUrl = `https://wa.me/${phone ? "91" + phone.slice(-10) : ""}?text=${encodeURIComponent(
      text
    )}`;
    window.open(targetUrl, "_blank");
  };

  // Helper for UPI QR
  const getUpiQrUrl = (amount: number, refNo: string) => {
    const s = db.settings;
    if (!s.upiId) return "";
    const upiString = `upi://pay?pa=${encodeURIComponent(s.upiId)}&pn=${encodeURIComponent(
      s.shopName
    )}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(refNo)}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
      upiString
    )}`;
  };

  // Step 8.2 — "Discount & Gift info properly formatted": a single honest
  // customer-facing "Total Savings" number, combining (a) per-item MRP vs
  // actual-sold-price savings for normal lines, (b) the full MRP value of
  // any complimentary gift lines (price is 0 for those), and (c) any extra
  // bill-level discount (sale.discount). All three numbers already exist
  // individually elsewhere on the invoice (per-item MRP/discount%, the 🎁
  // gift tag, and the Discount row in the totals table) — this just adds
  // them up into one number so the customer sees the full picture at a
  // glance instead of doing the mental math themselves.
  const totalSavings = sale
    ? sale.items.reduce((acc, i) => {
        const mrp = Number(i.mrp || 0);
        if (mrp <= 0) return acc;
        if (i.isGift) return acc + mrp * i.qty;
        if (mrp > i.price) return acc + (mrp - i.price) * i.qty;
        return acc;
      }, 0) + (sale.discount || 0)
    : 0;

  const hasWarrantyItem = !!sale?.items.some((i) => i.warrantyEnabled);

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`}>
        <div className="modal-head">
          <h3>
            {sale
              ? `Invoice ${sale.invoiceNo}`
              : creditNote
              ? `Credit Note ${creditNote.returnNo}`
              : `Exchange Slip ${exchange?.exchangeNo}`}
          </h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        {sale && (
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px" }}>
            <span style={{ fontSize: "12.5px", color: "var(--ink-soft)" }}>Print Format:</span>
            <select
              value={printFormat}
              onChange={(e) => setPrintFormat(e.target.value as any)}
              style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid var(--line)" }}
            >
              <option value="a4">📄 Standard A4 Full Invoice</option>
              <option value="thermal">🧾 58mm / 80mm POS Thermal Slip</option>
            </select>
          </div>
        )}

        <div id="print-area" data-format={sale ? printFormat : "a4"}>
          {sale && (
            <div className={`invoice-paper ${printFormat === "thermal" ? "thermal" : ""}`}>
              <div className="inv-watermark">{(db.settings.shopName || "DS").trim().slice(0, 2).toUpperCase()}</div>
              {/* Status Header Strip */}
              <div
                className={`status-strip ${
                  sale.dueAmount > 0.005
                    ? sale.amountPaid > 0
                      ? "partial"
                      : "due"
                    : "paid"
                }`}
              >
                {sale.dueAmount > 0.005
                  ? `◐ Balance Due: ${inr(sale.dueAmount)}`
                  : "✔ Paid in Full"}
              </div>

              <div className="ihead">
                <div className="shop-row">
                  <div className="logo-circle">
                    {db.settings.logo ? (
                      <img src={db.settings.logo} alt="Logo" />
                    ) : (
                      (db.settings.shopName || "DS").trim().slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h2>{db.settings.shopName}</h2>
                    <div className="shop-meta-line">
                      {db.settings.address}
                    </div>
                    <div className="shop-meta-line">
                      Ph: {db.settings.phone}
                      {db.settings.email ? ` • ${db.settings.email}` : ""}
                    </div>
                    {db.settings.gstin && (
                      <div className="shop-meta-line">
                        GSTIN: {db.settings.gstin}
                      </div>
                    )}
                  </div>
                </div>
                <div className="meta-r">
                  <div className="inv-no">{sale.invoiceNo}</div>
                  <div>
                    {sale.date} • {sale.time}
                  </div>
                  <div>Payment: {sale.payment}</div>
                </div>
              </div>

              <div className="ibody">
                <div className="invoice-tag-row">
                  <div className="itag">
                    BILLED TO<b>{sale.customer?.name || "Walk-in Customer"}</b>
                  </div>
                  <div className="itag">
                    MOBILE NO<b>{sale.customer?.phone || "—"}</b>
                  </div>
                  <div className="itag">
                    ADDRESS<b>{sale.customer?.address || "—"}</b>
                  </div>
                  <div className="itag">
                    PAYMENT MODE<b>{sale.payment}</b>
                  </div>
                </div>

                {sale.isFinance && sale.financeDetails && (
                  <div className="finance-box">
                    <b>💳 Mobile Finance (0% EMI) Breakdown:</b>
                    <div className="finance-grid">
                      <div>Company: <b>{sale.financeDetails.company}</b></div>
                      <div>Loan A/c: <b>{sale.financeDetails.loanAccountNo}</b></div>
                      <div>Down Payment: <b>{inr(sale.financeDetails.downPayment)}</b></div>
                      <div>Loan Amount: <b>{inr(sale.financeDetails.loanAmount)}</b></div>
                    </div>
                  </div>
                )}

                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product Description &amp; IMEI</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Total</th>
                      <th>Warranty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sale.items.map((i, idx) => {
                      const discountPct = i.category !== "Cyber Cafe" ? computeDiscountPercent(i.mrp, i.price) : null;
                      return (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>
                            <b>{i.name}</b>
                            {i.isGift && (
                              <div style={{ fontSize: "11px", fontWeight: 800, color: "#166534" }}>
                                🎁 Complimentary Gift{i.mrp ? ` — MRP ${inr(i.mrp)}` : ""}
                              </div>
                            )}
                            {!i.isGift && discountPct !== null && discountPct > 0 && (
                              <div className="imei-line">
                                MRP {inr(i.mrp)} • Discount {discountPct}%
                              </div>
                            )}
                            {i.selectedImeis && i.selectedImeis.length > 0 && (
                              <div className="imei-line">
                                IMEI: <b>{i.selectedImeis.join(", ")}</b>
                              </div>
                            )}
                          </td>
                          <td>{i.category}</td>
                          <td>{i.qty}</td>
                          <td>{i.isGift ? "FREE" : inr(i.price)}</td>
                          <td>{i.isGift ? "FREE" : inr(i.price * i.qty)}</td>
                          <td>
                            {i.warrantyEnabled
                              ? `${i.warrantyMonths}m (${i.warrantyEnd || "From date"})`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={5} style={{ textAlign: "right" }}>Subtotal</td>
                      <td colSpan={2}>{inr(sale.subtotal)}</td>
                    </tr>
                    {sale.discount > 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right" }}>Discount</td>
                        <td colSpan={2}>-{inr(sale.discount)}</td>
                      </tr>
                    )}
                    {!!sale.taxAmount && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right" }}>
                          GST {db.settings.gstEnabled ? `(${db.settings.gstPercent}%)` : ""}
                        </td>
                        <td colSpan={2}>{inr(sale.taxAmount)}</td>
                      </tr>
                    )}
                    <tr className="grand-row">
                      <td colSpan={5} style={{ textAlign: "right" }}>Grand Total</td>
                      <td colSpan={2}>{inr(sale.total)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} style={{ textAlign: "right" }}>Amount Received</td>
                      <td colSpan={2}>{inr(sale.amountPaid)}</td>
                    </tr>
                    {sale.dueAmount > 0.005 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right" }} className="due-label">
                          Outstanding Balance Due
                        </td>
                        <td colSpan={2} className="due-label">
                          {inr(sale.dueAmount)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {totalSavings > 0.5 && (
                  <div className="savings-strip">
                    <Gift size={13} /> You saved <b>{inr(totalSavings)}</b> on this purchase!
                  </div>
                )}

                <div className="amount-words">
                  <b>Amount in words:</b> {numberToWordsIndian(sale.total)}
                </div>

                <div className="invoice-foot-grid">
                  <div className="terms">
                    <b><ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Terms &amp; Conditions:</b>
                    <ol>
                      {(db.settings.invoiceTerms || "")
                        .split("\n")
                        .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
                        .filter(Boolean)
                        .map((line, idx) => (
                          <li key={idx}>{line}</li>
                        ))}
                    </ol>
                  </div>

                  {db.settings.upiId && (
                    <div className="qr-box">
                      <img
                        src={getUpiQrUrl(
                          sale.dueAmount > 0.005 ? sale.dueAmount : sale.total,
                          sale.invoiceNo
                        )}
                        alt="Scan to Pay UPI"
                      />
                      <div>
                        Scan to Pay {inr(sale.dueAmount > 0.005 ? sale.dueAmount : sale.total)}
                        <br />
                        via Any UPI App
                      </div>
                    </div>
                  )}

                  <div className="sign-box">
                    <div className="sign-line">Authorized Signatory</div>
                    {hasWarrantyItem && (
                      <div className="sign-sub">Warranty terms accepted</div>
                    )}
                  </div>
                </div>

                <div className="motivational-strip">
                  <Sparkles size={13} /> {motivationalLineFor(sale.invoiceNo || sale.date)}
                </div>

                <p className="inv-footer-msg">
                  {db.settings.invoiceFooter}
                </p>
              </div>
            </div>
          )}

          {creditNote && (
            <div className="invoice-paper">
              <div className="status-strip due">CREDIT NOTE — {creditNote.type.toUpperCase()} RETURN</div>
              <div className="ihead">
                <div className="shop-row">
                  <div className="logo-circle">
                    {db.settings.logo ? (
                      <img src={db.settings.logo} alt="Logo" />
                    ) : (
                      (db.settings.shopName || "DS").trim().slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h2>{db.settings.shopName}</h2>
                    <div style={{ opacity: 0.85, fontSize: "12px" }}>{db.settings.address} • Ph: {db.settings.phone}</div>
                  </div>
                </div>
                <div className="meta-r">
                  <div className="inv-no">{creditNote.returnNo}</div>
                  <div>{creditNote.date} • {creditNote.time}</div>
                  <div>Original Bill: {creditNote.invoiceNo}</div>
                </div>
              </div>
              <div className="ibody">
                <div className="invoice-tag-row">
                  <div className="itag">CUSTOMER<b>{creditNote.customer?.name || "Walk-in"}</b></div>
                  <div className="itag">MOBILE<b>{creditNote.customer?.phone || "—"}</b></div>
                  <div className="itag">RETURN REASON<b>{creditNote.reason}</b></div>
                  <div className="itag">REFUND MODE<b>{creditNote.refundMethod}</b></div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Returned Product</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Refund Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditNote.items.map((i, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td><b>{i.name}</b></td>
                        <td>{i.category}</td>
                        <td>{i.qty}</td>
                        <td>{inr(i.price)}</td>
                        <td>{inr(i.refund)}</td>
                      </tr>
                    ))}
                    <tr className="grand-row">
                      <td colSpan={5} style={{ textAlign: "right" }}>Total Refund Value</td>
                      <td>{inr(creditNote.subtotalRefund)}</td>
                    </tr>
                    {creditNote.dueOffset > 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right" }}>Adjusted Against Pending Due</td>
                        <td>-{inr(creditNote.dueOffset)}</td>
                      </tr>
                    )}
                    {creditNote.settlementAmount > 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "right", fontWeight: 800 }}>
                          Amount Paid Out ({creditNote.refundMethod})
                        </td>
                        <td style={{ fontWeight: 800 }}>{inr(creditNote.settlementAmount)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="amount-words">
                  <b>Refund in words:</b> {numberToWordsIndian(creditNote.subtotalRefund)}
                </div>
              </div>
            </div>
          )}

          {exchange && (
            <div className="invoice-paper">
              <div className="status-strip exch">PRODUCT EXCHANGE SLIP</div>
              <div className="ihead">
                <div className="shop-row">
                  <div>
                    <h2>{db.settings.shopName}</h2>
                    <div style={{ opacity: 0.85, fontSize: "12px" }}>{db.settings.address} • Ph: {db.settings.phone}</div>
                  </div>
                </div>
                <div className="meta-r">
                  <div className="inv-no">{exchange.exchangeNo}</div>
                  <div>{exchange.date} • {exchange.time}</div>
                  <div>Original Bill: {exchange.invoiceNo}</div>
                </div>
              </div>
              <div className="ibody">
                <div className="invoice-tag-row">
                  <div className="itag">CUSTOMER<b>{exchange.customer?.name || "Walk-in"}</b></div>
                  <div className="itag">MOBILE<b>{exchange.customer?.phone || "—"}</b></div>
                  <div className="itag">REASON<b>{exchange.reason}</b></div>
                  <div className="itag">SETTLEMENT<b>{exchange.settlementMethod}</b></div>
                </div>

                <div style={{ fontWeight: 800, margin: "10px 0 4px", color: "var(--inv-navy)" }}>Returned Items:</div>
                <table>
                  <thead>
                    <tr><th>Item</th><th>Category</th><th>Qty</th><th>Credit Rate</th><th>Credit Total</th></tr>
                  </thead>
                  <tbody>
                    {exchange.returnedItems.map((i, idx) => (
                      <tr key={idx}>
                        <td>{i.name}</td><td>{i.category}</td><td>{i.qty}</td><td>{inr(i.price)}</td><td>{inr(i.price * i.qty)}</td>
                      </tr>
                    ))}
                    <tr><td colSpan={4} style={{ textAlign: "right" }}>Returned Items Credit</td><td><b>{inr(exchange.returnedValue)}</b></td></tr>
                  </tbody>
                </table>

                <div style={{ fontWeight: 800, margin: "14px 0 4px", color: "var(--inv-navy)" }}>New Replacement Items:</div>
                <table>
                  <thead>
                    <tr><th>Item</th><th>Category</th><th>Qty</th><th>Rate</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {exchange.replacementItems.map((i, idx) => (
                      <tr key={idx}>
                        <td>{i.name}</td><td>{i.category}</td><td>{i.qty}</td><td>{inr(i.price)}</td><td>{inr(i.price * i.qty)}</td>
                      </tr>
                    ))}
                    <tr><td colSpan={4} style={{ textAlign: "right" }}>Replacement Items Total</td><td><b>{inr(exchange.replacementValue)}</b></td></tr>
                    <tr className="grand-row">
                      <td colSpan={4} style={{ textAlign: "right" }}>
                        {exchange.differenceAmount >= 0 ? "Net Amount Paid by Customer" : "Net Refund Returned to Customer"}
                      </td>
                      <td>{inr(Math.abs(exchange.differenceAmount))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: "16px" }}>
          <button className="btn" onClick={requestClose}>Close</button>
          {sale && (
            <button className="btn success" onClick={handleWhatsAppShare}>
              <MessageCircle size={14} /> WhatsApp Invoice
            </button>
          )}
          <button className="btn primary" onClick={handlePrint}>
            <Printer size={14} /> Print Document
          </button>
          {sale && onOpenReturn && (
            <button className="btn danger" onClick={() => onOpenReturn(sale)}>
              <RotateCcw size={14} /> Return
            </button>
          )}
          {sale && onOpenExchange && (
            <button className="btn" onClick={() => onOpenExchange(sale)}>
              <RefreshCw size={14} /> Exchange
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
