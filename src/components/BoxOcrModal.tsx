import React, { useState, useRef } from "react";
import { Camera, Sparkles, Upload, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { processPhoneOcr, OcrPhoneResult } from "../utils/aiOcr";
import { inr } from "../utils/indianCurrency";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface BoxOcrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyResult: (result: OcrPhoneResult) => void;
  defaultType?: "box" | "about_screen" | "auto";
}

export const BoxOcrModal: React.FC<BoxOcrModalProps> = ({
  isOpen,
  onClose,
  onApplyResult,
  defaultType = "box",
}) => {
  const [scanType, setScanType] = useState<"box" | "about_screen">("box");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [ocrResult, setOcrResult] = useState<OcrPhoneResult | null>(null);
  const [verificationConfirmed, setVerificationConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { closing, requestClose, runClosing } = useAnimatedClose(onClose);

  if (!isOpen) return null;

  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg("");
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setSelectedImage(dataUrl);
      await runAnalysis(dataUrl, scanType);
    };
    reader.readAsDataURL(file);
  };

  const runAnalysis = async (imgData: string, type: "box" | "about_screen") => {
    setIsProcessing(true);
    setErrorMsg("");
    setOcrResult(null);
    setVerificationConfirmed(false);
    try {
      const result = await processPhoneOcr(imgData, type);
      setOcrResult(result);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to analyze photo. Please try again or fill manually.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = () => {
    if (!ocrResult) return;
    if (ocrResult.requiresVerification && !verificationConfirmed) return;
    runClosing(() => {
      onApplyResult(ocrResult);
      onClose();
    });
  };

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`}>
        <div className="modal-head">
          <h3>
            <Sparkles size={18} style={{ color: "var(--glow)", marginRight: "8px", verticalAlign: "middle" }} />
            AI Mobile Box &amp; About-Phone Scanner
          </h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        <div className="tabs" style={{ marginBottom: "14px" }}>
          <button
            className={scanType === "box" ? "active" : ""}
            onClick={() => {
              setScanType("box");
              if (selectedImage) runAnalysis(selectedImage, "box");
            }}
          >
            📦 New Phone Box Sticker
          </button>
          <button
            className={scanType === "about_screen" ? "active" : ""}
            onClick={() => {
              setScanType("about_screen");
              if (selectedImage) runAnalysis(selectedImage, "about_screen");
            }}
          >
            📱 2nd-Hand Phone "About Phone" Screenshot
          </button>
        </div>

        <div className="grid cols-2" style={{ alignItems: "flex-start" }}>
          {/* Left Column: Image Upload & Preview */}
          <div>
            <div
              style={{
                border: "2px dashed var(--line)",
                borderRadius: "12px",
                padding: "20px",
                textAlign: "center",
                background: "var(--card)",
                cursor: "pointer",
                position: "relative",
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedImage ? (
                <div style={{ position: "relative" }}>
                  <img
                    src={selectedImage}
                    alt="Scan Preview"
                    style={{
                      width: "100%",
                      maxHeight: "260px",
                      objectFit: "contain",
                      borderRadius: "8px",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      right: "8px",
                      background: "rgba(0,0,0,0.7)",
                      color: "#fff",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontSize: "11px",
                    }}
                  >
                    Click to change photo
                  </div>
                </div>
              ) : (
                <div style={{ padding: "30px 10px" }}>
                  <Camera size={38} style={{ color: "var(--ink-soft)", marginBottom: "8px" }} />
                  <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>
                    {scanType === "box"
                      ? "Snap / Upload Phone Box Label Photo"
                      : "Snap / Upload 'Settings > About Phone' Screenshot"}
                  </div>
                  <div className="hint">
                    {scanType === "box"
                      ? "AI extracts Model, IMEI 1 & 2, Serial No, Color, RAM/ROM & MRP"
                      : "AI extracts Model Name, IMEI 1 & 2, Android version, Storage & Health"}
                  </div>
                  <button className="btn primary sm" style={{ marginTop: "12px" }}>
                    <Upload size={14} /> Select / Capture Photo
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={handleImageSelected}
              />
            </div>

            {selectedImage && !isProcessing && (
              <button
                className="btn sm"
                style={{ width: "100%", marginTop: "10px" }}
                onClick={() => runAnalysis(selectedImage, scanType)}
              >
                <RefreshCw size={13} /> Re-analyze with AI
              </button>
            )}
          </div>

          {/* Right Column: Extracted Values Preview */}
          <div>
            <div className="section-head">
              <h2 style={{ fontSize: "14px" }}>AI Extracted Information</h2>
              {ocrResult && (
                <span className="badge ok">
                  <CheckCircle2 size={12} /> Ready to Fill
                </span>
              )}
            </div>

            {isProcessing ? (
              <div style={{ textAlign: "center", padding: "40px 10px" }}>
                <Sparkles size={32} style={{ color: "var(--glow)", animation: "spinCheck 1s linear infinite" }} />
                <div style={{ fontWeight: 700, marginTop: "12px", fontSize: "14px" }}>
                  Analyzing photo with Gemini AI Vision...
                </div>
                <div className="hint" style={{ marginTop: "4px" }}>
                  Extracting IMEI 1, IMEI 2, Serial number, Model &amp; Specifications
                </div>
              </div>
            ) : errorMsg ? (
              <div className="alert red">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            ) : ocrResult ? (
              <div style={{ background: "var(--paper)", padding: "14px", borderRadius: "10px" }}>
                <div className="kv">
                  <span>Detected Brand:</span>
                  <b>{ocrResult.brand || "—"}</b>
                </div>
                <div className="kv">
                  <span>Phone Model:</span>
                  <b>{ocrResult.modelName || "—"}</b>
                </div>
                <div className="kv">
                  <span>Primary IMEI 1:</span>
                  <b style={{ color: "var(--blue)" }}>{ocrResult.imei1 || "—"}</b>
                </div>
                {ocrResult.imei2 && (
                  <div className="kv">
                    <span>Secondary IMEI 2:</span>
                    <b>{ocrResult.imei2}</b>
                  </div>
                )}
                {ocrResult.serialNo && (
                  <div className="kv">
                    <span>Serial No (S/N):</span>
                    <b>{ocrResult.serialNo}</b>
                  </div>
                )}
                {ocrResult.ramStorage && (
                  <div className="kv">
                    <span>RAM / Storage:</span>
                    <b>{ocrResult.ramStorage}</b>
                  </div>
                )}
                {ocrResult.color && (
                  <div className="kv">
                    <span>Color:</span>
                    <b>{ocrResult.color}</b>
                  </div>
                )}
                {ocrResult.mrp && ocrResult.mrp > 0 ? (
                  <div className="kv">
                    <span>Box MRP:</span>
                    <b>{inr(ocrResult.mrp)}</b>
                  </div>
                ) : null}
                {ocrResult.androidVersion && (
                  <div className="kv">
                    <span>OS / Software:</span>
                    <b>{ocrResult.androidVersion}</b>
                  </div>
                )}
                {ocrResult.batteryHealth && (
                  <div className="kv">
                    <span>Battery Status:</span>
                    <b>{ocrResult.batteryHealth}</b>
                  </div>
                )}
                <div className="kv">
                  <span>Category:</span>
                  <span className="badge ok">{ocrResult.detectedCategory}</span>
                </div>
              </div>
            ) : (
              <div className="empty">
                Upload or capture a photo on the left to see automatically extracted details here.
              </div>
            )}
          </div>
        </div>

        {ocrResult?.requiresVerification && (
          <div className="warning" style={{ marginTop: "14px" }}>
            <b>AI/OCR verification required.</b>
            {ocrResult.mismatches?.length
              ? ` Mismatch fields: ${ocrResult.mismatches.join(", ")}.`
              : " Review every extracted field against the image before saving."}
            <label style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={verificationConfirmed}
                onChange={(e) => setVerificationConfirmed(e.target.checked)}
              />
              I verified the extracted values against the image.
            </label>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: "16px" }}>
          <button className="btn" onClick={requestClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ocrResult || isProcessing || (ocrResult.requiresVerification && !verificationConfirmed)} onClick={handleApply}>
            <CheckCircle2 size={14} /> Auto-Fill Form with Extracted Data
          </button>
        </div>
      </div>
    </div>
  );
};
