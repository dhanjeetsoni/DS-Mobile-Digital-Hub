import React, { useEffect, useState, useCallback } from "react";
import { KeyRound, RefreshCw, CheckCircle2, XCircle, Clock, Sparkles, Cpu, Layers, Tag } from "lucide-react";
import { getGeminiKeyStatus, saveGeminiKey, GeminiKeySlotStatus, AiProvider } from "../services/geminiKeys";
import { detectProviderFromKey } from "../services/aiProviderAdapters";

// Step 2.1 (Owner Settings: up to 10 AI keys, auto-rotation pool) +
// Step 2.2 (AI Key Status Widget: active key, available/exhausted counts,
// today's rough usage). Owner-only — this is rendered inside the Settings
// screen, which is already gated to Owner in Sidebar.tsx (ownerOnly: true).
// Phase 11 extends the pool to any mix of providers, not just Gemini.
const PROVIDER_OPTIONS: { id: AiProvider; name: string; placeholder: string; badgeColor: string; bg: string }[] = [
  { id: "gemini", name: "Google Gemini", placeholder: "Paste Gemini API key (AIzaSy...)", badgeColor: "#0284c7", bg: "rgba(2, 132, 199, 0.1)" },
  { id: "openai", name: "OpenAI (ChatGPT)", placeholder: "Paste OpenAI key (sk-...)", badgeColor: "#10b981", bg: "rgba(16, 185, 129, 0.1)" },
  { id: "anthropic", name: "Anthropic Claude", placeholder: "Paste Claude key (sk-ant-...)", badgeColor: "#8b5cf6", bg: "rgba(139, 92, 246, 0.1)" },
  { id: "groq", name: "Groq (Fast Llama)", placeholder: "Paste Groq key (gsk_...)", badgeColor: "#f97316", bg: "rgba(249, 115, 22, 0.1)" },
  { id: "openrouter", name: "OpenRouter", placeholder: "Paste OpenRouter key (sk-or-...)", badgeColor: "#6366f1", bg: "rgba(99, 102, 241, 0.1)" },
];

