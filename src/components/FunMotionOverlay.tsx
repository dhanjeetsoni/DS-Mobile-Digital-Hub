import React, { useState, useEffect } from "react";
import { Sparkles, Play, CheckCircle2, TrendingUp, Award, Zap, Smile, Heart } from "lucide-react";

export type AnimationType = "celebration" | "saleSuccess" | "customerSmile" | "stockCheck" | "none";

interface FunMotionOverlayProps {
  type: AnimationType;
  title?: string;
  subtitle?: string;
  onComplete?: () => void;
  duration?: number;
}

export const FunMotionOverlay: React.FC<FunMotionOverlayProps> = ({
  type,
  title,
  subtitle,
  onComplete,
  duration = 2800,
}) => {
  useEffect(() => {
    if (type === "none") return;
    const timer = setTimeout(() => {
      onComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [type, duration, onComplete]);

  if (type === "none") return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(4px)",
        animation: "funOverlayFade 0.3s ease forwards",
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "2px solid var(--accent)",
          borderRadius: "24px",
          padding: "24px 36px",
          textAlign: "center",
          boxShadow: "0 25px 60px -15px rgba(0,0,0,0.5)",
          maxWidth: "380px",
          width: "90%",
          animation: "funCardPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative Particle Elements */}
        <div style={{ position: "absolute", top: "10px", right: "15px", animation: "funStarSpin 3s linear infinite" }}>
          <Sparkles size={20} style={{ color: "var(--amber)" }} />
        </div>
        <div style={{ position: "absolute", bottom: "10px", left: "15px", animation: "funStarSpin 2.5s linear infinite reverse" }}>
          <Zap size={18} style={{ color: "var(--accent)" }} />
        </div>

        {/* Dynamic Character / Animated Icon based on type */}
        {type === "saleSuccess" && (
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #10b981, #059669)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: "0 10px 25px rgba(16, 185, 129, 0.4)",
                animation: "funBounce 0.8s ease infinite alternate",
              }}
            >
              <CheckCircle2 size={40} />
            </div>
            <div style={{ marginTop: "14px", fontWeight: 900, fontSize: "19px", color: "var(--ink)" }}>
              {title || "🎉 Dhanbad! Sale Recorded"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" }}>
              {subtitle || "Cash galla & stock updated smoothly!"}
            </div>
          </div>
        )}

        {type === "celebration" && (
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                fontSize: "50px",
                lineHeight: 1,
                animation: "funWiggle 0.6s ease-in-out infinite alternate",
              }}
            >
              🚀✨
            </div>
            <div style={{ marginTop: "14px", fontWeight: 900, fontSize: "19px", color: "var(--ink)" }}>
              {title || "Super Counter Day!"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" }}>
              {subtitle || "Target hit, keep growing DS Mobile!"}
            </div>
          </div>
        )}

        {type === "customerSmile" && (
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #ec4899, #db2777)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: "0 10px 25px rgba(236, 72, 153, 0.4)",
                animation: "funPulse 1s ease infinite alternate",
              }}
            >
              <Heart size={38} />
            </div>
            <div style={{ marginTop: "14px", fontWeight: 900, fontSize: "19px", color: "var(--ink)" }}>
              {title || "Customer Khush!"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" }}>
              {subtitle || "Invoice sent to WhatsApp & warranty locked."}
            </div>
          </div>
        )}

        {type === "stockCheck" && (
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: "0 10px 25px rgba(59, 130, 246, 0.4)",
                animation: "funRotatePulse 1.2s ease infinite",
              }}
            >
              <TrendingUp size={38} />
            </div>
            <div style={{ marginTop: "14px", fontWeight: 900, fontSize: "19px", color: "var(--ink)" }}>
              {title || "Stock Verified!"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" }}>
              {subtitle || "Inventory and valuation synchronized."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
