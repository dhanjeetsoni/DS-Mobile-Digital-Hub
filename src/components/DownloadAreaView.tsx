import React, { useEffect, useState } from "react";
import { DownloadCloud, CheckCircle2, RefreshCw, Trash2, HardDrive, Image as ImageIcon, ListChecks, PackageCheck, Sparkles, ShieldCheck, Layers } from "lucide-react";
import { Database } from "../types";
import {
  collectPhotoUrls,
  downloadPhotosForOffline,
  downloadFullCatalogForOffline,
  clearDownloadedPhotos,
  getOfflineStatus,
  isFreshDeviceLogin,
  type OfflineStatus,
  type PrecacheProgress,
  type FullDownloadProgress,
} from "../services/offlineDownload";
import { touchStaffOfflineDownload } from "../services/staffAuth";

interface DownloadAreaViewProps {
  db: Database;
  isStaff: boolean;
  showToast: (msg: string, color?: string) => void;
}

export const DownloadAreaView: React.FC<DownloadAreaViewProps> = ({ db, isStaff, showToast }) => {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [fullProgress, setFullProgress] = useState<FullDownloadProgress | null>(null);
  const [photosProgress, setPhotosProgress] = useState<PrecacheProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const isFresh = isFreshDeviceLogin();

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

  const handleFullDownload = async () => {
    setDownloading(true);
    setFullProgress({
      stage: "catalog",
      message: "Starting full catalog & product pages sync...",
      catalogSaved: false,
      productsCount: db.products?.length || 0,
      specsIndexed: 0,
      photosProgress: { done: 0, failed: 0, total: photoUrlCount },
    });
    try {
      const result = await downloadFullCatalogForOffline(db, setFullProgress);
      if (isStaff) void touchStaffOfflineDownload();
      await refreshStatus();
      if (result.photos.failed > 0) {
        showToast(
          `Catalog downloaded! ${result.productsCount} products + ${result.photos.done - result.photos.failed}/${result.photos.total} photos cached (${result.photos.failed} skipped).`,
          "amber"
        );
      } else {
        showToast(
          `Offline Mode 100% ready! ${result.productsCount} products, ${result.specsCount} specs & ${result.photos.total} photos cached locally.`,
          "green"
        );
      }
    } catch (err: any) {
      showToast(err?.message || "Catalog download failed — please reload and retry.", "red");
    } finally {
      setDownloading(false);
    }
  };

  const handlePhotosOnlyDownload = async () => {
    setDownloading(true);
    setPhotosProgress({ done: 0, failed: 0, total: photoUrlCount });
    try {
      const result = await downloadPhotosForOffline(db, setPhotosProgress);
      if (isStaff) void touchStaffOfflineDownload();
      await refreshStatus();
      if (result.failed > 0) {
        showToast(`Photos download complete — ${result.done - result.failed}/${result.total} saved, ${result.failed} skipped.`, "amber");
      } else {
        showToast(`All ${result.total} photos cached offline.`, "green");
      }
    } catch (err: any) {
      showToast(err?.message || "Download failed — please reload and retry.", "red");
    } finally {
      setDownloading(false);
      setPhotosProgress(null);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearDownloadedPhotos();
      await refreshStatus();
      showToast("Downloaded photos aur offline cache clear ho gayi — device space free ho gaya.", "green");
    } catch {
      showToast("Clear nahi ho paya, dobara try karein.", "red");
    } finally {
      setClearing(false);
    }
  };

  const activeProgress = fullProgress?.photosProgress || photosProgress;
  const pct = activeProgress && activeProgress.total > 0 ? Math.round((activeProgress.done / activeProgress.total) * 100) : 0;
  const coveragePct = status && status.photosTotal > 0 ? Math.round((status.photosCached / status.photosTotal) * 100) : status ? 100 : 0;

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <DownloadCloud size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Download Area — Offline Catalog &amp; Mode Setup
        </h2>
        <button className="btn sm" onClick={() => void refreshStatus()} title="Refresh status">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {isFresh && (
        <div
          className="notice"
          style={{
            marginBottom: "16px",
            background: "var(--accent-tint, rgba(59, 130, 246, 0.08))",
            border: "1px solid var(--accent, #3b82f6)",
            padding: "12px 14px",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, color: "var(--accent, #3b82f6)", marginBottom: "4px" }}>
            <Sparkles size={16} /> Naya Device Setup — Full Offline Download Recommended
          </div>
          <div style={{ fontSize: "12.5px" }}>
            Aapne is device par naya login kiya hai. Neeche diya gaya <strong>"Download Full Catalog &amp; Product Pages"</strong> dabayein
            taaki aapka poora catalog, product detail pages, specifications, invoice rules, aur photos local storage mein save ho jaayein.
            Uske baad internet band hone par bhi poori dukan chalegi.
          </div>
        </div>
      )}

      <div className="notice" style={{ marginBottom: "14px" }}>
        Yahan se apne store ka poora zaroori data — stock list, product detail pages, specifications, product photos, aur screen-size mappings —
        is device mein download kar lein. Internet chala jaaye to bhi app dikhana, search karna, aur sell
        karna kaam karega; wapas internet aate hi sab automatically sync ho jaayega.
      </div>

      <div className="grid cols-4" style={{ gap: "12px", marginBottom: "16px" }}>
        <div className="card" style={{ padding: "14px" }}>
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <PackageCheck size={14} /> Full Catalog &amp; Pages
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800 }}>
            {status?.catalogCached ? `${status.catalogProductsCount} items` : `${db.products?.length || 0} items`}
          </div>
          <div className="hint" style={{ color: status?.catalogCached ? "var(--green)" : undefined }}>
            {status?.catalogCached ? `✓ ${status.specsCount} specs pages cached` : "Cloud sync active"}
          </div>
        </div>

        <div className="card" style={{ padding: "14px" }}>
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <ImageIcon size={14} /> Product Photos &amp; Gallery
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
            {status?.lastDownloadAt ? `Last download: ${new Date(status.lastDownloadAt).toLocaleDateString()}` : "Abhi tak download nahi hua"}
          </div>
        </div>
      </div>

      {downloading && (
        <div style={{ marginBottom: "16px", background: "var(--paper)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>
              {fullProgress ? fullProgress.message : `Downloading photos… ${activeProgress?.done}/${activeProgress?.total}`}
            </div>
            {activeProgress && activeProgress.total > 0 && (
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--primary)" }}>{pct}%</span>
            )}
          </div>
          <div style={{ height: "8px", borderRadius: "999px", background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--primary)", transition: "width .2s" }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
        <button className="btn primary" onClick={() => void handleFullDownload()} disabled={downloading} style={{ padding: "8px 18px" }}>
          {downloading ? <RefreshCw size={14} className="spin" /> : <DownloadCloud size={15} />}
          {downloading ? "Downloading Catalog & Photos…" : "Download Full Catalog & Product Pages (Offline Mode)"}
        </button>
        <button className="btn" onClick={() => void handlePhotosOnlyDownload()} disabled={downloading}>
          <ImageIcon size={14} /> Sync Photos Only
        </button>
        <button className="btn sm danger" onClick={() => void handleClear()} disabled={clearing || downloading}>
          <Trash2 size={13} /> Clear Downloaded Data
        </button>
      </div>

      {/* Offline Capabilities Checklist */}
      <div className="card" style={{ padding: "14px 16px", background: "var(--paper)", border: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 700, fontSize: "13.5px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
          <ShieldCheck size={16} style={{ color: "var(--green)" }} />
          <span>Offline Capabilities on this Device</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px", fontSize: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle2 size={13} style={{ color: "var(--green)" }} />
            <span>POS Billing &amp; Barcode Scanning (No Internet Required)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle2 size={13} style={{ color: "var(--green)" }} />
            <span>Product Detail Pages &amp; AI Specifications Offline</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle2 size={13} style={{ color: "var(--green)" }} />
            <span>Category Invoice Rules &amp; Quotes (Thermal &amp; A4 Print)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle2 size={13} style={{ color: "var(--green)" }} />
            <span>FIFO Stock Batches &amp; Local SQLite Mutation Ledger</span>
          </div>
        </div>
      </div>

      {status && status.photosTotal > 0 && status.photosCached >= status.photosTotal && !downloading && (
        <div className="notice" style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "8px", color: "var(--green)" }}>
          <CheckCircle2 size={15} /> Yeh device poori tarah offline-ready hai — internet chale jaane par bhi app flawlessly chalega.
        </div>
      )}

      {status && !status.serviceWorkerReady && (
        <div className="notice" style={{ marginTop: "14px" }}>
          Offline download service abhi ready nahi hai — page ek baar reload karein, phir "Download Full Catalog" dabayein.
        </div>
      )}
    </div>
  );
};
