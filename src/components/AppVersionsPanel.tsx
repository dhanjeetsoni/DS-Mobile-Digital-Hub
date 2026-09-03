import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Rocket, UploadCloud } from "lucide-react";
import {
  APP_PLATFORMS,
  AppPlatform,
  AppVersionRow,
  PLATFORM_LABELS,
  listAppVersions,
  publishAppVersion,
  setAppVersionLive,
} from "../services/appVersion";
import { r2PublicUrl } from "../services/r2Client";

// STEP 12.3 — Owner's "App Versions" Panel (Status Dashboard's sibling
// screen, same "⚙️ System" nav group). Two-step flow exactly as the plan
// describes: upload a build (creates a not-yet-live row) → separately
// press "Make this version Live" on it once you're happy with it.

interface AppVersionsPanelProps {
  storeId: string | null | undefined;
  // While the cloud profile/store is still being confirmed, storeId is
  // briefly null even for a signed-in user — without this flag the panel
  // rendered "Store abhi set nahi hua" on every load for a split second
  // (and indefinitely if the profile fetch itself was failing, e.g. the
  // profiles RLS recursion bug). See StaffAccessView's storeLoading for
  // the same pattern.
  storeLoading?: boolean;
  toast: (msg: string, color?: string) => void;
}

const CONTENT_TYPE_BY_PLATFORM: Record<AppPlatform, string> = {
  windows: "application/octet-stream", // .exe/.msi/.msix installer
  "staff-android": "application/vnd.android.package-archive",
  "owner-android": "application/vnd.android.package-archive",
};

export const AppVersionsPanel: React.FC<AppVersionsPanelProps> = ({ storeId, storeLoading, toast }) => {
  const [rows, setRows] = useState<AppVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [platform, setPlatform] = useState<AppPlatform>("windows");
  const [version, setVersion] = useState("");
  const [buildNumber, setBuildNumber] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [signature, setSignature] = useState("");
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setRows(await listAppVersions());
    } catch (e) {
      toast(e instanceof Error ? e.message : "App versions load nahi ho paayi.", "red");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePublish = async () => {
    if (!storeId) return toast("Store abhi set nahi hua.", "red");
    if (!file) return toast("Pehle installer/APK file choose karo.", "red");
    if (!version.trim()) return toast("Version number daalo (jaise 1.4.0).", "red");
    const build = Number(buildNumber);
    if (!build || build < 1) return toast("Build number ek positive number hona chahiye (jaise 14).", "red");

    setUploading(true);
    try {
      await publishAppVersion({
        storeId,
        platform,
        version: version.trim(),
        buildNumber: build,
        file,
        filename: `${platform}-v${version.trim()}-b${build}-${Date.now()}-${file.name}`,
        contentType: file.type || CONTENT_TYPE_BY_PLATFORM[platform],
        signature: signature.trim() || undefined,
        releaseNotes: releaseNotes.trim() || undefined,
      });
      toast("Build upload ho gaya — ab list mein 'Make Live' dabao jab bhej dena ho.", "green");
      setVersion("");
      setBuildNumber("");
      setReleaseNotes("");
      setSignature("");
      setFile(null);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload fail ho gaya.", "red");
    } finally {
      setUploading(false);
    }
  };

  const handleMakeLive = async (row: AppVersionRow) => {
    setBusyId(row.id);
    try {
      await setAppVersionLive(row.id);
      toast(`v${row.version} ab ${PLATFORM_LABELS[row.platform]} ke saare devices ko milega.`, "green");
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Live karne mein error aayi.", "red");
    } finally {
      setBusyId(null);
    }
  };

  if (storeLoading) {
    return (
      <div className="section">
        <h2>App Versions</h2>
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--ink-soft)", marginTop: 12 }}>
          <Loader2 size={18} className="spin" style={{ marginBottom: 8 }} /><br />
          Store status check ho raha hai…
        </div>
      </div>
    );
  }

  if (!storeId) {
    return (
      <div className="section">
        <h2>App Versions</h2>
        <div className="notice" style={{ marginTop: 12 }}>Store abhi set nahi hua — Cloud &amp; Security se pehle sign in karo.</div>
      </div>
    );
  }

  const liveByPlatform = new Map<AppPlatform, AppVersionRow>(rows.filter((r) => r.isLive).map((r) => [r.platform, r] as [AppPlatform, AppVersionRow]));

  return (
    <div className="section">
      <div className="section-head">
        <h2><Rocket size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />App Versions ({rows.length})</h2>
        <button className="btn sm" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 size={14} className="spin" /> : null} Refresh
        </button>
      </div>

      <div className="notice" style={{ marginTop: 4, marginBottom: 12 }}>
        Naya build yahan upload karo, phir jab devices tak bhejna ho tab uski row par "Make Live" dabao — upload
        karte hi kisi ke phone/PC par kuch nahi badalta jab tak "Make Live" na dabao. Purane version ko dobara
        "Make Live" karke turant rollback bhi kar sakte ho.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
        {APP_PLATFORMS.map((p) => {
          const live = liveByPlatform.get(p);
          return (
            <div key={p} className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{PLATFORM_LABELS[p]}</div>
              {live ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--green)", fontWeight: 700 }}>
                  <CheckCircle2 size={14} /> v{live.version} (build {live.buildNumber}) — Live
                </div>
              ) : (
                <div className="hint">Abhi tak koi version publish/live nahi hai.</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}><UploadCloud size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Naya Build Upload Karo</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label>
            Platform
            <select value={platform} onChange={(e) => setPlatform(e.target.value as AppPlatform)}>
              {APP_PLATFORMS.map((p) => (
                <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label>
            Version (jaise 1.4.0)
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.4.0" />
          </label>
          <label>
            Build Number (jaise 14)
            <input value={buildNumber} onChange={(e) => setBuildNumber(e.target.value)} placeholder="14" type="number" min={1} />
          </label>
          <label>
            Installer / APK File
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} accept={platform === "windows" ? ".exe,.msi,.msix" : ".apk"} />
          </label>
        </div>
        <label style={{ display: "block", marginTop: 10 }}>
          Release Notes (optional — devices ko is baar kya naya mila dikhega)
          <textarea value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} rows={2} />
        </label>
        {platform === "windows" && (
          <label style={{ display: "block", marginTop: 10 }}>
            Tauri Updater Signature (optional — `tauri signer sign` se mila .sig content, sirf Windows silent-update ke liye)
            <textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={2} />
          </label>
        )}
        <button className="btn primary sm" style={{ marginTop: 12 }} onClick={handlePublish} disabled={uploading}>
          {uploading ? <Loader2 size={14} className="spin" /> : <UploadCloud size={14} />} Upload
        </button>
      </div>

      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Version</th>
                <th>Build</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{PLATFORM_LABELS[r.platform]}</td>
                  <td><b>v{r.version}</b></td>
                  <td className="hint">{r.buildNumber}</td>
                  <td className="hint">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                  <td>
                    {r.isLive ? (
                      <span style={{ color: "var(--green)", fontWeight: 700 }}>● Live</span>
                    ) : (
                      <span className="hint">Not live</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <a className="btn sm" href={r2PublicUrl("app", r.downloadPath)} target="_blank" rel="noreferrer">Download</a>
                      {!r.isLive && (
                        <button className="btn sm primary" onClick={() => handleMakeLive(r)} disabled={busyId === r.id}>
                          {busyId === r.id ? <Loader2 size={12} className="spin" /> : <Rocket size={12} />} Make Live
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
