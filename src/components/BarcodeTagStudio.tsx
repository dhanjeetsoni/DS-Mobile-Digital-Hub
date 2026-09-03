import React, { useState } from "react";
import { Tag, Printer, CheckSquare, Square, Search, Smartphone, Layers, Eye } from "lucide-react";
import { Database, Product } from "../types";
import { inr } from "../utils/indianCurrency";

interface BarcodeTagStudioProps {
  db: Database;
}

export const BarcodeTagStudio: React.FC<BarcodeTagStudioProps> = ({ db }) => {
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [tagFormat, setTagFormat] = useState<"small" | "medium" | "showroom">("medium");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [copiesPerItem, setCopiesPerItem] = useState<number>(1);
  const [showQrCode, setShowQrCode] = useState<boolean>(true);
  const [showEmiBadge, setShowEmiBadge] = useState<boolean>(true);

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

  // Barcode generator helper (visual Code128 pattern SVG)
  const renderVisualBarcode = (code: string) => {
    const clean = (code || "DSM000000").replace(/[^a-zA-Z0-9]/g, "");
    return (
      <div style={{ textAlign: "center", margin: "4px 0" }}>
        <svg viewBox="0 0 160 38" style={{ width: "100%", height: "26px" }}>
          {/* Simple representative barcode stripes */}
          {clean.split("").map((char, i) => {
            const codeVal = char.charCodeAt(0);
            const w1 = (codeVal % 3) + 1;
            const w2 = ((codeVal >> 1) % 3) + 1;
            return (
              <React.Fragment key={i}>
                <rect x={i * 14} y="0" width={w1} height="36" fill="#000" />
                <rect x={i * 14 + w1 + 1} y="0" width={w2} height="36" fill="#000" />
              </React.Fragment>
            );
          })}
        </svg>
        <div style={{ fontSize: "10px", fontFamily: "monospace", letterSpacing: "1px", color: "#000" }}>
          *{clean}*
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>Barcode &amp; Price Tag Studio</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn primary sm"
              disabled={selectedProducts.length === 0}
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print {selectedProducts.length * copiesPerItem} Tags
            </button>
          </div>
        </div>

        {/* Configuration Bar */}
        <div className="grid cols-4" style={{ gap: "12px", marginBottom: "14px" }}>
          <div className="field">
            <label>Tag Format / Size</label>
            <select value={tagFormat} onChange={(e) => setTagFormat(e.target.value as any)}>
              <option value="small">Small Cable / Accessory Tag (38x20mm)</option>
              <option value="medium">Standard Shelf Price Tag (50x35mm)</option>
              <option value="showroom">Showroom Mobile Display Card (75x100mm)</option>
            </select>
          </div>
          <div className="field">
            <label>Copies per Product</label>
            <input
              type="number"
              min="1"
              max="50"
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
              checked={showEmiBadge}
              onChange={(e) => setShowEmiBadge(e.target.checked)}
            />
            Show 0% EMI Estimate Badge
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
                <th>Price</th>
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
            Print Preview ({selectedProducts.length * copiesPerItem} Tags)
          </h2>
          <button className="btn primary sm" onClick={() => window.print()} disabled={selectedProducts.length === 0}>
            <Printer size={14} /> Print Now
          </button>
        </div>

        {selectedProducts.length === 0 ? (
          <div className="empty">Select one or more products above to preview and generate printable price tags.</div>
        ) : (
          <div id="print-area">
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  tagFormat === "showroom"
                    ? "repeat(auto-fill, minmax(220px, 1fr))"
                    : tagFormat === "medium"
                    ? "repeat(auto-fill, minmax(170px, 1fr))"
                    : "repeat(auto-fill, minmax(130px, 1fr))",
                gap: "12px",
                padding: "8px",
                background: "#fff",
                borderRadius: "8px",
                border: "1px solid var(--line)",
              }}
            >
              {selectedProducts.flatMap((p) =>
                Array.from({ length: copiesPerItem }).map((_, copyIdx) => {
                  const estEmi = Math.round(p.sellingPrice / 6);
                  return (
                    <div
                      key={`${p.id}-${copyIdx}`}
                      style={{
                        border: "1px dashed #999",
                        borderRadius: tagFormat === "showroom" ? "8px" : "4px",
                        padding: tagFormat === "showroom" ? "12px" : "8px",
                        background: "#fff",
                        color: "#000",
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        pageBreakInside: "avoid",
                      }}
                    >
                      {/* Shop Header */}
                      <div style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: "#444" }}>
                        {db.settings.shopName || "DS MOBILE"}
                      </div>

                      {/* Product Name & Brand */}
                      <div style={{ marginTop: "4px" }}>
                        <div style={{ fontWeight: 800, fontSize: tagFormat === "showroom" ? "14px" : "11.5px", color: "#000", lineHeight: "1.2" }}>
                          {p.name}
                        </div>
                        {p.brand && (
                          <div style={{ fontSize: "10px", color: "#666" }}>{p.brand} {p.category !== "Other" ? `• ${p.category}` : ""}</div>
                        )}
                      </div>

                      {/* Showroom Specs */}
                      {tagFormat === "showroom" && (
                        <div style={{ margin: "8px 0", fontSize: "11px", background: "#f5f5f5", padding: "6px", borderRadius: "6px", textAlign: "left" }}>
                          {p.warrantyEnabled ? `✔ ${p.warrantyMonths} Months Warranty` : "✔ Genuine Quality Checked"}
                          <br />
                          {p.compatibleModels && p.compatibleModels.length > 0
                            ? `✔ Compatible with ${p.compatibleModels[0]}`
                            : "✔ 100% Tested & Verified"}
                        </div>
                      )}

                      {/* Barcode Strip */}
                      {renderVisualBarcode(p.barcode || p.sku)}

                      {/* Price Section */}
                      <div style={{ marginTop: "4px", borderTop: "1px dashed #ccc", paddingTop: "4px" }}>
                        <div style={{ fontSize: tagFormat === "showroom" ? "18px" : "14px", fontWeight: 800, color: "#000" }}>
                          {inr(p.sellingPrice)}
                        </div>

                        {showEmiBadge && p.sellingPrice >= 3000 && (
                          <div
                            style={{
                              fontSize: "9.5px",
                              fontWeight: 800,
                              background: "#eaf1ff",
                              color: "#16294f",
                              padding: "2px 4px",
                              borderRadius: "4px",
                              marginTop: "2px",
                              display: "inline-block",
                            }}
                          >
                            0% EMI @ {inr(estEmi)}/mo*
                          </div>
                        )}
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
