import React, { useEffect, useState } from "react";
import { DownloadCloud, CheckCircle2, RefreshCw, Trash2, HardDrive, Image as ImageIcon, ListChecks } from "lucide-react";
import { Database } from "../types";
import {
  collectPhotoUrls,
  downloadPhotosForOffline,
  clearDownloadedPhotos,
  getOfflineStatus,
  type OfflineStatus,
  type PrecacheProgress,
} from "../services/offlineDownload";
import { touchStaffOfflineDownload } from "../services/staffAuth";

interface DownloadAreaViewProps {
  db: Database;
  isStaff: boolean;
  showToast: (msg: string, color?: string) => void;
}

export const DownloadAreaView: React.FC<DownloadAreaViewProps> = ({ db, isStaff, showToast }) => {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [progress, setProgress] = useState<PrecacheProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refreshStatus = async () => {
    try {
      const result = await getOfflineStatus(db);
      setStatus(result);
    } catch {
      // status is best-effort — leave last known status on screen
    }
  };

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.products.length]);

  const photoUrlCount = collectPhotoUrls(db).length;

  const handleDownload = async () => {
    setDownloading(true);
    setProgress({ done: 0, failed: 0, total: photoUrlCount });
    try {
      const result = await downloadPhotosForOffline(db, setProgress);
      if (isStaff) void touchStaffOfflineDownload();
      await refreshStatus();
      if (result.failed > 0) {
        showToast(`Download complete — ${result.done - result.failed}/${result.total} photos saved, ${result.failed} skipped (weak signal). Dobara try karein.`, "amber");
      } else {
        showToast(`Offline ke liye sab ready hai — ${result.total} photos + poora stock data local mein save ho gaya.`, "green");
      }
    } catch (err: any) {
      showToast(err?.message || "Download start nahi ho paya — page reload karke dobara try karein.", "red");
    } finally {
      setDownloading(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearDownloadedPhotos();
      await refreshStatus();
      showToast("Downloaded photos clear ho gayi — device space free ho gaya.", "green");
    } catch {
      showToast("Clear nahi ho paya, dobara try karein.", "red");
    } finally {
      setClearing(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const coveragePct = status && status.photosTotal > 0 ? Math.round((status.photosCached / status.photosTotal) * 100) : status ? 100 : 0;

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <DownloadCloud size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Download Area — Offline Mode Setup
        </h2>
        <button className="btn sm" onClick={() => void refreshStatus()} title="Refresh status">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="notice" style={{ marginBottom: "14px" }}>
        Yahan se apne store ka poora zaroori data — stock list, product photos, screen-size mappings —
        is device mein download kar lein. Internet chala jaaye to bhi app dikhana, search karna, aur sell
        karna kaam karega; wapas internet aate hi sab automatically sync ho jaayega.
      </div>

      <div className="grid cols-3" style={{ gap: "12px", marginBottom: "16px" }}>
        <div className="card" style={{ padding: "14px" }}>
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <ImageIcon size={14} /> Product Photos
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800 }}>
            {status ? `${status.photosCached}/${status.photosTotal}` : "…"}
          </div>
          <div className="hint">{coveragePct}% offline-ready</div>
        </div>

        <div className="card" style={{ padding: "14px" }}>
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <ListChecks size={14} /> Pending Sync
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: status && status.pendingQueueCount > 0 ? "var(--amber)" : undefined }}>
            {status ? status.pendingQueueCount : "…"}
          </div>
          <div className="hint">{status && status.pendingQueueCount > 0 ? "internet aane par auto-sync hoga" : "sab sync ho chuka hai"}</div>
        </div>

        <div className="card" style={{ padding: "14px" }}>
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <HardDrive size={14} /> Device Storage Used
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800 }}>
            {status?.storageUsedMb != null ? `${status.storageUsedMb} MB` : "—"}
          </div>
          <div className="hint">
            {status?.lastDownloadAt ? `Last download: ${new Date(status.lastDownloadAt).toLocaleString()}` : "Abhi tak download nahi hua"}
          </div>
        </div>
      </div>

      {downloading && progress && (
        <div style={{ marginBottom: "14px" }}>
          <div className="hint" style={{ marginBottom: "4px" }}>
            Downloading photos… {progress.done}/{progress.total} {progress.failed > 0 ? `(${progress.failed} skipped)` : ""}
          </div>
          <div style={{ height: "8px", borderRadius: "999px", background: "var(--paper)", border: "1px solid var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width .2s" }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => void handleDownload()} disabled={downloading}>
          {downloading ? <RefreshCw size={14} className="spin" /> : <DownloadCloud size={14} />}
          {downloading ? "Downloading…" : "Download for Offline Use"}
        </button>
        <button className="btn sm" onClick={() => void handleClear()} disabled={clearing || downloading}>
          <Trash2 size={13} /> Clear Downloaded Photos
        </button>
      </div>

      {status && status.photosTotal > 0 && status.photosCached >= status.photosTotal && !downloading && (
        <div className="notice" style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "8px", color: "var(--green)" }}>
          <CheckCircle2 size={15} /> Yeh device poori tarah offline-ready hai — internet chale jaane par bhi app flawlessly chalega.
        </div>
      )}

      {status && !status.serviceWorkerReady && (
        <div className="notice" style={{ marginTop: "14px" }}>
          Offline download service abhi ready nahi hai — page ek baar reload karein, phir "Download for Offline Use" dabayein.
        </div>
      )}
    </div>
  );
};
