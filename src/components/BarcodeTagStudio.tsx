import React, { useState } from "react";
import { Tag, Printer, CheckSquare, Square, Search, Smartphone, Layers, Eye, Sparkles, Copy } from "lucide-react";
import { Database, Product } from "../types";
import { inr } from "../utils/indianCurrency";

interface BarcodeTagStudioProps {
  db: Database;
}

export const BarcodeTagStudio: React.FC<BarcodeTagStudioProps> = ({ db }) => {
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [tagFormat, setTagFormat] = useState<"50x25" | "38x25" | "showroom">("50x25");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [copiesPerItem, setCopiesPerItem] = useState<number>(1);
  const [showMrpStrike, setShowMrpStrike] = useState<boolean>(true);
  const [customMrpMultiplier, setCustomMrpMultiplier] = useState<number>(1.3);

  const categories = ["All", ...db.categories];

  const filteredProducts = db.products.filter((p) => {
    if (selectedCategory !== "All" && p.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const toggleSelectProduct = (id: string) => {
    if (selectedProductIds.includes(id)) {
      setSelectedProductIds(selectedProductIds.filter((x) => x !== id));
    } else {
      setSelectedProductIds([...selectedProductIds, id]);
    }
  };

  const selectAllFiltered = () => {
    const ids = filteredProducts.map((p) => p.id);
    setSelectedProductIds(Array.from(new Set([...selectedProductIds, ...ids])));
  };

  const clearSelection = () => {
    setSelectedProductIds([]);
  };

  const selectedProducts = db.products.filter((p) => selectedProductIds.includes(p.id));

  // High-contrast clean barcode SVG generator
  const renderVisualBarcode = (code: string, compact = false) => {
    const clean = (code || "DSM000000").replace(/[^a-zA-Z0-9]/g, "");
    return (
      <div style={{ textAlign: "center", margin: compact ? "1px 0" : "3px 0" }}>
        <svg viewBox="0 0 160 32" style={{ width: "100%", height: compact ? "18px" : "24px" }}>
          {clean.split("").map((char, i) => {
            const codeVal = char.charCodeAt(0);
            const w1 = (codeVal % 3) + 1;
            const w2 = ((codeVal >> 1) % 3) + 1;
            return (
              <React.Fragment key={i}>
                <rect x={i * 13 + 4} y="0" width={w1} height="32" fill="#000" />
                <rect x={i * 13 + w1 + 3} y="0" width={w2} height="32" fill="#000" />
              </React.Fragment>
            );
          })}
        </svg>
        <div style={{ fontSize: compact ? "8.5px" : "9.5px", fontFamily: "monospace", letterSpacing: "1px", color: "#000", fontWeight: 700 }}>
          *{clean}*
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "19px", margin: 0 }}>
              <Tag size={22} style={{ color: "var(--brand)" }} />
              Thermal Barcode &amp; Price Tag Sticker Generator
            </h2>
            <p className="hint" style={{ marginTop: "4px", margin: 0 }}>
              Generate &amp; print high-contrast price tags and barcode stickers (50x25mm &amp; 38x25mm) for chargers, cables, cases, and tempered glass.
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn primary sm"
              disabled={selectedProducts.length === 0}
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print {selectedProducts.length * copiesPerItem} Thermal Stickers
            </button>
          </div>
        </div>

        {/* Configuration Bar */}
        <div className="grid cols-4" style={{ gap: "12px", marginBottom: "14px" }}>
          <div className="field">
            <label>Thermal Sticker Size</label>
            <select value={tagFormat} onChange={(e) => setTagFormat(e.target.value as any)}>
              <option value="50x25">Standard Accessory Label (50 x 25 mm)</option>
              <option value="38x25">Compact Cable / Glass Tag (38 x 25 mm)</option>
              <option value="showroom">Showroom Counter Display (75 x 100 mm)</option>
            </select>
          </div>
          <div className="field">
            <label>Stickers per Product</label>
            <input
              type="number"
              min="1"
              max="100"
              value={copiesPerItem}
              onChange={(e) => setCopiesPerItem(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
          <div className="field">
            <label>Filter Category</label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Search Products</label>
            <input
              placeholder="Search by name, brand, SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px" }}>
          <button className="btn sm" onClick={selectAllFiltered}>
            <CheckSquare size={13} /> Select All Matching ({filteredProducts.length})
          </button>
          {selectedProductIds.length > 0 && (
            <button className="btn sm ghost" onClick={clearSelection}>
              Clear Selection ({selectedProductIds.length})
            </button>
          )}
          <label style={{ marginLeft: "auto", fontSize: "12.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <input
              type="checkbox"
              checked={showMrpStrike}
              onChange={(e) => setShowMrpStrike(e.target.checked)}
            />
            Display MRP &amp; Discount Strike
          </label>
        </div>

        {/* Product Selection Table */}
        <div className="table-wrap" style={{ maxHeight: "240px", overflowY: "auto", marginBottom: "16px" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: "36px" }}></th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Brand</th>
                <th>SKU / Barcode</th>
                <th>Selling Price</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => {
                const isSelected = selectedProductIds.includes(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => toggleSelectProduct(p.id)}
                    style={{ cursor: "pointer", background: isSelected ? "var(--blue-light)" : "transparent" }}
                  >
                    <td>
                      {isSelected ? (
                        <CheckSquare size={16} style={{ color: "var(--blue)" }} />
                      ) : (
                        <Square size={16} style={{ color: "var(--ink-soft)" }} />
                      )}
                    </td>
                    <td><b>{p.name}</b></td>
                    <td>{p.category}</td>
                    <td>{p.brand || "—"}</td>
                    <td className="hint">{p.barcode || p.sku}</td>
                    <td><b>{inr(p.sellingPrice)}</b></td>
                    <td>{p.stock}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable Price Tags Preview */}
      <div className="section">
        <div className="section-head">
          <h2>
            <Eye size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} />
            Thermal Sticker Print Preview ({selectedProducts.length * copiesPerItem} Stickers)
          </h2>
          <button className="btn primary sm" onClick={() => window.print()} disabled={selectedProducts.length === 0}>
            <Printer size={14} /> Print Now
          </button>
        </div>

        {selectedProducts.length === 0 ? (
          <div className="empty">Select one or more products above to preview thermal stickers.</div>
        ) : (
          <div id="print-area">
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  tagFormat === "showroom"
                    ? "repeat(auto-fill, minmax(220px, 1fr))"
                    : tagFormat === "50x25"
                    ? "repeat(auto-fill, minmax(180px, 1fr))"
                    : "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "10px",
                padding: "10px",
                background: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid var(--line)",
              }}
            >
              {selectedProducts.flatMap((p) =>
                Array.from({ length: copiesPerItem }).map((_, copyIdx) => {
                  const estMrp = Math.round(p.sellingPrice * customMrpMultiplier);
                  const isCompact = tagFormat === "38x25";

                  return (
                    <div
                      key={`${p.id}-${copyIdx}`}
                      style={{
                        border: "1.5px solid #000",
                        borderRadius: "4px",
                        padding: isCompact ? "4px 6px" : "6px 8px",
                        background: "#fff",
                        color: "#000",
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        pageBreakInside: "avoid",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                        width: tagFormat === "50x25" ? "188px" : tagFormat === "38x25" ? "145px" : "auto",
                        minHeight: tagFormat === "50x25" ? "95px" : tagFormat === "38x25" ? "95px" : "auto",
                        margin: "0 auto",
                      }}
                    >
                      {/* Shop Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #000", paddingBottom: "2px" }}>
                        <span style={{ fontSize: isCompact ? "8px" : "9px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          {db.settings.shopName || "DS MOBILE"}
                        </span>
                        <span style={{ fontSize: isCompact ? "7.5px" : "8.5px", fontWeight: 700 }}>
                          {p.category.slice(0, 10)}
                        </span>
                      </div>

                      {/* Product Name */}
                      <div style={{ margin: "2px 0" }}>
                        <div style={{ fontWeight: 800, fontSize: isCompact ? "9.5px" : "11px", color: "#000", lineHeight: "1.15", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.name}
                        </div>
                        {p.compatibleModels && p.compatibleModels.length > 0 && (
                          <div style={{ fontSize: "7.5px", color: "#333", whiteSpace: "nowrap", overflow: "hidden" }}>
                            For {p.compatibleModels[0]}
                          </div>
                        )}
                      </div>

                      {/* Barcode Strip */}
                      {renderVisualBarcode(p.barcode || p.sku, isCompact)}

                      {/* Price Section */}
                      <div style={{ borderTop: "1px solid #000", paddingTop: "2px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        {showMrpStrike && (
                          <div style={{ fontSize: isCompact ? "8px" : "9px", color: "#555", textDecoration: "line-through" }}>
                            MRP {inr(estMrp)}
                          </div>
                        )}
                        <div style={{ fontSize: isCompact ? "11.5px" : "13px", fontWeight: 900, color: "#000" }}>
                          OUR: {inr(p.sellingPrice)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
