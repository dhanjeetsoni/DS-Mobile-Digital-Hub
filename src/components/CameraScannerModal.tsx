import { BrowserMultiFormatReader } from "@zxing/browser";
import React, { useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw, Upload, CheckCircle2 } from "lucide-react";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedText: string) => void;
  title?: string;
}

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = "Live Camera Barcode & QR Scanner",
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [manualInput, setManualInput] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const { closing, requestClose, runClosing } = useAnimatedClose(onClose);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setCameras(videoDevices);
        if (videoDevices.length > 0) {
          // Prefer back/environment camera on phones
          const backCam = videoDevices.find((d) =>
            d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear")
          );
          setSelectedCameraId(backCam ? backCam.deviceId : videoDevices[0].deviceId);
        }
      })
      .catch((err) => console.warn("Could not list video devices", err));

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async (deviceId?: string) => {
    stopCamera();
    setErrorMsg("");
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
        startScanningLoop();
      }
    } catch (err: any) {
      console.warn("Camera start failed:", err);
      setErrorMsg("Camera access denied or unavailable. You can enter the barcode/IMEI manually or upload a photo.");
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    try { zxingReaderRef.current?.reset(); } catch {}
    zxingReaderRef.current = null;
  };

  const startScanningLoop = () => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

    // If native BarcodeDetector is available
    if ("BarcodeDetector" in window) {
      try {
        // @ts-ignore
        const barcodeDetector = new (window as any).BarcodeDetector({
          formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "upc_a", "upc_e"],
        });

        scanIntervalRef.current = setInterval(async () => {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const barcodes = await barcodeDetector.detect(videoRef.current);
              if (barcodes && barcodes.length > 0) {
                const raw = barcodes[0].rawValue;
                if (raw) {
                  onScan(raw);
                  stopCamera();
                  runClosing();
                }
              }
            } catch (e) {
              // Ignore single frame detection errors
            }
          }
        }, 300);
        return;
      } catch (e) {
        console.warn("BarcodeDetector init error", e);
      }
    }

    // Real ZXing fallback for browsers without native BarcodeDetector.
    try {
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;
      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const result = await reader.decodeOnceFromVideoElement(videoRef.current);
          const raw = result?.getText?.();
          if (raw) {
            onScan(raw);
            stopCamera();
            runClosing();
          }
        } catch {
          // No code in this frame is expected; keep scanning.
        }
      }, 250);
    } catch (e) {
      console.error("Barcode decoder fallback unavailable", e);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result as string;
      try {
        const decoder = zxingReaderRef.current || new BrowserMultiFormatReader();
        zxingReaderRef.current = decoder;
        const decoded = await decoder.decodeFromImageUrl(result);
        const raw = decoded?.getText?.();
        if (!raw) throw new Error("No barcode detected");
        onScan(raw);
        runClosing();
      } catch {
        setErrorMsg("No readable barcode found in this image. Upload a clearer barcode photo.");
      }
    };
    reader.readAsDataURL(file);
  };

  if (!isOpen) return null;

  // Manual close (X / Close button) — stop the camera stream immediately
  // rather than waiting for the delayed unmount, then play the exit
  // animation. Scan-success paths above already call stopCamera() of their
  // own accord before runClosing(), so this only matters for the "give up"
  // path.
  const handleManualClose = () => {
    stopCamera();
    requestClose();
  };

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal ${closing ? "closing" : ""}`} style={{ maxWidth: "580px" }}>
        <div className="modal-head">
          <h3>
            <Camera size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            {title}
          </h3>
          <button onClick={handleManualClose}>&times;</button>
        </div>

        {errorMsg ? (
          <div className="alert amber">{errorMsg}</div>
        ) : (
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "4/3",
              background: "#000",
              borderRadius: "10px",
              overflow: "hidden",
              marginBottom: "12px",
            }}
          >
            <video
              ref={videoRef}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              playsInline
              muted
            />

            {/* Target Reticle */}
            <div
              style={{
                position: "absolute",
                inset: "15%",
                border: "2px dashed var(--glow)",
                borderRadius: "12px",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  color: "#fff",
                  fontSize: "12px",
                  background: "rgba(0,0,0,0.7)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
              >
                Center Barcode / IMEI / QR in frame
              </div>
            </div>
          </div>
        )}

        {cameras.length > 1 && (
          <div className="field" style={{ marginBottom: "12px" }}>
            <label>Switch Camera</label>
            <select
              value={selectedCameraId}
              onChange={(e) => {
                setSelectedCameraId(e.target.value);
                startCamera(e.target.value);
              }}
            >
              {cameras.map((c, i) => (
                <option key={c.deviceId || i} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="formgrid">
          <div className="field full">
            <label>Manual Barcode / 15-Digit IMEI Entry</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="Type or paste barcode / IMEI number..."
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualInput.trim()) {
                    onScan(manualInput.trim());
                    stopCamera();
                    runClosing();
                  }
                }}
              />
              <button
                className="btn primary sm"
                onClick={() => {
                  if (manualInput.trim()) {
                    onScan(manualInput.trim());
                    stopCamera();
                    runClosing();
                  }
                }}
              >
                Apply
              </button>
            </div>
          </div>

          <div className="field full" style={{ marginTop: "4px" }}>
            <label>Or Upload Photo from Gallery / Files</label>
            <input type="file" accept="image/*" onChange={handleFileUpload} />
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: "16px" }}>
          <button className="btn" onClick={handleManualClose}>
            Close
          </button>
          {cameraActive && (
            <button
              className="btn"
              onClick={() => startCamera(selectedCameraId)}
              title="Restart video feed"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