export const AiKeyPoolPanel: React.FC = () => {
  const [slots, setSlots] = useState<GeminiKeySlotStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [providers, setProviders] = useState<Record<number, AiProvider>>({});
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [savingSlot, setSavingSlot] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const status = await getGeminiKeyStatus();
      setSlots(status);
      const initialProviders: Record<number, AiProvider> = {};
      const initialLabels: Record<number, string> = {};
      for (const s of status) {
        initialProviders[s.slot] = s.provider || "gemini";
        if (s.label) initialLabels[s.slot] = s.label;
      }
      setProviders((prev) => ({ ...initialProviders, ...prev }));
      setLabels((prev) => ({ ...initialLabels, ...prev }));
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

  const handleKeyChange = (slot: number, value: string) => {
    setInputs((prev) => ({ ...prev, [slot]: value }));
    const detected = detectProviderFromKey(value);
    if (detected && value.length > 5) {
      setProviders((prev) => ({ ...prev, [slot]: detected }));
    }
  };

  const handleSave = async (slot: number) => {
    const value = (inputs[slot] || "").trim();
    const provider = providers[slot] || "gemini";
    const label = (labels[slot] || "").trim();
    setSavingSlot(slot);
    try {
      await saveGeminiKey(slot, value, label, provider);
      setToast(value ? `Slot ${slot} (${provider.toUpperCase()}) saved successfully.` : `Slot ${slot} cleared.`);
      setInputs((prev) => ({ ...prev, [slot]: "" }));
      await refresh();
    } catch (e) {
      setToast(e instanceof Error ? `Error: ${e.message}` : "Save failed.");
    } finally {
      setSavingSlot(null);
      setTimeout(() => setToast(""), 4500);
    }
  };

  const activeCount = (slots || []).filter((s) => s.status === "active").length;
  const exhaustedCount = (slots || []).filter((s) => s.status === "exhausted").length;
  const configuredCount = (slots || []).filter((s) => s.hasKey).length;
  const usageToday = (slots || []).reduce((sum, s) => sum + (s.usageCountToday || 0), 0);
  const activeSlot = (slots || []).find((s) => s.status === "active" && s.hasKey);

  // Provider breakdown
  const providerCounts = (slots || [])
    .filter((s) => s.hasKey)
    .reduce((acc, s) => {
      acc[s.provider] = (acc[s.provider] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const statusBadge = (s: GeminiKeySlotStatus) => {
    if (!s.hasKey) return <span className="muted">⚪ Not set</span>;
    if (s.status === "exhausted") return <span style={{ color: "#f59e0b" }}>🟡 Resting (cooldown)</span>;
    if (s.status === "invalid") return <span style={{ color: "#ef4444" }}>🔴 Invalid</span>;
    return <span style={{ color: "#22c55e" }}>🟢 Active</span>;
  };

  const providerBadge = (provider: AiProvider) => {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === provider) || PROVIDER_OPTIONS[0];
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          fontWeight: 700,
          color: opt.badgeColor,
          background: opt.bg,
          border: `1px solid ${opt.badgeColor}40`,
        }}
      >
        <Cpu size={11} /> {opt.name}
      </span>
    );
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>
          <KeyRound size={16} style={{ verticalAlign: "-2px" }} /> AI Key Pool (Universal Multi-Provider)
        </h2>
        <button type="button" className="btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>
      <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Apne store mein kisi bhi AI provider (<strong>Google Gemini, OpenAI ChatGPT, Anthropic Claude, Groq, OpenRouter</strong>)
        ki API keys daal sakte ho. Ek key ki limit khatam hone par system khud agli available key aur provider par switch kar lega —
        shop ka koi bhi OCR, glass search, ya product page feature nahi rukega.
      </p>

      {loadError && (
        <div className="notice" style={{ marginBottom: 12 }}>
          {loadError}
        </div>
      )}

      {!loadError && (
        <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Configured Keys</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{configuredCount} / 10</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Active Now</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#22c55e" }}>
              {activeSlot ? `Slot ${activeSlot.slot} (${activeSlot.provider})` : activeCount > 0 ? activeCount : "—"}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Resting (cooldown)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: exhaustedCount ? "#f59e0b" : undefined }}>
              {exhaustedCount}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Today AI Calls</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{usageToday}</div>
          </div>
          {Object.keys(providerCounts).length > 0 && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 12 }}>Pool Providers:</span>
              {Object.entries(providerCounts).map(([prov, cnt]) => (
                <span key={prov} style={{ fontSize: "11.5px", fontWeight: 700 }}>
                  {providerBadge(prov as AiProvider)} ×{cnt}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !slots && <div className="muted">Loading AI key status…</div>}

      {slots && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {slots.map((s) => {
            const currentProvider = providers[s.slot] || s.provider || "gemini";
            const opt = PROVIDER_OPTIONS.find((p) => p.id === currentProvider) || PROVIDER_OPTIONS[0];

            return (
              <div
                key={s.slot}
                className="card"
                style={{
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderLeft: s.hasKey ? `4px solid ${opt.badgeColor}` : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: "14px" }}>Slot {s.slot}</span>
                    {s.hasKey && providerBadge(s.provider)}
                    {statusBadge(s)}
                    {s.label && (
                      <span className="muted" style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                        <Tag size={11} /> {s.label}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {s.lastUsedAt && (
                      <span className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                        <Clock size={11} /> {new Date(s.lastUsedAt).toLocaleTimeString()}
                      </span>
                    )}
                    {s.status === "active" && s.hasKey && (
                      <span className="muted" style={{ fontSize: 11, color: "#22c55e" }}>
                        <CheckCircle2 size={11} style={{ verticalAlign: "-1px" }} /> {s.usageCountToday} calls today
                      </span>
                    )}
                    {s.status === "exhausted" && s.lastError && (
                      <span className="muted" style={{ fontSize: 11, color: "#f59e0b" }} title={s.lastError}>
                        <XCircle size={11} style={{ verticalAlign: "-1px" }} /> {s.lastError.slice(0, 45)}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {/* Provider Selector */}
                  <select
                    value={currentProvider}
                    onChange={(e) => setProviders((prev) => ({ ...prev, [s.slot]: e.target.value as AiProvider }))}
                    style={{ width: "170px", padding: "6px 8px", fontSize: "12.5px" }}
                  >
                    {PROVIDER_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {/* Optional Label */}
                  <input
                    type="text"
                    placeholder="Key Label (e.g. Office GPT-4o)"
                    value={labels[s.slot] ?? s.label ?? ""}
                    onChange={(e) => setLabels((prev) => ({ ...prev, [s.slot]: e.target.value }))}
                    style={{ width: "180px", padding: "6px 8px", fontSize: "12.5px" }}
                  />

                  {/* API Key Secret Input */}
                  <input
                    type="password"
                    placeholder={s.hasKey ? "•••••••••••• (saved — enter new key to replace)" : opt.placeholder}
                    value={inputs[s.slot] || ""}
                    onChange={(e) => handleKeyChange(s.slot, e.target.value)}
                    style={{ flex: 1, minWidth: "220px", padding: "6px 8px", fontSize: "12.5px" }}
                  />

                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={savingSlot === s.slot || (!(inputs[s.slot] || "").trim() && labels[s.slot] === s.label && currentProvider === s.provider)}
                    onClick={() => handleSave(s.slot)}
                  >
                    {savingSlot === s.slot ? "Saving…" : "Save"}
                  </button>

                  {s.hasKey && (
                    <button
                      type="button"
                      className="btn sm danger"
                      disabled={savingSlot === s.slot}
                      onClick={async () => {
                        setSavingSlot(s.slot);
                        try {
                          await saveGeminiKey(s.slot, "", "", currentProvider);
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
                </div>
              </div>
            );
          })}
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
