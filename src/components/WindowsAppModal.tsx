import React, { useState } from "react";
import {
  Monitor,
  Download,
  Terminal,
  Zap,
  CheckCircle2,
  ExternalLink,
  Laptop,
  HelpCircle,
  Sparkles,
  ShieldCheck,
  FolderDown,
  Cpu,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Database } from "../types";
import { exportStandaloneHtml } from "../utils/exportStandaloneHtml";
import {
  downloadWindowsSetupInstaller,
  downloadElectronWindowsSource,
} from "../utils/windowsInstallerGenerator";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface WindowsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: Database;
  deferredPrompt: any;
  onTriggerInstall: () => void;
}

export const WindowsAppModal: React.FC<WindowsAppModalProps> = ({
  isOpen,
  onClose,
  db,
  deferredPrompt,
  onTriggerInstall,
}) => {
  const [activeTab, setActiveTab] = useState<"install" | "shortcuts" | "electron">("install");
  const [installerSuccess, setInstallerSuccess] = useState(false);
  const [electronSuccess, setElectronSuccess] = useState(false);
  const { closing, requestClose } = useAnimatedClose(onClose);

  if (!isOpen) return null;

  const isWindowsOS =
    typeof navigator !== "undefined" &&
    (navigator.userAgent.includes("Windows") || navigator.platform.includes("Win"));

  const handleDownloadSetup = () => {
    downloadWindowsSetupInstaller(db);
    setInstallerSuccess(true);
    setTimeout(() => setInstallerSuccess(false), 5000);
  };

  const handleDownloadElectron = () => {
    downloadElectronWindowsSource(db);
    setElectronSuccess(true);
    setTimeout(() => setElectronSuccess(false), 5000);
  };

  const SHORTCUTS = [
    { key: "F2", action: "POS / New Sale", color: "var(--blue)" },
    { key: "F3", action: "Tempered Glass & Back Cover Finder", color: "var(--navy)" },
    { key: "F4", action: "Quick Camera Barcode & AI Box Scan (/ )", color: "var(--purple)" },
    { key: "F6", action: "1-Tap Xerox & Cyber Services", color: "var(--green)" },
    { key: "F7", action: "2nd-Hand Buyback KYC (  /)", color: "var(--navy)" },
    { key: "F8", action: "New Repair / Service Job", color: "var(--purple)" },
    { key: "F9", action: "Daily Galla Closing", color: "var(--amber)" },
    { key: "Ctrl + P", action: "Print Current Invoice / Document", color: "var(--ink-soft)" },
    { key: "Esc", action: "Close Active Popup / Dialog", color: "var(--red)" },
  ];

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`} style={{ zIndex: 110 }}>
      <div className={`modal wide ${closing ? "closing" : ""}`} style={{ maxWidth: "880px" }}>
        {/* Header */}
        <div className="modal-head" style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #0284c7, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
              }}
            >
              <Monitor size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800 }}>
                  Windows Desktop Application Setup &amp; Installation
                </h3>
                {isWindowsOS && (
                  <span
                    style={{
                      background: "var(--green-light)",
                      color: "var(--green)",
                      border: "1px solid var(--green-border)",
                      fontSize: "10px",
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: "999px",
                    }}
                  >
                    ✔ Windows PC Detected
                  </span>
                )}
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--ink-soft)" }}>
                Install and run {db.settings.shopName || "DS Mobile"} directly on your Windows PC as a dedicated desktop software
              </p>
            </div>
          </div>
          <button onClick={requestClose} style={{ fontSize: "24px" }}>
            &times;
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "1px solid var(--line)",
            marginBottom: "16px",
            paddingBottom: "8px",
          }}
        >
          <button
            className={`btn sm ${activeTab === "install" ? "primary" : ""}`}
            onClick={() => setActiveTab("install")}
            style={{ fontWeight: 700 }}
          >
            <Zap size={14} /> 1. Windows Installation Options
          </button>
          <button
            className={`btn sm ${activeTab === "shortcuts" ? "primary" : ""}`}
            onClick={() => setActiveTab("shortcuts")}
            style={{ fontWeight: 700 }}
          >
            <Terminal size={14} /> 2. Keyboard Shortcuts
          </button>
          <button
            className={`btn sm ${activeTab === "electron" ? "primary" : ""}`}
            onClick={() => setActiveTab("electron")}
            style={{ fontWeight: 700 }}
          >
            <Cpu size={14} /> 3. .EXE Installer Builder
          </button>
        </div>

        <div style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: "4px" }}>
          {activeTab === "install" && (
            <div>
              {/* Top Highlight Banner */}
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(2, 132, 199, 0.08))",
                  border: "1.5px solid var(--blue-border)",
                  borderRadius: "12px",
                  padding: "14px 18px",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: "14px", color: "var(--navy)", marginBottom: "4px" }}>
                    🚀 Direct Windows Application Mode (Direct Native Install)
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--ink-soft)", lineHeight: 1.4 }}>
                    The PWA can be installed from Chrome or Edge. Native .EXE packaging is provided separately by the desktop build.
                  </div>
                </div>
                <button
                  className="btn primary"
                  style={{
                    padding: "10px 18px",
                    fontSize: "13px",
                    fontWeight: 800,
                    flexShrink: 0,
                    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
                  }}
                  onClick={onTriggerInstall}
                >
                  <Zap size={16} /> 1-Click Install App
                </button>
              </div>

              {/* 3 Installation Methods Cards */}
              <div className="grid cols-3" style={{ gap: "14px", marginBottom: "18px" }}>
                {/* Method 1: Native Windows PWA */}
                <div
                  className="card"
                  style={{
                    background: "var(--card)",
                    border: "1.5px solid var(--line)",
                    borderRadius: "12px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "16px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontSize: "24px" }}>💻</span>
                      <span
                        style={{
                          background: "var(--green-light)",
                          color: "var(--green)",
                          border: "1px solid var(--green-border)",
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "10.5px",
                          fontWeight: 800,
                        }}
                      >
                        BEST &amp; EASIEST
                      </span>
                    </div>
                    <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
                      Method A: Browser App Install
                    </h4>
                    <p style={{ fontSize: "12px", color: "var(--ink-soft)", margin: 0, lineHeight: 1.45 }}>
                      Click the <b>(⊕ App Install)</b> icon in the address bar, or use the button below to pin the PWA.
                    </p>
                  </div>

                  <div style={{ marginTop: "16px" }}>
                    <button
                      className="btn primary"
                      style={{ width: "100%", justifyContent: "center", padding: "9px", fontSize: "12.5px" }}
                      onClick={onTriggerInstall}
                    >
                      <Sparkles size={14} /> Install on Windows
                    </button>
                  </div>
                </div>

                {/* Method 2: Windows Setup Installer (.bat) */}
                <div
                  className="card"
                  style={{
                    background: "var(--card)",
                    border: "1.5px solid var(--line)",
                    borderRadius: "12px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "16px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontSize: "24px" }}>⚙️</span>
                      <span
                        style={{
                          background: "var(--blue-light)",
                          color: "var(--blue)",
                          border: "1px solid var(--blue-border)",
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "10.5px",
                          fontWeight: 800,
                        }}
                      >
                        AUTO SHORTCUT
                      </span>
                    </div>
                    <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
                      Method B: Windows Setup Wizard
                    </h4>
                    <p style={{ fontSize: "12px", color: "var(--ink-soft)", margin: 0, lineHeight: 1.45 }}>
                      The legacy setup script is retained for compatibility. It is not a native Windows executable.
                    </p>
                  </div>

                  <div style={{ marginTop: "16px" }}>
                    <button
                      className="btn"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "9px",
                        fontSize: "12.5px",
                        fontWeight: 700,
                        background: "var(--paper)",
                      }}
                      onClick={handleDownloadSetup}
                    >
                      <Download size={14} /> Download Legacy Setup Script
                    </button>
                    {installerSuccess && (
                      <div style={{ fontSize: "11px", color: "var(--green)", marginTop: "4px", textAlign: "center", fontWeight: 700 }}>
                        ✔ Installer Downloaded! Double click to install.
                      </div>
                    )}
                  </div>
                </div>

                {/* Method 3: 100% Offline Standalone HTML File */}
                <div
                  className="card"
                  style={{
                    background: "var(--card)",
                    border: "1.5px solid var(--line)",
                    borderRadius: "12px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "16px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontSize: "24px" }}>💾</span>
                      <span
                        style={{
                          background: "var(--purple-light)",
                          color: "var(--purple)",
                          border: "1px solid var(--purple)",
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "10.5px",
                          fontWeight: 800,
                        }}
                      >
                        PORTABLE / PENDRIVE
                      </span>
                    </div>
                    <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
                      Method C: Portable Offline File
                    </h4>
                    <p style={{ fontSize: "12px", color: "var(--ink-soft)", margin: 0, lineHeight: 1.45 }}>
                      A single-file offline edition that can run on a Windows PC without a network connection.
                    </p>
                  </div>

                  <div style={{ marginTop: "16px" }}>
                    <button
                      className="btn"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "9px",
                        fontSize: "12.5px",
                        fontWeight: 700,
                        background: "var(--paper)",
                      }}
                      onClick={() => exportStandaloneHtml(db)}
                    >
                      <FolderDown size={14} /> Export Portable .HTML
                    </button>
                  </div>
                </div>
              </div>

              {/* Step-by-Step Installation Guide */}
              <div
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "16px 20px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <Laptop size={18} color="var(--accent)" />
                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
                    📖 Windows Step-by-Step Installation Guide (Windows 10 / 11 / 7)
                  </h4>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "12px", color: "var(--ink)" }}>
                  <div style={{ background: "var(--card)", padding: "12px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <div style={{ fontWeight: 800, color: "var(--navy)", marginBottom: "4px" }}>
                      1. Microsoft Edge / Google Chrome Se Install Kaise Karein:
                    </div>
                    <ol style={{ margin: "0 0 0 16px", padding: 0, lineHeight: 1.5, color: "var(--ink-soft)" }}>
                      <li>Open the browser top-right three-dot menu (<b>⋮</b> or <b>⋯</b>).</li>
                      <li><b>"Apps"</b> ya <b>"Save and Share"</b> par hover karein.</li>
                      <li><b>"Install {db.settings.shopName || "DS Mobile"}"</b> select karein.</li>
                      <li>"Pin to taskbar" aur "Create Desktop shortcut" par tick lagayein.</li>
                    </ol>
                  </div>

                  <div style={{ background: "var(--card)", padding: "12px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <div style={{ fontWeight: 800, color: "var(--navy)", marginBottom: "4px" }}>
                      2. Legacy Windows setup script:
                    </div>
                    <ol style={{ margin: "0 0 0 16px", padding: 0, lineHeight: 1.5, color: "var(--ink-soft)" }}>
                      <li>Upar diye gaye <b>"Download Legacy Setup Script"</b> button par click karein.</li>
                      <li>Open the Downloads folder and <b>Install-...-Setup.bat</b> and double-click it.</li>
                      <li>Ye script turant aapke Desktop par Application Icon bana degi.</li>
                      <li>You can then launch the installed shortcut.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div>
              <div className="section-head" style={{ marginBottom: "12px" }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: "var(--ink)" }}>
                    ⚡ High-Speed Counter Keyboard Shortcuts (F2 - F9)
                  </h4>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--ink-soft)" }}>
                    Aap counter par bina mouse touch kiye direct keyboard se pura billing aur management run it:
                  </p>
                </div>
              </div>

              <div className="grid cols-3" style={{ gap: "10px", marginBottom: "16px" }}>
                {SHORTCUTS.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--line)",
                      borderRadius: "8px",
                      padding: "10px 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ fontSize: "12.5px", color: "var(--ink)", fontWeight: 600 }}>
                      {s.action}
                    </div>
                    <span
                      style={{
                        background: "var(--paper)",
                        border: "1.5px solid var(--line)",
                        color: s.color,
                        boxShadow: "0 2px 0 var(--line)",
                        padding: "3px 10px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "13px",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                        marginLeft: "8px",
                      }}
                    >
                      {s.key}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  background: "var(--blue-light)",
                  border: "1px solid var(--blue-border)",
                  borderRadius: "10px",
                  padding: "12px 16px",
                  fontSize: "12px",
                  color: "var(--ink)",
                }}
              >
                💡 <b>Counter Tip:</b> Press <b>F2</b> for a new bill and <b>Esc</b> to close the active dialog.
              </div>
            </div>
          )}

          {activeTab === "electron" && (
            <div>
              <div
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "16px 20px",
                  marginBottom: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <Cpu size={20} color="var(--accent)" />
                  <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: "var(--ink)" }}>
                    📦 Electron Windows .EXE Source Package (For Developers / Advanced Setup)
                  </h4>
                </div>
                <p style={{ fontSize: "12.5px", color: "var(--ink-soft)", margin: "0 0 12px", lineHeight: 1.5 }}>
                  For a true standalone <b>.EXE</b>, use the included native desktop build configuration rather than the legacy browser launcher.
                </p>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button className="btn primary" onClick={handleDownloadElectron}>
                    <Download size={15} /> Download Legacy Windows Builder Source (.txt/.bat)
                  </button>
                </div>

                {electronSuccess && (
                  <div style={{ fontSize: "12px", color: "var(--green)", marginTop: "8px", fontWeight: 700 }}>
                    ✔ Electron Source package downloaded! Open file for full build instructions.
                  </div>
                )}
              </div>

              <div
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  padding: "14px 18px",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--ink)",
                  lineHeight: 1.6,
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--navy)", marginBottom: "6px", fontFamily: "var(--font)" }}>
                  Commands to Build .EXE on your PC:
                </div>
                <div>1. npm install</div>
                <div>2. npm start &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (Runs Windows App in Dev Mode)</div>
                <div>3. npm run dist &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (Builds DS-Mobile-Setup-1.0.0.exe in /dist folder)</div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className="modal-actions"
          style={{
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid var(--line-light)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "11.5px", color: "var(--ink-soft)" }}>
            Need help? Keyboard shortcuts: <b>F2 (Sale)</b>, <b>F6 (Xerox)</b>, <b>F9 (Galla)</b>
          </div>
          <button className="btn primary" onClick={requestClose}>
            Done / Close ()
          </button>
        </div>
      </div>
    </div>
  );
};
