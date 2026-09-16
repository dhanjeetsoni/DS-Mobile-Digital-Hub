import React, { useState, useMemo } from "react";
import {
  Award,
  DollarSign,
  TrendingUp,
  UserCheck,
  CheckCircle2,
  Clock,
  Send,
  Plus,
  Filter,
  Calendar,
  Sparkles,
  Percent,
  Sliders,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { Database, StaffIncentiveRecord, StaffCommissionRule } from "../types";
import { inr } from "../utils/indianCurrency";

interface StaffIncentiveTrackerViewProps {
  db: Database;
  onUpdateDb: (updater: (prev: Database) => Database) => void;
  activeRole: "owner" | "staff";
  currentStaffName?: string;
}

const DEFAULT_COMMISSION_RULES: StaffCommissionRule[] = [
  { category: "Repairs & Services", type: "flat", value: 50 }, // ₹50 flat per completed repair
  { category: "Smartphones & Tablets", type: "flat", value: 100 }, // ₹100 per phone sold
  { category: "Accessories", type: "percent", value: 5 }, // 5% on accessory amount
  { category: "Tempered Glass & Covers", type: "flat", value: 15 }, // ₹15 flat per glass/cover
  { category: "Xerox / Cyber Cafe", type: "flat", value: 2 }, // ₹2 per cyber job
  { category: "SIM Activation", type: "flat", value: 25 }, // ₹25 per SIM
];

export const StaffIncentiveTrackerView: React.FC<StaffIncentiveTrackerViewProps> = ({
  db,
  onUpdateDb,
  activeRole,
  currentStaffName = "Staff",
}) => {
  const [selectedStaff, setSelectedStaff] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "Pending" | "Paid Out">("all");
  const [showAddManualModal, setShowAddManualModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [targetAmount, setTargetAmount] = useState<number>(50000); // ₹50,000 monthly sales target

  // Form for manual bonus/incentive
  const [manualStaff, setManualStaff] = useState(currentStaffName);
  const [manualDesc, setManualDesc] = useState("");
  const [manualAmount, setManualAmount] = useState<number | "">("");
  const [manualSource, setManualSource] = useState<StaffIncentiveRecord["sourceType"]>("POS Sale");

  const incentiveList: StaffIncentiveRecord[] = useMemo(() => {
    return db.staffIncentives || [];
  }, [db.staffIncentives]);

  // Unique staff list
  const staffNames = useMemo(() => {
    const set = new Set<string>();
    incentiveList.forEach((inc) => set.add(inc.staffName));
    if (db.sales) {
      db.sales.forEach((s) => {
        if (s.staffName) set.add(s.staffName);
      });
    }
    set.add("Rahul");
    set.add("Amit");
    set.add("Priya");
    return Array.from(set).filter(Boolean);
  }, [incentiveList, db.sales]);

  // Filtered incentives
  const filteredIncentives = useMemo(() => {
    return incentiveList.filter((item) => {
      if (selectedStaff !== "all" && item.staffName !== selectedStaff) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      return true;
    });
  }, [incentiveList, selectedStaff, statusFilter]);

  // Summary Metrics
  const totalEarned = useMemo(() => {
    return filteredIncentives.reduce((sum, item) => sum + item.incentiveEarned, 0);
  }, [filteredIncentives]);

  const totalPending = useMemo(() => {
    return filteredIncentives
      .filter((i) => i.status === "Pending")
      .reduce((sum, item) => sum + item.incentiveEarned, 0);
  }, [filteredIncentives]);

  const totalPaidOut = useMemo(() => {
    return filteredIncentives
      .filter((i) => i.status === "Paid Out")
      .reduce((sum, item) => sum + item.incentiveEarned, 0);
  }, [filteredIncentives]);

  // Mark incentive as paid out
  const handleMarkPaid = (id: string) => {
    onUpdateDb((prev) => {
      const updated = (prev.staffIncentives || []).map((inc) => {
        if (inc.id === id) {
          return {
            ...inc,
            status: "Paid Out" as const,
            paidAt: new Date().toISOString(),
            paidNotes: "Settled by Owner",
          };
        }
        return inc;
      });
      return { ...prev, staffIncentives: updated };
    });
  };

  // Settle all pending for selected staff
  const handleSettleAllPending = () => {
    if (!window.confirm(`Kya aap ${selectedStaff === "all" ? "sab staff" : selectedStaff} ka pending incentive (₹${totalPending}) settle/paid mark karna chahte hain?`)) {
      return;
    }
    onUpdateDb((prev) => {
      const updated = (prev.staffIncentives || []).map((inc) => {
        if (inc.status === "Pending" && (selectedStaff === "all" || inc.staffName === selectedStaff)) {
          return {
            ...inc,
            status: "Paid Out" as const,
            paidAt: new Date().toISOString(),
            paidNotes: "Bulk Settled by Owner",
          };
        }
        return inc;
      });
      return { ...prev, staffIncentives: updated };
    });
  };

  // Add manual incentive
  const handleAddManualIncentive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAmount || Number(manualAmount) <= 0 || !manualDesc.trim()) {
      alert("Kripya valid incentive amount aur description enter karein.");
      return;
    }
    const newInc: StaffIncentiveRecord = {
      id: `INC-${Date.now()}`,
      staffName: manualStaff,
      date: new Date().toISOString().split("T")[0],
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      sourceType: manualSource,
      referenceId: `MANUAL-${Date.now().toString().slice(-4)}`,
      description: manualDesc.trim(),
      saleAmount: 0,
      incentiveEarned: Number(manualAmount),
      status: "Pending",
    };
    onUpdateDb((prev) => ({
      ...prev,
      staffIncentives: [newInc, ...(prev.staffIncentives || [])],
    }));
    setManualDesc("");
    setManualAmount("");
    setShowAddManualModal(false);
  };

  // WhatsApp Incentive Slip
  const handleSendWhatsAppSlip = (staff: string) => {
    const staffRecords = incentiveList.filter((i) => i.staffName === staff);
    const pending = staffRecords.filter((i) => i.status === "Pending").reduce((s, i) => s + i.incentiveEarned, 0);
    const paid = staffRecords.filter((i) => i.status === "Paid Out").reduce((s, i) => s + i.incentiveEarned, 0);

    const message = `*DS MOBILE HUB — STAFF INCENTIVE SLIP* 🏆%0A` +
      `👤 *Staff Name:* ${staff}%0A` +
      `📅 *Date:* ${new Date().toLocaleDateString("en-IN")}%0A` +
      `----------------------------%0A` +
      `💰 *Total Earned:* ${inr(pending + paid)}%0A` +
      `✅ *Paid Out:* ${inr(paid)}%0A` +
      `⏳ *Pending Payout:* ${inr(pending)}%0A` +
      `----------------------------%0A` +
      `_Aapki mehnat ke liye shukriya! Best of luck for next targets!_ 🚀`;

    window.open(`https://wa.me/?text=${message}`, "_blank");
  };

  return (
    <div style={{ padding: "12px", maxWidth: "100%", margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(16, 185, 129, 0.15))",
          border: "1px solid rgba(59, 130, 246, 0.3)",
          borderRadius: "16px",
          padding: "16px",
          marginBottom: "16px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Award size={24} color="#3b82f6" />
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--text, #f8fafc)" }}>
              Staff Commission & Target Incentive Tracker
            </h2>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", margin: "4px 0 0 0" }}>
            Daily sales, repairs, accessories aur cyber targets par staff commission hisaab.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {activeRole === "owner" && (
            <>
              <button
                className="btn primary"
                onClick={() => setShowAddManualModal(true)}
                style={{ fontSize: "12px", padding: "8px 14px", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <Plus size={14} />
                <span>Add Bonus / Incentive</span>
              </button>
              {totalPending > 0 && (
                <button
                  className="btn"
                  onClick={handleSettleAllPending}
                  style={{
                    fontSize: "12px",
                    padding: "8px 14px",
                    background: "rgba(16, 185, 129, 0.2)",
                    borderColor: "rgba(16, 185, 129, 0.4)",
                    color: "#34d399",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <CheckCircle2 size={14} />
                  <span>Settle All Pending ({inr(totalPending)})</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", fontWeight: 600 }}>
            TOTAL EARNED
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#60a5fa", marginTop: "4px" }}>
            {inr(totalEarned)}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            {filteredIncentives.length} records logged
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 600 }}>
            PENDING PAYOUT
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#fbbf24", marginTop: "4px" }}>
            {inr(totalPending)}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Ready for owner payment
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 600 }}>
            ALREADY PAID OUT
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#34d399", marginTop: "4px" }}>
            {inr(totalPaidOut)}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Settled to staff
          </div>
        </div>
      </div>

      {/* Target Progress Card */}
      <div
        style={{
          background: "var(--bg-card, rgba(255,255,255,0.03))",
          border: "1px solid var(--border, rgba(255,255,255,0.08))",
          borderRadius: "14px",
          padding: "14px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <TrendingUp size={16} color="#3b82f6" />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text, #f8fafc)" }}>
              Monthly Sales Target & Tier Bonus
            </span>
          </div>
          <span style={{ fontSize: "12px", color: "#60a5fa", fontWeight: 700 }}>
            {Math.min(100, Math.round((totalEarned / targetAmount) * 100))}% Achieved
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: "8px",
            background: "rgba(255,255,255,0.1)",
            borderRadius: "4px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, (totalEarned / targetAmount) * 100)}%`,
              height: "100%",
              background: "linear-gradient(90deg, #3b82f6, #10b981)",
              borderRadius: "4px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "11px",
            color: "var(--text-muted, #94a3b8)",
            marginTop: "6px",
          }}
        >
          <span>Progress: {inr(totalEarned)}</span>
          <span>Target: {inr(targetAmount)}</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        {/* Staff Selector */}
        <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
          <button
            onClick={() => setSelectedStaff("all")}
            className={`tab-item ${selectedStaff === "all" ? "active" : ""}`}
            style={{
              padding: "6px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: selectedStaff === "all" ? 600 : 500,
              background: selectedStaff === "all" ? "rgba(59, 130, 246, 0.2)" : "transparent",
              border: `1px solid ${selectedStaff === "all" ? "#3b82f6" : "var(--border, rgba(255,255,255,0.1))"}`,
              color: selectedStaff === "all" ? "#60a5fa" : "var(--text-muted, #94a3b8)",
              cursor: "pointer",
            }}
          >
            All Staff
          </button>
          {staffNames.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedStaff(name)}
              style={{
                padding: "6px 12px",
                borderRadius: "20px",
                fontSize: "12px",
                fontWeight: selectedStaff === name ? 600 : 500,
                background: selectedStaff === name ? "rgba(59, 130, 246, 0.2)" : "transparent",
                border: `1px solid ${selectedStaff === name ? "#3b82f6" : "var(--border, rgba(255,255,255,0.1))"}`,
                color: selectedStaff === name ? "#60a5fa" : "var(--text-muted, #94a3b8)",
                cursor: "pointer",
              }}
            >
              {name}
            </button>
          ))}
        </div>

        {/* WhatsApp Slip Trigger for specific staff */}
        {selectedStaff !== "all" && (
          <button
            onClick={() => handleSendWhatsAppSlip(selectedStaff)}
            style={{
              padding: "6px 12px",
              borderRadius: "8px",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#34d399",
              fontSize: "11px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
            }}
          >
            <Send size={12} />
            <span>Send {selectedStaff} WhatsApp Slip</span>
          </button>
        )}
      </div>

      {/* Incentives List Table */}
      {filteredIncentives.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            background: "var(--bg-card, rgba(255,255,255,0.02))",
            borderRadius: "14px",
            border: "1px dashed var(--border, rgba(255,255,255,0.1))",
          }}
        >
          <Award size={36} color="#64748b" style={{ margin: "0 auto 12px auto" }} />
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text, #f8fafc)" }}>
            Abhi tak koi commission ya incentive record nahi hai
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", marginTop: "4px" }}>
            Sales, repairs ya manual bonus add karne par yahan automatic incentive dikhega.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))", textAlign: "left" }}>
                <th style={{ padding: "10px 8px", color: "var(--text-muted, #94a3b8)" }}>DATE & TIME</th>
                <th style={{ padding: "10px 8px", color: "var(--text-muted, #94a3b8)" }}>STAFF</th>
                <th style={{ padding: "10px 8px", color: "var(--text-muted, #94a3b8)" }}>TASK / SALE</th>
                <th style={{ padding: "10px 8px", color: "var(--text-muted, #94a3b8)" }}>INCENTIVE</th>
                <th style={{ padding: "10px 8px", color: "var(--text-muted, #94a3b8)" }}>STATUS</th>
                {activeRole === "owner" && (
                  <th style={{ padding: "10px 8px", color: "var(--text-muted, #94a3b8)", textAlign: "right" }}>
                    ACTION
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredIncentives.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: "1px solid var(--border, rgba(255,255,255,0.04))",
                  }}
                >
                  <td style={{ padding: "10px 8px" }}>
                    <div style={{ fontWeight: 600, color: "var(--text, #f8fafc)" }}>{item.date}</div>
                    <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)" }}>{item.time}</div>
                  </td>
                  <td style={{ padding: "10px 8px", fontWeight: 600, color: "#60a5fa" }}>
                    {item.staffName}
                  </td>
                  <td style={{ padding: "10px 8px" }}>
                    <div style={{ fontWeight: 500, color: "var(--text, #f8fafc)" }}>{item.description}</div>
                    <div style={{ fontSize: "10px", color: "var(--text-muted, #94a3b8)" }}>
                      {item.sourceType} • Ref: {item.referenceId}
                    </div>
                  </td>
                  <td style={{ padding: "10px 8px", fontWeight: 700, color: "#10b981", fontSize: "13px" }}>
                    +{inr(item.incentiveEarned)}
                  </td>
                  <td style={{ padding: "10px 8px" }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "12px",
                        fontSize: "10px",
                        fontWeight: 600,
                        background:
                          item.status === "Paid Out"
                            ? "rgba(16, 185, 129, 0.15)"
                            : "rgba(245, 158, 11, 0.15)",
                        color: item.status === "Paid Out" ? "#34d399" : "#fbbf24",
                        border: `1px solid ${
                          item.status === "Paid Out"
                            ? "rgba(16, 185, 129, 0.3)"
                            : "rgba(245, 158, 11, 0.3)"
                        }`,
                      }}
                    >
                      {item.status}
                    </span>
                  </td>
                  {activeRole === "owner" && (
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>
                      {item.status === "Pending" ? (
                        <button
                          onClick={() => handleMarkPaid(item.id)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 600,
                            background: "rgba(16, 185, 129, 0.2)",
                            border: "1px solid rgba(16, 185, 129, 0.4)",
                            color: "#34d399",
                            cursor: "pointer",
                          }}
                        >
                          Mark Paid
                        </button>
                      ) : (
                        <span style={{ fontSize: "10px", color: "var(--text-muted, #64748b)" }}>
                          Paid ✓
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Add Manual Bonus / Incentive */}
      {showAddManualModal && (
        <div className="overlay" onClick={() => setShowAddManualModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "420px" }}>
            <div className="modal-head">
              <h3>Add Staff Bonus / Incentive</h3>
              <button className="btn" onClick={() => setShowAddManualModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddManualIncentive}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                    Staff Member
                  </label>
                  <select
                    value={manualStaff}
                    onChange={(e) => setManualStaff(e.target.value)}
                    style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                  >
                    {staffNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                    Source Type
                  </label>
                  <select
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value as any)}
                    style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                  >
                    <option value="POS Sale">POS Sale Bonus</option>
                    <option value="Repair Completed">Special Repair Completed</option>
                    <option value="Xerox / Cyber">Cyber Cafe Bulk Order</option>
                    <option value="SIM Activation">MNP / SIM Target</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                    Incentive Amount (₹)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 100"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    required
                    style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                    Reason / Task Description
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. iPhone Screen replacement done with zero defect"
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    required
                    style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                  />
                </div>

                <div className="modal-actions" style={{ marginTop: "16px" }}>
                  <button type="button" className="btn" onClick={() => setShowAddManualModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary">
                    Save Incentive
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
