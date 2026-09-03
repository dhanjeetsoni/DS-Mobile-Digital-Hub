import React, { useState } from "react";
import { Loader2, Rocket, X } from "lucide-react";
import type { AppUpdateInfo } from "../services/appVersion";
import { checkDownloadInstallAndRelaunch, detectTauriRuntime, type WindowsUpdateProgress } from "../services/windowsUpdater";

// STEP 12.1/12.2 — the "Update Available" popup, matching the Master
// Plan's wording literally ("Update Available" popup, one-tap download).
// Kept as a small always-visible pill (same visual family as the existing
// LOW STOCK pill in App.tsx's top-actions row) rather than a blocking
// modal — an app update should never stop someone mid-sale.
//
// Android (staff-android/owner-android): the one tap opens the APK's
// direct-download URL in the system browser. That's a real, working
// install path with zero extra native code — Android's own download
// manager + "install unknown apps" prompt takes it from there, same as
// any sideloaded APK. No Tauri Android plugin needed for this part.
//
// Windows: when actually running inside the Tauri shell (detectTauriRuntime()
// — false in `npm run dev`'s browser preview), the tap now runs the real
// silent flow: check() -> downloadAndInstall() -> relaunch(), via
// src/services/windowsUpdater.ts, backed by the Tauri Updater plugin wired
// in src-tauri/tauri.conf.json's "plugins.updater" block (see
// STEP12-APP-UPDATE-SETUP.md for the one-time signing-key setup this
// needs). Outside Tauri (or if that flow errors), it falls back to the
// same manual installer-download link Android uses — always a working
// path even before/without the signed-build pipeline being finished.

interface UpdateAvailablePillProps {
  info: AppUpdateInfo;
  isAndroid: boolean;
  onDismiss: () => void;
}

export const UpdateAvailablePill: React.FC<UpdateAvailablePillProps> = ({ info, isAndroid, onDismiss }) => {
  const [progress, setProgress] = useState<WindowsUpdateProgress | null>(null);
  const useNativeFlow = !isAndroid && detectTauriRuntime();

  const handleClick = async (e: React.MouseEvent) => {
    if (!useNativeFlow) return; // let the <a href> do its normal thing
    e.preventDefault();
    if (progress && progress.phase !== "error" && progress.phase !== "done") return; // already running
    await checkDownloadInstallAndRelaunch((p) => {
      setProgress(p);
      // A successful relaunch() never returns control here — if we do
      // reach "done" without the app having restarted, something odd
      // happened (e.g. relaunch permission missing); fall back to
      // reminding the person they can also just use the download link.
    });
  };

  const label = useNativeFlow
    ? progress?.phase === "downloading"
      ? `Download ho raha hai${progress.contentLength ? ` (${Math.round((progress.downloadedBytes / progress.contentLength) * 100)}%)` : "..."}`
      : progress?.phase === "installing"
      ? "Install ho raha hai..."
      : progress?.phase === "error"
      ? `Update fail ho gaya (${progress.message}) — click karke installer download karein`
      : `UPDATE AVAILABLE v${info.version} — Update karein (auto-install)`
    : `UPDATE AVAILABLE v${info.version} — ${isAndroid ? "Download karke Install karein" : "Installer Download karein"}`;

  const busy = progress?.phase === "checking" || progress?.phase === "downloading" || progress?.phase === "installing";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: "var(--green-light, rgba(34,197,94,0.12))",
        color: "var(--green, #22c55e)",
        border: "1px solid var(--green-border, rgba(34,197,94,0.35))",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 800,
      }}
      title={info.releaseNotes || `Naya version v${info.version} available (abhi v${info.installedVersion} chal raha hai)`}
    >
      {busy ? <Loader2 size={12} className="spin" /> : <Rocket size={12} />}
      <a
        href={info.downloadUrl}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        style={{ color: "inherit", textDecoration: "underline", cursor: busy ? "default" : "pointer" }}
      >
        {label}
      </a>
      <button
        onClick={onDismiss}
        title="Abhi ke liye chhupao (agli baar app khulne par phir dikhega jab tak update na ho)"
        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", display: "flex", padding: 0 }}
      >
        <X size={12} />
      </button>
    </div>
  );
};
