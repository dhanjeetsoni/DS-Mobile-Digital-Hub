import React, { useState, useMemo, useRef, useEffect } from "react";
import { Product } from "../types";
import { ClipboardCheck, Barcode, Camera, Download, RotateCcw, AlertTriangle, CheckCircle2, Search, ArrowRight } from "lucide-react";
import { playScanPip, playAlertTone } from "../utils/counterAudio";

interface StockAuditScannerViewProps {
  products: Product[];
  onApplyReconciliation: (updates: { productId: string; newStock: number }[]) => void;
  showToast: (msg: string, kind?: string) => void;
}

interface AuditRecord {
  productId: string;
  countedQty: number;
  lastScannedAt: number;
}

export const StockAuditScannerView: React.FC<StockAuditScannerViewProps> = ({
  products,
  onApplyReconciliation,
  showToast,
}) => {
  const [auditRecords, setAuditRecords] = useState<Record<string, AuditRecord>>({});
  const [barcodeInput, setBarcodeInput] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "discrepancy" | "counted">("all");
  const [searchFilter, setSearchFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input automatically
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleBarcodeSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;

    // Find product matching barcode, sku, imei, or exact name
    const found = products.find(
      (p) =>
        p.barcode === code ||
        p.sku === code ||
        p.id === code ||
        p.name.toLowerCase() === code.toLowerCase()
    );

    if (found) {
      playScanPip();
      setAuditRecords((prev) => {
        const existing = prev[found.id]?.countedQty || 0;
        return {
          ...prev,
          [found.id]: {
            productId: found.id,
            countedQty: existing + 1,
            lastScannedAt: Date.now(),
          },
        };
      });
      showToast(`Scanned: ${found.name} (Count: ${(auditRecords[found.id]?.countedQty || 0) + 1})`, "green");
    } else {
      playAlertTone();
      showToast(`Product code "${code}" catalog me nahi mila!`, "red");
    }

    setBarcodeInput("");
    inputRef.current?.focus();
  };

  const handleManualCountChange = (productId: string, val: number) => {
    setAuditRecords((prev) => ({
      ...prev,
      [productId]: {
        productId,
        countedQty: Math.max(0, val),
        lastScannedAt: Date.now(),
      },
    }));
  };

  // Build discrepancy items
  const auditList = useMemo(() => {
    return products.map((p) => {
      const counted = auditRecords[p.id]?.countedQty ?? 0;
      const system = p.stock || 0;
      const diff = counted - system;
      const isCounted = auditRecords[p.id] !== undefined;

      return {
        product: p,
        systemStock: system,
        countedStock: counted,
        diff,
        isCounted,
      };
    });
  }, [products, auditRecords]);

  const summary = useMemo(() => {
    const totalCountedSkus = Object.keys(auditRecords).length;
    let totalExcess = 0;
    let totalShortage = 0;
    let totalMatched = 0;

    auditList.forEach((it) => {
      if (!it.isCounted) return;
      if (it.diff === 0) totalMatched++;
      else if (it.diff < 0) totalShortage += Math.abs(it.diff);
      else totalExcess += it.diff;
    });

    return { totalCountedSkus, totalMatched, totalShortage, totalExcess };
  }, [auditList, auditRecords]);

  const filteredList = useMemo(() => {
    return auditList.filter((it) => {
      if (filterMode === "counted" && !it.isCounted) return false;
      if (filterMode === "discrepancy" && (!it.isCounted || it.diff === 0)) return false;
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        return (
          it.product.name.toLowerCase().includes(q) ||
          (it.product.barcode && it.product.barcode.toLowerCase().includes(q)) ||
          (it.product.brand && it.product.brand.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [auditList, filterMode, searchFilter]);

  const handleExportCsv = () => {
    const rows = [
      ["Product Name", "Barcode / SKU", "Brand", "Category", "System Stock", "Physical Counted", "Variance (Diff)", "Cost Each (₹)", "Loss/Excess Value (₹)"],
      ...auditList
        .filter((it) => it.isCounted)
        .map((it) => {
          const cost = it.product.purchasePrice || Math.round(it.product.price * 0.7);
          return [
            `"${it.product.name.replace(/"/g, '""')}"`,
            `"${it.product.barcode || it.product.sku || ""}"`,
            `"${it.product.brand || ""}"`,
            `"${it.product.category}"`,
            it.systemStock,
            it.countedStock,
            it.diff,
            cost,
            Math.round(it.diff * cost),
          ];
        }),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Physical_Stock_Audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Audit reconciliation report exported!", "green");
  };

  const handleReconcileAll = () => {
    const countedOnly = auditList.filter((it) => it.isCounted && it.diff !== 0);
    if (countedOnly.length === 0) {
      showToast("Koi discrepancy update karne ke liye nahi hai.", "amber");
      return;
    }

    const confirm = window.confirm(
      `Warning: ${countedOnly.length} items ka system stock physical count ke barabar update ho jayega. Kya aap confirm karte hain?`
    );
    if (!confirm) return;

    const updates = countedOnly.map((it) => ({
      productId: it.product.id,
      newStock: it.countedStock,
    }));

    onApplyReconciliation(updates);
    showToast(`Successfully reconciled ${updates.length} products stock!`, "green");
  };

  return (
    <div style={{ padding: "16px 20px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800, display: "flex", alignItems: "center", gap: "8px" }}>
            <ClipboardCheck size={22} color="var(--brand, #2563eb)" />
            Stock Auditing &amp; Physical Counting Mode
          </h2>
          <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "2px" }}>
            Continuous barcode scanning to detect shop inventory shrinkage, lost items, and system variance
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn sm" onClick={handleExportCsv} disabled={summary.totalCountedSkus === 0}>
            <Download size={13} /> Export Audit Report
          </button>
          <button className="btn primary sm" onClick={handleReconcileAll} disabled={summary.totalCountedSkus === 0}>
            <RotateCcw size={13} /> Apply Counted to System Stock
          </button>
        </div>
      </div>

      {/* Barcode Gun Input Box */}
      <div
        style={{
          background: "var(--navy, #0f172a)",
          color: "#fff",
          padding: "16px 20px",
          borderRadius: "14px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}
      >
        <Barcode size={32} color="#38bdf8" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
            RAPID SCANNER LISTENING (USB Barcode Gun / Keyboard Input)
          </div>
          <form onSubmit={handleBarcodeSubmit} style={{ display: "flex", gap: "8px" }}>
            <input
              ref={inputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Shelf ka barcode scan karein (Press Enter to count)..."
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: "8px",
                border: "2px solid #38bdf8",
                background: "#1e293b",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 600,
              }}
            />
            <button type="submit" className="btn primary" style={{ fontWeight: 800, padding: "0 20px" }}>
              Count (+1)
            </button>
          </form>
        </div>
      </div>

      {/* KPI Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", marginBottom: "16px" }}>
        <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-soft)" }}>SCANNED / COUNTED SKUS</div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "var(--ink)", marginTop: "4px" }}>
            {summary.totalCountedSkus} / {products.length}
          </div>
        </div>

        <div style={{ background: "#f0fdf4", padding: "12px 14px", borderRadius: "10px", border: "1px solid #bbf7d0" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#166534" }}>PERFECT MATCH (0 VARIANCE)</div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "#15803d", marginTop: "4px" }}>
            {summary.totalMatched} SKUs
          </div>
        </div>

        <div style={{ background: "#fef2f2", padding: "12px 14px", borderRadius: "10px", border: "1px solid #fecaca" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#991b1b" }}>MISSING / SHORTAGE (SHRINKAGE)</div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "#dc2626", marginTop: "4px" }}>
            -{summary.totalShortage} pcs
          </div>
        </div>

        <div style={{ background: "#eff6ff", padding: "12px 14px", borderRadius: "10px", border: "1px solid #bfdbfe" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#1e40af" }}>SURPLUS / UNRECORDED</div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "#2563eb", marginTop: "4px" }}>
            +{summary.totalExcess} pcs
          </div>
        </div>
      </div>

      {/* Filter and Table */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "12px",
          background: "var(--paper)",
          padding: "8px 12px",
          borderRadius: "8px",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }} />
          <input
            type="text"
            placeholder="Filter scanned products..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{ width: "100%", paddingLeft: "30px", fontSize: "12px" }}
          />
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            className={`btn sm ${filterMode === "all" ? "primary" : ""}`}
            onClick={() => setFilterMode("all")}
          >
            All ({auditList.length})
          </button>
          <button
            className={`btn sm ${filterMode === "counted" ? "primary" : ""}`}
            onClick={() => setFilterMode("counted")}
          >
            Counted ({summary.totalCountedSkus})
          </button>
          <button
            className={`btn sm ${filterMode === "discrepancy" ? "primary" : ""}`}
            onClick={() => setFilterMode("discrepancy")}
            style={{ color: filterMode === "discrepancy" ? "#fff" : "#ef4444" }}
          >
            Discrepancies Only
          </button>
        </div>
      </div>

      {/* Audit Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "10px", background: "var(--bg)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "var(--paper)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "8px 12px" }}>Product &amp; Code</th>
              <th style={{ padding: "8px 12px" }}>Category</th>
              <th style={{ padding: "8px 12px" }}>System Stock</th>
              <th style={{ padding: "8px 12px" }}>Physical Counted</th>
              <th style={{ padding: "8px 12px" }}>Variance</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>Quick Adjust</th>
            </tr>
          </thead>
          <tbody>
            {filteredList.slice(0, 100).map((it) => {
              const hasDiff = it.isCounted && it.diff !== 0;
              const isMatch = it.isCounted && it.diff === 0;

              return (
                <tr
                  key={it.product.id}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    background: hasDiff
                      ? it.diff < 0
                        ? "rgba(239, 68, 68, 0.04)"
                        : "rgba(59, 130, 246, 0.04)"
                      : isMatch
                      ? "rgba(16, 185, 129, 0.03)"
                      : "transparent",
                  }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ fontWeight: 700 }}>{it.product.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>
                      {it.product.barcode || it.product.sku || "No Barcode"} {it.product.brand ? `• ${it.product.brand}` : ""}
                    </div>
                  </td>

                  <td style={{ padding: "8px 12px", color: "var(--ink-soft)", fontSize: "12px" }}>
                    {it.product.category}
                  </td>

                  <td style={{ padding: "8px 12px", fontWeight: 700 }}>
                    {it.systemStock} pcs
                  </td>

                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        min="0"
                        value={it.isCounted ? it.countedStock : ""}
                        placeholder="Not Counted"
                        onChange={(e) => handleManualCountChange(it.product.id, Number(e.target.value))}
                        style={{
                          width: "80px",
                          padding: "4px 8px",
                          fontWeight: 800,
                          fontSize: "13px",
                          textAlign: "center",
                          border: it.isCounted ? "1px solid var(--brand)" : "1px dashed var(--line)",
                        }}
                      />
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => handleManualCountChange(it.product.id, it.countedStock + 1)}
                        style={{ padding: "2px 8px", fontSize: "11px" }}
                        title="Add 1"
                      >
                        +1
                      </button>
                    </div>
                  </td>

                  <td style={{ padding: "8px 12px" }}>
                    {!it.isCounted ? (
                      <span style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Pending</span>
                    ) : isMatch ? (
                      <span style={{ color: "#16a34a", fontWeight: 800, display: "flex", alignItems: "center", gap: "3px" }}>
                        <CheckCircle2 size={13} /> Matched
                      </span>
                    ) : (
                      <span
                        style={{
                          fontWeight: 800,
                          color: it.diff < 0 ? "#dc2626" : "#2563eb",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: it.diff < 0 ? "#fee2e2" : "#dbeafe",
                        }}
                      >
                        {it.diff > 0 ? `+${it.diff} Surplus` : `${it.diff} Missing`}
                      </span>
                    )}
                  </td>

                  <td style={{ padding: "8px 12px", textAlign: "right" }}>
                    {it.isCounted && hasDiff && (
                      <button
                        className="btn sm"
                        onClick={() => {
                          onApplyReconciliation([{ productId: it.product.id, newStock: it.countedStock }]);
                          showToast(`Updated ${it.product.name} stock to ${it.countedStock}`, "green");
                        }}
                        style={{ fontSize: "11px" }}
                      >
                        Match ({it.countedStock})
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
