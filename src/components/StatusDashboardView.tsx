import React, { useCallback, useEffect, useState } from "react";
import { Activity, Bot, Cloud, Cpu, Database as DbIcon, RefreshCw, Send, Users } from "lucide-react";
import { getGeminiKeyStatus, GeminiKeySlotStatus } from "../services/geminiKeys";
import { pollTelegramConnection, describeFunctionsError } from "../services/telegram";
import { listStaffAccounts, StaffProfile } from "../services/staffAuth";
import { getSupabaseUsage, getCloudflareUsage } from "../services/storageUsage";
import { StorageUsageMeter } from "./StorageUsageMeter";

// STEP 9.1 — Full System Status Dashboard (Owner-only).
// One screen, six services, each with a green/red (sometimes amber) dot —
// exactly the list in DS_Mobile_Master_Plan.md's STEP 9.1:
//   Gemini AI, Telegram Bot, Telegram Owner Account, Staff Connections,
//   Cloudflare Storage, Supabase Storage & Database — plus the Step 7.3
//   Storage Usage Meter embedded below (it was already built as a
//   self-contained component specifically so it could slot in here
//   unchanged).
//
// Deliberately separate from Step 4.4's small always-visible online/offline
// badge (ConnectionStatusBadge) — that one answers "is this device online
// right now" for everyone; this one answers "is the whole system healthy"
// for the Owner, on demand, in one place. Every card re-uses the exact
// service function the real feature itself calls (get_gemini_key_status
// RPC, telegram-connect's status action, profiles table, the Step 7.3
// storage RPC/Edge Function) — never a separate fake health-check path
// that could drift from what's actually true.

type DotColor = "green" | "amber" | "red" | "grey";

const dotClassFor: Record<DotColor, string> = {
  green: "online",
  amber: "connecting",
  red: "error",
  grey: "",
};

const StatusRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  color: DotColor;
  loading: boolean;
  headline: string;
  detail?: string;
}> = ({ icon, title, color, loading, headline, detail }) => (
  <div style={{ padding: 14, borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontWeight: 600 }}>
      {icon} {title}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className={`status-dot ${loading ? "connecting" : dotClassFor[color]}`}></span>
      <span style={{ fontSize: 15, fontWeight: 700 }}>{loading ? "Checking..." : headline}</span>
    </div>
    {!loading && detail && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{detail}</div>}
  </div>
);

interface StatusDashboardViewProps {
  storeId: string | null | undefined;
  storageLimitSupabaseMb?: number;
  storageLimitCloudflareMb?: number;
  onSaveStorageLimits: (supabaseLimitMb: number, cloudflareLimitMb: number) => void;
}

