// Number Pad Quick Increment (+ / -) Component
// Supports rapid increment/decrement on continuous long-press or tap

import React, { useRef } from "react";
import { Plus, Minus } from "lucide-react";

interface QuantityStepperProps {
  value: number;
  onChange: (newValue: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  value,
  onChange,
  min = 1,
  max = 9999,
  step = 1,
  size = "sm",
  className = "",
  disabled = false,
}) => {
  const timerRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);

  const update = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    onChange(next);
  };

  const startRepeat = (delta: number) => {
    if (disabled) return;
    update(delta);

    // After 350ms hold, repeat rapidly every 70ms
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        onChange((prev: any) => {
          // In case value is controlled via state updater
          const cur = typeof prev === "number" ? prev : value;
          return Math.min(max, Math.max(min, cur + delta));
        });
      }, 70);
    }, 350);
  };

  const stopRepeat = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const isSmall = size === "sm";

  return (
    <div
      className={`quantity-stepper ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1.5px solid var(--line, #cbd5e1)",
        borderRadius: isSmall ? "6px" : "8px",
        background: "var(--card, #ffffff)",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onMouseDown={() => startRepeat(-step)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => startRepeat(-step)}
        onTouchEnd={stopRepeat}
        style={{
          border: "none",
          background: value <= min ? "var(--paper, #f1f5f9)" : "var(--surface-2, #f8fafc)",
          color: value <= min ? "var(--ink-soft, #94a3b8)" : "var(--ink, #0f172a)",
          padding: isSmall ? "4px 8px" : "6px 12px",
          cursor: value <= min ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          touchAction: "manipulation",
        }}
        title="Decrease (- hold for rapid)"
      >
        <Minus size={isSmall ? 12 : 14} />
      </button>

      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        disabled={disabled}
        style={{
          width: isSmall ? "36px" : "48px",
          textAlign: "center",
          border: "none",
          padding: isSmall ? "2px 0" : "4px 0",
          fontSize: isSmall ? "12px" : "14px",
          fontWeight: 800,
          background: "transparent",
          color: "var(--ink, #0f172a)",
          outline: "none",
          MozAppearance: "textfield",
        }}
      />

      <button
        type="button"
        disabled={disabled || value >= max}
        onMouseDown={() => startRepeat(step)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => startRepeat(step)}
        onTouchEnd={stopRepeat}
        style={{
          border: "none",
          background: value >= max ? "var(--paper, #f1f5f9)" : "var(--surface-2, #f8fafc)",
          color: value >= max ? "var(--ink-soft, #94a3b8)" : "var(--ink, #0f172a)",
          padding: isSmall ? "4px 8px" : "6px 12px",
          cursor: value >= max ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          touchAction: "manipulation",
        }}
        title="Increase (+ hold for rapid)"
      >
        <Plus size={isSmall ? 12 : 14} />
      </button>
    </div>
  );
};
