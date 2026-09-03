import React, { useEffect, useState } from "react";
import { Check, Clock, Copy, KeyRound, Loader2, Plus, Power, RefreshCcw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { isCloudConfigured } from "../services/supabaseClient";
import {
  createStaffAccount,
  deleteStaffAccount,
  generateStaffLoginId,
  generateStaffPassword,
  grantStaffAccess,
  listStaffAccounts,
  resetStaffPassword,
  revokeStaffAccess,
  StaffProfile,
} from "../services/staffAuth";

/** Small "copy to clipboard" button used inside the Reveal & Copy box. */
const CopyButton: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API can fail on non-https/older webviews — fall back silently,
      // the value is still shown on screen for manual copy.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="btn sm" onClick={handleCopy} style={{ minWidth: 84 }}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
    </button>
  );
};

type AccessMode = "no_restriction" | "full_day" | "timed";

const accessModeLabel = (s: StaffProfile) => {
  if (!s.access_enabled) return "Access OFF";
  if (s.access_mode === "no_restriction") return "No time limit";
  if (s.access_mode === "full_day") return "Full day (aaj tak)";
  if (s.access_mode === "timed" && s.access_expires_at) {
    const ms = new Date(s.access_expires_at).getTime() - Date.now();
    if (ms <= 0) return "Time khatam";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} min baaki`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m baaki`;
  }
  return "Access ON";
};

interface StaffAccessViewProps {
  storeId: string | null | undefined;
  /**
   * Step 1.3 fix: true while the app is still figuring out who's signed in
   * and which store they belong to (right after app-open or right after a
   * sign-in). Previously this screen judged "no store" the instant it
   * mounted, even while that check was still in flight — so it would flash
   * "Store abhi set nahi hua" for a signed-in owner for a split second (or
   * longer on a slow connection) before the real store_id arrived. Now we
   * wait for this to go false before trusting a missing storeId.
   */
  storeLoading?: boolean;
  toast: (msg: string, color?: string) => void;
}

