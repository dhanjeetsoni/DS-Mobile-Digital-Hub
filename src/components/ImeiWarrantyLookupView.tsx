import React, { useState, useMemo } from "react";
import {
  Search,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Printer,
  MessageCircle,
  Wrench,
  Smartphone,
  Calendar,
  CheckCircle2,
  FileText,
  User,
  History,
  AlertCircle,
  Tag,
  ArrowRight,
} from "lucide-react";
import { Database, Sale, RepairJob, SecondHandKYC, IMEIUnit } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";
import { openWhatsApp } from "../services/whatsapp";
import { PasteButton } from "./PasteButton";

interface ImeiWarrantyLookupViewProps {
  db: Database;
  onCreateJobForDevice?: (deviceName: string, phone: string, customerName: string) => void;
  showToast: (msg: string, kind?: "green" | "red" | "amber") => void;
}

export const ImeiWarrantyLookupView: React.FC<ImeiWarrantyLookupViewProps> = ({
  db,
  onCreateJobForDevice,
  showToast,
}) => {
  const [query, setQuery] = useState("");
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  // Search through all sales, IMEIs, KYC buybacks, and Repair jobs
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];

    const matches: Array<{
      id: string;
      type: "sale" | "inventory" | "job" | "kyc";
      matchedImei: string;
      matchedKey: string;
      productName: string;
      customerName: string;
      customerPhone: string;
      date: string;
      sale?: Sale;
      job?: RepairJob;
      kyc?: SecondHandKYC;
      inventoryUnit?: IMEIUnit;
    }> = [];

    // 1. Check sales invoices for item IMEIs or customer phone
    (db.sales || []).forEach((sale) => {
      sale.items.forEach((item) => {
        const imeis = item.selectedImeis || [];
        const matchesImei = imeis.some((im) => im.toLowerCase().includes(q));
        const matchesPhone = (sale.customerPhone || "").includes(q);
        const matchesInvoice = sale.invoiceNo.toLowerCase().includes(q);
        const matchesCustName = (sale.customerName || "").toLowerCase().includes(q);

        if (matchesImei || matchesPhone || matchesInvoice || matchesCustName) {
          const matchedImeiStr = imeis.find((im) => im.toLowerCase().includes(q)) || (imeis[0] || "N/A");
          matches.push({
            id: `sale-${sale.id}-${item.productId}`,
            type: "sale",
            matchedImei: matchedImeiStr,
            matchedKey: matchesImei ? "IMEI Match" : matchesPhone ? "Phone Match" : "Invoice Match",
            productName: item.name,
            customerName: sale.customerName || "Walk-in Customer",
            customerPhone: sale.customerPhone || "—",
            date: sale.date,
            sale,
          });
        }
      });
    });

    // 2. Check repair jobs
    (db.jobs || []).forEach((job) => {
      const matchesDevice = job.device.toLowerCase().includes(q);
      const matchesJobNo = job.jobNo.toLowerCase().includes(q);
      const matchesPhone = job.phone.includes(q);
      const matchesName = job.customerName.toLowerCase().includes(q);
      const matchesIssue = (job.issue || "").toLowerCase().includes(q);

      if (matchesDevice || matchesJobNo || matchesPhone || matchesName || matchesIssue) {
        matches.push({
          id: `job-${job.id}`,
          type: "job",
          matchedImei: "Service Card",
          matchedKey: matchesPhone ? "Phone Match" : "Job Match",
          productName: job.device,
          customerName: job.customerName,
          customerPhone: job.phone,
          date: job.date,
          job,
        });
      }
    });

    // 3. Check 2nd Hand Buyback KYC records
    (db.secondHandKYCs || []).forEach((kyc) => {
      const matchesImei = (kyc.imei1 || "").toLowerCase().includes(q) || (kyc.imei2 || "").toLowerCase().includes(q);
      const matchesModel = (kyc.brandModel || "").toLowerCase().includes(q);
      const matchesSeller = (kyc.sellerName || "").toLowerCase().includes(q);
      const matchesPhone = (kyc.sellerPhone || "").includes(q);

      if (matchesImei || matchesModel || matchesSeller || matchesPhone) {
        matches.push({
          id: `kyc-${kyc.id}`,
          type: "kyc",
          matchedImei: kyc.imei1,
          matchedKey: matchesImei ? "KYC IMEI Match" : "Seller Phone Match",
          productName: kyc.brandModel,
          customerName: `${kyc.sellerName} (Seller)`,
          customerPhone: kyc.sellerPhone,
          date: kyc.date,
          kyc,
        });
      }
    });

    return matches;
  }, [query, db]);

  const activeMatch = useMemo(() => {
    if (!searchResults.length) return null;
    if (selectedResultId) {
      return searchResults.find((r) => r.id === selectedResultId) || searchResults[0];
    }
    return searchResults[0];
  }, [searchResults, selectedResultId]);

  // Compute warranty details for active sale
  const warrantyInfo = useMemo(() => {
    if (!activeMatch || !activeMatch.sale) return null;
    const sale = activeMatch.sale;
    const saleItem = sale.items.find((i) => i.name === activeMatch.productName) || sale.items[0];
    const product = db.products.find((p) => p.id === saleItem?.productId);

    const warrantyMonths = product?.warrantyMonths || 12;
    const isWarrantyEnabled = product?.warrantyEnabled ?? true;

    // Calculate expiry date
    const saleDateObj = new Date(sale.date);
    const expiryDateObj = new Date(saleDateObj);
    expiryDateObj.setMonth(expiryDateObj.getMonth() + warrantyMonths);

    const todayObj = new Date(todayStr());
    const isExpired = todayObj > expiryDateObj;
    const daysLeft = Math.max(0, Math.ceil((expiryDateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24)));
    const totalDays = Math.max(1, Math.ceil((expiryDateObj.getTime() - saleDateObj.getTime()) / (1000 * 60 * 60 * 24)));
    const percentRemaining = Math.max(0, Math.min(100, Math.round((daysLeft / totalDays) * 100)));

    const expiryDateStr = expiryDateObj.toISOString().split("T")[0];

    return {
      enabled: isWarrantyEnabled,
      months: warrantyMonths,
      saleDate: sale.date,
      expiryDate: expiryDateStr,
      isExpired,
      daysLeft,
      percentRemaining,
      invoiceNo: sale.invoiceNo,
      soldAmount: saleItem?.price || sale.total,
      imei: activeMatch.matchedImei,
    };
  }, [activeMatch, db.products]);

  // Find all service repair history for this customer / phone / device
  const relatedRepairs = useMemo(() => {
    if (!activeMatch) return [];
    const phone = activeMatch.customerPhone;
    const name = activeMatch.productName.toLowerCase();
    return (db.jobs || []).filter(
      (j) => (phone && phone !== "—" && j.phone === phone) || j.device.toLowerCase().includes(name)
    );
  }, [activeMatch, db.jobs]);

  const handleShareWarrantyWhatsApp = () => {
    if (!activeMatch || !warrantyInfo) return;
    const phone = activeMatch.customerPhone;
    if (!phone || phone.length < 10) {
      showToast("Customer phone number not available", "amber");
      return;
    }

    const msg =
      `*🛡️ WARRANTY & SERVICE STATUS — ${db.settings.shopName || "DS Mobile Hub"}*\n\n` +
      `👤 *Customer:* ${activeMatch.customerName}\n` +
      `📱 *Device:* ${activeMatch.productName}\n` +
      `🔢 *IMEI/Serial:* ${warrantyInfo.imei}\n` +
      `🧾 *Invoice No:* ${warrantyInfo.invoiceNo}\n` +
      `📅 *Purchase Date:* ${warrantyInfo.saleDate}\n` +
      `⏳ *Warranty Valid Till:* ${warrantyInfo.expiryDate}\n` +
      `📊 *Status:* ${warrantyInfo.isExpired ? "❌ Expired" : `✅ ACTIVE (${warrantyInfo.daysLeft} days remaining)`}\n\n` +
      `_Note: Physical breakages, liquid damage & third-party repairs void warranty terms._\n` +
      `📞 Contact: ${db.settings.phone || ""}`;

    openWhatsApp(phone, msg);
    showToast("Opening WhatsApp with warranty details...", "green");
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div className="section" style={{ marginBottom: "16px" }}>
        <div className="section-head" style={{ marginBottom: "12px" }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "19px", margin: 0 }}>
              <ShieldCheck size={22} style={{ color: "var(--brand)" }} />
              IMEI &amp; Serial Number Warranty Lookup
            </h2>
            <p className="hint" style={{ marginTop: "4px", margin: 0 }}>
              Enter 15-digit IMEI, last 4 digits, Serial Number, or Customer Mobile to verify live warranty &amp; repair history.
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div className="searchbar" style={{ flex: 1, margin: 0 }}>
            <Search size={18} style={{ color: "var(--ink-soft)" }} />
            <input
              placeholder="🔍 Type 15-digit IMEI, last 4 digits, Mobile No., or Invoice No..."
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              autoFocus
              style={{ fontSize: "16px", padding: "10px 12px", textTransform: "uppercase" }}
            />
          </div>
          <PasteButton
            cleanType="imei"
            onPaste={(val) => setQuery(val.toUpperCase())}
            toast={(msg, kind) => showToast(msg, (kind as any) || "green")}
            title="Paste IMEI / S/N (1-Click)"
          />
          {query && (
            <button className="btn ghost sm" onClick={() => setQuery("")}>
              Clear
            </button>
          )}
        </div>

        {/* Quick Suggestion Pills */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
          <span className="hint" style={{ alignSelf: "center", fontSize: "11px", fontWeight: 700 }}>
            Quick Filter:
          </span>
          {db.sales.slice(-4).flatMap((s) =>
            s.items
              .filter((i) => i.selectedImeis && i.selectedImeis.length > 0)
              .map((i) => (
                <button
                  key={i.productId}
                  className="btn sm ghost"
                  style={{ fontSize: "11px", padding: "3px 8px" }}
                  onClick={() => setQuery(i.selectedImeis![0])}
                >
                  📱 {i.name.split(" ")[0]} ({i.selectedImeis![0].slice(-4)})
                </button>
              ))
          )}
        </div>
      </div>

      {/* Main Results Grid */}
      {query.length >= 2 && (
        <div className="grid cols-3" style={{ gap: "16px", alignItems: "flex-start" }}>
          {/* Left Column: Search Results List */}
          <div className="section" style={{ padding: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--ink-soft)", textTransform: "uppercase", marginBottom: "10px" }}>
              Matching Records ({searchResults.length})
            </div>

            {searchResults.length === 0 ? (
              <div className="empty" style={{ padding: "20px 10px" }}>
                <AlertCircle size={24} style={{ color: "var(--amber)", margin: "0 auto 8px" }} />
                No invoices, IMEIs, or jobs matched "{query}".
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "560px", overflowY: "auto" }}>
                {searchResults.map((res) => {
                  const isSelected = activeMatch?.id === res.id;
                  return (
                    <div
                      key={res.id}
                      onClick={() => setSelectedResultId(res.id)}
                      style={{
                        padding: "12px",
                        borderRadius: "10px",
                        border: isSelected ? "2px solid var(--brand)" : "1px solid var(--line)",
                        background: isSelected ? "var(--blue-light)" : "var(--card)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "13.5px", fontWeight: 800, color: "var(--ink)" }}>{res.productName}</span>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 800,
                            padding: "2px 6px",
                            borderRadius: "6px",
                            background: res.type === "sale" ? "#10b98122" : res.type === "job" ? "#8b5cf622" : "#f59e0b22",
                            color: res.type === "sale" ? "#047857" : res.type === "job" ? "#6d28d9" : "#b45309",
                          }}
                        >
                          {res.matchedKey}
                        </span>
                      </div>

                      <div style={{ fontSize: "11.5px", color: "var(--ink-soft)", marginTop: "4px" }}>
                        👤 {res.customerName} • 📞 {res.customerPhone}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--ink-soft)", marginTop: "6px", borderTop: "1px dashed var(--line)", paddingTop: "4px" }}>
                        <span>IMEI: <b>{res.matchedImei}</b></span>
                        <span>{res.date}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Detailed Warranty & Service Passport */}
          <div className="section" style={{ gridColumn: "span 2", padding: "18px" }}>
            {!activeMatch ? (
              <div className="empty" style={{ padding: "40px" }}>
                Select a matched device on the left to inspect its live warranty passport.
              </div>
            ) : (
              <div>
                {/* Header Badge */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                  <div>
                    <h3 style={{ fontSize: "18px", margin: 0, fontWeight: 800 }}>{activeMatch.productName}</h3>
                    <div className="hint" style={{ marginTop: "2px" }}>
                      Customer: <b>{activeMatch.customerName}</b> ({activeMatch.customerPhone})
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    {warrantyInfo && (
                      <button className="btn sm" onClick={handleShareWarrantyWhatsApp} style={{ background: "#25D366", color: "#fff", border: "none" }}>
                        <MessageCircle size={14} /> WhatsApp Certificate
                      </button>
                    )}
                    {onCreateJobForDevice && (
                      <button
                        className="btn primary sm"
                        onClick={() => onCreateJobForDevice(activeMatch.productName, activeMatch.customerPhone, activeMatch.customerName)}
                      >
                        <Wrench size={14} /> Book Repair Ticket
                      </button>
                    )}
                  </div>
                </div>

                {/* Warranty Status Banner */}
                {warrantyInfo ? (
                  <div
                    style={{
                      background: warrantyInfo.isExpired ? "rgba(239, 68, 68, 0.08)" : "rgba(16, 185, 129, 0.08)",
                      border: `1.5px solid ${warrantyInfo.isExpired ? "#ef4444" : "#10b981"}`,
                      borderRadius: "12px",
                      padding: "16px",
                      marginBottom: "18px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {warrantyInfo.isExpired ? (
                          <ShieldAlert size={28} style={{ color: "#ef4444" }} />
                        ) : (
                          <ShieldCheck size={28} style={{ color: "#10b981" }} />
                        )}
                        <div>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: warrantyInfo.isExpired ? "#b91c1c" : "#047857" }}>
                            {warrantyInfo.isExpired ? "Warranty Expired" : `Active Shop Warranty — ${warrantyInfo.daysLeft} Days Left`}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
                            Purchased on {warrantyInfo.saleDate} • Coverage Period: {warrantyInfo.months} Months
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 800 }}>Valid Until</div>
                        <div style={{ fontSize: "15px", fontWeight: 800 }}>{warrantyInfo.expiryDate}</div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {!warrantyInfo.isExpired && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ height: "6px", background: "#e5e7eb", borderRadius: "999px", overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${warrantyInfo.percentRemaining}%`,
                              background: warrantyInfo.percentRemaining > 30 ? "#10b981" : "#f59e0b",
                              borderRadius: "999px",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--ink-soft)", marginTop: "4px" }}>
                          <span>Purchase: {warrantyInfo.saleDate}</span>
                          <span>{warrantyInfo.percentRemaining}% Period Remaining</span>
                          <span>Expires: {warrantyInfo.expiryDate}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="notice" style={{ marginBottom: "16px" }}>
                    ℹ️ Device was logged via direct repair service ticket or trade-in KYC.
                  </div>
                )}

                {/* Device Specifications & Identity Grid */}
                <div className="grid cols-3" style={{ gap: "12px", marginBottom: "18px" }}>
                  <div style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                    <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>IMEI 1 / Serial</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                      {activeMatch.matchedImei}
                    </div>
                  </div>

                  <div style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                    <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>Invoice / Ref No</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, marginTop: "2px" }}>
                      {activeMatch.sale?.invoiceNo || activeMatch.job?.jobNo || activeMatch.kyc?.voucherNo || "—"}
                    </div>
                  </div>

                  <div style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                    <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>Original Bill Amount</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--navy)", marginTop: "2px" }}>
                      {activeMatch.sale ? inr(activeMatch.sale.total) : activeMatch.job ? inr(activeMatch.job.estCost) : inr(activeMatch.kyc?.purchasePrice || 0)}
                    </div>
                  </div>
                </div>

                {/* Past Repair & Spare Parts History */}
                <div style={{ marginTop: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <h4 style={{ fontSize: "14px", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                      <History size={16} style={{ color: "var(--purple)" }} />
                      Repair History &amp; Replaced Parts ({relatedRepairs.length})
                    </h4>
                  </div>

                  {relatedRepairs.length === 0 ? (
                    <div className="empty" style={{ padding: "16px", background: "var(--paper)", borderRadius: "8px" }}>
                      No prior repairs or service tickets recorded for this phone.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {relatedRepairs.map((job) => (
                        <div
                          key={job.id}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--line)",
                            background: "var(--card)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800, fontSize: "13px" }}>
                              {job.jobNo} — <span style={{ color: "var(--ink-soft)" }}>{job.issue}</span>
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--ink-soft)", marginTop: "2px" }}>
                              📅 {job.date} • Status: <b style={{ color: job.status === "Delivered" ? "var(--green)" : "var(--amber)" }}>{job.status}</b>
                              {job.selectedSparePartId && ` • Spare Part: ID #${job.selectedSparePartId}`}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", fontWeight: 800, fontSize: "13px", color: "var(--navy)" }}>
                            {inr(job.estCost)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Warranty Terms Reminder */}
                <div style={{ marginTop: "18px", padding: "10px 12px", background: "var(--paper)", borderRadius: "8px", fontSize: "11.5px", color: "var(--ink-soft)" }}>
                  <b>⚠️ Shop Warranty Terms:</b> Covers manufacturing defects &amp; touch screen IC failure during the warranty term. Damage due to water drops, liquid ingress, screen cracks, or external repairs invalidates warranty coverage.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {query.length < 2 && (
        <div className="section" style={{ textAlign: "center", padding: "40px 20px" }}>
          <ShieldCheck size={48} style={{ color: "var(--brand)", margin: "0 auto 12px", opacity: 0.8 }} />
          <h3 style={{ fontSize: "17px", fontWeight: 800, margin: 0 }}>Instant Device Warranty &amp; IMEI Audit Passport</h3>
          <p className="hint" style={{ maxWidth: "480px", margin: "8px auto 0" }}>
            Type any IMEI number, customer mobile number, or invoice barcode above to view active warranty timers, service history, and replacement records instantly.
          </p>
        </div>
      )}
    </div>
  );
};
