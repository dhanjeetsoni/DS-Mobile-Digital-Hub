import React, { useMemo, useState } from "react";
import {
  Search,
  Download,
  Send,
  Copy,
  Printer,
  Users,
  Sparkles,
  MessageCircle,
  QrCode,
  Check,
  Phone,
  MapPin,
  Smartphone,
  Wrench,
  Receipt,
  UserPlus,
  Zap,
} from "lucide-react";
import { Database, Customer } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";
import { sendTelegramReport } from "../services/telegram";
import { getCustomerMessageDrafts, CustomerMessageOptions } from "../services/aiOps";
import { openWhatsApp } from "../services/whatsapp";
import { downloadCsv } from "../utils/csvExport";
import { CustomerKhataUpiModal } from "./CustomerKhataUpiModal";
import { QuickKhataRepaymentModal } from "./QuickKhataRepaymentModal";
import { PasteButton } from "./PasteButton";
import {
  getCustomerTier,
  getCustomerPurchasedDevices,
  getCustomerRepairHistory,
} from "../utils/customerTier";
import { pickContactFromPhone, isContactPickerSupported } from "../utils/clipboardHelper";

interface CustomerDirectoryViewProps {
  db: Database;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
  onViewInvoiceByNo?: (invoiceNo: string) => void;
}

type RangeMode = "all" | "today" | "month" | "due" | "custom";

function ymd(d: string) {
  return (d || "").slice(0, 10);
}

