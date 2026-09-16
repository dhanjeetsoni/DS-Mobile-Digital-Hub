import React, { useState, useMemo } from "react";
import {
  TrendingUp,
  Package,
  AlertTriangle,
  Send,
  Printer,
  CheckCircle2,
  Clock,
  Sparkles,
  ShoppingBag,
  Truck,
  Plus,
  Trash2,
  FileText,
  ChevronRight,
  Filter,
} from "lucide-react";
import { Database, Product, RestockPurchaseOrder, RestockPurchaseOrderItem } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, uid } from "../utils/fifoEngine";
import { openWhatsApp } from "../services/whatsapp";

interface SmartRestockPredictorViewProps {
  db: Database;
  onUpdateDb: (db: Database) => void;
  showToast: (msg: string, kind?: "green" | "red" | "amber") => void;
}

export const SmartRestockPredictorView: React.FC<SmartRestockPredictorViewProps> = ({
  db,
  onUpdateDb,
  showToast,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [leadTimeDays, setLeadTimeDays] = useState<number>(3); // Days distributor takes to deliver
  const [safetyBufferDays, setSafetyBufferDays] = useState<number>(7); // Days of buffer stock
  const [selectedSupplier, setSelectedSupplier] = useState<string>("All");
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"analysis" | "orders">("analysis");

  // Calculate 15-day sales velocity for all products
  const productVelocity = useMemo(() => {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const fifteenDaysAgoStr = fifteenDaysAgo.toISOString().split("T")[0];

    const salesInWindow = (db.sales || []).filter((s) => s.date >= fifteenDaysAgoStr);

    const qtySoldMap: Record<string, number> = {};
    salesInWindow.forEach((sale) => {
      sale.items.forEach((item) => {
        qtySoldMap[item.productId] = (qtySoldMap[item.productId] || 0) + item.qty;
      });
    });

    return qtySoldMap;
  }, [db.sales]);

  // Generate smart restock recommendations
  const recommendations = useMemo(() => {
    return db.products
      .map((p) => {
        const sales15 = productVelocity[p.id] || 0;
        const dailyRunRate = sales15 / 15;
        const currentStock = p.stock || 0;
        const minStock = p.minStock || 3;

        // Estimated runway in days
        const runwayDays = dailyRunRate > 0 ? Math.round(currentStock / dailyRunRate) : currentStock > 0 ? 999 : 0;

        // Suggested reorder qty = (Daily rate * (Lead time + Buffer)) - Current Stock
        const targetHolding = Math.ceil(dailyRunRate * (leadTimeDays + safetyBufferDays));
        const suggestedRaw = targetHolding > currentStock ? targetHolding - currentStock : currentStock <= minStock ? minStock * 2 : 0;
        const suggestedQty = Math.max(0, suggestedRaw);

        // Urgency rating
        let urgency: "Critical Out of Stock" | "Low Stock Soon" | "Adequate Stock" | "Overstocked" = "Adequate Stock";
        if (currentStock === 0) {
          urgency = "Critical Out of Stock";
        } else if (currentStock <= minStock || runwayDays <= leadTimeDays) {
          urgency = "Low Stock Soon";
        } else if (runwayDays > 45 && currentStock > minStock * 3) {
          urgency = "Overstocked";
        }

        const effectiveOrderQty = customQuantities[p.id] !== undefined ? customQuantities[p.id] : suggestedQty;

        return {
          product: p,
          sales15,
          dailyRunRate: Number(dailyRunRate.toFixed(2)),
          runwayDays,
          suggestedQty,
          effectiveOrderQty,
          urgency,
          unitCost: p.purchasePrice || p.confidentialPrice || Math.round(p.sellingPrice * 0.7),
          totalCost: effectiveOrderQty * (p.purchasePrice || p.confidentialPrice || Math.round(p.sellingPrice * 0.7)),
        };
      })
      .filter((r) => {
        if (selectedCategory !== "All" && r.product.category !== selectedCategory) return false;
        if (selectedSupplier !== "All" && (r.product.supplier || "Unassigned") !== selectedSupplier) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort critical and low stock first
        const urgencyOrder = { "Critical Out of Stock": 0, "Low Stock Soon": 1, "Adequate Stock": 2, "Overstocked": 3 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      });
  }, [db.products, productVelocity, leadTimeDays, safetyBufferDays, selectedCategory, selectedSupplier, customQuantities]);

  const itemsToOrder = useMemo(() => {
    return recommendations.filter((r) => r.effectiveOrderQty > 0);
  }, [recommendations]);

  const totalOrderInvestment = useMemo(() => {
    return itemsToOrder.reduce((sum, r) => sum + r.totalCost, 0);
  }, [itemsToOrder]);

  const categories = ["All", ...db.categories];
  const suppliers = ["All", ...Array.from(new Set(db.products.map((p) => p.supplier || "Unassigned")))];

  // Create Purchase Order
  const handleCreatePurchaseOrder = (supplierName: string) => {
    const itemsForSupplier = itemsToOrder.filter(
      (r) => (r.product.supplier || "Unassigned") === supplierName || supplierName === "All"
    );

    if (itemsForSupplier.length === 0) {
      showToast("No items with positive order quantity selected", "amber");
      return;
    }

    const nextSeq = (db.poSeq || 100) + 1;
    const poNumber = `PO-${nextSeq}`;

    const orderItems: RestockPurchaseOrderItem[] = itemsForSupplier.map((r) => ({
      productId: r.product.id,
      productName: r.product.name,
      category: r.product.category,
      currentStock: r.product.stock,
      minStock: r.product.minStock,
      salesLast15Days: r.sales15,
      suggestedQty: r.suggestedQty,
      orderQty: r.effectiveOrderQty,
      purchasePrice: r.unitCost,
      totalCost: r.totalCost,
    }));

    const totalCost = orderItems.reduce((a, b) => a + b.totalCost, 0);
    const supplierObj = db.suppliers.find((s) => s.name === supplierName);

    const newPO: RestockPurchaseOrder = {
      id: uid("po"),
      orderNo: poNumber,
      date: todayStr(),
      supplierName: supplierName === "All" ? "General Distributor" : supplierName,
      supplierPhone: supplierObj?.phone,
      items: orderItems,
      totalEstimatedCost: totalCost,
      status: "Draft",
      createdAt: new Date().toISOString(),
    };

    const nextDb = {
      ...db,
      purchaseOrders: [newPO, ...(db.purchaseOrders || [])],
      poSeq: nextSeq,
    };

    onUpdateDb(nextDb);
    showToast(`Purchase Order ${poNumber} created successfully!`, "green");
    setActiveTab("orders");
  };

  // Send via WhatsApp
  const handleSendPOWhatsApp = (po: RestockPurchaseOrder) => {
    const supplierPhone = po.supplierPhone || "";

    const itemList = po.items
      .map((i, idx) => `${idx + 1}. *${i.productName}* (${i.category}) — *Qty: ${i.orderQty} pcs*`)
      .join("\n");

    const msg =
      `*📦 PURCHASE ORDER — ${po.orderNo}*\n` +
      `*From:* ${db.settings.shopName || "DS Mobile Hub"}\n` +
      `*Date:* ${po.date}\n` +
      `*To:* ${po.supplierName}\n\n` +
      `Namaste, kripya neeche diye gaye items ka stock dispatch karein:\n\n` +
      `${itemList}\n\n` +
      `*Total Items:* ${po.items.length} SKUs (${po.items.reduce((a, b) => a + b.orderQty, 0)} Units)\n` +
      `*Est. Cost:* ${inr(po.totalEstimatedCost)}\n\n` +
      `Kripya dispatch date aur transport bill confirm karein. Dhanyawad! 🙏`;

    if (supplierPhone && supplierPhone.length >= 10) {
      openWhatsApp(supplierPhone, msg);
    } else {
      // Open WhatsApp web without specific phone
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    }

    // Update PO status to Sent
    const updatedPOs = (db.purchaseOrders || []).map((p) =>
      p.id === po.id ? { ...p, status: "Sent via WhatsApp" as const } : p
    );
    onUpdateDb({ ...db, purchaseOrders: updatedPOs });
    showToast("Purchase order prepared for WhatsApp!", "green");
  };

  // Receive stock into inventory
  const handleReceivePOStock = (po: RestockPurchaseOrder) => {
    const updatedProducts = db.products.map((p) => {
      const orderItem = po.items.find((i) => i.productId === p.id);
      if (orderItem) {
        return {
          ...p,
          stock: (p.stock || 0) + orderItem.orderQty,
        };
      }
      return p;
    });

    const updatedPOs = (db.purchaseOrders || []).map((p) =>
      p.id === po.id ? { ...p, status: "Received & Added to Stock" as const } : p
    );

    onUpdateDb({
      ...db,
      products: updatedProducts,
      purchaseOrders: updatedPOs,
    });

    showToast(`Stock received! ${po.items.reduce((a, b) => a + b.orderQty, 0)} units added to inventory.`, "green");
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div className="section" style={{ marginBottom: "16px" }}>
        <div className="section-head" style={{ marginBottom: "12px" }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "19px", margin: 0 }}>
              <TrendingUp size={22} style={{ color: "var(--brand)" }} />
              AI Smart Restock &amp; Low-Stock Reorder Predictor
            </h2>
            <p className="hint" style={{ marginTop: "4px", margin: 0 }}>
              Analyzes real 15-day sales velocity, runway depletion, and calculates optimal order quantities before shelves run empty.
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className={`btn sm ${activeTab === "analysis" ? "primary" : ""}`}
              onClick={() => setActiveTab("analysis")}
            >
              <Sparkles size={14} /> Smart Restock Predictor
            </button>
            <button
              className={`btn sm ${activeTab === "orders" ? "primary" : ""}`}
              onClick={() => setActiveTab("orders")}
            >
              <FileText size={14} /> Saved Purchase Orders ({(db.purchaseOrders || []).length})
            </button>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid cols-4" style={{ gap: "10px" }}>
          <div style={{ background: "var(--card)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>🚨 CRITICAL OUT OF STOCK</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--red)", marginTop: "2px" }}>
              {recommendations.filter((r) => r.urgency === "Critical Out of Stock").length} SKUs
            </div>
            <div className="hint" style={{ fontSize: "11px" }}>0 inventory on shelves</div>
          </div>

          <div style={{ background: "var(--card)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>⚠️ LOW STOCK WARNING</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--amber)", marginTop: "2px" }}>
              {recommendations.filter((r) => r.urgency === "Low Stock Soon").length} SKUs
            </div>
            <div className="hint" style={{ fontSize: "11px" }}>Reaching min stock soon</div>
          </div>

          <div style={{ background: "var(--card)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>📦 SUGGESTED UNITS TO ORDER</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--blue)", marginTop: "2px" }}>
              {itemsToOrder.reduce((a, b) => a + b.effectiveOrderQty, 0)} Units
            </div>
            <div className="hint" style={{ fontSize: "11px" }}>Across {itemsToOrder.length} products</div>
          </div>

          <div style={{ background: "var(--card)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 700 }}>💰 ESTIMATED INVESTMENT</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--navy)", marginTop: "2px" }}>
              {inr(totalOrderInvestment)}
            </div>
            <div className="hint" style={{ fontSize: "11px" }}>At wholesale purchase cost</div>
          </div>
        </div>
      </div>

      {activeTab === "analysis" ? (
        <div>
          {/* Controls Bar */}
          <div className="section" style={{ marginBottom: "16px", padding: "14px" }}>
            <div className="grid cols-4" style={{ gap: "12px" }}>
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
                <label>Filter Supplier / Wholesaler</label>
                <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
                  {suppliers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Distributor Lead Time (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={leadTimeDays}
                  onChange={(e) => setLeadTimeDays(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>

              <div className="field">
                <label>Safety Buffer Stock (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={safetyBufferDays}
                  onChange={(e) => setSafetyBufferDays(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            {/* Quick Action Button to Generate PO */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
              <span style={{ fontSize: "12.5px", color: "var(--ink-soft)" }}>
                Order Qty can be modified directly in the table below before creating PO.
              </span>

              <button
                className="btn primary sm"
                disabled={itemsToOrder.length === 0}
                onClick={() => handleCreatePurchaseOrder(selectedSupplier)}
              >
                <FileText size={14} /> Create Purchase Order ({itemsToOrder.length} Items • {inr(totalOrderInvestment)})
              </button>
            </div>
          </div>

          {/* Restock Recommendations Table */}
          <div className="section">
            <div className="section-head">
              <h2>Smart Inventory Health &amp; Reorder Forecast</h2>
              <span className="hint">{recommendations.length} SKUs evaluated</span>
            </div>

            <div className="table-wrap" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Product &amp; Category</th>
                    <th style={{ textAlign: "center" }}>Current Stock</th>
                    <th style={{ textAlign: "center" }}>15-Day Sales</th>
                    <th style={{ textAlign: "center" }}>Runway Left</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                    <th style={{ textAlign: "center" }}>AI Suggested</th>
                    <th style={{ textAlign: "center", width: "110px" }}>Order Qty</th>
                    <th style={{ textAlign: "right" }}>Unit Cost</th>
                    <th style={{ textAlign: "right" }}>Est. Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.map((r) => {
                    const isUrgent = r.urgency === "Critical Out of Stock" || r.urgency === "Low Stock Soon";
                    return (
                      <tr key={r.product.id} style={{ background: isUrgent ? "rgba(239, 68, 68, 0.02)" : "transparent" }}>
                        <td>
                          <b>{r.product.name}</b>
                          <div className="hint" style={{ fontSize: "11px" }}>
                            {r.product.category} • Supplier: {r.product.supplier || "—"}
                          </div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <b style={{ color: r.product.stock <= r.product.minStock ? "var(--red)" : "inherit" }}>
                            {r.product.stock}
                          </b>
                          <div className="hint" style={{ fontSize: "10px" }}>Min: {r.product.minStock}</div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <b>{r.sales15} pcs</b>
                          <div className="hint" style={{ fontSize: "10px" }}>{r.dailyRunRate}/day</div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {r.runwayDays > 90 ? (
                            <span style={{ color: "var(--green)", fontWeight: 700 }}>90+ days</span>
                          ) : (
                            <span style={{ color: r.runwayDays <= leadTimeDays ? "var(--red)" : "var(--ink)", fontWeight: 700 }}>
                              {r.runwayDays} days
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: "999px",
                              background:
                                r.urgency === "Critical Out of Stock"
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : r.urgency === "Low Stock Soon"
                                  ? "rgba(245, 158, 11, 0.15)"
                                  : r.urgency === "Overstocked"
                                  ? "rgba(107, 114, 128, 0.15)"
                                  : "rgba(16, 185, 129, 0.15)",
                              color:
                                r.urgency === "Critical Out of Stock"
                                  ? "#dc2626"
                                  : r.urgency === "Low Stock Soon"
                                  ? "#d97706"
                                  : r.urgency === "Overstocked"
                                  ? "#4b5563"
                                  : "#059669",
                            }}
                          >
                            {r.urgency}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <b>{r.suggestedQty}</b>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="number"
                            min="0"
                            value={r.effectiveOrderQty}
                            onChange={(e) =>
                              setCustomQuantities({
                                ...customQuantities,
                                [r.product.id]: Math.max(0, parseInt(e.target.value) || 0),
                              })
                            }
                            style={{
                              width: "70px",
                              textAlign: "center",
                              fontWeight: 800,
                              padding: "4px 6px",
                              fontSize: "13px",
                              borderRadius: "6px",
                              border: "1px solid var(--line)",
                            }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>{inr(r.unitCost)}</td>
                        <td style={{ textAlign: "right", fontWeight: 800, color: "var(--navy)" }}>
                          {inr(r.totalCost)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Saved Purchase Orders View */
        <div className="section">
          <div className="section-head">
            <h2>Generated Purchase Orders &amp; Dispatch Tracking</h2>
          </div>

          {(!db.purchaseOrders || db.purchaseOrders.length === 0) ? (
            <div className="empty" style={{ padding: "40px" }}>
              <ShoppingBag size={40} style={{ color: "var(--ink-soft)", margin: "0 auto 10px" }} />
              No Purchase Orders generated yet. Switch to "Smart Restock Predictor" above to auto-create your first PO.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {db.purchaseOrders.map((po) => (
                <div
                  key={po.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "16px",
                    background: "var(--card)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "16px", fontWeight: 800 }}>{po.orderNo}</span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "2px 8px",
                            borderRadius: "999px",
                            background:
                              po.status === "Received & Added to Stock"
                                ? "rgba(16, 185, 129, 0.15)"
                                : po.status === "Sent via WhatsApp"
                                ? "rgba(59, 130, 246, 0.15)"
                                : "rgba(245, 158, 11, 0.15)",
                            color:
                              po.status === "Received & Added to Stock"
                                ? "#059669"
                                : po.status === "Sent via WhatsApp"
                                ? "#2563eb"
                                : "#d97706",
                          }}
                        >
                          {po.status}
                        </span>
                      </div>
                      <div className="hint" style={{ marginTop: "2px" }}>
                        📅 Date: {po.date} • Supplier: <b>{po.supplierName}</b> {po.supplierPhone && `(${po.supplierPhone})`}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="btn sm"
                        onClick={() => handleSendPOWhatsApp(po)}
                        style={{ background: "#25D366", color: "#fff", border: "none" }}
                      >
                        <Send size={13} /> WhatsApp Supplier
                      </button>

                      {po.status !== "Received & Added to Stock" && (
                        <button
                          className="btn primary sm"
                          onClick={() => handleReceivePOStock(po)}
                        >
                          <CheckCircle2 size={13} /> Mark Stock Received
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PO Items List */}
                  <div style={{ background: "var(--paper)", borderRadius: "8px", padding: "10px 14px", marginTop: "10px" }}>
                    <div style={{ fontSize: "11.5px", fontWeight: 800, color: "var(--ink-soft)", textTransform: "uppercase", marginBottom: "6px" }}>
                      Order Items ({po.items.length} SKUs • {po.items.reduce((a, b) => a + b.orderQty, 0)} Units)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "8px" }}>
                      {po.items.map((item) => (
                        <div
                          key={item.productId}
                          style={{
                            background: "var(--card)",
                            border: "1px solid var(--line)",
                            padding: "6px 10px",
                            borderRadius: "6px",
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "12px",
                          }}
                        >
                          <span>{item.productName}</span>
                          <b>Qty: {item.orderQty}</b>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px", fontSize: "13px" }}>
                    <span>Estimated Total: <b style={{ color: "var(--navy)", fontSize: "14px" }}>{inr(po.totalEstimatedCost)}</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
