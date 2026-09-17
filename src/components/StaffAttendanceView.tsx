import React, { useState, useMemo } from "react";
import {
  Users,
  Clock,
  CheckCircle2,
  LogIn,
  LogOut,
  Calendar,
  AlertTriangle,
  FileSpreadsheet,
  ShieldCheck,
  Plus,
  Trash2,
  DollarSign,
  Coffee,
} from "lucide-react";
import { Database, StaffAttendanceRecord } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, nowTimeStr, uid } from "../utils/fifoEngine";

interface StaffAttendanceViewProps {
  db: Database;
  onUpdateDb: (db: Database) => void;
  showToast: (msg: string, kind?: "green" | "red" | "amber") => void;
}

export const StaffAttendanceView: React.FC<StaffAttendanceViewProps> = ({
  db,
  onUpdateDb,
  showToast,
}) => {
  const [selectedStaff, setSelectedStaff] = useState<string>("Suresh (Technician)");
  const [counterRole, setCounterRole] = useState<
    "Main Counter / Billing" | "Repair & Service" | "Accessories Desk" | "Cyber & Xerox"
  >("Main Counter / Billing");
  const [openingGallaCash, setOpeningGallaCash] = useState<string>("");
  const [closingGallaCash, setClosingGallaCash] = useState<string>("");
  const [shiftNotes, setShiftNotes] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>(todayStr().slice(0, 7)); // YYYY-MM

  const knownStaffList = [
    "Suresh (Technician)",
    "Rahul (Sales & Billing)",
    "Amit (Cyber & SIM Desk)",
    "Pooja (Accessories)",
    "Owner (Dhanjeet)",
  ];

  const today = todayStr();
  const allRecords = db.staffAttendance || [];

  // Filter today's records
  const todayRecords = useMemo(() => {
    return allRecords.filter((r) => r.date === today);
  }, [allRecords, today]);

  // Filter monthly records
  const monthRecords = useMemo(() => {
    return allRecords.filter((r) => r.date.startsWith(selectedMonth));
  }, [allRecords, selectedMonth]);

  // Check if selected staff is currently punched in today
  const activePunchIn = todayRecords.find((r) => r.staffName === selectedStaff && !r.outTime);

  // Handle Punch-In
  const handlePunchIn = () => {
    if (activePunchIn) {
      showToast(`${selectedStaff} is already punched in today!`, "amber");
      return;
    }

    const newRecord: StaffAttendanceRecord = {
      id: uid("att"),
      staffName: selectedStaff,
      date: today,
      inTime: nowTimeStr(),
      status: "Present",
      counterRole,
      gallaOpeningVerified: openingGallaCash ? Number(openingGallaCash) : undefined,
      notes: shiftNotes || "Shift started on time",
      verifiedByOwner: true,
    };

    const nextDb = {
      ...db,
      staffAttendance: [newRecord, ...allRecords],
    };

    onUpdateDb(nextDb);
    setOpeningGallaCash("");
    setShiftNotes("");
    showToast(`✅ ${selectedStaff} Punched In at ${newRecord.inTime}`, "green");
  };

  // Handle Punch-Out / Handover
  const handlePunchOut = (recordId: string) => {
    const updated = allRecords.map((r) => {
      if (r.id === recordId) {
        return {
          ...r,
          outTime: nowTimeStr(),
          status: "Handover Completed" as const,
          gallaClosingHandover: closingGallaCash ? Number(closingGallaCash) : r.gallaClosingHandover,
          notes: shiftNotes ? `${r.notes || ""} | Out: ${shiftNotes}` : r.notes,
        };
      }
      return r;
    });

    onUpdateDb({
      ...db,
      staffAttendance: updated,
    });

    setClosingGallaCash("");
    setShiftNotes("");
    showToast("Shift punch-out & handover recorded successfully!", "green");
  };

  // Quick mark leave or half-day
  const handleMarkStatus = (staff: string, status: "Leave" | "Half-Day") => {
    const newRecord: StaffAttendanceRecord = {
      id: uid("att"),
      staffName: staff,
      date: today,
      inTime: "—",
      outTime: "—",
      status,
      notes: status === "Leave" ? "Marked as Leave" : "Half-day shift",
      verifiedByOwner: true,
    };

    onUpdateDb({
      ...db,
      staffAttendance: [newRecord, ...allRecords],
    });

    showToast(`Marked ${staff} as ${status}`, "green");
  };

  // Delete record
  const handleDeleteRecord = (id: string) => {
    if (!window.confirm("Delete this attendance log?")) return;
    onUpdateDb({
      ...db,
      staffAttendance: allRecords.filter((r) => r.id !== id),
    });
    showToast("Attendance record deleted", "amber");
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div className="section" style={{ marginBottom: "16px" }}>
        <div className="section-head" style={{ marginBottom: "12px" }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "19px", margin: 0 }}>
              <Clock size={22} style={{ color: "var(--brand)" }} />
              Digital Staff Attendance &amp; Counter Login Timings
            </h2>
            <p className="hint" style={{ marginTop: "4px", margin: 0 }}>
              Track daily staff punch-in / punch-out times, counter assignments, and galla cash handover checkpoints.
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--brand)", background: "var(--blue-light)", padding: "6px 12px", borderRadius: "999px" }}>
              📅 Today: {today}
            </span>
          </div>
        </div>

        {/* Punch In/Out Console */}
        <div className="grid cols-3" style={{ gap: "16px", alignItems: "flex-start", marginTop: "14px" }}>
          {/* Card 1: Punch In Console */}
          <div style={{ background: "var(--card)", padding: "16px", borderRadius: "12px", border: "1px solid var(--line)" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 800, margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "6px", color: "var(--ink)" }}>
              <LogIn size={16} style={{ color: "var(--green)" }} />
              Staff Punch-In &amp; Shift Login
            </h3>

            <div className="field" style={{ marginBottom: "10px" }}>
              <label>Select Staff Member</label>
              <select value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)}>
                {knownStaffList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ marginBottom: "10px" }}>
              <label>Assigned Counter / Role</label>
              <select value={counterRole} onChange={(e) => setCounterRole(e.target.value as any)}>
                <option value="Main Counter / Billing">Main Counter / Billing</option>
                <option value="Repair & Service">Repair &amp; Service Lab</option>
                <option value="Accessories Desk">Accessories Desk</option>
                <option value="Cyber & Xerox">Cyber &amp; Xerox Desk</option>
              </select>
            </div>

            <div className="field" style={{ marginBottom: "10px" }}>
              <label>Opening Cash In Drawer (₹ Optional)</label>
              <input
                type="number"
                placeholder="e.g. 2000"
                value={openingGallaCash}
                onChange={(e) => setOpeningGallaCash(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: "14px" }}>
              <label>Shift Notes</label>
              <input
                placeholder="e.g. On-time, opening shop key with Suresh"
                value={shiftNotes}
                onChange={(e) => setShiftNotes(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="btn primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handlePunchIn}
                disabled={!!activePunchIn}
              >
                <LogIn size={15} /> Punch In Now
              </button>

              <button
                className="btn ghost sm"
                onClick={() => handleMarkStatus(selectedStaff, "Leave")}
                title="Mark Leave"
              >
                Mark Leave
              </button>
            </div>
          </div>

          {/* Card 2: Today's Active Counter Shift Status */}
          <div style={{ gridColumn: "span 2", background: "var(--card)", padding: "16px", borderRadius: "12px", border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                <Users size={16} style={{ color: "var(--blue)" }} />
                Today's On-Duty Staff ({todayRecords.length})
              </h3>
            </div>

            {todayRecords.length === 0 ? (
              <div className="empty" style={{ padding: "30px" }}>
                No staff punched in yet today ({today}). Use the punch-in console on the left to start morning shifts.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {todayRecords.map((rec) => {
                  const isOnDuty = !rec.outTime && rec.status === "Present";
                  return (
                    <div
                      key={rec.id}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--line)",
                        background: isOnDuty ? "rgba(16, 185, 129, 0.05)" : "var(--paper)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontWeight: 800, fontSize: "14px" }}>{rec.staffName}</span>
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: "999px",
                              background: isOnDuty ? "#10b98122" : "#6b728022",
                              color: isOnDuty ? "#047857" : "#4b5563",
                            }}
                          >
                            {isOnDuty ? "🟢 On Duty" : `🏁 ${rec.status}`}
                          </span>
                          <span className="hint" style={{ fontSize: "11px" }}>
                            Desk: <b>{rec.counterRole || "General"}</b>
                          </span>
                        </div>

                        <div style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: "4px" }}>
                          ⏰ In: <b>{rec.inTime}</b> {rec.outTime && `• Out: ${rec.outTime}`}
                          {rec.gallaOpeningVerified !== undefined && ` • Opening Galla: ${inr(rec.gallaOpeningVerified)}`}
                          {rec.gallaClosingHandover !== undefined && ` • Handover Galla: ${inr(rec.gallaClosingHandover)}`}
                        </div>

                        {rec.notes && (
                          <div style={{ fontSize: "11px", color: "var(--ink-soft)", marginTop: "2px", fontStyle: "italic" }}>
                            "{rec.notes}"
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: "6px" }}>
                        {isOnDuty && (
                          <button
                            className="btn sm primary"
                            style={{ fontSize: "12px", padding: "4px 10px" }}
                            onClick={() => {
                              const cash = prompt("Enter Closing Handover Cash in Galla (₹):", "0");
                              if (cash !== null) {
                                setClosingGallaCash(cash);
                                handlePunchOut(rec.id);
                              }
                            }}
                          >
                            <LogOut size={13} /> Punch Out / Handover
                          </button>
                        )}
                        <button
                          className="btn ghost sm"
                          style={{ padding: "4px 8px" }}
                          onClick={() => handleDeleteRecord(rec.id)}
                          title="Delete Log"
                        >
                          <Trash2 size={13} style={{ color: "var(--red)" }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Monthly History & Audit Log */}
      <div className="section">
        <div className="section-head">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2>Monthly Attendance Log &amp; Shift Register</h2>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "13px", borderRadius: "6px", border: "1px solid var(--line)" }}
            />
          </div>
          <span className="hint">{monthRecords.length} shifts recorded in {selectedMonth}</span>
        </div>

        {monthRecords.length === 0 ? (
          <div className="empty" style={{ padding: "30px" }}>
            No attendance records found for {selectedMonth}.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Staff Name</th>
                  <th>Counter Desk</th>
                  <th>Punch In</th>
                  <th>Punch Out</th>
                  <th>Opening Galla</th>
                  <th>Handover Galla</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {monthRecords.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.date}</b></td>
                    <td>{r.staffName}</td>
                    <td>{r.counterRole || "—"}</td>
                    <td><b>{r.inTime}</b></td>
                    <td>{r.outTime || <span style={{ color: "var(--green)" }}>Active</span>}</td>
                    <td>{r.gallaOpeningVerified ? inr(r.gallaOpeningVerified) : "—"}</td>
                    <td>{r.gallaClosingHandover ? inr(r.gallaClosingHandover) : "—"}</td>
                    <td>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: "6px",
                          background: r.status === "Present" || r.status === "Handover Completed" ? "#10b98122" : "#f59e0b22",
                          color: r.status === "Present" || r.status === "Handover Completed" ? "#047857" : "#b45309",
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="hint" style={{ fontSize: "11.5px" }}>{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
