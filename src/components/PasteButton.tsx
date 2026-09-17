import React, { useState } from "react";
import { Clipboard, Check, Sparkles } from "lucide-react";
import { readFromClipboard, cleanImeiOrSerial, cleanIndianPhoneNumber, cleanModelOrText } from "../utils/clipboardHelper";

export interface PasteButtonProps {
  onPaste: (pastedValue: string) => void;
  cleanType?: "imei" | "phone" | "model" | "text";
  label?: string;
  showLabel?: boolean;
  className?: string;
  style?: React.CSSProperties;
  toast?: (msg: string, kind?: "green" | "red" | "amber") => void;
  title?: string;
}

export const PasteButton: React.FC<PasteButtonProps> = ({
  onPaste,
  cleanType = "text",
  label = "Paste",
  showLabel = false,
  className = "btn sm ghost",
  style,
  toast,
  title = "Paste from WhatsApp / Clipboard (1-Click)",
}) => {
  const [justPasted, setJustPasted] = useState(false);

  const handlePasteClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const rawText = await readFromClipboard();
      if (!rawText) {
        if (toast) toast("Clipboard is empty or paste was cancelled", "amber");
        return;
      }

      let processed = rawText;
      if (cleanType === "imei") {
        processed = cleanImeiOrSerial(rawText);
      } else if (cleanType === "phone") {
        processed = cleanIndianPhoneNumber(rawText);
      } else if (cleanType === "model") {
        processed = cleanModelOrText(rawText);
      } else {
        processed = rawText.trim();
      }

      if (!processed) {
        if (toast) toast("Could not extract valid text from clipboard", "amber");
        return;
      }

      onPaste(processed);
      setJustPasted(true);
      setTimeout(() => setJustPasted(false), 1600);

      if (toast) {
        const typeLabel = cleanType === "imei" ? "IMEI/Serial" : cleanType === "phone" ? "Mobile Number" : "Text";
        toast(`📋 Pasted ${typeLabel}: ${processed.length > 20 ? processed.slice(0, 20) + "…" : processed}`, "green");
      }
    } catch (err) {
      console.error("Paste failed:", err);
      if (toast) toast("Paste failed. Please enter manually.", "red");
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handlePasteClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        padding: showLabel ? "4px 8px" : "5px 7px",
        fontSize: "11.5px",
        fontWeight: 600,
        borderRadius: "6px",
        cursor: "pointer",
        color: justPasted ? "var(--green)" : "var(--brand, #0284c7)",
        background: justPasted ? "var(--green-light, #dcfce7)" : "var(--paper, rgba(2, 132, 199, 0.08))",
        border: "1px solid",
        borderColor: justPasted ? "var(--green, #22c55e)" : "var(--line, rgba(2, 132, 199, 0.2))",
        transition: "all 0.15s ease",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {justPasted ? <Check size={13} style={{ color: "var(--green)" }} /> : <Clipboard size={13} />}
      {showLabel && <span>{justPasted ? "Pasted!" : label}</span>}
    </button>
  );
};
