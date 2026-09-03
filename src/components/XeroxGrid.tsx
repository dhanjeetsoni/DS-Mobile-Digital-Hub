import React, { useState } from "react";
import { Layers, Plus, RotateCcw, CheckCircle2, Printer, Zap, Sparkles, Settings as SettingsIcon, Trash2, Lock, Pencil, TrendingUp } from "lucide-react";
import { Database, XeroxEntry, CybercafeService } from "../types";
import { inr } from "../utils/indianCurrency";
import { uid, todayStr, nowTimeStr } from "../utils/fifoEngine";
import { xeroxCost, xeroxProfit } from "../utils/profitEngine";
import { MiniShareBars } from "./MiniCharts";

interface XeroxGridProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, kind?: string) => void;
  ownerMode: boolean;
}

// Built-in fallback rates — used the very first time a shop opens this page,
// and for any old saved database that doesn't have db.cybercafeServices yet.
// Once the owner saves changes from "Manage Rates", db.cybercafeServices
// takes over and these are never referenced again for that shop.
export const DEFAULT_CYBERCAFE_SERVICES: CybercafeService[] = [
  { id: "xrx-bw-2", serviceType: "Xerox B&W", rate: 2, label: "Xerox B&W (₹2)", icon: "📄", color: "var(--navy-2)" },
  { id: "xrx-bw-3", serviceType: "Xerox B&W", rate: 3, label: "Xerox B&W (₹3)", icon: "📄", color: "var(--navy-2)" },
  { id: "xrx-bw-5", serviceType: "Xerox B&W", rate: 5, label: "Xerox B&W 2-Sided (₹5)", icon: "📑", color: "var(--navy-2)" },
  { id: "xrx-color-10", serviceType: "Xerox Color", rate: 10, label: "Color Print A4 (₹10)", icon: "🎨", color: "var(--purple)" },
  { id: "photo-20", serviceType: "Photo Print", rate: 20, label: "Passport Photo (₹20)", icon: "📸", color: "var(--blue)" },
  { id: "photo-30", serviceType: "Photo Print", rate: 30, label: "Photo 4x6 / Card (₹30)", icon: "🖼️", color: "var(--blue)" },
  { id: "lam-20", serviceType: "Lamination", rate: 20, label: "A4 Lamination (₹20)", icon: "🛡️", color: "var(--amber)" },
  { id: "id-30", serviceType: "Aadhaar/PAN Print", rate: 30, label: "Aadhaar / PAN PVC (₹30)", icon: "🪪", color: "var(--green)" },
  { id: "id-50", serviceType: "Aadhaar/PAN Print", rate: 50, label: "PVC Smart Card (₹50)", icon: "💳", color: "var(--green)" },
  { id: "form-50", serviceType: "Online Form Apply", rate: 50, label: "Online Form Filling (₹50)", icon: "💻", color: "var(--accent)" },
  { id: "form-100", serviceType: "Online Form Apply", rate: 100, label: "Job / Scheme Form (₹100)", icon: "📝", color: "var(--accent)" },
  { id: "money-20", serviceType: "Money Transfer Fee", rate: 20, label: "Money Transfer (₹20)", icon: "💸", color: "var(--green)" },
];

