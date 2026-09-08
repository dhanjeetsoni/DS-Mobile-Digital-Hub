import React, { useEffect, useMemo, useState } from "react";
import { ClipboardList, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { fetchAuditLogs, AuditLogRow } from "../services/repository";
import { listStaffAccounts } from "../services/staffAuth";

interface AuditLogViewProps {
  storeId?: string;
  cloudProfile: { id?: string; full_name?: string; staff_name?: string; email?: string } | null;
  showToast: (msg: string, color?: string) => void;
}

// Turns "products_update" -> "Products updated", "profile_access_update"
// -> "Staff access changed" etc. — a short, readable label; the full raw
// old/new JSON is still available underneath via the row's expand toggle
// for anyone who needs the exact detail.
const ACTION_LABELS: Record<string, string> = {
  products_insert: "Product added",
  products_update: "Product edited",
  products_delete: "Product deleted",
  sales_insert: "Sale recorded",
  sales_update: "Sale edited",
  sales_delete: "Sale deleted",
  profile_access_update: "Staff access changed",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

function actionColor(action: string): string {
  if (action.endsWith("_delete")) return "var(--red)";
  if (action.endsWith("_insert")) return "var(--green)";
  if (action === "profile_access_update") return "var(--amber)";
  return "var(--ink)";
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ storeId, cloudProfile, showToast }) => {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actionFilter, setActionFilter] = useState<string>("all");

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [logs, staff] = await Promise.all([fetchAuditLogs(storeId), listStaffAccounts(storeId)]);
      setRows(logs);
      const names: Record<string, string> = {};
      staff.forEach((s) => { names[s.id] = s.staff_name || s.staff_login_id || "Staff"; });
      if (cloudProfile?.id) {
        names[cloudProfile.id] = cloudProfile.full_name || cloudProfile.staff_name || "Owner";
      }
      setUserNames(names);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Audit log load failed.", "red");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const actionTypes = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);
  const filteredRows = actionFilter === "all" ? rows : rows.filter((r) => r.action === actionFilter);

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <ClipboardList size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Audit Log
        </h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ fontSize: "12px" }}>
            <option value="all">Sab actions</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>{actionLabel(a)}</option>
            ))}
          </select>
          <button className="btn sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 0 }}>
        Kisne, kab, kya add/edit/delete kiya — products, sales, aur staff access changes. Sabse
        naya sabse upar. Sirf owner/manager ko ye dikhta hai. Last {rows.length} entries.
      </p>

      {loading && rows.length === 0 ? (
        <div className="empty">Loading...</div>
      ) : filteredRows.length === 0 ? (
        <div className="empty">Abhi tak koi tracked activity nahi hai.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "28px" }}></th>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isOpen = !!expanded[row.id];
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                    >
                      <td>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "12px" }}>{formatWhen(row.createdAt)}</td>
                      <td className="truncate">{row.userId ? (userNames[row.userId] || "Unknown") : "System"}</td>
                      <td style={{ fontWeight: 700, color: actionColor(row.action) }}>{actionLabel(row.action)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td></td>
                        <td colSpan={3}>
                          <pre
                            style={{
                              fontSize: "11px",
                              background: "var(--panel-soft)",
                              padding: "10px",
                              borderRadius: "8px",
                              overflowX: "auto",
                              maxWidth: "100%",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {JSON.stringify(row.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
