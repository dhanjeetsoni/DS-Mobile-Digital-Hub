import React, { useState, useEffect } from "react";
import {
  Wifi,
  WifiOff,
  Cloud,
  CloudOff,
  RefreshCw,
  Database as DbIcon,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { supabase } from "../services/supabaseClient";

interface OfflineSyncCenterViewProps {
  db: Database;
  isOnline: boolean;
  cloudStatus: string;
  onSyncNow?: () => Promise<{processed:number;failed:number}>;
  canManageRecovery?: boolean;
  onUpdateDb: (updater: (prev: Database) => Database) => void;
}

export const OfflineSyncCenterView: React.FC<OfflineSyncCenterViewProps> = ({
  db,
  isOnline,
  cloudStatus,
  onSyncNow,
  canManageRecovery=false,
  onUpdateDb,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>("Not checked yet");
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [dbSizeKb, setDbSizeKb] = useState<number>(0);
  const [recovery,setRecovery]=useState<any>(null);
  const [recoveryError,setRecoveryError]=useState("");
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const refreshRecovery=async()=>{if(!canManageRecovery||!isOnline)return;const {data,error}=await supabase.rpc("get_shop_recovery_status");if(error){setRecoveryError(error.message);return;}setRecovery(data);setRecoveryError("");};
  useEffect(()=>{void refreshRecovery();},[canManageRecovery,isOnline]);
  const checkpoint=async()=>{setRecoveryBusy(true);try{const {data,error}=await supabase.rpc("create_shop_checkpoint");if(error||data?.ok!==true)throw new Error(error?.message||"Backup verification failed");await refreshRecovery();}catch(e){setRecoveryError(e instanceof Error?e.message:"Checkpoint failed");}finally{setRecoveryBusy(false);}};

  // Compute local database size
  useEffect(() => {
    try {
      const json = JSON.stringify(db);
      const kb = Math.round(new Blob([json]).size / 1024);
      setDbSizeKb(kb);
    } catch {
      setDbSizeKb(0);
    }
  }, [db]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncMessage("Syncing local records with Cloud...");
    try {
      if(!isOnline||!onSyncNow)throw new Error("Cloud sync is not available");
      const result=await onSyncNow();
      setLastSyncTime(new Date().toLocaleTimeString());
      setSyncMessage(result.failed?result.processed+" operations uploaded; "+result.failed+" need retry/review.":result.processed+" queued operations processed. Snapshot and conflict status are shown separately.");
      await refreshRecovery();
    } catch (err) {
      setSyncMessage("Sync unavailable or failed. Pending data has not been confirmed uploaded.");
    } finally {
      setIsSyncing(false);
    }
  };

  // Export full local snapshot backup
  const handleExportBackup = () => {
    if(!window.confirm("This local backup contains private business data. Keep it securely; it is not a complete server backup. Continue?"))return;
    const dataStr = URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:"application/json"}));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `DS_Mobile_Hub_Backup_${new Date().toISOString().split("T")[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(()=>URL.revokeObjectURL(dataStr),1000);
  };

  return (
    <div style={{ padding: "12px", maxWidth: "100%", margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          background: isOnline
            ? "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))"
            : "linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(239, 68, 68, 0.15))",
          border: `1px solid ${isOnline ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
          borderRadius: "16px",
          padding: "16px",
          marginBottom: "16px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {isOnline ? <Wifi size={24} color="#10b981" /> : <WifiOff size={24} color="#f59e0b" />}
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--text, #f8fafc)" }}>
              Offline & Cloud Sync Center
            </h2>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", margin: "4px 0 0 0" }}>
            {isOnline
              ? "Network available. Check cloud status and pending operations below."
              : "Offline Mode Active: Internet band hone par bhi billing aur Xerox full speed me chalega."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            className="btn primary"
            onClick={handleManualSync}
            disabled={isSyncing}
            style={{
              fontSize: "12px",
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RefreshCw size={14} className={isSyncing ? "spin" : ""} />
            <span>{isSyncing ? "Syncing..." : "Sync Cloud Now"}</span>
          </button>
          <button
            className="btn"
            onClick={handleExportBackup}
            style={{
              fontSize: "12px",
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Download size={14} />
            <span>Download Local Backup</span>
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncMessage && (
        <div
          style={{
            background: "rgba(16, 185, 129, 0.12)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "12px",
            padding: "12px 14px",
            marginBottom: "16px",
            fontSize: "12px",
            color: "#34d399",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <CheckCircle2 size={16} />
          <span>{syncMessage}</span>
        </div>
      )}

      {/* Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", fontWeight: 600 }}>
            CONNECTION STATUS
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: isOnline ? "#34d399" : "#fbbf24",
              marginTop: "4px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: isOnline ? "#10b981" : "#f59e0b",
              }}
            />
            {isOnline ? "Online (Live)" : "Offline (Local)"}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            {cloudStatus || "IndexedDB Active"}
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", fontWeight: 600 }}>
            LOCAL DB SIZE
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#60a5fa", marginTop: "4px" }}>
            {dbSizeKb} KB
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Local snapshot size (not encrypted by this export)
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-card, rgba(255,255,255,0.04))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "14px",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", fontWeight: 600 }}>
            LAST SYNC TIME
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text, #f8fafc)", marginTop: "4px" }}>
            {lastSyncTime}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted, #64748b)", marginTop: "2px" }}>
            Last manual queue check
          </div>
        </div>
      </div>

      {canManageRecovery && <div style={{border:"1px solid var(--border,#64748b)",borderRadius:12,padding:16,marginBottom:16}}>
        <h3 style={{marginTop:0}}>Server backup & integrity</h3>
        <p>Private database checkpoint, not an off-site or photo-file backup. Restore/reset requires operator maintenance.</p>
        {recoveryError&&<p role="alert">{recoveryError}</p>}
        {recovery&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:12}}>
          <div>Last checkpoint: {recovery.backup?new Date(recovery.backup.createdAt).toLocaleString():"None"}</div>
          <div>Checksum: {recovery.backup?.verified?"Verified":"Not verified"}</div>
          <div>FIFO mismatches: {recovery.fifoMismatches}</div>
          <div>Unknown sale cost lines: {recovery.unknownCostLines}</div>
          <div>Pending cloud operations: {recovery.pendingOperations}</div>
          <div>Abandoned operations: {recovery.abandonedOperations}</div>
          <div>Telegram pending/failed: {recovery.pendingMessages}</div>
        </div>}
        <button className="btn primary" disabled={!isOnline||recoveryBusy} onClick={checkpoint}>{recoveryBusy?"Creating checkpoint...":"Create verified server checkpoint"}</button>{" "}
        <button className="btn" disabled={!isOnline||recoveryBusy} onClick={()=>void refreshRecovery()}>Refresh integrity status</button>
        <p style={{fontSize:12}}>A checkpoint created in the last 30 minutes is reused. No data is deleted.</p>
      </div>}

      {/* Persistence Architecture Highlights */}
      <div
        style={{
          background: "var(--bg-card, rgba(255,255,255,0.03))",
          border: "1px solid var(--border, rgba(255,255,255,0.08))",
          borderRadius: "14px",
          padding: "16px",
        }}
      >
        <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "var(--text, #f8fafc)" }}>
          🛡️ Dual-Storage Redundancy Architecture
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          <div
            style={{
              padding: "12px",
              background: "rgba(59, 130, 246, 0.06)",
              borderRadius: "10px",
              border: "1px solid rgba(59, 130, 246, 0.15)",
            }}
          >
            <div style={{ fontWeight: 600, color: "#60a5fa", fontSize: "13px", marginBottom: "4px" }}>
              1. Zero-Lag Local Engine
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", lineHeight: 1.4 }}>
              Device par local snapshot aur pending operation recovery maintained hai.
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              background: "rgba(16, 185, 129, 0.06)",
              borderRadius: "10px",
              border: "1px solid rgba(16, 185, 129, 0.15)",
            }}
          >
            <div style={{ fontWeight: 600, color: "#34d399", fontSize: "13px", marginBottom: "4px" }}>
              2. Background Cloud Sync
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", lineHeight: 1.4 }}>
              Internet available hote hi background thread safe auto-sync karta hai bina counter screen freeze kiye.
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              background: "rgba(245, 158, 11, 0.06)",
              borderRadius: "10px",
              border: "1px solid rgba(245, 158, 11, 0.15)",
            }}
          >
            <div style={{ fontWeight: 600, color: "#fbbf24", fontSize: "13px", marginBottom: "4px" }}>
              3. Offline Queue & Retry
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", lineHeight: 1.4 }}>
              Account-scoped queued operations reconnect par retry hote hain; conflicts review ke liye preserve hote hain.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
