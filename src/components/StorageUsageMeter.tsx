import React, { useCallback, useEffect, useState } from "react";
import { Database as DbIcon, RefreshCw, AlertTriangle, HardDrive } from "lucide-react";
import { getStorageUsage, formatBytes, usageLevel, UsageLevel } from "../services/storageUsage";

// Step 7.3 — Storage Usage Meter. Owner-only (rendered inside the Settings
// screen, which Sidebar.tsx already gates to Owner via ownerOnly: true — same
// placement pattern as AiKeyPoolPanel above it). Shows Supabase (text data)
// and Cloudflare (heavy files) usage side by side with Warning/Critical
// colouring, per DS_Mobile_Master_Plan.md STEP 7.3. This is deliberately just
// the meter — the full multi-service Status Dashboard (Gemini/Telegram/Staff
// connections etc.) is Step 9, this component is designed to slot into that
// dashboard unchanged when Step 9 is built.

const DEFAULT_SUPABASE_LIMIT_MB = 500; // Supabase Free plan DB size
const DEFAULT_CLOUDFLARE_LIMIT_MB = 10 * 1024; // Cloudflare R2 Free plan (10 GB/month)

interface StorageUsageMeterProps {
  storeId?: string;
  supabaseLimitMb?: number;
  cloudflareLimitMb?: number;
  onSaveLimits?: (supabaseLimitMb: number, cloudflareLimitMb: number) => void;
}

const levelColor: Record<UsageLevel, string> = { ok: "#22c55e", warning: "#f59e0b", critical: "#ef4444" };
const levelLabel: Record<UsageLevel, string> = { ok: "OK", warning: "Warning", critical: "Critical" };