export const XeroxGrid: React.FC<XeroxGridProps> = ({ db, onUpdate, toast, ownerMode }) => {
  const [copiesCount, setCopiesCount] = useState<number>(1);
  const [payMethod, setPayMethod] = useState<"Cash" | "UPI">("Cash");
  const [isRateEditorOpen, setIsRateEditorOpen] = useState(false);
  const [draftServices, setDraftServices] = useState<CybercafeService[]>([]);
  // Owner-only: optional cost for the NEXT transaction logged. Left blank ("")
  // means "use this service's default cost (if any set in Manage Rates), or
  // ₹0 if none" — the field is not compulsory, matching how staff use this
  // grid every day. Typing a number here overrides the default for a
  // one-off variable cost (e.g. "FRP bypass — mera is baar ₹350 laga").
  const [manualCost, setManualCost] = useState<string>("");
  // Owner-only: inline cost correction on an already-logged entry.
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editingCostValue, setEditingCostValue] = useState<string>("");

  const SERVICES: CybercafeService[] =
    db.cybercafeServices && db.cybercafeServices.length > 0
      ? db.cybercafeServices
      : DEFAULT_CYBERCAFE_SERVICES;

  const openRateEditor = () => {
    if (!ownerMode) {
      toast("Sirf owner rates change kar sakte hain", "red");
      return;
    }
    setDraftServices(SERVICES.map((s) => ({ ...s })));
    setIsRateEditorOpen(true);
  };

  const updateDraftRate = (id: string, field: "label" | "rate" | "icon" | "serviceType" | "defaultCost", value: string) => {
    setDraftServices((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, [field]: field === "rate" || field === "defaultCost" ? Math.max(0, Number(value) || 0) : value } : s
      )
    );
  };

  const removeDraftService = (id: string) => {
    setDraftServices((prev) => prev.filter((s) => s.id !== id));
  };

  const addDraftService = () => {
    setDraftServices((prev) => [
      ...prev,
      {
        id: uid("svc"),
        serviceType: "Custom Product",
        rate: 0,
        label: "",
        icon: "🧾",
        color: "var(--accent)",
        defaultCost: 0,
      },
    ]);
  };

  const saveRates = () => {
    const cleaned = draftServices.filter((s) => s.label.trim().length > 0);
    if (cleaned.length < draftServices.length) {
      toast("Khaali naam wali entry hata di gayi — naam bharna zaroori hai", "amber");
    }
    db.cybercafeServices = cleaned;
    onUpdate();
    setIsRateEditorOpen(false);
    toast("Cyber cafe rates & products update ho gaye", "green");
  };

  const resetRatesToDefault = () => {
    setDraftServices(DEFAULT_CYBERCAFE_SERVICES.map((s) => ({ ...s })));
  };

  const todayEntries = (db.xeroxEntries || []).filter((x) => x.date === todayStr());
  const todayRevenue = todayEntries.reduce((a, x) => a + x.totalAmount, 0);
  const todayCopies = todayEntries.reduce((a, x) => a + x.copies, 0);
  const todayCost = todayEntries.reduce((a, x) => a + xeroxCost(x), 0);
  const todayProfit = todayEntries.reduce((a, x) => a + xeroxProfit(x), 0);

  const handle1TapAdd = (srv: CybercafeService) => {
    const total = srv.rate * copiesCount;
    const autoCost = (srv.defaultCost || 0) * copiesCount;
    const cost = manualCost.trim() !== "" ? Math.max(0, Number(manualCost) || 0) : autoCost;
    const entry: XeroxEntry = {
      id: uid("xrx"),
      date: todayStr(),
      time: nowTimeStr(),
      serviceType: srv.serviceType,
      copies: copiesCount,
      ratePerUnit: srv.rate,
      totalAmount: total,
      paymentMethod: payMethod,
      costAmount: cost,
    };

    if (!db.xeroxEntries) db.xeroxEntries = [];
    db.xeroxEntries.push(entry);
    onUpdate();

    const profitNote = ownerMode && cost > 0 ? ` (cost ${inr(cost)}, profit ${inr(total - cost)})` : "";
    toast(`+${inr(total)} logged for ${copiesCount}x ${srv.label} (${payMethod})${profitNote}`, "green");
    setCopiesCount(1); // reset counter after adding
    setManualCost(""); // reset one-off cost override after adding
  };

  const startEditCost = (x: XeroxEntry) => {
    setEditingCostId(x.id);
    setEditingCostValue(x.costAmount ? String(x.costAmount) : "");
  };

  const saveEditCost = (x: XeroxEntry) => {
    x.costAmount = Math.max(0, Number(editingCostValue) || 0);
    x.costEditedAt = new Date().toISOString();
    onUpdate();
    setEditingCostId(null);
    setEditingCostValue("");
    toast(`Cost updated for ${x.serviceType} — profit ${inr(xeroxProfit(x))}`, "green");
  };

  // Owner-only "today's profit by service" — helps spot which counter
  // service (Xerox, Photo, FRP-style custom services, etc) is actually
  // making money vs. which is just turnover with thin/no margin.
  const profitByServiceToday = Object.entries(
    todayEntries.reduce((acc: { [t: string]: number }, x) => {
      acc[x.serviceType] = (acc[x.serviceType] || 0) + xeroxProfit(x);
      return acc;
    }, {} as { [t: string]: number })
  )
    .map(([label, value]) => ({ label, value: value as number }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const handleClearHistory = () => {
    // Keep today only or remove last
    if (db.xeroxEntries && db.xeroxEntries.length > 0) {
      const removed = db.xeroxEntries.pop();
      onUpdate();
      toast(`Removed last entry: ${removed?.serviceType} (${inr(removed?.totalAmount || 0)})`, "amber");
    }
  };

  return (
    <div>
      <div className={`grid ${ownerMode ? "cols-4" : "cols-3"}`} style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Today's Digital Hub Revenue</h3>
          <div className="big green">{inr(todayRevenue)}</div>
          <div className="foot">{todayEntries.length} quick transactions logged</div>
        </div>
        <div className="card">
          <h3>Total Copies / Prints Done</h3>
          <div className="big blue">{todayCopies} Units</div>
          <div className="foot">Today's total volume</div>
        </div>
        <div className="card">
          <h3>Cash vs UPI Ratio</h3>
          <div className="big">
            {inr(todayEntries.filter((x) => x.paymentMethod === "Cash").reduce((a, x) => a + x.totalAmount, 0))} /{" "}
            {inr(todayEntries.filter((x) => x.paymentMethod === "UPI").reduce((a, x) => a + x.totalAmount, 0))}
          </div>
          <div className="foot">Cash in Galla / Online UPI</div>
        </div>
        {ownerMode && (
          <div className="card">
            <h3>Today's Profit (Owner Only)</h3>
            <div className={`big ${todayProfit >= 0 ? "green" : "red"}`}>{inr(todayProfit)}</div>
            <div className="foot">Cost so far: {inr(todayCost)}</div>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>1-Tap Cyber Cafe &amp; Xerox Counter</h2>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {ownerMode ? (
              <button className="btn sm" onClick={openRateEditor}>
                <SettingsIcon size={13} /> Manage Rates &amp; Products
              </button>
            ) : (
              <span className="hint" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Lock size={12} /> Rates set by owner
              </span>
            )}
            <span style={{ fontSize: "12.5px", fontWeight: 700 }}>Payment Method:</span>
            <div className="mode-pill" style={{ margin: 0 }}>
              <button
                className={payMethod === "Cash" ? "on" : ""}
                onClick={() => setPayMethod("Cash")}
              >
                💵 Cash
              </button>
              <button
                className={payMethod === "UPI" ? "on" : ""}
                onClick={() => setPayMethod("UPI")}
              >
                📱 UPI
              </button>
            </div>
          </div>
        </div>

        {/* Quantity Selector Pills */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--ink-soft)" }}>Copies Multiplier:</span>
          {[1, 2, 3, 5, 10, 20, 50].map((qty) => (
            <button
              key={qty}
              className={`btn sm ${copiesCount === qty ? "primary" : ""}`}
              onClick={() => setCopiesCount(qty)}
              style={{ fontWeight: 800 }}
            >
              {qty}x
            </button>
          ))}
          <input
            type="number"
            min="1"
            value={copiesCount}
            onChange={(e) => setCopiesCount(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: "70px", padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}
          />
        </div>

        {ownerMode && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", background: "var(--paper)", padding: "8px 12px", borderRadius: "8px" }}>
            <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--ink-soft)" }}>
              Cost for next entry (₹, optional):
            </span>
            <input
              type="number"
              min="0"
              value={manualCost}
              onChange={(e) => setManualCost(e.target.value)}
              placeholder="e.g. 350 for FRP bypass"
              style={{ width: "170px", padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}
            />
            <span className="hint">
              Khaali chhodne par service ka set default cost (agar Manage Rates mein hai) use hoga, warna ₹0 — profit poora amount maana jayega.
            </span>
          </div>
        )}

        {/* Fast 1-Tap Touch Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
          }}
        >
          {SERVICES.map((srv, idx) => {
            const totalForSelectedQty = srv.rate * copiesCount;
            return (
              <button
                key={idx}
                onClick={() => handle1TapAdd(srv)}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "16px",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "var(--shadow)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--glow)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--line)";
                  e.currentTarget.style.transform = "none";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "24px" }}>{srv.icon}</span>
                  <span
                    className="badge"
                    style={{ background: "var(--blue-light)", color: "var(--navy)", fontWeight: 800 }}
                  >
                    {inr(srv.rate)}/pc
                  </span>
                </div>
                <div style={{ marginTop: "10px" }}>
                  <div style={{ fontWeight: 800, fontSize: "13.5px", color: "var(--ink)" }}>{srv.label}</div>
                  <div style={{ fontSize: "11.5px", color: "var(--ink-soft)", marginTop: "2px" }}>
                    {copiesCount > 1 ? `${copiesCount}x = ` : ""}
                    <b style={{ color: "var(--green)", fontSize: "13px" }}>{inr(totalForSelectedQty)}</b>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Today's Transactions Table */}
      <div className="section">
        <div className="section-head">
          <h2>Today's Xerox &amp; Digital Log ({todayEntries.length})</h2>
          {todayEntries.length > 0 && (
            <button className="btn sm danger" onClick={handleClearHistory}>
              <RotateCcw size={12} /> Undo Last Entry
            </button>
          )}
        </div>

        <div className="table-wrap">
          {todayEntries.length === 0 ? (
            <div className="empty">No Xerox or print services logged yet today. Tap any button above to instantly log cash.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Service</th>
                  <th>Copies</th>
                  <th>Rate</th>
                  <th>Total Amount</th>
                  <th>Payment</th>
                  {ownerMode && <th>Cost</th>}
                  {ownerMode && <th>Profit</th>}
                </tr>
              </thead>
              <tbody>
                {todayEntries.slice().reverse().map((x) => (
                  <tr key={x.id}>
                    <td>{x.time}</td>
                    <td><b>{x.serviceType}</b></td>
                    <td>{x.copies}</td>
                    <td>{inr(x.ratePerUnit)}</td>
                    <td style={{ fontWeight: 800, color: "var(--green)" }}>{inr(x.totalAmount)}</td>
                    <td><span className="badge ok">{x.paymentMethod}</span></td>
                    {ownerMode && (
                      <td>
                        {editingCostId === x.id ? (
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <input
                              type="number"
                              min="0"
                              autoFocus
                              value={editingCostValue}
                              onChange={(e) => setEditingCostValue(e.target.value)}
                              style={{ width: "70px", padding: "3px 6px", borderRadius: "6px", border: "1px solid var(--line)" }}
                            />
                            <button className="btn sm primary" type="button" onClick={() => saveEditCost(x)}>
                              <CheckCircle2 size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn sm ghost"
                            type="button"
                            onClick={() => startEditCost(x)}
                            title="Cost edit karein"
                            style={{ display: "flex", alignItems: "center", gap: "4px" }}
                          >
                            {inr(xeroxCost(x))} <Pencil size={11} />
                          </button>
                        )}
                      </td>
                    )}
                    {ownerMode && (
                      <td style={{ fontWeight: 800, color: xeroxProfit(x) >= 0 ? "var(--green)" : "var(--red)" }}>
                        {inr(xeroxProfit(x))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {ownerMode && profitByServiceToday.length > 0 && (
        <div className="section">
          <div className="section-head">
            <h2><TrendingUp size={15} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Today's Profit by Service (Owner Only)</h2>
          </div>
          <MiniShareBars data={profitByServiceToday} />
        </div>
      )}

      {isRateEditorOpen && ownerMode && (
        <div className="overlay show">
          <div className="modal wide">
            <div className="modal-head">
              <h3>Manage Cyber Cafe Rates &amp; Products (Owner Only)</h3>
              <button onClick={() => setIsRateEditorOpen(false)}>&times;</button>
            </div>

            <p className="hint" style={{ marginBottom: "12px" }}>
              Yahan se price badlein, naya product/service jodein, icon ya category badlein, ya hata dein. Save karte hi staff ko naye rates 1-Tap grid par turant dikhenge.
            </p>

            <div className="table-wrap" style={{ maxHeight: "360px", overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Icon</th>
                    <th>Product / Service Name</th>
                    <th>Category</th>
                    <th>Rate (₹)</th>
                    <th>Default Cost (₹)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {draftServices.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          value={s.icon}
                          onChange={(e) => updateDraftRate(s.id, "icon", e.target.value)}
                          placeholder="📄"
                          style={{ width: "48px", padding: "6px 4px", borderRadius: "6px", border: "1px solid var(--line)", textAlign: "center", fontSize: "18px" }}
                        />
                      </td>
                      <td>
                        <input
                          value={s.label}
                          onChange={(e) => updateDraftRate(s.id, "label", e.target.value)}
                          style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}
                        />
                      </td>
                      <td>
                        <input
                          value={s.serviceType}
                          onChange={(e) => updateDraftRate(s.id, "serviceType", e.target.value)}
                          list="cybercafe-category-suggestions"
                          placeholder="e.g. Xerox, Printing, Stationery"
                          style={{ width: "140px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={s.rate}
                          onChange={(e) => updateDraftRate(s.id, "rate", e.target.value)}
                          style={{ width: "90px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={s.defaultCost ?? ""}
                          onChange={(e) => updateDraftRate(s.id, "defaultCost", e.target.value)}
                          placeholder="0"
                          title="Per-unit cost — auto-fills the cost box on the 1-Tap counter"
                          style={{ width: "90px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}
                        />
                      </td>
                      <td>
                        <button className="btn sm danger" type="button" onClick={() => removeDraftService(s.id)}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="cybercafe-category-suggestions">
                {Array.from(new Set(DEFAULT_CYBERCAFE_SERVICES.map((s) => s.serviceType))).map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>

            <button type="button" className="btn sm" style={{ marginTop: "10px" }} onClick={addDraftService}>
              <Plus size={13} /> Add New Product / Service
            </button>

            <div className="modal-actions" style={{ marginTop: "16px", justifyContent: "space-between" }}>
              <button type="button" className="btn sm" onClick={resetRatesToDefault}>
                <RotateCcw size={12} /> Reset to Default
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" className="btn" onClick={() => setIsRateEditorOpen(false)}>Cancel</button>
                <button type="button" className="btn primary" onClick={saveRates}>
                  <CheckCircle2 size={14} /> Save Rates
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
