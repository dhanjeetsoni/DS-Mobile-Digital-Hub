import React, { useState, useEffect } from "react";
import { Download, CheckCircle2, HardDrive, RefreshCw, Trash2, Layers, WifiOff, AlertCircle } from "lucide-react";
import {
  getOfflineCatalogMeta,
  downloadFullCatalogForOffline,
  clearOfflineCatalogCache,
  type CatalogDownloadMeta,
} from "../services/offlineCatalogService";

interface OfflineCatalogDownloadProps {
  storeId: string | null;
  onDownloaded?: () => void;
}

export const OfflineCatalogDownload: React.FC<OfflineCatalogDownloadProps> = ({ storeId, onDownloaded }) => {
  const [meta, setMeta] = useState<CatalogDownloadMeta>(() => getOfflineCatalogMeta());
  const [isDownloading, setIsDownloading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setMeta(getOfflineCatalogMeta());
  }, []);

  const handleDownload = async () => {
    if (!storeId) {
      setFeedback({ type: "error", text: "Please sign in to a store before downloading the catalog." });
      return;
    }

    setIsDownloading(true);
    setFeedback(null);
    setProgressPercent(5);
    setProgressMsg("Starting download...");

    const res = await downloadFullCatalogForOffline(storeId, (msg, pct) => {
      setProgressMsg(msg);
      setProgressPercent(pct);
    });

    setIsDownloading(false);
    setMeta(getOfflineCatalogMeta());

    if (res.success) {
      setFeedback({ type: "success", text: res.message });
      onDownloaded?.();
    } else {
      setFeedback({ type: "error", text: res.message });
    }
  };

  const handleClear = () => {
    if (window.confirm("Are you sure you want to remove the local offline catalog cache from this device?")) {
      clearOfflineCatalogCache();
      setMeta(getOfflineCatalogMeta());
      setFeedback({ type: "success", text: "Offline catalog cache cleared from this device." });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 KB";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formattedDate = meta.lastDownloadedAt
    ? new Date(meta.lastDownloadedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className="offline-catalog-download-card"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "16px",
        marginTop: "16px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px", color: "var(--ink)" }}>
            <HardDrive size={18} color="var(--primary)" />
            <span>Offline Catalog &amp; Product Pages Download</span>
          </div>
          <div className="hint" style={{ marginTop: "4px", fontSize: "12px", maxWidth: "600px" }}>
            Naye device ya fresh login par poora product catalog (specifications, stock, photos, AI rules aur details) local storage mein download kar lein, taaki internet band hone par bhi POS aur product lookup 100% offline kaam kare.
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {meta.status === "cached" && (
            <button
              type="button"
              className="btn sm"
              style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--red, #ef4444)" }}
              onClick={handleClear}
              disabled={isDownloading}
              title="Clear cached catalog from this device"
            >
              <Trash2 size={13} />
              Clear
            </button>
          )}

          <button
            type="button"
            className="btn primary sm"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            onClick={handleDownload}
            disabled={isDownloading || !storeId}
          >
            {isDownloading ? (
              <>
                <RefreshCw size={14} className="spin" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download size={14} />
                <span>{meta.status === "cached" ? "Re-sync / Update" : "Download Catalog"}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "10px",
          marginTop: "14px",
          background: "var(--bg)",
          borderRadius: "8px",
          padding: "10px 12px",
          border: "1px solid var(--border)",
        }}
      >
        <div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Offline Readiness</div>
          <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
            {meta.status === "cached" ? (
              <span style={{ color: "var(--green, #10b981)", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Ready Offline
              </span>
            ) : (
              <span style={{ color: "var(--amber, #f59e0b)", display: "flex", alignItems: "center", gap: "4px" }}>
                <WifiOff size={14} /> Not Downloaded
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Cached Products</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", marginTop: "2px" }}>
            {meta.itemCount} items
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Categories</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", marginTop: "2px" }}>
            {meta.categoriesCount} categories
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Last Synced</div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink-soft)", marginTop: "2px" }}>
            {formattedDate || "Never"}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Est. Storage Size</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", marginTop: "2px" }}>
            {formatBytes(meta.sizeBytes)}
          </div>
        </div>
      </div>

      {/* Progress bar while downloading */}
      {isDownloading && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginBottom: "4px", color: "var(--ink-soft)" }}>
            <span>{progressMsg}</span>
            <span>{progressPercent}%</span>
          </div>
          <div style={{ width: "100%", height: "6px", background: "var(--bg)", borderRadius: "3px", overflow: "hidden", border: "1px solid var(--border)" }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                background: "var(--primary)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Feedback banner */}
      {feedback && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "12.5px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: feedback.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: feedback.type === "success" ? "var(--green, #10b981)" : "var(--red, #ef4444)",
            border: `1px solid ${feedback.type === "success" ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
          }}
        >
          {feedback.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
};
