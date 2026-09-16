import React, { useState, useEffect } from "react";
import { X, Delete, Copy, Check, Sparkles, Percent, RotateCcw } from "lucide-react";

interface CounterCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyToSell?: (amount: number) => void;
}

export const CounterCalculatorModal: React.FC<CounterCalculatorModalProps> = ({
  isOpen,
  onClose,
  onApplyToSell,
}) => {
  const [display, setDisplay] = useState<string>("0");
  const [equation, setEquation] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [gstType, setGstType] = useState<"none" | "add" | "remove">("none");
  const [gstRate, setGstRate] = useState<number>(18);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        handleDigit(e.key);
      } else if (["+", "-", "*", "/"].includes(e.key)) {
        const op = e.key === "*" ? "×" : e.key === "/" ? "÷" : e.key;
        handleOperator(op);
      } else if (e.key === "Enter" || e.key === "=") {
        e.preventDefault();
        handleCalculate();
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === ".") {
        handleDecimal();
      } else if (e.key === "c" || e.key === "C") {
        handleClear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, display, equation]);

  if (!isOpen) return null;

  const handleDigit = (digit: string) => {
    setDisplay((prev) => {
      if (prev === "0" || prev === "Error") return digit;
      if (prev.length >= 15) return prev;
      return prev + digit;
    });
  };

  const handleDecimal = () => {
    setDisplay((prev) => {
      if (prev === "Error") return "0.";
      if (prev.includes(".")) return prev;
      return prev + ".";
    });
  };

  const handleOperator = (op: string) => {
    if (display === "Error") return;
    const currentVal = parseFloat(display) || 0;
    setEquation(`${currentVal} ${op} `);
    setDisplay("0");
  };

  const handleCalculate = () => {
    if (!equation || display === "Error") return;
    const parts = equation.trim().split(" ");
    if (parts.length < 2) return;

    const num1 = parseFloat(parts[0]);
    const op = parts[1];
    const num2 = parseFloat(display) || 0;

    let result = 0;
    if (op === "+") result = num1 + num2;
    else if (op === "-") result = num1 - num2;
    else if (op === "×") result = num1 * num2;
    else if (op === "÷") {
      if (num2 === 0) {
        setDisplay("Error");
        setEquation("");
        return;
      }
      result = num1 / num2;
    }

    const rounded = Math.round((result + Number.EPSILON) * 100) / 100;
    const itemHistory = `${num1} ${op} ${num2} = ${rounded}`;
    setHistory((prev) => [itemHistory, ...prev.slice(0, 9)]);
    setDisplay(String(rounded));
    setEquation("");
  };

  const handleClear = () => {
    setDisplay("0");
    setEquation("");
  };

  const handleBackspace = () => {
    setDisplay((prev) => {
      if (prev === "Error" || prev.length <= 1) return "0";
      return prev.slice(0, -1);
    });
  };

  const handleQuickGst = (type: "add" | "remove", rate: number) => {
    const val = parseFloat(display) || 0;
    if (val === 0 || display === "Error") return;

    let result = val;
    if (type === "add") {
      result = val + (val * rate) / 100;
      setHistory((prev) => [`₹${val} + ${rate}% GST = ₹${result.toFixed(2)}`, ...prev.slice(0, 9)]);
    } else {
      result = (val * 100) / (100 + rate);
      setHistory((prev) => [`₹${val} excl. ${rate}% GST = ₹${result.toFixed(2)}`, ...prev.slice(0, 9)]);
    }
    setDisplay(String(Math.round((result + Number.EPSILON) * 100) / 100));
    setEquation("");
  };

  const handleQuickMargin = (marginPercent: number) => {
    const cost = parseFloat(display) || 0;
    if (cost === 0 || display === "Error") return;
    const sellPrice = cost + (cost * marginPercent) / 100;
    const rounded = Math.round((sellPrice + Number.EPSILON) * 100) / 100;
    setHistory((prev) => [`Cost ₹${cost} + ${marginPercent}% Margin = ₹${rounded}`, ...prev.slice(0, 9)]);
    setDisplay(String(rounded));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(display);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const currentNum = parseFloat(display) || 0;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "420px",
          width: "95%",
          background: "var(--card)",
          borderRadius: "16px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          border: "1px solid var(--line)",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            background: "linear-gradient(135deg, var(--accent), var(--accent-2, #3b82f6))",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>🧮</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: "15px", letterSpacing: "-0.01em" }}>
                Counter Quick Calculator
              </div>
              <div style={{ fontSize: "11px", opacity: 0.85 }}>GST &amp; Retail Margin Tools</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              color: "#fff",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Display Screen */}
        <div
          style={{
            padding: "16px 20px",
            background: "var(--paper)",
            borderBottom: "1px solid var(--line)",
            textAlign: "right",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "var(--ink-soft)",
              minHeight: "18px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {equation || " "}
          </div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: 800,
              fontFamily: "var(--font-mono)",
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: "2px",
            }}
          >
            {display}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "8px",
              fontSize: "11px",
              color: "var(--ink-soft)",
            }}
          >
            <button
              onClick={handleCopy}
              className="btn sm"
              style={{ padding: "3px 8px", fontSize: "11px", gap: "4px" }}
            >
              {copied ? <Check size={12} style={{ color: "var(--green)" }} /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy Result"}
            </button>
            {onApplyToSell && currentNum > 0 && (
              <button
                onClick={() => {
                  onApplyToSell(currentNum);
                  onClose();
                }}
                className="btn primary sm"
                style={{ padding: "3px 10px", fontSize: "11px" }}
              >
                + Apply to POS Bill (₹{currentNum})
              </button>
            )}
          </div>
        </div>

        {/* Quick Retail Tools Strip */}
        <div
          style={{
            padding: "10px 16px",
            background: "var(--card-glass)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => handleQuickGst("add", 18)}
            className="btn sm"
            style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0", fontSize: "11px", flex: "1 1 auto" }}
            title="Add 18% GST to current amount"
          >
            +18% GST
          </button>
          <button
            onClick={() => handleQuickGst("add", 5)}
            className="btn sm"
            style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0", fontSize: "11px", flex: "1 1 auto" }}
            title="Add 5% GST to current amount"
          >
            +5% GST
          </button>
          <button
            onClick={() => handleQuickGst("remove", 18)}
            className="btn sm"
            style={{ background: "#eff6ff", color: "#1e40af", borderColor: "#bfdbfe", fontSize: "11px", flex: "1 1 auto" }}
            title="Calculate base amount before 18% GST"
          >
            -18% GST Base
          </button>
          <button
            onClick={() => handleQuickMargin(25)}
            className="btn sm"
            style={{ background: "#faf5ff", color: "#6b21a8", borderColor: "#e9d5ff", fontSize: "11px", flex: "1 1 auto" }}
            title="Add 25% shop margin"
          >
            +25% Margin
          </button>
          <button
            onClick={() => handleQuickMargin(35)}
            className="btn sm"
            style={{ background: "#faf5ff", color: "#6b21a8", borderColor: "#e9d5ff", fontSize: "11px", flex: "1 1 auto" }}
            title="Add 35% accessory margin"
          >
            +35% Margin
          </button>
        </div>

        {/* Keypad Grid */}
        <div
          style={{
            padding: "14px 16px",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "8px",
          }}
        >
          {/* Row 1 */}
          <button
            onClick={handleClear}
            style={{
              padding: "14px",
              fontSize: "15px",
              fontWeight: 800,
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            AC
          </button>
          <button
            onClick={handleBackspace}
            style={{
              padding: "14px",
              fontSize: "14px",
              fontWeight: 700,
              background: "var(--paper)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            ⌫
          </button>
          <button
            onClick={() => {
              const val = parseFloat(display) || 0;
              setDisplay(String(val / 100));
            }}
            style={{
              padding: "14px",
              fontSize: "15px",
              fontWeight: 700,
              background: "var(--paper)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            %
          </button>
          <button
            onClick={() => handleOperator("÷")}
            style={{
              padding: "14px",
              fontSize: "18px",
              fontWeight: 800,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            ÷
          </button>

          {/* Row 2 */}
          <button onClick={() => handleDigit("7")} style={digitKeyStyle}>7</button>
          <button onClick={() => handleDigit("8")} style={digitKeyStyle}>8</button>
          <button onClick={() => handleDigit("9")} style={digitKeyStyle}>9</button>
          <button
            onClick={() => handleOperator("×")}
            style={{
              padding: "14px",
              fontSize: "18px",
              fontWeight: 800,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            ×
          </button>

          {/* Row 3 */}
          <button onClick={() => handleDigit("4")} style={digitKeyStyle}>4</button>
          <button onClick={() => handleDigit("5")} style={digitKeyStyle}>5</button>
          <button onClick={() => handleDigit("6")} style={digitKeyStyle}>6</button>
          <button
            onClick={() => handleOperator("-")}
            style={{
              padding: "14px",
              fontSize: "18px",
              fontWeight: 800,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            -
          </button>

          {/* Row 4 */}
          <button onClick={() => handleDigit("1")} style={digitKeyStyle}>1</button>
          <button onClick={() => handleDigit("2")} style={digitKeyStyle}>2</button>
          <button onClick={() => handleDigit("3")} style={digitKeyStyle}>3</button>
          <button
            onClick={() => handleOperator("+")}
            style={{
              padding: "14px",
              fontSize: "18px",
              fontWeight: 800,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            +
          </button>

          {/* Row 5 */}
          <button onClick={() => handleDigit("0")} style={{ ...digitKeyStyle, gridColumn: "span 2" }}>
            0
          </button>
          <button onClick={handleDecimal} style={digitKeyStyle}>.</button>
          <button
            onClick={handleCalculate}
            style={{
              padding: "14px",
              fontSize: "18px",
              fontWeight: 800,
              background: "var(--green)",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
            }}
          >
            =
          </button>
        </div>

        {/* History Footprint */}
        {history.length > 0 && (
          <div
            style={{
              padding: "10px 16px",
              background: "var(--paper)",
              borderTop: "1px solid var(--line)",
              maxHeight: "100px",
              overflowY: "auto",
              fontSize: "11px",
              color: "var(--ink-soft)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "4px", color: "var(--ink)" }}>
              Recent Calculations:
            </div>
            {history.map((h, i) => (
              <div key={i} style={{ fontFamily: "var(--font-mono)", padding: "1px 0" }}>
                {h}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const digitKeyStyle: React.CSSProperties = {
  padding: "14px",
  fontSize: "16px",
  fontWeight: 700,
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  cursor: "pointer",
  transition: "all 0.1s ease",
};