export const CustomerDirectoryView: React.FC<CustomerDirectoryViewProps> = ({
  db,
  toast,
  onViewInvoiceByNo,
}) => {
  const [search, setSearch] = useState("");
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedUpiCustomer, setSelectedUpiCustomer] = useState<Customer | null>(null);
  const [repayCustomer, setRepayCustomer] = useState<Customer | null>(null);
  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<"purchases" | "devices" | "repairs">("purchases");

  // AI-drafted WhatsApp due-payment reminder
  const [reminderState, setReminderState] = useState<
    Record<
      string,
      {
        loading: boolean;
        text: string;
        error: string;
        drafts?: CustomerMessageOptions;
        styleKey?: keyof CustomerMessageOptions;
      }
    >
  >({});

  const handleAiReminder = async (customerId: string, name: string, phone: string, dueAmount: number) => {
    setReminderState((prev) => ({ ...prev, [customerId]: { loading: true, text: "", error: "" } }));
    try {
      const drafts = await getCustomerMessageDrafts({
        type: "dueReminder",
        customerName: name,
        phone,
        amount: dueAmount,
        shopName: db.settings.shopName,
      });
      const chosenText = drafts.politeHinglish || drafts.shortInstant || drafts.professional;
      setReminderState((prev) => ({
        ...prev,
        [customerId]: { loading: false, text: chosenText, drafts, styleKey: "politeHinglish", error: "" },
      }));
    } catch (e) {
      setReminderState((prev) => ({
        ...prev,
        [customerId]: { loading: false, text: "", error: e instanceof Error ? e.message : "AI reminder failed." },
      }));
    }
  };

  const handlePickContact = async () => {
    const res = await pickContactFromPhone();
    if (res.success && res.phone) {
      setSearch(res.phone);
      toast(`Found contact: ${res.name || res.phone}`, "green");
    } else if (res.error) {
      toast(res.error, "amber");
    }
  };

  const monthStart = todayStr().slice(0, 7) + "-01";

  const filtered = useMemo(() => {
    let list = [...(db.customers || [])];

    if (rangeMode === "today") {
      list = list.filter((c) => ymd(c.createdAt) === todayStr());
    } else if (rangeMode === "month") {
      list = list.filter((c) => ymd(c.createdAt) >= monthStart);
    } else if (rangeMode === "due") {
      list = list.filter((c) => (c.totalDue || 0) > 0);
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
    rangeMode === "today"
      ? `Today (${todayStr()})`
      : rangeMode === "month"
      ? `This Month (${monthStart.slice(0, 7)})`
      : rangeMode === "due"
      ? "Pending Khata Dues Only"
      : rangeMode === "custom"
      ? `${customFrom || "…"} to ${customTo || "…"}`
      : "All Time";

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

    const devices = getCustomerPurchasedDevices(phone, db);
    const repairs = getCustomerRepairHistory(phone, db);
    const tier = getCustomerTier(c, db.sales || []);

    return {
      customer: c,
      sales,
      returns,
      totalSpent,
      totalRefunded,
      visitCount,
      avgOrderValue,
      devices,
      repairs,
      tier,
    };
  }, [profileCustomerId, db.customers, db.sales, db.returns, db.imeiRegistry, db.repairJobs]);

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
    if (filtered.length === 0) {
      toast("Is filter mein koi customer nahi mila", "amber");
      return;
    }
    try {
      await navigator.clipboard.writeText(buildReportText());
      toast("Copy ho gaya — ab WhatsApp group mein paste kar dijiye", "green");
    } catch {
      toast("Copy nahi ho paya — browser permission check karein", "red");
    }
  };

  const handleSendTelegram = async () => {
    if (filtered.length === 0) {
      toast("Is filter mein koi customer nahi mila", "amber");
      return;
    }
    setIsSending(true);
    try {
      await sendTelegramReport(buildReportText());
      toast("Telegram par customer list bhej di gayi", "green");
    } catch (e: any) {
      toast(e?.message || "Telegram error aayi — check settings", "red");
    } finally {
      setIsSending(false);
    }
  };

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      toast("Is filter mein koi customer nahi mila", "amber");
      return;
    }
    const headers = ["Name", "Phone", "Address", "Added On", "Total Due", "Loyalty Points"];
    const rows = filtered.map((c) => [
      c.name,
      c.phone,
      c.address || "",
      ymd(c.createdAt),
      c.totalDue || 0,
      c.loyaltyPoints || 0,
    ]);
    downloadCsv(`customers_${rangeMode}_${todayStr()}.csv`, headers, rows);
    toast("Excel CSV file download ho gayi", "green");
  };

  return (
    <div className="section">
      <div className="section-head">
        <div>
          <h2>👥 Customer Directory &amp; Khata Profiles</h2>
          <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
            Search customers, VIP status, call/map shortcuts, purchase &amp; repair history, and instant WhatsApp payment links
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="btn sm ghost" onClick={handleExportExcel}>
            <Download size={13} /> Excel
          </button>
          <button className="btn sm ghost" onClick={handleCopyForWhatsApp}>
            <Copy size={13} /> Copy for WhatsApp
          </button>
          <button className="btn sm ghost" onClick={handleSendTelegram} disabled={isSending}>
            <Send size={13} /> {isSending ? "Bhej rahe..." : "Telegram"}
          </button>
          <button className="btn sm" onClick={() => setIsPrintOpen(true)}>
            <Printer size={13} /> Print / PDF
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: "240px", display: "flex", gap: "6px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type="text"
                placeholder="🔍 Search name, phone number, village / address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: "34px", width: "100%" }}
              />
              <Search
                size={16}
                style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }}
              />
            </div>
            <PasteButton
              type="phone"
              onPaste={(pasted) => setSearch(pasted)}
              toast={toast}
            />
            {isContactPickerSupported() && (
              <button
                type="button"
                className="btn sm"
                onClick={handlePickContact}
                title="Select directly from phone contacts"
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 700 }}
              >
                <Users size={13} /> Pick Contact
              </button>
            )}
          </div>

          <div className="mode-pill">
            <button className={rangeMode === "all" ? "on" : ""} onClick={() => setRangeMode("all")}>All</button>
            <button className={rangeMode === "today" ? "on" : ""} onClick={() => setRangeMode("today")}>Today</button>
            <button className={rangeMode === "month" ? "on" : ""} onClick={() => setRangeMode("month")}>This Month</button>
            <button className={rangeMode === "due" ? "on" : ""} onClick={() => setRangeMode("due")} style={{ color: rangeMode === "due" ? "#ffffff" : "#dc2626" }}>
              ⚠️ Udhaar Baaki ({db.customers.filter((c) => (c.totalDue || 0) > 0).length})
            </button>
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

        <div className="hint" style={{ marginBottom: "8px" }}>
          {filtered.length} customer(s) — {rangeLabel}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer &amp; VIP Status</th>
                <th>Mobile &amp; Call</th>
                <th>Address &amp; Map</th>
                <th>Added On</th>
                <th>Outstanding Due</th>
                <th>1-Tap Actions &amp; Reminder</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const tier = getCustomerTier(c, db.sales || []);
                const hasDue = (c.totalDue || 0) > 0;

                return (
                  <tr
                    key={c.id}
                    className="clickable-row"
                    style={{ cursor: "pointer" }}
                    onClick={() => setProfileCustomerId(c.id)}
                  >
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <b className="truncate" title={c.name} style={{ fontSize: "13.5px" }}>
                          {c.name}
                        </b>
                        {tier.tier === "gold" && (
                          <span
                            title="Gold VIP Customer (High Spend)"
                            style={{
                              fontSize: "10px",
                              fontWeight: 800,
                              background: "#fef3c7",
                              color: "#92400e",
                              border: "1px solid #f59e0b",
                              borderRadius: "4px",
                              padding: "1px 5px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                            }}
                          >
                            🌟 GOLD VIP
                          </span>
                        )}
                        {tier.tier === "silver" && (
                          <span
                            title="Silver Regular Customer"
                            style={{
                              fontSize: "10px",
                              fontWeight: 800,
                              background: "#e0e7ff",
                              color: "#1e3a8a",
                              border: "1px solid #6366f1",
                              borderRadius: "4px",
                              padding: "1px 5px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                            }}
                          >
                            🥈 SILVER
                          </span>
                        )}
                      </div>
                      <div className="hint" style={{ fontSize: "11px" }}>
                        {tier.visitCount} visits • {inr(tier.totalSpent)} spent
                      </div>
                    </td>

                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontWeight: 600 }}>{c.phone}</span>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="btn sm ghost"
                            title={`Direct Call ${c.name}`}
                            style={{
                              padding: "2px 6px",
                              color: "#2563eb",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              fontSize: "11px",
                              fontWeight: 700,
                            }}
                          >
                            <Phone size={11} /> Call
                          </a>
                        )}
                      </div>
                    </td>

                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "12px" }}>{c.address || "—"}</span>
                        {c.address && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn sm ghost"
                            title="Open in Google Maps"
                            style={{
                              padding: "2px 6px",
                              color: "#ea580c",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              fontSize: "11px",
                              fontWeight: 700,
                            }}
                          >
                            <MapPin size={11} /> Map
                          </a>
                        )}
                      </div>
                    </td>

                    <td>{ymd(c.createdAt) || "—"}</td>

                    <td>
                      <div style={{ fontWeight: 900, fontSize: "13.5px", color: hasDue ? "var(--red, #ef4444)" : "var(--green, #16a34a)" }}>
                        {inr(c.totalDue || 0)}
                      </div>
                      {hasDue && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRepayCustomer(c);
                          }}
                          style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            background: "#dcfce7",
                            color: "#15803d",
                            border: "1px solid #86efac",
                            fontWeight: 800,
                            marginTop: "2px",
                          }}
                        >
                          <Zap size={10} /> ⚡ Jama / Settle
                        </button>
                      )}
                    </td>

                    <td onClick={(e) => e.stopPropagation()}>
                      {hasDue ? (
                        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                          {/* 1-Tap WhatsApp Payment Reminder */}
                          <button
                            className="btn sm"
                            style={{
                              fontSize: "11px",
                              padding: "4px 10px",
                              background: "#25D366",
                              color: "#fff",
                              border: "none",
                              fontWeight: 800,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                            onClick={() => setSelectedUpiCustomer(c)}
                          >
                            <MessageCircle size={13} /> 💬 Send UPI Payment Link on WhatsApp
                          </button>

                          {!reminderState[c.id] && (
                            <button
                              className="btn sm ghost"
                              style={{ fontSize: "11px", padding: "3px 8px" }}
                              onClick={() => handleAiReminder(c.id, c.name, c.phone, c.totalDue || 0)}
                            >
                              <Sparkles size={12} /> AI Custom
                            </button>
                          )}

                          {reminderState[c.id]?.loading && (
                            <span style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Likh rahe hain...</span>
                          )}

                          {reminderState[c.id]?.text && (
                            <div style={{ width: "100%", marginTop: "6px", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "6px", padding: "8px" }}>
                              <div style={{ fontSize: "11px", color: "var(--ink)", whiteSpace: "pre-line", marginBottom: "6px", lineHeight: "1.4" }}>
                                {reminderState[c.id].text}
                              </div>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  className="btn sm green"
                                  style={{ fontSize: "11px", padding: "3px 8px" }}
                                  onClick={() => openWhatsApp(c.phone, reminderState[c.id].text)}
                                >
                                  <MessageCircle size={12} /> Send WhatsApp
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="hint">No pending balance</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px" }}>
                    Is filter mein koi customer nahi mila
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Profile & Device History Modal */}
      {profileCustomer && (
        <div className="overlay show">
          <div className="modal wide" style={{ maxWidth: "780px" }}>
            <div className="modal-head">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    background: profileCustomer.tier.tier === "gold" ? "#fef3c7" : "#eff6ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                  }}
                >
                  {profileCustomer.tier.badgeEmoji}
                </div>
                <div>
                  <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                    {profileCustomer.customer.name}
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 800,
                        padding: "2px 7px",
                        borderRadius: "4px",
                        background: profileCustomer.tier.badgeBg,
                        color: profileCustomer.tier.badgeColor,
                        border: `1px solid ${profileCustomer.tier.badgeBorder}`,
                      }}
                    >
                      {profileCustomer.tier.badgeLabel}
                    </span>
                  </h3>
                  <div className="hint" style={{ fontSize: "12px", marginTop: "2px" }}>
                    📱 {profileCustomer.customer.phone}
                    {profileCustomer.customer.address ? ` • 📍 ${profileCustomer.customer.address}` : ""}
                  </div>
                </div>
              </div>
              <button onClick={() => setProfileCustomerId(null)}>&times;</button>
            </div>

            {/* Customer Due Balance Banner */}
            {(profileCustomer.customer.totalDue || 0) > 0 && (
              <div
                style={{
                  background: "#fff7ed",
                  border: "1.5px solid #f97316",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  marginTop: "12px",
                  marginBottom: "12px",
                  fontSize: "14px",
                  color: "#9a3412",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "10px",
                  boxShadow: "0 2px 10px rgba(249, 115, 22, 0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "20px" }}>⚠️</span>
                  <span>
                    Is customer ka <b>{inr(profileCustomer.customer.totalDue || 0)}</b> purana baaki hai
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn sm"
                    style={{
                      background: "#ea580c",
                      color: "#ffffff",
                      border: "none",
                      fontWeight: 800,
                      fontSize: "12px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                    }}
                    onClick={() => {
                      setRepayCustomer(profileCustomer.customer);
                    }}
                  >
                    💳 Settle / Jama Karein
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    style={{
                      background: "#22c55e",
                      color: "#ffffff",
                      border: "none",
                      fontWeight: 800,
                      fontSize: "12px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                    }}
                    onClick={() => {
                      setSelectedUpiCustomer(profileCustomer.customer);
                    }}
                  >
                    💬 WhatsApp UPI Reminder
                  </button>
                </div>
              </div>
            )}

            {/* Metric stats */}
            <div
              className="stat-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "10px",
                margin: "12px 0 16px",
              }}
            >
              <div className="stat-card" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                <div className="hint" style={{ fontSize: "11px" }}>Lifetime Spend</div>
                <div style={{ fontWeight: 800, fontSize: "16px" }}>{inr(profileCustomer.totalSpent)}</div>
              </div>
              <div className="stat-card" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                <div className="hint" style={{ fontSize: "11px" }}>Total Visits</div>
                <div style={{ fontWeight: 800, fontSize: "16px" }}>{profileCustomer.visitCount}</div>
              </div>
              <div className="stat-card" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                <div className="hint" style={{ fontSize: "11px" }}>Devices Owned</div>
                <div style={{ fontWeight: 800, fontSize: "16px", color: "var(--navy)" }}>{profileCustomer.devices.length}</div>
              </div>
              <div className="stat-card" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                <div className="hint" style={{ fontSize: "11px" }}>Outstanding Due</div>
                <div style={{ fontWeight: 800, fontSize: "16px", color: (profileCustomer.customer.totalDue || 0) > 0 ? "var(--red)" : "var(--green)" }}>
                  {inr(profileCustomer.customer.totalDue || 0)}
                </div>
              </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: "flex", gap: "8px", borderBottom: "1.5px solid var(--line)", paddingBottom: "8px", marginBottom: "12px" }}>
              <button
                type="button"
                className={`btn sm ${profileTab === "purchases" ? "primary" : "ghost"}`}
                onClick={() => setProfileTab("purchases")}
                style={{ fontWeight: 700 }}
              >
                <Receipt size={13} /> 🛒 Purchases &amp; Bills ({profileCustomer.sales.length})
              </button>
              <button
                type="button"
                className={`btn sm ${profileTab === "devices" ? "primary" : "ghost"}`}
                onClick={() => setProfileTab("devices")}
                style={{ fontWeight: 700 }}
              >
                <Smartphone size={13} /> 📱 Device &amp; IMEI History ({profileCustomer.devices.length})
              </button>
              <button
                type="button"
                className={`btn sm ${profileTab === "repairs" ? "primary" : "ghost"}`}
                onClick={() => setProfileTab("repairs")}
                style={{ fontWeight: 700 }}
              >
                <Wrench size={13} /> 🛠️ Repair &amp; Service History ({profileCustomer.repairs.length})
              </button>
            </div>

            {/* Tab 1: Purchases */}
            {profileTab === "purchases" && (
              <div className="table-wrap" style={{ maxHeight: "320px", overflowY: "auto" }}>
                {profileCustomer.sales.length === 0 ? (
                  <div className="empty">Is customer ka abhi tak koi purchase record nahi hai.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        <th>Invoice #</th>
                        <th>Items Purchased</th>
                        <th>Payment Mode</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profileCustomer.sales.map((s) => (
                        <tr key={s.id}>
                          <td>{s.date} <span className="hint">{s.time}</span></td>
                          <td>
                            {onViewInvoiceByNo ? (
                              <button
                                className="btn sm ghost"
                                style={{ fontWeight: 800, padding: "2px 6px" }}
                                onClick={() => {
                                  setProfileCustomerId(null);
                                  onViewInvoiceByNo(s.invoiceNo);
                                }}
                              >
                                {s.invoiceNo}
                              </button>
                            ) : (
                              <b>{s.invoiceNo}</b>
                            )}
                          </td>
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
            )}

            {/* Tab 2: Customer Device & IMEI History */}
            {profileTab === "devices" && (
              <div className="table-wrap" style={{ maxHeight: "320px", overflowY: "auto" }}>
                {profileCustomer.devices.length === 0 ? (
                  <div className="empty">Is customer ke kisi smartphone/device purchase ka IMEI record nahi mila.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Device Name</th>
                        <th>Primary IMEI / S/N</th>
                        <th>Secondary IMEI</th>
                        <th>Purchase Date</th>
                        <th>Invoice Ref</th>
                        <th>Warranty End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profileCustomer.devices.map((d, idx) => (
                        <tr key={idx}>
                          <td>
                            <b>{d.deviceName}</b>
                            {d.isSecondHand && <span className="badge exch" style={{ marginLeft: "6px", fontSize: "10px" }}>2nd Hand</span>}
                          </td>
                          <td>
                            <b style={{ color: "var(--navy)", fontFamily: "monospace" }}>{d.imei1 || d.serialNo || "—"}</b>
                          </td>
                          <td>
                            <span style={{ fontFamily: "monospace" }}>{d.imei2 || "—"}</span>
                          </td>
                          <td>{d.purchaseDate}</td>
                          <td>
                            {onViewInvoiceByNo ? (
                              <button
                                className="btn sm ghost"
                                style={{ fontWeight: 700, padding: "2px 6px" }}
                                onClick={() => {
                                  setProfileCustomerId(null);
                                  onViewInvoiceByNo(d.invoiceNo);
                                }}
                              >
                                {d.invoiceNo}
                              </button>
                            ) : (
                              d.invoiceNo
                            )}
                          </td>
                          <td>
                            {d.warrantyEnd ? (
                              <span style={{ color: "var(--green)", fontWeight: 700, fontSize: "11.5px" }}>
                                {d.warrantyEnd}
                              </span>
                            ) : (
                              <span className="hint">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Tab 3: Repair & Service Timeline */}
            {profileTab === "repairs" && (
              <div className="table-wrap" style={{ maxHeight: "320px", overflowY: "auto" }}>
                {profileCustomer.repairs.length === 0 ? (
                  <div className="empty">Is customer ka koi service ya repair ticket nahi hai.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Job #</th>
                        <th>Device Model</th>
                        <th>Reported Issue</th>
                        <th>Status</th>
                        <th>Total Cost</th>
                        <th>Advance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profileCustomer.repairs.map((job) => (
                        <tr key={job.id}>
                          <td><b>{job.ticketNo || job.id.slice(-6).toUpperCase()}</b></td>
                          <td><b>{job.device}</b></td>
                          <td style={{ fontSize: "12px", maxWidth: "220px" }}>{job.issue}</td>
                          <td>
                            <span className={`badge ${job.status === "Delivered" ? "ok" : job.status === "Ready" ? "info" : "due"}`}>
                              {job.status}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700 }}>{inr(job.estCost || 0)}</td>
                          <td>{inr(job.advance || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: "16px" }}>
              {(profileCustomer.customer.totalDue || 0) > 0 && (
                <button
                  type="button"
                  className="btn primary sm"
                  style={{ background: "#25D366", color: "#fff", border: "none", fontWeight: 800 }}
                  onClick={() => {
                    const c = profileCustomer.customer;
                    setProfileCustomerId(null);
                    setSelectedUpiCustomer(c);
                  }}
                >
                  <MessageCircle size={13} /> Send WhatsApp Payment Reminder
                </button>
              )}
              <button className="btn" onClick={() => setProfileCustomerId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Print Customer Directory Modal */}
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
                    <th style={{ border: "1px solid #ccc", padding: "6px", textAlign: "left" }}>Outstanding Due</th>
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
                      <td style={{ border: "1px solid #ccc", padding: "6px", fontWeight: 700 }}>{inr(c.totalDue || 0)}</td>
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

      {selectedUpiCustomer && (
        <CustomerKhataUpiModal
          customer={selectedUpiCustomer}
          db={db}
          onClose={() => setSelectedUpiCustomer(null)}
          showToast={toast}
        />
      )}

      {repayCustomer && (
        <QuickKhataRepaymentModal
          customer={repayCustomer}
          db={db}
          isOpen={true}
          onClose={() => setRepayCustomer(null)}
          onSuccess={(updated) => {
            // Updated in DB by modal
          }}
          toast={toast}
        />
      )}
    </div>
  );
};
