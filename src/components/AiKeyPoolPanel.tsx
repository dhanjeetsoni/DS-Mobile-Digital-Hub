import React, { useEffect, useState, useCallback } from "react";
import { KeyRound, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { getGeminiKeyStatus, saveGeminiKey, GeminiKeySlotStatus } from "../services/geminiKeys";

// Step 2.1 (Owner Settings: up to 10 Gemini keys, auto-rotation pool) +
// Step 2.2 (AI Key Status Widget: active key, available/exhausted counts,
// today's rough usage). Owner-only — this is rendered inside the Settings
// screen, which is already gated to Owner in Sidebar.tsx (ownerOnly: true).
export const AiKeyPoolPanel: React.FC = () => {
  const [slots, setSlots] = useState<GeminiKeySlotStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [savingSlot, setSavingSlot] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const status = await getGeminiKeyStatus();
      setSlots(status);
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : "AI Key status load nahi ho paya. Agar SUPABASE_SERVICE_ROLE_KEY server par set nahi hai, ya migration apply nahi hui, yeh dikh sakta hai."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async (slot: number) => {
    const value = (inputs[slot] || "").trim();
    setSavingSlot(slot);
    try {
      await saveGeminiKey(slot, value);
      setToast(value ? `Slot ${slot} key saved.` : `Slot ${slot} cleared.`);
      setInputs((prev) => ({ ...prev, [slot]: "" }));
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? `Error: ${e.message}` : "Save failed.");
    } finally {
      setSavingSlot(null);
      setTimeout(() => setToast(""), 4000);
    }
  };

  const activeCount = (slots || []).filter((s) => s.status === "active").length;
  const exhaustedCount = (slots || []).filter((s) => s.status === "exhausted").length;
  const configuredCount = (slots || []).filter((s) => s.hasKey).length;
  const usageToday = (slots || []).reduce((sum, s) => sum + (s.usageCountToday || 0), 0);
  const activeSlot = (slots || []).find((s) => s.status === "active" && s.hasKey);

  const statusBadge = (s: GeminiKeySlotStatus) => {
    if (!s.hasKey) return <span className="muted">⚪ Not set</span>;
    if (s.status === "exhausted") return <span style={{ color: "#f59e0b" }}>🟡 Resting (cooldown)</span>;
    if (s.status === "invalid") return <span style={{ color: "#ef4444" }}>🔴 Invalid</span>;
    return <span style={{ color: "#22c55e" }}>🟢 Active</span>;
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>
          <KeyRound size={16} style={{ verticalAlign: "-2px" }} /> AI Key Pool (Gemini)
        </h2>
        <button type="button" className="btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>
      <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Yahan tak 10 Gemini API keys daal sakte ho. Jaisi hi ek key ka daily limit khatam ho, system khud
        agli key try karega — koi AI feature ruknа nahi chahiye. Keys sirf yahan se, ek baar save hone ke
        baad, dobara plain-text mein nahi dikhtin (naya value dalke overwrite kar sakte ho).
      </p>

      {loadError && (
        <div className="notice" style={{ marginBottom: 12 }}>
          {loadError}
        </div>
      )}

      {!loadError && (
        <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Configured</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{configuredCount} / 10</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Active now</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#22c55e" }}>
              {activeSlot ? `Slot ${activeSlot.slot}` : activeCount > 0 ? activeCount : "—"}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Resting (exhausted)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: exhaustedCount ? "#f59e0b" : undefined }}>
              {exhaustedCount}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Aaj AI use (rough count)</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{usageToday}</div>
          </div>
        </div>
      )}

      {loading && !slots && <div className="muted">Loading key status…</div>}

      {slots && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {slots.map((s) => (
            <div
              key={s.slot}
              className="card"
              style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
            >
              <div style={{ width: 64, fontWeight: 600 }}>Slot {s.slot}</div>
              <div style={{ width: 150 }}>{statusBadge(s)}</div>
              <input
                type="password"
                placeholder={s.hasKey ? "•••••••••••• (set — type to replace)" : "Paste Gemini API key"}
                value={inputs[s.slot] || ""}
                onChange={(e) => setInputs((prev) => ({ ...prev, [s.slot]: e.target.value }))}
                style={{ flex: 1, minWidth: 220 }}
              />
              <button
                type="button"
                className="btn"
                disabled={savingSlot === s.slot || !(inputs[s.slot] || "").trim()}
                onClick={() => handleSave(s.slot)}
              >
                {savingSlot === s.slot ? "Saving…" : "Save"}
              </button>
              {s.hasKey && (
                <button
                  type="button"
                  className="btn danger"
                  disabled={savingSlot === s.slot}
                  onClick={async () => {
                    setSavingSlot(s.slot);
                    try {
                      await saveGeminiKey(s.slot, "");
                      setToast(`Slot ${s.slot} cleared.`);
                      await refresh();
                    } catch (e) {
                      setToast(e instanceof Error ? e.message : "Clear failed.");
                    } finally {
                      setSavingSlot(null);
                      setTimeout(() => setToast(""), 4000);
                    }
                  }}
                >
                  Clear
                </button>
              )}
              {s.lastUsedAt && (
                <span className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={12} /> Last used {new Date(s.lastUsedAt).toLocaleString()}
                </span>
              )}
              {s.status === "exhausted" && s.lastError && (
                <span className="muted" style={{ fontSize: 12, color: "#f59e0b" }} title={s.lastError}>
                  <XCircle size={12} style={{ verticalAlign: "-1px" }} /> {s.lastError.slice(0, 60)}
                </span>
              )}
              {s.status === "active" && s.hasKey && (
                <span className="muted" style={{ fontSize: 12, color: "#22c55e" }}>
                  <CheckCircle2 size={12} style={{ verticalAlign: "-1px" }} /> Aaj {s.usageCountToday} calls
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="notice" style={{ marginTop: 12 }}>
          {toast}
        </div>
      )}
    </div>
  );
};
