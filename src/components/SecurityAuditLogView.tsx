import React, { useState, useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  Filter,
  Search,
  Lock,
  Send,
  Calendar,
  User,
  Trash2,
} from "lucide-react";
import { Database, SecurityAuditAlert } from "../types";
import { inr } from "../utils/indianCurrency";

interface SecurityAuditLogViewProps {
  db: Database;
  onUpdateDb: (updater: (prev: Database) => Database) => void;
  activeRole: "owner" | "staff";
}

export const SecurityAuditLogView: React.FC<SecurityAuditLogViewProps> = ({
  db,
  onUpdateDb,
  activeRole,
}) => {
  const [severityFilter, setSeverityFilter] = useState<"all" | "High" | "Medium" | "Low">("all");
  const [resolvedFilter, setResolvedFilter] = useState<"all" | "unresolved" | "resolved">("unresolved");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAlert, setSelectedAlert] = useState<SecurityAuditAlert | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  const rawAlerts: SecurityAuditAlert[] = useMemo(() => {
    const list = [...(db.securityAlerts || [])];

    // Also auto-derive any implicit suspicious events if not logged
    // 1. Sales with high discounts (> 15%)
    if (db.sales) {
      db.sales.forEach((s) => {
        if (s.discount && s.discount > 0 && s.total > 0) {
          const discountPercent = (s.discount / (s.total + s.discount)) * 100;
          if (discountPercent > 15 && !list.some((a) => a.referenceId === s.invoiceNo)) {
            list.push({
              id: `AUTO-DISC-${s.invoiceNo}`,
              timestamp: `${s.date} ${s.time || ""}`,
              severity: discountPercent > 25 ? "High" : "Medium",
              eventType: "Excessive Discount Given",
              performedBy: s.staffName || "Counter Staff",
              description: `Bill ${s.invoiceNo}: Flat ₹${s.discount} (${discountPercent.toFixed(1)}%) discount granted on ₹${s.total + s.discount} total.`,
              referenceId: s.invoiceNo,
              amountInvolved: s.discount,
              resolved: false,
            });
          }
        }
      });
    }

    // Sort newest first
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [db.securityAlerts, db.sales]);

  const filteredAlerts = useMemo(() => {
    return rawAlerts.filter((item) => {
      if (severityFilter !== "all" && item.severity !== severityFilter) return false;
      if (resolvedFilter === "unresolved" && item.resolved) return false;
      if (resolvedFilter === "resolved" && !item.resolved) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.description.toLowerCase().includes(q) ||
          item.performedBy.toLowerCase().includes(q) ||
          item.eventType.toLowerCase().includes(q) ||
          (item.referenceId && item.referenceId.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [rawAlerts, severityFilter, resolvedFilter, searchQuery]);

  const highSeverityCount = useMemo(() => {
    return rawAlerts.filter((a) => a.severity === "High" && !a.resolved).length;
  }, [rawAlerts]);

  const mediumSeverityCount = useMemo(() => {
    return rawAlerts.filter((a) => a.severity === "Medium" && !a.resolved).length;
  }, [rawAlerts]);

  // Resolve alert
  const handleResolveAlert = (id: string) => {
    onUpdateDb((prev) => {
      const currentList = prev.securityAlerts || [];
      const exists = currentList.find((a) => a.id === id);
      let updated: SecurityAuditAlert[];
      if (exists) {
        updated = currentList.map((a) =>
          a.id === id
            ? {
                ...a,
                resolved: true,
                resolvedAt: new Date().toISOString(),
                resolvedNotes: resolutionNote || "Acknowledged & verified by Owner",
              }
            : a
        );
      } else {
        // If it was auto-derived, create a resolved record
        const derived = rawAlerts.find((a) => a.id === id);
        if (derived) {
          updated = [
            ...currentList,
            {
              ...derived,
              resolved: true,
              resolvedAt: new Date().toISOString(),
              resolvedNotes: resolutionNote || "Acknowledged & verified by Owner",
            },
          ];
        } else {
          updated = currentList;
        }
      }
      return { ...prev, securityAlerts: updated };
    });
    setSelectedAlert(null);
    setResolutionNote("");
  };

  // WhatsApp Alert Summary for Owner
  const handleSendOwnerAlertWhatsApp = () => {
    const unres = rawAlerts.filter((a) => !a.resolved);
    const message = `*🚨 DS MOBILE HUB — SECURITY & ANTI-THEFT AUDIT SUMMARY* 🛡️%0A` +
      `📅 *Report Time:* ${new Date().toLocaleString("en-IN")}%0A` +
      `----------------------------%0A` +
      `🔴 *High Alerts (Action Required):* ${highSeverityCount}%0A` +
      `🟡 *Medium Alerts:* ${mediumSeverityCount}%0A` +
      `📋 *Total Unresolved Issues:* ${unres.length}%0A` +
      `----------------------------%0A` +
      `_Audit verified by Store Security Engine._`;

    window.open(`https://wa.me/?text=${message}`, "_blank");
  };

  return (
    <div style={{ padding: "12px", maxWidth: "100%", margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.15))",
          border: "1px solid rgba(239, 68, 68, 0.3)",
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
            <ShieldAlert size={24} color="#ef4444" />
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--text, #f8fafc)" }}>
              Anti-Theft & Suspicious Transaction Audit Log
            </h2>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", margin: "4px 0 0 0" }}>
            Excessive discounts, bill cancellations, negative margin sales aur cash discrepancy surveillance.
          </p>
        </div>

        <button
          className="btn"
          onClick={handleSendOwnerAlertWhatsApp}
          style={{
            fontSize: "12px",
            padding: "8px 14px",
            background: "rgba(239, 68, 68, 0.2)",
            borderColor: "rgba(239, 68, 68, 0.4)",
            color: "#f87171",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Send size={14} />
          <span>Send Owner WhatsApp Alert</span>
        </button>
      </div>

      {/* Severity Metric Cards */}
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
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#f87171", fontWeight: 600 }}>
            🚨 HIGH SEVERITY
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#ef4444", marginTop: "4px" }}>
            {highSeverityCount}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Immediate review needed
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 600 }}>
            ⚠️ MEDIUM SEVERITY
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#f59e0b", marginTop: "4px" }}>
            {mediumSeverityCount}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Discounts & overrides
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#34d399", fontWeight: 600 }}>
            🛡️ RESOLVED & CLEARED
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#10b981", marginTop: "4px" }}>
            {rawAlerts.filter((a) => a.resolved).length}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Owner verified
          </div>
        </div>
      </div>

      {/* Filter Row */}
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
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {/* Status buttons */}
          <button
            onClick={() => setResolvedFilter("unresolved")}
            style={{
              padding: "6px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              background: resolvedFilter === "unresolved" ? "rgba(239, 68, 68, 0.2)" : "transparent",
              border: `1px solid ${resolvedFilter === "unresolved" ? "#ef4444" : "var(--border, rgba(255,255,255,0.1))"}`,
              color: resolvedFilter === "unresolved" ? "#f87171" : "var(--text-muted, #94a3b8)",
              cursor: "pointer",
            }}
          >
            Unresolved ({rawAlerts.filter((a) => !a.resolved).length})
          </button>
          <button
            onClick={() => setResolvedFilter("resolved")}
            style={{
              padding: "6px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              background: resolvedFilter === "resolved" ? "rgba(16, 185, 129, 0.2)" : "transparent",
              border: `1px solid ${resolvedFilter === "resolved" ? "#10b981" : "var(--border, rgba(255,255,255,0.1))"}`,
              color: resolvedFilter === "resolved" ? "#34d399" : "var(--text-muted, #94a3b8)",
              cursor: "pointer",
            }}
          >
            Resolved ({rawAlerts.filter((a) => a.resolved).length})
          </button>
          <button
            onClick={() => setResolvedFilter("all")}
            style={{
              padding: "6px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 600,
              background: resolvedFilter === "all" ? "rgba(59, 130, 246, 0.2)" : "transparent",
              border: `1px solid ${resolvedFilter === "all" ? "#3b82f6" : "var(--border, rgba(255,255,255,0.1))"}`,
              color: resolvedFilter === "all" ? "#60a5fa" : "var(--text-muted, #94a3b8)",
              cursor: "pointer",
            }}
          >
            All Events
          </button>
        </div>

        <input
          type="text"
          placeholder="Search by staff, invoice, or issue..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: "8px",
            fontSize: "12px",
            background: "var(--bg-card, rgba(255,255,255,0.05))",
            border: "1px solid var(--border, rgba(255,255,255,0.1))",
            color: "var(--text, #f8fafc)",
            minWidth: "200px",
          }}
        />
      </div>

      {/* Alerts Feed */}
      {filteredAlerts.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            background: "var(--bg-card, rgba(255,255,255,0.02))",
            borderRadius: "14px",
            border: "1px dashed var(--border, rgba(255,255,255,0.1))",
          }}
        >
          <ShieldCheck size={40} color="#10b981" style={{ margin: "0 auto 12px auto" }} />
          <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text, #f8fafc)" }}>
            Zero Suspicious Activity Detected
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", marginTop: "4px" }}>
            Store billing, discounts, inventory aur cash counters 100% secure aur compliant hain.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                background: alert.resolved
                  ? "var(--bg-card, rgba(255,255,255,0.02))"
                  : alert.severity === "High"
                  ? "rgba(239, 68, 68, 0.08)"
                  : "rgba(245, 158, 11, 0.08)",
                border: `1px solid ${
                  alert.resolved
                    ? "var(--border, rgba(255,255,255,0.08))"
                    : alert.severity === "High"
                    ? "rgba(239, 68, 68, 0.35)"
                    : "rgba(245, 158, 11, 0.35)"
                }`,
                borderRadius: "14px",
                padding: "14px",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flex: "1 1 300px" }}>
                <div style={{ marginTop: "2px" }}>
                  {alert.severity === "High" ? (
                    <AlertOctagon size={22} color="#ef4444" />
                  ) : (
                    <AlertTriangle size={22} color="#f59e0b" />
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text, #f8fafc)" }}>
                      {alert.eventType}
                    </span>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "8px",
                        fontSize: "10px",
                        fontWeight: 700,
                        background:
                          alert.severity === "High"
                            ? "rgba(239, 68, 68, 0.2)"
                            : "rgba(245, 158, 11, 0.2)",
                        color: alert.severity === "High" ? "#f87171" : "#fbbf24",
                      }}
                    >
                      {alert.severity} Severity
                    </span>
                    {alert.resolved && (
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "8px",
                          fontSize: "10px",
                          fontWeight: 700,
                          background: "rgba(16, 185, 129, 0.2)",
                          color: "#34d399",
                        }}
                      >
                        Resolved ✓
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text, #f8fafc)", marginTop: "4px" }}>
                    {alert.description}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted, #94a3b8)",
                      marginTop: "4px",
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>👤 Staff: <strong>{alert.performedBy}</strong></span>
                    <span>🕒 {alert.timestamp}</span>
                    {alert.amountInvolved && <span>💰 Amount: {inr(alert.amountInvolved)}</span>}
                  </div>
                  {alert.resolved && alert.resolvedNotes && (
                    <div style={{ fontSize: "11px", color: "#34d399", marginTop: "4px", fontStyle: "italic" }}>
                      Note: {alert.resolvedNotes}
                    </div>
                  )}
                </div>
              </div>

              {!alert.resolved && (
                <button
                  onClick={() => setSelectedAlert(alert)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: "rgba(16, 185, 129, 0.2)",
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    color: "#34d399",
                    cursor: "pointer",
                  }}
                >
                  Verify & Clear Alert
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: Resolve Alert */}
      {selectedAlert && (
        <div className="overlay" onClick={() => setSelectedAlert(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "420px" }}>
            <div className="modal-head">
              <h3>Verify & Resolve Security Alert</h3>
              <button className="btn" onClick={() => setSelectedAlert(null)}>✕</button>
            </div>
            <div style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text, #f8fafc)" }}>
                {selectedAlert.eventType}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", marginTop: "4px" }}>
                {selectedAlert.description}
              </div>

              <div style={{ marginTop: "14px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted, #94a3b8)" }}>
                  Owner Resolution / Explanation Note
                </label>
                <input
                  type="text"
                  placeholder="e.g. Verified with customer; bulk tempered glass discount approved"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "8px" }}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button className="btn" onClick={() => setSelectedAlert(null)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={() => handleResolveAlert(selectedAlert.id)}
                  style={{ background: "#10b981", borderColor: "#10b981" }}
                >
                  Confirm Resolved ✓
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
