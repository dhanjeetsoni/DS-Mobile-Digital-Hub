import React, { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import {
  requestConfidentialPrice,
  subscribeToConfidentialPriceRequest,
  type ConfidentialPriceRequestRow,
} from "../services/confidentialPrice";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface ConfidentialPriceModalProps {
  productId: string;
  productName: string;
  productCategory?: string;
  requesterName: string;
  onApply: (price: number) => void;
  onClose: () => void;
}

type Phase = "idle" | "sending" | "pending" | "approved" | "denied" | "expired" | "error";

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export const ConfidentialPriceModal: React.FC<ConfidentialPriceModalProps> = ({
  productId,
  productName,
  productCategory,
  requesterName,
  onApply,
  onClose,
}) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [revealedPrice, setRevealedPrice] = useState<number | null>(null);
  const [revealExpiresAt, setRevealExpiresAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const { closing, requestClose, runClosing } = useAnimatedClose(onClose);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  // Live countdown once approved, so staff can see the 5-minute reveal
  // window ticking down instead of it silently going stale.
  useEffect(() => {
    if (phase !== "approved" || !revealExpiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(revealExpiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setPhase("expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, revealExpiresAt]);

  const onRowUpdate = (row: ConfidentialPriceRequestRow) => {
    if (row.status === "approved") {
      setRevealedPrice(row.revealed_price);
      setRevealExpiresAt(row.reveal_expires_at);
      setPhase("approved");
    } else if (row.status === "denied") {
      setPhase("denied");
    } else if (row.status === "expired") {
      setPhase("expired");
    }
  };

  const sendRequest = async () => {
    setPhase("sending");
    setErrorMsg("");
    try {
      const { requestId } = await requestConfidentialPrice(productId, productName, productCategory);
      unsubRef.current = subscribeToConfidentialPriceRequest(requestId, onRowUpdate);
      setPhase("pending");
    } catch (e) {
      setErrorMsg((e as Error)?.message || "Request bhejne mein error aaya.");
      setPhase("error");
    }
  };

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal ${closing ? "closing" : ""}`} style={{ maxWidth: "440px" }}>
        <div className="modal-head">
          <h3>
            <Lock size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            Confidential Price
          </h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <div className="hint">Product</div>
          <div style={{ fontWeight: 700 }}>
            {productName}
            {productCategory ? <span className="hint"> ({productCategory})</span> : null}
          </div>
        </div>

        {phase === "idle" && (
          <>
            <p className="hint" style={{ marginBottom: "14px" }}>
              Owner ko Telegram par ek request jaayegi — <b>{requesterName}</b> is product ka Confidential Price
              dekhna chahte hain. Owner approve karega to price sirf 5 minute ke liye dikhega, permanent nahi.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={requestClose}>Cancel</button>
              <button className="btn primary" onClick={sendRequest}>Owner ko Request Bhejein</button>
            </div>
          </>
        )}

        {phase === "sending" && <div className="empty">Request bheji ja rahi hai...</div>}

        {phase === "pending" && (
          <>
            <div className="alert amber" style={{ marginBottom: "14px" }}>
              ⏳ Owner ke jawab ka wait ho raha hai — unke Telegram par Approve/Deny message ja chuka hai. Yeh
              window khuli rakhiye, jawab aate hi yahan turant dikh jaayega.
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={requestClose}>Band Karein (background mein wait karega)</button>
            </div>
          </>
        )}

        {phase === "approved" && revealedPrice != null && (
          <>
            <div
              className="alert"
              style={{ marginBottom: "14px", background: "var(--green-light, #e8f7ee)", borderColor: "var(--green, #1a9850)" }}
            >
              ✅ Owner ne approve kar diya.
              <div style={{ fontSize: "22px", fontWeight: 800, margin: "8px 0" }}>{inr(revealedPrice)}</div>
              {secondsLeft != null && (
                <div className="hint">
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} minute mein yeh reveal expire ho jaayega
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={requestClose}>Band Karein</button>
              <button
                className="btn primary"
                onClick={() => runClosing(() => { onApply(revealedPrice); onClose(); })}
              >
                Cart Mein Apply Karein
              </button>
            </div>
          </>
        )}

        {phase === "denied" && (
          <>
            <div className="alert red" style={{ marginBottom: "14px" }}>❌ Owner ne is request ko deny kar diya.</div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={requestClose}>Band Karein</button>
            </div>
          </>
        )}

        {phase === "expired" && (
          <>
            <div className="alert amber" style={{ marginBottom: "14px" }}>
              ⌛ Yeh request/reveal expire ho gaya hai. Zaroorat ho to dobara request bhejein.
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={requestClose}>Band Karein</button>
              <button className="btn primary" onClick={sendRequest}>Dobara Request Bhejein</button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="alert red" style={{ marginBottom: "14px" }}>{errorMsg}</div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={requestClose}>Band Karein</button>
              <button className="btn primary" onClick={sendRequest}>Dobara Try Karein</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
