import React, { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";

// Step 4.4 — Connection Status Indicator.
//
// Deliberately separate from the big Owner-only Status Dashboard (Step 9):
// this is a tiny, always-visible badge that BOTH Owner and Staff see,
// answering one question at a glance — "is this device online and synced
// right now?" — plus a manual "Retry Sync" escape hatch for when someone
// doesn't want to wait for the automatic background retry.
//
// Network truth comes from the browser's own online/offline events
// (navigator.onLine + window 'online'/'offline' listeners) rather than the
// app's cloudStatus alone — cloudStatus only changes when a cloud call is
// actually attempted, so a phone that quietly lost signal between calls
// would otherwise keep showing whatever it last was. Automatic background
// retry itself (on 'online' + a 15s interval) already lives in
// services/repository.ts's startConnectivitySync and is unchanged by this
// component — this badge is purely the visible read-out + a manual nudge.

export type CloudConnectionStatus = "offline" | "connecting" | "online" | "error" | "sync-error";

interface ConnectionStatusBadgeProps {
  cloudStatus: CloudConnectionStatus;
  pendingSyncCount: number;
  onRetry: () => Promise<{ processed: number; failed: number }>;
  /** 2026-09-08: staff area wants just the dot — no "Syncing (n)" text, no
   * manual Retry Sync button. Automatic background retry (startConnectivitySync
   * in repository.ts, unchanged) keeps handling reconnection either way; this
   * only removes the manual escape hatch + text from what staff sees. */
  simplified?: boolean;
}

export function ConnectionStatusBadge({ cloudStatus, pendingSyncCount, onRetry, simplified = false }: ConnectionStatusBadgeProps) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const hasSyncIssue = cloudStatus === "error" || cloudStatus === "sync-error";

  let dotClass = "online";
  let label = "Online (Synced)";
  let hint = "Sab data live/synced hai.";

  if (!isOnline) {
    dotClass = "offline";
    label = "Offline";
    hint = "Internet nahi hai — data is device par safe hai, net aate hi khud-ba-khud sync ho jayega.";
  } else if (hasSyncIssue) {
    dotClass = "error";
    label = "Sync Issue";
    hint = "Cloud se sync karte waqt error aayi — Retry Sync dabao ya thodi der mein khud retry hoga.";
  } else if (pendingSyncCount > 0 || cloudStatus === "connecting") {
    dotClass = "connecting";
    label = pendingSyncCount > 0 ? `Syncing (${pendingSyncCount})` : "Connecting...";
    hint = pendingSyncCount > 0
      ? `${pendingSyncCount} entries abhi cloud par sync ho rahi hain — internet milte hi apne aap ho jayengi.`
      : "Cloud se connect ho raha hai...";
  }

  const hasRealIssue = !isOnline || hasSyncIssue || pendingSyncCount > 0;
  const showRetry = !simplified && hasRealIssue;

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  if (simplified) {
    // Staff area: normally just the dot (green = online/synced, yellow/
    // pulsing = syncing/connecting, red = offline or a sync error) — green
    // is the 99% case and there's nothing for staff to fiddle with then.
    // Improvement: when there IS a real issue (a sale genuinely failed to
    // sync, not just "still syncing"), staff also gets a small tappable
    // retry — previously only the owner could ever manually retry, so a
    // staff member seeing a stuck sale had no option but to wait or go
    // find the owner. Background auto-retry (startConnectivitySync) still
    // runs regardless either way; this is just a manual nudge, same as the
    // owner's version.
    if (!hasRealIssue) {
      return <span className={`status-dot ${dotClass}`} title={hint}></span>;
    }
    return (
      <button
        className="btn sm"
        onClick={handleRetry}
        disabled={retrying}
        title={`${hint} Dobara try karne ke liye tap karo.`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          background: hasSyncIssue ? "var(--amber-light)" : undefined,
          color: hasSyncIssue ? "var(--amber)" : undefined,
          border: hasSyncIssue ? "1px solid var(--amber-border)" : undefined,
          padding: "3px 8px",
          fontSize: "11px",
          fontWeight: 700,
        }}
      >
        <span className={`status-dot ${dotClass}`}></span>
        <RefreshCw size={12} className={retrying ? "spin" : ""} />
        {pendingSyncCount > 0 ? `${pendingSyncCount} pending` : hasSyncIssue ? "Retry" : "Offline"}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span
        className="btn sm"
        title={hint}
        style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "default" }}
      >
        <span className={`status-dot ${dotClass}`}></span>
        {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
        {label}
      </span>
      {showRetry && (
        <button
          className="btn sm"
          onClick={handleRetry}
          disabled={retrying}
          title="Turant sync try karo (background mein bhi khud-ba-khud hota rahega)"
          style={{
            background: "var(--amber-light)",
            color: "var(--amber)",
            border: "1px solid var(--amber-border)",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <RefreshCw size={13} className={retrying ? "spin" : ""} /> Retry Sync
        </button>
      )}
    </div>
  );
}