export const StatusDashboardView: React.FC<StatusDashboardViewProps> = ({
  storeId,
  storageLimitSupabaseMb,
  storageLimitCloudflareMb,
  onSaveStorageLimits,
}) => {
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const [geminiSlots, setGeminiSlots] = useState<GeminiKeySlotStatus[] | null>(null);
  const [geminiError, setGeminiError] = useState("");

  const [telegramConnected, setTelegramConnected] = useState(false);
  const [botConfigured, setBotConfigured] = useState(false);
  const [telegramError, setTelegramError] = useState("");

  const [staff, setStaff] = useState<StaffProfile[] | null>(null);
  const [staffError, setStaffError] = useState("");

  const [supabaseOk, setSupabaseOk] = useState<boolean | null>(null);
  const [supabaseError, setSupabaseError] = useState("");

  const [cloudflareOk, setCloudflareOk] = useState<boolean | null>(null);
  const [cloudflareNotConfigured, setCloudflareNotConfigured] = useState(false);
  const [cloudflareError, setCloudflareError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);

    const [geminiRes, telegramRes, staffRes, supabaseRes, cloudflareRes] = await Promise.allSettled([
      getGeminiKeyStatus(),
      pollTelegramConnection(),
      storeId ? listStaffAccounts(storeId) : Promise.reject(new Error("Store abhi load nahi hua.")),
      getSupabaseUsage(),
      storeId ? getCloudflareUsage(storeId) : Promise.reject(new Error("Store abhi load nahi hua.")),
    ]);

    if (geminiRes.status === "fulfilled") {
      setGeminiSlots(geminiRes.value);
      setGeminiError("");
    } else {
      setGeminiSlots(null);
      setGeminiError(geminiRes.reason instanceof Error ? geminiRes.reason.message : String(geminiRes.reason));
    }

    if (telegramRes.status === "fulfilled") {
      const d = telegramRes.value as { connected?: boolean; botConfigured?: boolean };
      setTelegramConnected(Boolean(d?.connected));
      setBotConfigured(Boolean(d?.botConfigured));
      setTelegramError("");
    } else {
      setTelegramConnected(false);
      setBotConfigured(false);
      setTelegramError(await describeFunctionsError(telegramRes.reason));
    }

    if (staffRes.status === "fulfilled") {
      setStaff(staffRes.value);
      setStaffError("");
    } else {
      setStaff(null);
      setStaffError(staffRes.reason instanceof Error ? staffRes.reason.message : String(staffRes.reason));
    }

    if (supabaseRes.status === "fulfilled") {
      setSupabaseOk(true);
      setSupabaseError("");
    } else {
      setSupabaseOk(false);
      setSupabaseError(supabaseRes.reason instanceof Error ? supabaseRes.reason.message : String(supabaseRes.reason));
    }

    if (cloudflareRes.status === "fulfilled") {
      setCloudflareOk(true);
      setCloudflareNotConfigured(false);
      setCloudflareError("");
    } else {
      const msg = cloudflareRes.reason instanceof Error ? cloudflareRes.reason.message : String(cloudflareRes.reason);
      setCloudflareOk(false);
      // r2-storage returns this exact message (503) when the 3 R2 secrets
      // haven't been set yet — Step 7.1's one still-pending manual step.
      // That's a "setup pending" amber state, not a real red outage.
      setCloudflareNotConfigured(msg.includes("configure nahi hai"));
      setCloudflareError(msg);
    }

    setLastChecked(new Date());
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- Gemini AI ----
  const activeKeyCount = geminiSlots ? geminiSlots.filter((s) => s.status === "active").length : 0;
  const setKeyCount = geminiSlots ? geminiSlots.filter((s) => s.hasKey).length : 0;
  let geminiColor: DotColor = "grey";
  let geminiHeadline = "Unavailable";
  let geminiDetail = geminiError || undefined;
  if (geminiSlots) {
    if (activeKeyCount > 0) {
      geminiColor = "green";
      geminiHeadline = `${activeKeyCount}/${setKeyCount || 10} keys active`;
    } else if (setKeyCount > 0) {
      geminiColor = "amber";
      geminiHeadline = "All keys exhausted/invalid";
    } else {
      geminiColor = "red";
      geminiHeadline = "No keys configured";
    }
    geminiDetail = `${setKeyCount} of 10 slots have a key saved.`;
  }

  // ---- Telegram Bot ----
  const telegramBotColor: DotColor = telegramError ? "grey" : botConfigured ? "green" : "red";
  const telegramBotHeadline = telegramError ? "Unavailable" : botConfigured ? "Configured" : "Not configured";

  // ---- Telegram Owner Account ----
  const ownerAcctColor: DotColor = !botConfigured ? "grey" : telegramConnected ? "green" : "red";
  const ownerAcctHeadline = !botConfigured
    ? "Bot not set up"
    : telegramConnected
    ? "Connected"
    : "Not connected";

  // ---- Staff Connections ----
  const ONLINE_WINDOW_MS = 15 * 60 * 1000; // "online/synced recently" = active in the last 15 minutes
  const now = Date.now();
  const activeStaff = staff ? staff.filter((s) => s.access_enabled) : [];
  const onlineStaff = activeStaff.filter(
    (s) => s.last_active_at && now - new Date(s.last_active_at).getTime() < ONLINE_WINDOW_MS
  );
  let staffColor: DotColor = "grey";
  let staffHeadline = "Unavailable";
  let staffDetail = staffError || undefined;
  if (staff) {
    staffHeadline = `${onlineStaff.length} online / ${activeStaff.length} active`;
    staffColor = staff.length === 0 ? "grey" : onlineStaff.length > 0 ? "green" : "amber";
    staffDetail =
      staff.length === 0
        ? "Abhi tak koi Staff ID banaya nahi gaya."
        : `${staff.length} total staff account${staff.length === 1 ? "" : "s"} (${activeStaff.length} access ON).`;
  }

  // ---- Cloudflare Storage ----
  const cloudflareColor: DotColor = cloudflareOk ? "green" : cloudflareNotConfigured ? "amber" : "red";
  const cloudflareHeadline = cloudflareOk ? "Connected" : cloudflareNotConfigured ? "Setup pending" : "Error";

  // ---- Supabase Storage & Database ----
  const supabaseColor: DotColor = supabaseOk ? "green" : "red";
  const supabaseHeadline = supabaseOk ? "Connected" : "Error";

  return (
    <div className="section">
      <div className="section-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={18} /> System Status Dashboard
        </h2>
        <button type="button" className="btn" onClick={refresh} disabled={loading} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} /> {loading ? "Checking..." : "Refresh"}
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        Poora system ek jagah — har service ka real, live status (koi fake health-check nahi, wahi asli function
        use hota hai jo feature khud use karta hai). {lastChecked && `Last checked: ${lastChecked.toLocaleTimeString()}`}
      </p>

      <div
        className="storage-meter-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}
      >
        <StatusRow
          icon={<Cpu size={15} />}
          title="Gemini AI"
          color={geminiColor}
          loading={loading}
          headline={geminiHeadline}
          detail={geminiDetail}
        />
        <StatusRow
          icon={<Bot size={15} />}
          title="Telegram Bot"
          color={telegramBotColor}
          loading={loading}
          headline={telegramBotHeadline}
          detail={!botConfigured ? "TELEGRAM_BOT_TOKEN Supabase secret set nahi hai." : "Bot token configured hai."}
        />
        <StatusRow
          icon={<Send size={15} />}
          title="Telegram Owner Account"
          color={ownerAcctColor}
          loading={loading}
          headline={ownerAcctHeadline}
          detail={
            !botConfigured
              ? "Pehle bot configure karo."
              : telegramConnected
              ? "Reports/alerts/approvals is account par jaa rahe hain."
              : "Settings se Telegram connect karo taaki reports/alerts mile."
          }
        />
        <StatusRow
          icon={<Users size={15} />}
          title="Staff Connections"
          color={staffColor}
          loading={loading}
          headline={staffHeadline}
          detail={staffDetail}
        />
        <StatusRow
          icon={<Cloud size={15} />}
          title="Cloudflare Storage"
          color={cloudflareColor}
          loading={loading}
          headline={cloudflareHeadline}
          detail={
            cloudflareNotConfigured
              ? "3 R2 secrets abhi Supabase mein set nahi — STEP7.1-CLOUDFLARE-SETUP.md dekho."
              : cloudflareOk
              ? "Photos/KYC/invoices R2 mein safely store ho rahe hain."
              : cloudflareError
          }
        />
        <StatusRow
          icon={<DbIcon size={15} />}
          title="Supabase Storage & Database"
          color={supabaseColor}
          loading={loading}
          headline={supabaseHeadline}
          detail={supabaseOk ? "Database reachable, sab data live sync ho raha hai." : supabaseError}
        />
      </div>

      <StorageUsageMeter
        storeId={storeId || undefined}
        supabaseLimitMb={storageLimitSupabaseMb}
        cloudflareLimitMb={storageLimitCloudflareMb}
        onSaveLimits={onSaveStorageLimits}
      />
    </div>
  );
};
