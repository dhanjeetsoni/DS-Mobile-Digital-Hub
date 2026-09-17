// WhatsApp Message Preview Bubble Component
// Simulates an authentic WhatsApp chat interface showing exactly what the customer will receive

import React, { useState } from "react";
import { MessageCircle, Send, Copy, Check, CheckCheck, Smartphone } from "lucide-react";
import { openWhatsApp } from "../services/whatsapp";

interface WhatsAppPreviewBubbleProps {
  recipientPhone: string;
  recipientName?: string;
  messageText: string;
  shopName?: string;
  onSent?: () => void;
  toast?: (msg: string, kind?: string) => void;
  style?: React.CSSProperties;
}

export const WhatsAppPreviewBubble: React.FC<WhatsAppPreviewBubbleProps> = ({
  recipientPhone,
  recipientName = "Customer",
  messageText,
  shopName = "DS Mobile Hub",
  onSent,
  toast,
  style = {},
}) => {
  const [copied, setCopied] = useState(false);
  const currentTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(messageText);
        setCopied(true);
        if (toast) toast("Message copied to clipboard!", "green");
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      if (toast) toast("Failed to copy", "red");
    }
  };

  const handleSend = () => {
    if (!recipientPhone) {
      if (toast) toast("Customer phone number is missing", "red");
      return;
    }
    const ok = openWhatsApp(recipientPhone, messageText);
    if (ok) {
      if (toast) toast(`Opening WhatsApp for ${recipientName}...`, "green");
      if (onSent) onSent();
    } else {
      if (toast) toast("Could not launch WhatsApp", "red");
    }
  };

  return (
    <div
      className="whatsapp-preview-card"
      style={{
        background: "#075e54",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 4px 14px rgba(0, 0, 0, 0.15)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        ...style,
      }}
    >
      {/* WhatsApp App Bar */}
      <div
        style={{
          background: "#075e54",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#ffffff",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              background: "#128c7e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontWeight: 800,
              fontSize: "14px",
            }}
          >
            {recipientName ? recipientName[0].toUpperCase() : "C"}
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.2 }}>
              {recipientName} ({recipientPhone || "No Phone"})
            </div>
            <div style={{ fontSize: "10.5px", color: "#a7f3d0", opacity: 0.9 }}>
              💬 Preview • Sending from {shopName}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="btn sm"
            onClick={handleCopy}
            title="Copy WhatsApp Message"
            style={{
              background: "rgba(255, 255, 255, 0.15)",
              color: "#ffffff",
              border: "none",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {/* Chat Wallpaper Canvas */}
      <div
        style={{
          background: "#efeae2",
          backgroundImage: "radial-gradient(#d1d7db 1px, transparent 1px)",
          backgroundSize: "16px 16px",
          padding: "14px",
        }}
      >
        {/* Outgoing Message Bubble */}
        <div
          style={{
            maxWidth: "92%",
            marginLeft: "auto",
            background: "#d9fdd3",
            borderRadius: "10px 10px 2px 10px",
            padding: "8px 12px 6px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
            position: "relative",
          }}
        >
          <div
            style={{
              fontSize: "12.5px",
              color: "#111b21",
              whiteSpace: "pre-wrap",
              lineHeight: "1.45",
              wordBreak: "break-word",
            }}
          >
            {messageText}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "4px",
              marginTop: "4px",
              fontSize: "10px",
              color: "#667781",
            }}
          >
            <span>{currentTime}</span>
            <CheckCheck size={13} style={{ color: "#53bdeb" }} />
          </div>
        </div>
      </div>

      {/* Bottom Send Bar */}
      <div
        style={{
          background: "#f0f2f5",
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #e9edef",
        }}
      >
        <span style={{ fontSize: "11px", color: "#667781" }}>
          Opens official WhatsApp directly
        </span>
        <button
          type="button"
          onClick={handleSend}
          className="btn primary sm"
          style={{
            background: "#25D366",
            color: "#ffffff",
            border: "none",
            fontWeight: 800,
            fontSize: "12.5px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px",
          }}
        >
          <Send size={13} />
          <span>Send on WhatsApp</span>
        </button>
      </div>
    </div>
  );
};