export const StaffAccessView: React.FC<StaffAccessViewProps> = ({ storeId, storeLoading, toast }) => {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<StaffProfile | null>(null);
  const [form, setForm] = useState({ staffName: "", loginId: "", password: "" });
  const [resetPassword, setResetPassword] = useState("");
  const [saving, setSaving] = useState(false);
  // Step 1.2: shown once, right after a staff login is created, so the owner
  // can copy/note the auto-generated ID + password before closing the modal
  // (the password itself is hashed server-side and can never be shown again
  // — only "Reset Password" can set a new one after this).
  const [createdReveal, setCreatedReveal] = useState<{ loginId: string; password: string; staffName: string } | null>(null);
  // Step 1.6 (finishing touch): "Regenerate Password" must be a one-click
  // random generate, never the Owner typing a new password by hand — same
  // rule as account creation. Reusing the reveal pattern so the new
  // password is shown exactly once here too.
  const [resetReveal, setResetReveal] = useState<{ loginId: string; password: string; staffName: string } | null>(null);
  const [grantTarget, setGrantTarget] = useState<StaffProfile | null>(null);
  const [grantMode, setGrantMode] = useState<AccessMode>("no_restriction");
  const [grantHours, setGrantHours] = useState(0);
  const [grantMinutes, setGrantMinutes] = useState(15);

  // Re-render every 30s so the "X min baaki" countdown on each row stays fresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, []);

  const refresh = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      setStaff(await listStaffAccounts(storeId));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Staff list load nahi ho paayi.", "red");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const openAddModal = () => {
    setForm({ staffName: "", loginId: generateStaffLoginId(), password: generateStaffPassword() });
    setCreatedReveal(null);
    setIsAddOpen(true);
  };

  const regenerateLoginId = () => setForm((f) => ({ ...f, loginId: generateStaffLoginId() }));
  const regeneratePassword = () => setForm((f) => ({ ...f, password: generateStaffPassword() }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.staffName.trim()) {
      toast("Staff ka naam bharo.", "amber");
      return;
    }
    setSaving(true);
    // Both loginId and password are auto-generated (Step 1.2/1.6) — a
    // collision on the random 4-char ID is very unlikely, but if it does
    // happen (Login ID must be globally unique), silently regenerate a
    // fresh ID and retry a few times before bothering the owner with it.
    let attempt = { ...form };
    let lastError: unknown = null;
    for (let tries = 0; tries < 5; tries++) {
      try {
        await createStaffAccount(attempt);
        setCreatedReveal({ loginId: attempt.loginId, staffName: attempt.staffName, password: attempt.password });
        setForm({ staffName: "", loginId: "", password: "" });
        await refresh();
        setSaving(false);
        return;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : "";
        if (msg.toLowerCase().includes("already taken")) {
          attempt = { ...attempt, loginId: generateStaffLoginId() };
          continue;
        }
        break;
      }
    }
    toast(lastError instanceof Error ? lastError.message : "Account create nahi ho paaya.", "red");
    setSaving(false);
  };

  const handleRevoke = async (member: StaffProfile) => {
    setBusyId(member.id);
    try {
      await revokeStaffAccess(member.id);
      setStaff((prev) => prev.map((s) => (s.id === member.id ? { ...s, access_enabled: false } : s)));
      toast(`${member.staff_name || member.staff_login_id} ka access OFF kar diya — ab wo login nahi kar payega, aur agar already andar hai to turant logout ho jayega.`, "amber");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Access OFF karne mein dikkat hui.", "red");
    } finally {
      setBusyId(null);
    }
  };

  const openGrantModal = (member: StaffProfile) => {
    setGrantTarget(member);
    setGrantMode("no_restriction");
    setGrantHours(0);
    setGrantMinutes(15);
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantTarget) return;
    if (grantMode === "timed" && grantHours <= 0 && grantMinutes <= 0) {
      toast("Kam se kam 1 minute ka time chuno.", "amber");
      return;
    }
    setSaving(true);
    try {
      await grantStaffAccess(grantTarget.id, { mode: grantMode, hours: grantHours, minutes: grantMinutes });
      await refresh();
      toast(`${grantTarget.staff_name || grantTarget.staff_login_id} ko access de diya. Sirf abhi se aage ki sales/galla dikhegi.`, "green");
      setGrantTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Access dene mein dikkat hui.", "red");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.trim().length < 4) {
      toast("Password kam se kam 4 characters ka ho.", "amber");
      return;
    }
    setSaving(true);
    try {
      await resetStaffPassword(resetTarget.id, resetPassword.trim());
      setResetReveal({ loginId: resetTarget.staff_login_id || "", password: resetPassword.trim(), staffName: resetTarget.staff_name || resetTarget.staff_login_id || "" });
      setResetTarget(null);
      setResetPassword("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Password reset fail hua.", "red");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (member: StaffProfile) => {
    if (!window.confirm(`${member.staff_name || member.staff_login_id} ka account permanently delete karein? Ye undo nahi ho sakta.`)) return;
    setBusyId(member.id);
    try {
      await deleteStaffAccount(member.id);
      setStaff((prev) => prev.filter((s) => s.id !== member.id));
      toast("Staff account delete kar diya.", "green");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete fail hua.", "red");
    } finally {
      setBusyId(null);
    }
  };

  if (!isCloudConfigured) {
    return (
      <div className="section">
        <h2><Users size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Staff Access Manager</h2>
        <div className="notice" style={{ marginTop: 12 }}>
          Ye feature cloud sync maangta hai. Pehle Cloud &amp; Security se sign in / setup karo, phir yahan se staff
          Login ID &amp; Password bana paoge.
        </div>
      </div>
    );
  }

  // Step 1.3 fix: while store/session status is still being confirmed, show
  // a neutral loading state — never the "not set up" error. The error is
  // only trustworthy once storeLoading has finished.
  if (storeLoading) {
    return (
      <div className="section">
        <h2><Users size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Staff Access Manager</h2>
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--ink-soft)", marginTop: 12 }}>
          <Loader2 size={18} className="spin" style={{ marginBottom: 8 }} /><br />
          Store status check ho raha hai…
        </div>
      </div>
    );
  }

  if (!storeId) {
    return (
      <div className="section">
        <h2>Staff Access Manager</h2>
        <div className="notice" style={{ marginTop: 12 }}>Store abhi set nahi hua — Cloud &amp; Security se pehle sign in karo.</div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2><Users size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Staff Access Manager ({staff.length})</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />} Refresh
          </button>
          <button className="btn primary sm" onClick={openAddModal}>
            <UserPlus size={14} /> Add Staff
          </button>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 4, marginBottom: 12 }}>
        <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: "4px" }} />
        Yahan se banaya gaya Login ID &amp; Password staff ko Android app ke "Staff Area" login screen mein daalna
        hai. Har baar "Grant Access" karne par sirf usi waqt se aage ki sales/galla staff ko dikhti hai — usse
        pehle ka purana data hidden rehta hai (product list hamesha A-Z dikhti hai). Time khatam hote hi ya
        aap "Turn OFF" karte hi wo turant logout ho jaata hai — chahe uska phone offline hi kyun na ho, device
        ka apna clock time khatam hone par khud hi logout kar deta hai.
      </div>

      {staff.length === 0 && !loading && (
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--ink-soft)" }}>
          Koi staff account nahi bana abhi tak. "Add Staff" dabao.
        </div>
      )}

      {staff.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Staff Name</th>
                <th>Login ID</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last Active</th>
                <th>Offline Download</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.staff_name || "—"}</b></td>
                  <td className="hint">{s.staff_login_id}</td>
                  <td>
                    <span style={{ color: s.access_enabled ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                      {s.access_enabled ? "● " : "● "}{accessModeLabel(s)}
                    </span>
                    {s.access_enabled && s.visibility_from && (
                      <div className="hint">Galla/sales sirf {new Date(s.visibility_from).toLocaleString()} ke baad se dikhti hai</div>
                    )}
                  </td>
                  <td className="hint">{s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</td>
                  <td className="hint">{s.last_active_at ? new Date(s.last_active_at).toLocaleString() : "Kabhi login nahi hua"}</td>
                  <td className="hint">{s.last_offline_download_at ? new Date(s.last_offline_download_at).toLocaleString() : "Kabhi download nahi hua"}</td>
                  <td>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {s.access_enabled ? (
                        <button className="btn sm danger" onClick={() => handleRevoke(s)} disabled={busyId === s.id}>
                          {busyId === s.id ? <Loader2 size={12} className="spin" /> : <Power size={12} />} Turn OFF
                        </button>
                      ) : (
                        <button className="btn sm primary" onClick={() => openGrantModal(s)} disabled={busyId === s.id}>
                          <Clock size={12} /> Grant Access
                        </button>
                      )}
                      {s.access_enabled && (
                        <button className="btn sm" onClick={() => openGrantModal(s)}>
                          <Clock size={12} /> Change Access Window
                        </button>
                      )}
                      <button className="btn sm" onClick={() => { setResetTarget(s); setResetPassword(generateStaffPassword()); }}>
                        <KeyRound size={12} /> Regenerate Password
                      </button>
                      <button className="btn sm danger" onClick={() => handleDelete(s)} disabled={busyId === s.id}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAddOpen && !createdReveal && (
        <div className="modal-backdrop" onMouseDown={() => setIsAddOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0 }}><Plus size={16} /> New Staff Login</h3>
              <button className="icon-btn" onClick={() => setIsAddOpen(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label>Staff Name</label>
                <input autoFocus value={form.staffName} onChange={(e) => setForm({ ...form, staffName: e.target.value })} placeholder="e.g. Rahul" />
              </div>
              <div className="field">
                <label>Staff ID (system-generated)</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={form.loginId} readOnly style={{ fontFamily: "monospace", fontWeight: 600, letterSpacing: 0.5 }} />
                  <button type="button" className="btn sm" onClick={regenerateLoginId} title="Naya ID generate karo">
                    <RefreshCcw size={12} />
                  </button>
                </div>
                <span className="hint">Random &amp; unguessable — aap ise type nahi karte, system khud banata hai.</span>
              </div>
              <div className="field">
                <label>Temporary Password (system-generated)</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={form.password} readOnly style={{ fontFamily: "monospace", fontWeight: 600, letterSpacing: 0.5 }} />
                  <button type="button" className="btn sm" onClick={regeneratePassword} title="Naya password generate karo">
                    <RefreshCcw size={12} />
                  </button>
                </div>
                <span className="hint">Create karne ke baad ek baar dikhega — turant copy/note kar lena. Baad mein "Reset Password" se naya bana sakte ho.</span>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setIsAddOpen(false)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />} {saving ? "Creating…" : "Create Staff Login"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createdReveal && (
        <div className="modal-backdrop" onMouseDown={() => { setCreatedReveal(null); setIsAddOpen(false); }}>
          <div className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0, color: "var(--green)" }}><ShieldCheck size={16} /> Staff Login Ready</h3>
            </div>
            <div className="notice" style={{ marginBottom: 12 }}>
              <b>{createdReveal.staffName}</b> ke liye account ban gaya. Yeh ID &amp; Password abhi copy/note kar lo aur
              staff ko de do (WhatsApp/verbally/kagaz par) — password dobara is form mein nahi dikhega.
            </div>
            <div className="field">
              <label>Staff ID</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={createdReveal.loginId} readOnly style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }} />
                <CopyButton value={createdReveal.loginId} />
              </div>
            </div>
            <div className="field">
              <label>Password</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={createdReveal.password} readOnly style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }} />
                <CopyButton value={createdReveal.password} />
              </div>
            </div>
            <div className="field">
              <div style={{ display: "flex", gap: 6 }}>
                <CopyButton value={`Staff ID: ${createdReveal.loginId}\nPassword: ${createdReveal.password}`} />
                <span className="hint" style={{ alignSelf: "center" }}>Dono ek saath copy karo (WhatsApp bhejne ke liye)</span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn primary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => { setCreatedReveal(null); setIsAddOpen(false); }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {grantTarget && (
        <div className="modal-backdrop" onMouseDown={() => setGrantTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0 }}><Clock size={16} /> Grant Access — {grantTarget.staff_name || grantTarget.staff_login_id}</h3>
              <button className="icon-btn" onClick={() => setGrantTarget(null)}>&times;</button>
            </div>
            <form onSubmit={handleGrant}>
              <div className="field">
                <label>Kitna access dena hai?</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
                    <input type="radio" checked={grantMode === "no_restriction"} onChange={() => setGrantMode("no_restriction")} />
                    No restriction — koi time limit nahi, jab tak khud OFF na karo
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
                    <input type="radio" checked={grantMode === "full_day"} onChange={() => setGrantMode("full_day")} />
                    Full day — sirf aaj ke liye (raat 12 baje khud OFF)
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
                    <input type="radio" checked={grantMode === "timed"} onChange={() => setGrantMode("timed")} />
                    Custom — hours / minutes chuno
                  </label>
                </div>
              </div>
              {grantMode === "timed" && (
                <div className="field" style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label>Hours</label>
                    <input type="number" min={0} max={72} value={grantHours} onChange={(e) => setGrantHours(Math.max(0, Number(e.target.value)))} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Minutes</label>
                    <input type="number" min={0} max={59} value={grantMinutes} onChange={(e) => setGrantMinutes(Math.max(0, Number(e.target.value)))} />
                  </div>
                </div>
              )}
              <div className="notice" style={{ marginTop: 10 }}>
                Access shuru hote hi purani sales/galla history staff se hidden ho jayegi — sirf ab se aage ki
                sales/galla dikhegi.
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setGrantTarget(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <Power size={15} />} {saving ? "Granting…" : "Grant Access"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="modal-backdrop" onMouseDown={() => setResetTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0 }}><KeyRound size={16} /> Regenerate Password — {resetTarget.staff_name || resetTarget.staff_login_id}</h3>
              <button className="icon-btn" onClick={() => setResetTarget(null)}>&times;</button>
            </div>
            <form onSubmit={handleReset}>
              <div className="field">
                <label>New Password (system-generated)</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={resetPassword} readOnly style={{ fontFamily: "monospace", fontWeight: 600, letterSpacing: 0.5 }} />
                  <button type="button" className="btn sm" onClick={() => setResetPassword(generateStaffPassword())} title="Naya password generate karo">
                    <RefreshCcw size={12} />
                  </button>
                </div>
                <span className="hint">Random &amp; unguessable — purana password turant invalid ho jaayega.</span>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setResetTarget(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} {saving ? "Saving…" : "Save New Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetReveal && (
        <div className="modal-backdrop" onMouseDown={() => setResetReveal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0, color: "var(--green)" }}><ShieldCheck size={16} /> New Password Ready</h3>
            </div>
            <div className="notice" style={{ marginBottom: 12 }}>
              <b>{resetReveal.staffName}</b> ka password badal gaya — purana turant invalid ho gaya hai. Yeh naya password
              abhi copy/note kar lo, dobara yahan nahi dikhega.
            </div>
            <div className="field">
              <label>Staff ID</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={resetReveal.loginId} readOnly style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }} />
                <CopyButton value={resetReveal.loginId} />
              </div>
            </div>
            <div className="field">
              <label>New Password</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={resetReveal.password} readOnly style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }} />
                <CopyButton value={resetReveal.password} />
              </div>
            </div>
            <div className="field">
              <div style={{ display: "flex", gap: 6 }}>
                <CopyButton value={`Staff ID: ${resetReveal.loginId}\nPassword: ${resetReveal.password}`} />
                <span className="hint" style={{ alignSelf: "center" }}>Dono ek saath copy karo (WhatsApp bhejne ke liye)</span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn primary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => setResetReveal(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
