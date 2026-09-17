import React, { useState, useMemo } from "react";
import { Product, Sale } from "../types";
import { AlertTriangle, TrendingDown, Clock, Search, Filter, ArrowUpDown, Tag, DollarSign, Download, Sparkles } from "lucide-react";

interface DeadStockHeatmapViewProps {
  products: Product[];
  sales: Sale[];
  onOpenEditProduct?: (product: Product) => void;
  showToast: (msg: string, kind?: string) => void;
}

interface AnalyzedStockItem {
  product: Product;
  daysUnsold: number;
  lastSaleDate: string | null;
  status: "dead" | "slow" | "healthy";
  capitalLocked: number;
  potentialRevenue: number;
}

export const DeadStockHeatmapView: React.FC<DeadStockHeatmapViewProps> = ({
  products,
  sales,
  onOpenEditProduct,
  showToast,
}) => {
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "dead" | "slow" | "healthy">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"days" | "capital" | "stock">("days");

  // Build a map of product.id -> last sale timestamp
  const lastSaleMap = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) => {
      const saleTime = new Date(s.date).getTime();
      s.items.forEach((it) => {
        const current = map.get(it.productId) || 0;
        if (saleTime > current) {
          map.set(it.productId, saleTime);
        }
      });
    });
    return map;
  }, [sales]);

  const analyzedItems: AnalyzedStockItem[] = useMemo(() => {
    const now = Date.now();
    const activeProducts = products.filter((p) => (p.stock || 0) > 0);

    return activeProducts.map((p) => {
      const lastSaleTs = lastSaleMap.get(p.id) || (p.createdAt ? new Date(p.createdAt).getTime() : now - 45 * 86400000);
      const diffDays = Math.max(0, Math.floor((now - lastSaleTs) / 86400000));

      let status: "dead" | "slow" | "healthy" = "healthy";
      if (diffDays >= 60) {
        status = "dead";
      } else if (diffDays >= 30) {
        status = "slow";
      }

      const cost = p.purchasePrice || p.price * 0.7;
      const capitalLocked = (p.stock || 0) * cost;
      const potentialRevenue = (p.stock || 0) * p.price;

      return {
        product: p,
        daysUnsold: diffDays,
        lastSaleDate: lastSaleMap.has(p.id) ? new Date(lastSaleTs).toLocaleDateString("en-IN") : "No recorded sale",
        status,
        capitalLocked,
        potentialRevenue,
      };
    });
  }, [products, lastSaleMap]);

  // Totals
  const summary = useMemo(() => {
    const deadItems = analyzedItems.filter((i) => i.status === "dead");
    const slowItems = analyzedItems.filter((i) => i.status === "slow");
    const healthyItems = analyzedItems.filter((i) => i.status === "healthy");

    const deadCapital = deadItems.reduce((s, i) => s + i.capitalLocked, 0);
    const slowCapital = slowItems.reduce((s, i) => s + i.capitalLocked, 0);
    const totalCapital = analyzedItems.reduce((s, i) => s + i.capitalLocked, 0);

    return {
      deadCount: deadItems.length,
      deadCapital,
      slowCount: slowItems.length,
      slowCapital,
      healthyCount: healthyItems.length,
      totalCapital,
    };
  }, [analyzedItems]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  // Filtered list
  const filtered = useMemo(() => {
    return analyzedItems
      .filter((item) => {
        if (filterStatus !== "all" && item.status !== filterStatus) return false;
        if (filterCategory !== "all" && item.product.category !== filterCategory) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const p = item.product;
          return (
            p.name.toLowerCase().includes(q) ||
            (p.brand && p.brand.toLowerCase().includes(q)) ||
            (p.compatibleModels || []).some((m) => m.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "days") return b.daysUnsold - a.daysUnsold;
        if (sortBy === "capital") return b.capitalLocked - a.capitalLocked;
        return (b.product.stock || 0) - (a.product.stock || 0);
      });
  }, [analyzedItems, filterStatus, filterCategory, searchQuery, sortBy]);

  const handleExportCsv = () => {
    const rows = [
      ["Product Name", "Brand", "Category", "Stock", "Days Unsold", "Status", "Cost (₹)", "Capital Locked (₹)", "Selling Price (₹)"],
      ...filtered.map((i) => [
        `"${i.product.name.replace(/"/g, '""')}"`,
        `"${i.product.brand || ""}"`,
        `"${i.product.category}"`,
        i.product.stock,
        i.daysUnsold,
        i.status.toUpperCase(),
        i.product.purchasePrice || 0,
        Math.round(i.capitalLocked),
        i.product.price,
      ]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Dead_Stock_Heatmap_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Dead Stock report CSV downloaded!", "green");
  };

  return (
    <div style={{ padding: "16px 20px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800, display: "flex", alignItems: "center", gap: "8px" }}>
            <TrendingDown size={22} color="#ef4444" />
            Slow-Moving &amp; Dead Stock Heatmap
          </h2>
          <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "2px" }}>
            Identify trapped working capital (30+ &amp; 60+ days unsold) to clear stock before obsolescence
          </div>
        </div>

        <button className="btn sm" onClick={handleExportCsv} style={{ fontWeight: 700 }}>
          <Download size={13} /> Export Dead Stock CSV
        </button>
      </div>

      {/* KPI Heatmap Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", marginBottom: "18px" }}>
        <div
          onClick={() => setFilterStatus(filterStatus === "dead" ? "all" : "dead")}
          style={{
            background: filterStatus === "dead" ? "#fef2f2" : "var(--paper)",
            border: filterStatus === "dead" ? "2px solid #ef4444" : "1px solid #fee2e2",
            borderRadius: "12px",
            padding: "14px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "#b91c1c", display: "flex", alignItems: "center", gap: "5px" }}>
              <AlertTriangle size={14} /> 60+ DAYS (CRITICAL DEAD)
            </span>
            <span style={{ fontSize: "11px", background: "#fecaca", color: "#991b1b", padding: "1px 6px", borderRadius: "10px", fontWeight: 700 }}>
              {summary.deadCount} SKUs
            </span>
          </div>
          <div style={{ fontSize: "22px", fontWeight: 900, color: "#dc2626", marginTop: "6px" }}>
            ₹{Math.round(summary.deadCapital).toLocaleString("en-IN")}
          </div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)", marginTop: "2px" }}>
            Trapped purchase capital. Recommended: 30%–50% clearance sale.
          </div>
        </div>

        <div
          onClick={() => setFilterStatus(filterStatus === "slow" ? "all" : "slow")}
          style={{
            background: filterStatus === "slow" ? "#fffbeb" : "var(--paper)",
            border: filterStatus === "slow" ? "2px solid #f59e0b" : "1px solid #fef3c7",
            borderRadius: "12px",
            padding: "14px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "#b45309", display: "flex", alignItems: "center", gap: "5px" }}>
              <Clock size={14} /> 30–60 DAYS (SLOW ROTATION)
            </span>
            <span style={{ fontSize: "11px", background: "#fde68a", color: "#92400e", padding: "1px 6px", borderRadius: "10px", fontWeight: 700 }}>
              {summary.slowCount} SKUs
            </span>
          </div>
          <div style={{ fontSize: "22px", fontWeight: 900, color: "#d97706", marginTop: "6px" }}>
            ₹{Math.round(summary.slowCapital).toLocaleString("en-IN")}
          </div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)", marginTop: "2px" }}>
            Pushed via combo offers or counter staff incentive.
          </div>
        </div>

        <div
          onClick={() => setFilterStatus(filterStatus === "healthy" ? "all" : "healthy")}
          style={{
            background: filterStatus === "healthy" ? "#f0fdf4" : "var(--paper)",
            border: filterStatus === "healthy" ? "2px solid #10b981" : "1px solid #d1fae5",
            borderRadius: "12px",
            padding: "14px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "#047857", display: "flex", alignItems: "center", gap: "5px" }}>
              <Sparkles size={14} /> &lt; 30 DAYS (HEALTHY ROTATION)
            </span>
            <span style={{ fontSize: "11px", background: "#a7f3d0", color: "#065f46", padding: "1px 6px", borderRadius: "10px", fontWeight: 700 }}>
              {summary.healthyCount} SKUs
            </span>
          </div>
          <div style={{ fontSize: "22px", fontWeight: 900, color: "#059669", marginTop: "6px" }}>
            Fast Movers
          </div>
          <div style={{ fontSize: "11px", color: "var(--ink-soft)", marginTop: "2px" }}>
            Healthy FIFO velocity with active customer demand.
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "14px",
          background: "var(--paper)",
          padding: "10px 14px",
          borderRadius: "10px",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }} />
          <input
            type="text"
            placeholder="Search product, brand, or model..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", paddingLeft: "30px", fontSize: "13px" }}
          />
        </div>

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{ fontSize: "13px", padding: "6px 10px", borderRadius: "6px" }}
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          style={{ fontSize: "13px", padding: "6px 10px", borderRadius: "6px" }}
        >
          <option value="days">Sort: Most Days Unsold</option>
          <option value="capital">Sort: Highest Capital Locked</option>
          <option value="stock">Sort: Highest Stock Qty</option>
        </select>

        {filterStatus !== "all" && (
          <button className="btn sm" onClick={() => setFilterStatus("all")}>
            Clear Status Filter ({filterStatus})
          </button>
        )}
      </div>

      {/* Stock Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "10px", background: "var(--bg)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "var(--paper)", textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "10px 14px" }}>Product &amp; Compatibility</th>
              <th style={{ padding: "10px 14px" }}>Category</th>
              <th style={{ padding: "10px 14px" }}>Current Stock</th>
              <th style={{ padding: "10px 14px" }}>Last Sold</th>
              <th style={{ padding: "10px 14px" }}>Days Unsold</th>
              <th style={{ padding: "10px 14px" }}>Capital Trapped</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "30px", color: "var(--ink-soft)" }}>
                  Koi stock match nahi hua is filter ke sath.
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const isDead = item.status === "dead";
                const isSlow = item.status === "slow";

                return (
                  <tr
                    key={item.product.id}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      background: isDead ? "rgba(239, 68, 68, 0.04)" : isSlow ? "rgba(245, 158, 11, 0.03)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{item.product.name}</div>
                      {item.product.brand && (
                        <span style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Brand: {item.product.brand}</span>
                      )}
                      {item.product.compatibleModels && item.product.compatibleModels.length > 0 && (
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "3px" }}>
                          {item.product.compatibleModels.slice(0, 3).map((m, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: "10px",
                                background: "var(--paper)",
                                border: "1px solid var(--line)",
                                padding: "1px 5px",
                                borderRadius: "4px",
                              }}
                            >
                              {m}
                            </span>
                          ))}
                          {item.product.compatibleModels.length > 3 && (
                            <span style={{ fontSize: "10px", opacity: 0.7 }}>+{item.product.compatibleModels.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: "10px 14px", color: "var(--ink-soft)" }}>{item.product.category}</td>

                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontWeight: 800, fontSize: "14px" }}>{item.product.stock}</span> pcs
                    </td>

                    <td style={{ padding: "10px 14px", fontSize: "12px", color: "var(--ink-soft)" }}>
                      {item.lastSaleDate}
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "3px 8px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: 800,
                          background: isDead ? "#fee2e2" : isSlow ? "#fef3c7" : "#d1fae5",
                          color: isDead ? "#991b1b" : isSlow ? "#92400e" : "#065f46",
                        }}
                      >
                        {item.daysUnsold} din
                      </span>
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 800, color: isDead ? "#dc2626" : "var(--ink)" }}>
                        ₹{Math.round(item.capitalLocked).toLocaleString("en-IN")}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>
                        ₹{item.product.purchasePrice || Math.round(item.product.price * 0.7)}/pc cost
                      </div>
                    </td>

                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      {onOpenEditProduct ? (
                        <button
                          className="btn sm"
                          onClick={() => onOpenEditProduct(item.product)}
                          style={{ fontSize: "11px", fontWeight: 700 }}
                        >
                          <Tag size={11} /> Clearance Discount
                        </button>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Selling ₹{item.product.price}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
