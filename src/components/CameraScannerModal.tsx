import { BrowserMultiFormatReader } from "@zxing/browser";
import React, { useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw, Upload, CheckCircle2 } from "lucide-react";
import { useAnimatedClose } from "../hooks/useAnimatedClose";
import {ScanLifecycle} from "../utils/scanLifecycle";

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedText: string) => void;
  title?: string;
}

// Phase 17.6 (DS Mobile usability §8.2): a short, synthesized beep (no
// bundled audio asset needed) + a brief vibration on a genuinely
// successful scan (live camera detection or a decoded uploaded photo —
// NOT the manual-typed-barcode fallback, which the person already knows
// they entered correctly). Best-effort only: some browsers block
// AudioContext before any user gesture, and iOS Safari has no
// navigator.vibrate at all — both are silently ignored rather than
// surfaced as an error, since this is a nice-to-have confirmation, not a
// step the scan flow depends on.
function playScanSuccessFeedback() {
  try {
    if (navigator.vibrate) navigator.vibrate(80);
  } catch {}
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {}
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
  const scanTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const lifecycle=useRef(new ScanLifecycle());
  const callbacks=useRef({onScan,onClose});
  callbacks.current={onScan,onClose};
  const { closing, requestClose, runClosing } = useAnimatedClose(onClose);

  const releaseCamera=()=>{
    if(scanTimer.current!==null){clearTimeout(scanTimer.current);scanTimer.current=null;}
    const stream=streamRef.current;streamRef.current=null;
    stream?.getTracks().forEach(track=>track.stop());
    if(videoRef.current){videoRef.current.pause();videoRef.current.srcObject=null;}
  };
  const complete=(token:number,raw:string,feedback=false)=>{
    const clean=raw.trim();if(!clean||!lifecycle.current.finish(token))return;
    releaseCamera();setCameraActive(false);
    if(feedback)playScanSuccessFeedback();
    callbacks.current.onScan(clean);
    runClosing(()=>callbacks.current.onClose());
  };
  const startCamera=async(deviceId?:string)=>{
    const token=lifecycle.current.begin();
    releaseCamera();setCameraActive(false);setErrorMsg("");
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error("Camera unavailable");
      const constraints:MediaStreamConstraints={video:deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}};
      const stream=await navigator.mediaDevices.getUserMedia(constraints);
      if(!lifecycle.current.isCurrent(token)||!videoRef.current){stream.getTracks().forEach(track=>track.stop());return;}
      streamRef.current=stream;videoRef.current.srcObject=stream;
      await videoRef.current.play();
      if(!lifecycle.current.isCurrent(token))return;
      setCameraActive(true);
      let native:any=null;
      try{if("BarcodeDetector" in window)native=new (window as any).BarcodeDetector({formats:["code_128","code_39","ean_13","ean_8","qr_code","upc_a","upc_e"]});}catch{}
      const decoder=new BrowserMultiFormatReader(),canvas=document.createElement("canvas");
      const loop=async()=>{
        if(!lifecycle.current.isCurrent(token))return;
        const video=videoRef.current;
        if(video&&video.readyState>=2&&video.videoWidth&&video.videoHeight){
          try{
            let raw="";
            if(native){const results=await native.detect(video);raw=results?.[0]?.rawValue||"";}
            else{
              const ratio=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));
              canvas.width=Math.max(1,Math.round(video.videoWidth*ratio));canvas.height=Math.max(1,Math.round(video.videoHeight*ratio));
              const ctx=canvas.getContext("2d",{willReadFrequently:true});if(ctx){ctx.drawImage(video,0,0,canvas.width,canvas.height);raw=decoder.decodeFromCanvas(canvas)?.getText()||"";}
            }
            if(raw)complete(token,raw,true);
          }catch{/* No readable code in this frame. */}
        }
        if(lifecycle.current.isCurrent(token))scanTimer.current=setTimeout(loop,300);
      };
      scanTimer.current=setTimeout(loop,300);
    }catch{
      if(!lifecycle.current.isCurrent(token))return;
      releaseCamera();setCameraActive(false);setErrorMsg("Camera access denied or unavailable. Enter the barcode/IMEI manually or upload a photo.");
    }
  };
  useEffect(()=>{
    if(!isOpen)return;
    let active=true;setManualInput("");
    void navigator.mediaDevices?.enumerateDevices().then(devices=>{
      if(!active)return;const video=devices.filter(d=>d.kind==="videoinput");setCameras(video);
      const preferred=video.find(d=>/back|rear/i.test(d.label))||video[0];setSelectedCameraId(preferred?.deviceId||"");
    }).catch(()=>{});
    void startCamera();
    return()=>{active=false;lifecycle.current.cancel();releaseCamera();};
  },[isOpen]);
  const handleFileUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];e.target.value="";if(!file)return;
    if(!file.type.startsWith("image/")||file.size>12*1024*1024){setErrorMsg("Choose an image up to 12 MB.");return;}
    const token=lifecycle.current.begin();releaseCamera();setCameraActive(false);
    const url=URL.createObjectURL(file);
    try{
      const decoded=await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      const raw=decoded?.getText();if(!raw)throw Error("No barcode");
      complete(token,raw,true);
    }catch{if(lifecycle.current.isCurrent(token))setErrorMsg("No readable barcode found. Upload a clearer photo or enter the code manually.");}
    finally{URL.revokeObjectURL(url);}
  };

  if (!isOpen) return null;

  const handleManualClose=()=>{lifecycle.current.cancel();releaseCamera();setCameraActive(false);requestClose();};

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`modal ${closing ? "closing" : ""}`} style={{ maxWidth: "580px" }}>
        <div className="modal-head">
          <h3>
            <Camera size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            {title}
          </h3>
          <button type="button" aria-label="Close scanner" onClick={handleManualClose}>&times;</button>
        </div>

        {errorMsg && <div role="alert" className="alert amber">{errorMsg}</div>}
        {(
          <div
            style={{
              position: "relative",
              display: errorMsg ? "none" : "block",
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
                    e.preventDefault();
                    complete(lifecycle.current.token,manualInput);
                  }
                }}
              />
              <button
                className="btn primary sm"
                onClick={() => {
                  if (manualInput.trim()) {
                    complete(lifecycle.current.token,manualInput);
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
          {!closing && (
            <button
              className="btn"
              onClick={() => void startCamera(selectedCameraId || undefined)}
              title="Restart video feed"
            >
              <RefreshCw size={14} /> {cameraActive?"Refresh":"Retry camera"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
