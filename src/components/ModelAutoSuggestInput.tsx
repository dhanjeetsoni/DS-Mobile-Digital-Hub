import React, { useState, useEffect, useRef } from "react";
import { Search, Smartphone, Sparkles, X, ChevronRight, Check } from "lucide-react";
import { searchPhoneModels, detectBrandFromModel, AutoSuggestResult } from "../utils/phoneModelCatalog";
import { PasteButton } from "./PasteButton";

export interface ModelAutoSuggestInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelectModel?: (model: string, detectedBrand?: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  customDbModels?: string[];
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  showPasteButton?: boolean;
  autoUppercase?: boolean;
  className?: string;
  style?: React.CSSProperties;
  toast?: (msg: string, kind?: "green" | "red" | "amber") => void;
}

export const ModelAutoSuggestInput: React.FC<ModelAutoSuggestInputProps> = ({
  value,
  onChange,
  onSelectModel,
  onKeyDown,
  customDbModels = [],
  placeholder = "Type phone model (e.g. 'V' for Vivo Y20, 'Redmi Note 13', 'S24'…)",
  required = false,
  autoFocus = false,
  disabled = false,
  id,
  name,
  showPasteButton = true,
  autoUppercase = false,
  className = "",
  style,
  toast,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AutoSuggestResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update suggestions whenever value or customDbModels change
  useEffect(() => {
    if (!value || !value.trim()) {
      setSuggestions([]);
      setIsOpen(false);
      setSelectedIndex(-1);
      return;
    }

    const matches = searchPhoneModels(value, customDbModels, 10);
    setSuggestions(matches);
    // Open dropdown if we have matches and the input doesn't already exactly equal the first suggestion
    if (matches.length > 0) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
    setSelectedIndex(-1);
  }, [value, customDbModels]);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSelect = (selectedModel: string) => {
    const brand = detectBrandFromModel(selectedModel);
    onChange(selectedModel);
    if (onSelectModel) {
      onSelectModel(selectedModel, brand);
    }
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = autoUppercase ? e.target.value.toUpperCase() : e.target.value;
    onChange(newVal);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === "Enter" && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex].model);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
      if (e.key === "Tab" && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        handleSelect(suggestions[selectedIndex].model);
      }
    }

    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const getBrandBadgeColor = (brand: string) => {
    switch (brand?.toLowerCase()) {
      case "vivo":
        return { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" };
      case "xiaomi":
      case "redmi":
        return { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" };
      case "samsung":
        return { bg: "#eef2ff", text: "#4338ca", border: "#c7d2fe" };
      case "realme":
        return { bg: "#fefce8", text: "#854d0e", border: "#fef08a" };
      case "oppo":
        return { bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" };
      case "oneplus":
        return { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" };
      case "apple":
        return { bg: "#f3f4f6", text: "#1f2937", border: "#e5e7eb" };
      case "motorola":
        return { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" };
      case "poco":
        return { bg: "#fef08a", text: "#713f12", border: "#fde047" };
      case "iqoo":
        return { bg: "#fdf4ff", text: "#86198f", border: "#f5d0fe" };
      default:
        return { bg: "var(--paper, #f1f5f9)", text: "var(--ink, #334155)", border: "var(--line, #cbd5e1)" };
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            ref={inputRef}
            id={id}
            name={name}
            type="text"
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (value && suggestions.length > 0) {
                setIsOpen(true);
              }
            }}
            placeholder={placeholder}
            required={required}
            autoFocus={autoFocus}
            disabled={disabled}
            className={className}
            style={{
              width: "100%",
              textTransform: autoUppercase ? "uppercase" : "none",
              paddingRight: value ? "28px" : "12px",
            }}
            autoComplete="off"
          />

          {value && !disabled && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "var(--ink-soft, #64748b)",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
              }}
              title="Clear text"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {showPasteButton && !disabled && (
          <PasteButton
            cleanType="model"
            onPaste={(pasted) => {
              const brand = detectBrandFromModel(pasted);
              onChange(pasted);
              if (onSelectModel) {
                onSelectModel(pasted, brand);
              }
            }}
            toast={toast}
            title="Paste Phone Model from WhatsApp (1-Click)"
          />
        )}
      </div>

      {/* Auto-Suggest Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "var(--card, #ffffff)",
            borderRadius: "10px",
            border: "1px solid var(--line, #e2e8f0)",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            maxHeight: "260px",
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          <div
            style={{
              padding: "4px 10px 6px",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--ink-soft, #64748b)",
              borderBottom: "1px solid var(--line, #f1f5f9)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Smartphone size={12} style={{ color: "var(--brand, #0284c7)" }} />
              Suggested Phone Models ({suggestions.length})
            </span>
            <span style={{ fontSize: "10px", fontWeight: 500 }}>
              ↑↓ navigate • Enter to select
            </span>
          </div>

          {suggestions.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            const badge = getBrandBadgeColor(item.brand);

            return (
              <div
                key={`${item.brand}-${item.model}-${idx}`}
                onClick={() => handleSelect(item.model)}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: "7px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  background: isSelected ? "var(--paper, #f1f5f9)" : "transparent",
                  borderLeft: isSelected ? "3px solid var(--brand, #0284c7)" : "3px solid transparent",
                  transition: "background 0.1s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Smartphone size={14} style={{ color: isSelected ? "var(--brand, #0284c7)" : "var(--ink-soft, #94a3b8)", flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: isSelected ? 700 : 600,
                      color: isSelected ? "var(--brand, #0284c7)" : "var(--ink, #0f172a)",
                    }}
                  >
                    {item.model}
                  </span>
                  {item.isDb && (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: "4px",
                        background: "#dcfce7",
                        color: "#166534",
                      }}
                    >
                      In Store
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: "6px",
                      background: badge.bg,
                      color: badge.text,
                      border: `1px solid ${badge.border}`,
                    }}
                  >
                    {item.brand}
                  </span>
                  <ChevronRight size={13} style={{ color: "var(--ink-soft, #cbd5e1)" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