const Bar: React.FC<{ usedBytes: number; limitBytes: number }> = ({ usedBytes, limitBytes }) => {
  const level = usageLevel(usedBytes, limitBytes);
  const pct = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  return (
    <div>
      <div style={{ height: 10, borderRadius: 6, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(pct, usedBytes > 0 ? 2 : 0)}%`,
            background: levelColor[level],
            transition: "width 300ms ease",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12, opacity: 0.8 }}>
        <span>{pct}% used</span>
        <span style={{ color: level === "ok" ? undefined : levelColor[level], fontWeight: level === "ok" ? 400 : 700 }}>
          {level !== "ok" && <AlertTriangle size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />}
          {levelLabel[level]}
        </span>
      </div>
    </div>
  );
};

export const StorageUsageMeter: React.FC<StorageUsageMeterProps> = ({ storeId, supabaseLimitMb, cloudflareLimitMb, onSaveLimits }) => {
  const [loading, setLoading] = useState(true);
  const [supabaseBytes, setSupabaseBytes] = useState<number | null>(null);
  const [supabaseError, setSupabaseError] = useState("");
  const [cloudflareBytes, setCloudflareBytes] = useState<number | null>(null);
  const [cloudflareError, setCloudflareError] = useState("");
  const [supabaseDetail, setSupabaseDetail] = useState<{ storeStateBytes: number; otherTablesBytes: number; tableCount: number } | null>(null);
  const [cloudflareDetail, setCloudflareDetail] = useState<{ publicBucketBytes: number; publicBucketCount: number; privateBucketBytes: number; privateBucketCount: number } | null>(null);
  const [editingLimits, setEditingLimits] = useState(false);
  const [limitInputs, setLimitInputs] = useState({
    supabase: String(supabaseLimitMb || DEFAULT_SUPABASE_LIMIT_MB),
    cloudflare: String(cloudflareLimitMb || DEFAULT_CLOUDFLARE_LIMIT_MB),
  });

  const supabaseLimitBytes = (supabaseLimitMb || DEFAULT_SUPABASE_LIMIT_MB) * 1024 * 1024;
  const cloudflareLimitBytes = (cloudflareLimitMb || DEFAULT_CLOUDFLARE_LIMIT_MB) * 1024 * 1024;

  const refresh = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      setSupabaseError("Store not loaded yet.");
      setCloudflareError("Store not loaded yet.");
      return;
    }
    setLoading(true);
    const result = await getStorageUsage(storeId);
    setSupabaseBytes(result.supabase?.totalBytes ?? null);
    setSupabaseDetail(result.supabase ? { storeStateBytes: result.supabase.storeStateBytes, otherTablesBytes: result.supabase.otherTablesBytes, tableCount: result.supabase.tableCount } : null);
    setSupabaseError(result.supabaseError || "");
    setCloudflareBytes(result.cloudflare?.totalBytes ?? null);
    setCloudflareDetail(
      result.cloudflare
        ? {
            publicBucketBytes: result.cloudflare.publicBucketBytes,
            publicBucketCount: result.cloudflare.publicBucketCount,
            privateBucketBytes: result.cloudflare.privateBucketBytes,
            privateBucketCount: result.cloudflare.privateBucketCount,
          }
        : null
    );
    setCloudflareError(result.cloudflareError || "");
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveLimits = () => {
    const sb = Math.max(1, Number(limitInputs.supabase) || DEFAULT_SUPABASE_LIMIT_MB);
    const cf = Math.max(1, Number(limitInputs.cloudflare) || DEFAULT_CLOUDFLARE_LIMIT_MB);
    onSaveLimits?.(sb, cf);
    setEditingLimits(false);
  };

  return (
    <div className="panel" style={{ marginTop: "28px" }}>
      <div className="section-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <HardDrive size={18} /> Storage Usage Meter
        </h2>
        <button type="button" className="btn" onClick={refresh} disabled={loading} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} /> {loading ? "Checking..." : "Refresh"}
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        Har storage ka kitna use hua / kitna baaki hai — 70% par amber Warning, 90% par red Critical dikhega taaki
        storage kabhi bina warning ke full na ho. (Step 7.3 — full multi-service Status Dashboard Step 9 mein.)
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }} className="storage-meter-grid">
        <div style={{ padding: 14, borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontWeight: 600 }}>
            <DbIcon size={15} /> Supabase (Text Data)
          </div>
          {supabaseBytes != null ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {formatBytes(supabaseBytes)} <span style={{ fontSize: 13, opacity: 0.6, fontWeight: 400 }}>/ {formatBytes(supabaseLimitBytes)}</span>
              </div>
              <Bar usedBytes={supabaseBytes} limitBytes={supabaseLimitBytes} />
              {supabaseDetail && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                  App state: {formatBytes(supabaseDetail.storeStateBytes)} • Other {supabaseDetail.tableCount} tables: {formatBytes(supabaseDetail.otherTablesBytes)}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              {loading ? "Checking..." : supabaseError || "Data unavailable."}
            </div>
          )}
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontWeight: 600 }}>
            <HardDrive size={15} /> Cloudflare (Photos, KYC, PDFs)
          </div>
          {cloudflareBytes != null ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {formatBytes(cloudflareBytes)} <span style={{ fontSize: 13, opacity: 0.6, fontWeight: 400 }}>/ {formatBytes(cloudflareLimitBytes)}</span>
              </div>
              <Bar usedBytes={cloudflareBytes} limitBytes={cloudflareLimitBytes} />
              {cloudflareDetail && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                  Photos/Invoices: {cloudflareDetail.publicBucketCount} files ({formatBytes(cloudflareDetail.publicBucketBytes)}) • KYC: {cloudflareDetail.privateBucketCount} files ({formatBytes(cloudflareDetail.privateBucketBytes)})
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              {loading ? "Checking..." : cloudflareError || "Data unavailable."}
              {!loading && cloudflareError && (
                <div style={{ marginTop: 4, opacity: 0.65 }}>
                  Agar Cloudflare R2 abhi tak configure nahi hua (Step 7.1's ek manual step baaki hai), yeh normal hai — see STEP7.1-CLOUDFLARE-SETUP.md.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {!editingLimits ? (
          <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => setEditingLimits(true)}>
            Edit plan limits
          </button>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field">
              <label style={{ fontSize: 12 }}>Supabase plan limit (MB)</label>
              <input
                type="number"
                min={1}
                value={limitInputs.supabase}
                onChange={(e) => setLimitInputs((v) => ({ ...v, supabase: e.target.value }))}
                style={{ width: 120 }}
              />
            </div>
            <div className="field">
              <label style={{ fontSize: 12 }}>Cloudflare plan limit (MB)</label>
              <input
                type="number"
                min={1}
                value={limitInputs.cloudflare}
                onChange={(e) => setLimitInputs((v) => ({ ...v, cloudflare: e.target.value }))}
                style={{ width: 140 }}
              />
            </div>
            <button type="button" className="btn primary" onClick={saveLimits}>Save</button>
            <button type="button" className="btn" onClick={() => setEditingLimits(false)}>Cancel</button>
          </div>
        )}
        <div className="hint" style={{ marginTop: 6 }}>
          Defaults dono free-tier plans ke mutabik hain (Supabase 500 MB DB, Cloudflare R2 10 GB/month). Agar paid
          plan hai to yahan sahi limit daal do, meter usi hisaab se sahi % dikhayega.
        </div>
      </div>
    </div>
  );
};
