import React, { useState } from "react";
import { Smartphone, Plus, Search, Sparkles, CheckCircle2, Shield, Calendar, Receipt, User, QrCode, Lock } from "lucide-react";
import { Database, IMEIUnit, Product } from "../types";
import { inr } from "../utils/indianCurrency";
import { uid, todayStr, genSku, addStockBatch } from "../utils/fifoEngine";
import { BoxOcrModal } from "./BoxOcrModal";
import { OcrPhoneResult } from "../utils/aiOcr";

interface ImeiAuditViewProps {
  db: Database;
  onUpdate: () => void;
  toast: (msg: string, kind?: string) => void;
  ownerMode: boolean;
  onViewInvoiceByNo?: (invoiceNo: string) => void;
}

export const ImeiAuditView: React.FC<ImeiAuditViewProps> = ({
  db,
  onUpdate,
  toast,
  ownerMode,
  onViewInvoiceByNo,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [filterType, setFilterType] = useState<string>("All");
  const [isAddUnitModalOpen, setIsAddUnitModalOpen] = useState(false);
  const [isOcrOpen, setIsOcrOpen] = useState(false);

  // Form states for registering a new phone unit
  const [phoneForm, setPhoneForm] = useState({
    brand: "",
    modelName: "",
    imei1: "",
    imei2: "",
    serialNo: "",
    color: "",
    ramStorage: "",
    category: "New Mobile" as "New Mobile" | "Second-Hand Mobile",
    condition: "Brand New" as const,
    purchaseCost: 0,
    // Step 3.3 — 4-Tier Pricing applies to phones too. `mrp` already existed
    // here (Box OCR reads it off the box) but was only ever used to
    // *suggest* a sellingPrice default and then silently thrown away —
    // never saved onto the product. Now it, and the new confidentialPrice
    // field, are actually persisted below.
    confidentialPrice: 0,
    sellingPrice: 0,
    mrp: 0,
    supplier: "",
    warrantyMonths: 12,
  });

  // Aggregate all units from products and db.imeiRegistry
  const allUnits: (IMEIUnit & { productName?: string; brand?: string; category?: string; sellingPrice?: number })[] = [];
  const registeredIds = new Set<string>();

  (db.imeiRegistry || []).forEach((u) => {
    const prod = db.products.find((p) => p.id === u.productId);
    allUnits.push({
      ...u,
      productName: prod?.name || "Mobile Phone",
      brand: prod?.brand || "",
      category: prod?.category || (u.isSecondHand ? "Second-Hand Mobile" : "New Mobile"),
      sellingPrice: prod?.sellingPrice || 0,
    });
    registeredIds.add(u.id);
  });

  db.products.forEach((p) => {
    (p.units || []).forEach((u) => {
      if (!registeredIds.has(u.id)) {
        allUnits.push({
          ...u,
          productName: p.name,
          brand: p.brand,
          category: p.category,
          sellingPrice: p.sellingPrice,
        });
        registeredIds.add(u.id);
      }
    });
  });

  const filteredUnits = allUnits.filter((u) => {
    if (filterStatus !== "All" && u.status !== filterStatus) return false;
    if (filterType === "New" && u.isSecondHand) return false;
    if (filterType === "Used" && !u.isSecondHand) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        u.imei1.toLowerCase().includes(q) ||
        (u.imei2 || "").toLowerCase().includes(q) ||
        (u.serialNo || "").toLowerCase().includes(q) ||
        (u.productName || "").toLowerCase().includes(q) ||
        (u.brand || "").toLowerCase().includes(q) ||
        (u.soldInvoiceNo || "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handleOcrResult = (res: OcrPhoneResult) => {
    setPhoneForm((prev) => ({
      ...prev,
      brand: res.brand || prev.brand,
      modelName: res.modelName || prev.modelName,
      imei1: res.imei1 || prev.imei1,
      imei2: res.imei2 || prev.imei2,
      serialNo: res.serialNo || prev.serialNo,
      color: res.color || prev.color,
      ramStorage: res.ramStorage || prev.ramStorage,
      mrp: res.mrp || prev.mrp,
      sellingPrice: res.sellingPriceSuggested || prev.sellingPrice || res.mrp || 0,
      category: res.detectedCategory === "Second-Hand Mobile" ? "Second-Hand Mobile" : "New Mobile",
      condition: res.detectedCategory === "Second-Hand Mobile" ? ("Good" as any) : "Brand New",
      warrantyMonths: res.detectedCategory === "Second-Hand Mobile" ? 1 : 12,
    }));
  };

  const handleRegisterPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerMode) {
      toast("Sirf owner naya phone stock add kar sakte hain", "red");
      return;
    }
    if (!phoneForm.brand.trim() || !phoneForm.modelName.trim()) {
      toast("Brand aur Model naam daalna zaroori hai", "red");
      return;
    }
    if (!phoneForm.imei1.trim() || phoneForm.imei1.trim().length < 14) {
      toast("Sahi 15-digit IMEI 1 daalna zaroori hai", "red");
      return;
    }
    // Step 3.3 — same 4-Tier Pricing ordering rule as AddProductModal /
    // EditProductModal: Original ≤ Confidential ≤ Selling.
    if (phoneForm.confidentialPrice > 0 && phoneForm.purchaseCost > 0 && phoneForm.confidentialPrice < phoneForm.purchaseCost) {
      toast("Confidential Price, Purchase Cost se kam nahi ho sakti.", "red");
      return;
    }
    if (phoneForm.confidentialPrice > 0 && phoneForm.sellingPrice < phoneForm.confidentialPrice) {
      toast("Selling Price, Confidential Price se kam nahi ho sakti — staff isse neeche kabhi bech nahi payega.", "red");
      return;
    }

    // BUG FIX: nothing stopped the same physical phone (same IMEI) from being
    // registered twice — by accident (re-scanning the same box) or by mistake —
    // which silently inflates stock count and lets one physical device be sold
    // under two different invoice records. Block duplicate IMEI1 up front.
    const imei1Clean = phoneForm.imei1.trim();
    const dupeInRegistry = (db.imeiRegistry || []).find((u) => u.imei1 === imei1Clean);
    const dupeInProducts = db.products.some((p) => (p.units || []).some((u) => u.imei1 === imei1Clean));
    if (dupeInRegistry || dupeInProducts) {
      toast(`IMEI ${imei1Clean} is already registered in stock. Check the IMEI Audit list before adding again.`, "red");
      return;
    }

    const productName = `${phoneForm.brand} ${phoneForm.modelName}${
      phoneForm.ramStorage ? ` (${phoneForm.ramStorage})` : ""
    }${phoneForm.color ? ` - ${phoneForm.color}` : ""}`;

    let prod = db.products.find(
      (p) => p.name.toLowerCase() === productName.toLowerCase() && p.category === phoneForm.category
    );

    const unitId = uid("imei");
    const unit: IMEIUnit = {
      id: unitId,
      productId: "",
      imei1: phoneForm.imei1.trim(),
      imei2: phoneForm.imei2.trim() || undefined,
      serialNo: phoneForm.serialNo.trim() || undefined,
      color: phoneForm.color.trim() || undefined,
      ramStorage: phoneForm.ramStorage.trim() || undefined,
      condition: phoneForm.condition as any,
      status: "In Stock",
      costPrice: Number(phoneForm.purchaseCost) || 0,
      isSecondHand: phoneForm.category === "Second-Hand Mobile",
      notes: `Registered on ${todayStr()}. Supplier: ${phoneForm.supplier || "Wholesale Distributor"}`,
    };

    if (!prod) {
      prod = {
        id: uid("p"),
        name: productName,
        category: phoneForm.category,
        brand: phoneForm.brand.trim(),
        sku: genSku(phoneForm.category === "Second-Hand Mobile" ? "2HD" : "PHN"),
        photo: "",
        purchasePrice: Number(phoneForm.purchaseCost) || 0,
        pendingCost: false,
        confidentialPrice: Number(phoneForm.confidentialPrice) || null,
        sellingPrice: Number(phoneForm.sellingPrice) || Number(phoneForm.purchaseCost) * 1.15,
        mrp: Number(phoneForm.mrp) || null,
        stock: 1,
        minStock: 1,
        warrantyEnabled: phoneForm.warrantyMonths > 0,
        warrantyMonths: phoneForm.warrantyMonths,
        requireCustomerDetails: true,
        supplier: phoneForm.supplier || "Mobile Distributor",
        notes: `IMEI tracked product. First unit: ${unit.imei1}`,
        compatibleModels: [phoneForm.modelName.trim()],
        isMobilePhone: true,
        units: [unit],
        createdAt: new Date().toISOString(),
      };
      unit.productId = prod.id;
      db.products.push(prod);
    } else {
      unit.productId = prod.id;
      prod.stock += 1;
      if (!prod.units) prod.units = [];
      prod.units.push(unit);
    }

    if (!db.imeiRegistry) db.imeiRegistry = [];
    db.imeiRegistry.push(unit);

    // Record stock batch
    addStockBatch(db, prod.id, 1, Number(phoneForm.purchaseCost) || 0, todayStr(), {
      supplier: phoneForm.supplier,
      source: "imei-registration",
      ref: unit.imei1,
    });

    onUpdate();
    setIsAddUnitModalOpen(false);
    setPhoneForm({
      brand: "",
      modelName: "",
      imei1: "",
      imei2: "",
      serialNo: "",
      color: "",
      ramStorage: "",
      category: "New Mobile",
      condition: "Brand New",
      purchaseCost: 0,
      confidentialPrice: 0,
      sellingPrice: 0,
      mrp: 0,
      supplier: "",
      warrantyMonths: 12,
    });
    toast(`Phone unit with IMEI ${unit.imei1} added to stock!`, "green");
  };

  return (
    <div>
      <div className="grid cols-4" style={{ marginBottom: "16px" }}>
        <div className="card accent">
          <h3>Total Phone Units</h3>
          <div className="big blue">{allUnits.length}</div>
          <div className="foot">All tracked IMEIs in database</div>
        </div>
        <div className="card">
          <h3>In Stock (Available)</h3>
          <div className="big green">{allUnits.filter((u) => u.status === "In Stock").length}</div>
          <div className="foot">Ready for sale in showroom</div>
        </div>
        <div className="card">
          <h3>Sold Units</h3>
          <div className="big purple">{allUnits.filter((u) => u.status === "Sold").length}</div>
          <div className="foot">With invoice &amp; warranty logs</div>
        </div>
        <div className="card">
          <h3>2nd-Hand Units</h3>
          <div className="big amber">{allUnits.filter((u) => u.isSecondHand).length}</div>
          <div className="foot">With Buyback KYC verification</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>IMEI &amp; Serial Number Audit Ledger</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            {ownerMode ? (
              <>
                <button className="btn sm" onClick={() => setIsOcrOpen(true)}>
                  <Sparkles size={14} /> Scan Box / About-Phone Photo
                </button>
                <button className="btn primary sm" onClick={() => setIsAddUnitModalOpen(true)}>
                  <Plus size={14} /> Register New Phone Unit
                </button>
              </>
            ) : (
              <span className="hint" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Lock size={12} /> Naya phone stock sirf owner add kar sakte hain
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
          <div style={{ flex: 1, minWidth: "240px" }}>
            <input
              placeholder="Search by 15-digit IMEI, Model, Brand, Serial Number or Invoice #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: "8px" }}
            />
          </div>
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid var(--line)", borderRadius: "8px" }}
            >
              <option value="All">All Unit Statuses</option>
              <option value="In Stock">In Stock (Available)</option>
              <option value="Sold">Sold</option>
              <option value="Returned">Returned</option>
              <option value="Under Repair">Under Repair</option>
            </select>
          </div>
          <div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid var(--line)", borderRadius: "8px" }}
            >
              <option value="All">New &amp; 2nd-Hand</option>
              <option value="New">Brand New Only</option>
              <option value="Used">2nd-Hand Only</option>
            </select>
          </div>
        </div>

        {/* Units Table */}
        <div className="table-wrap">
          {filteredUnits.length === 0 ? (
            <div className="empty">No phone units found matching query. Click "Register New Phone Unit" to add.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Primary IMEI 1</th>
                  <th>IMEI 2 / S/N</th>
                  <th>Model / Brand</th>
                  <th>Specs / Color</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Sold Invoice #</th>
                  <th>Selling Price</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnits.slice().reverse().map((u) => {
                  const isInStock = u.status === "In Stock";
                  return (
                    <tr key={u.id}>
                      <td>
                        <b style={{ color: "var(--navy)" }}>{u.imei1}</b>
                      </td>
                      <td>
                        {u.imei2 && <div>{u.imei2}</div>}
                        {u.serialNo && <div className="hint">S/N: {u.serialNo}</div>}
                        {!u.imei2 && !u.serialNo && "—"}
                      </td>
                      <td>
                        <b>{u.productName}</b>
                      </td>
                      <td>
                        {u.ramStorage && <span className="hint">{u.ramStorage} </span>}
                        {u.color && <span className="hint">• {u.color}</span>}
                      </td>
                      <td>
                        <span className={`badge ${u.isSecondHand ? "exch" : "ok"}`}>
                          {u.isSecondHand ? "2nd-Hand" : "Brand New"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${isInStock ? "ok" : "due"}`}>{u.status}</span>
                      </td>
                      <td>
                        {u.soldInvoiceNo ? (
                          <button
                            className="btn sm ghost"
                            style={{ fontWeight: 800, padding: "2px 6px" }}
                            onClick={() => onViewInvoiceByNo && onViewInvoiceByNo(u.soldInvoiceNo!)}
                          >
                            {u.soldInvoiceNo}
                          </button>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td>
                        {u.sellingPrice ? inr(u.sellingPrice) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal: Register Phone Unit — owner only, even if state is somehow set true */}
      {isAddUnitModalOpen && ownerMode && (
        <div className="overlay show">
          <div className="modal wide">
            <div className="modal-head">
              <h3>Register New Smartphone (IMEI / S/N Tracked)</h3>
              <button onClick={() => setIsAddUnitModalOpen(false)}>&times;</button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", background: "var(--blue-light)", padding: "10px 14px", borderRadius: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--navy)" }}>
                Have the retail box sticker or screenshot?
              </span>
              <button className="btn primary sm" type="button" onClick={() => setIsOcrOpen(true)}>
                <Sparkles size={14} /> Auto-Scan with Gemini AI
              </button>
            </div>

            <form onSubmit={handleRegisterPhone}>
              <div className="grid cols-2" style={{ gap: "14px" }}>
                <div className="field">
                  <label>Brand / Manufacturer <span className="req">*</span></label>
                  <input
                    value={phoneForm.brand}
                    onChange={(e) => setPhoneForm({ ...phoneForm, brand: e.target.value })}
                    placeholder="e.g. Samsung, Xiaomi, Apple, Realme, Vivo"
                    required
                  />
                </div>
                <div className="field">
                  <label>Model Name <span className="req">*</span></label>
                  <input
                    value={phoneForm.modelName}
                    onChange={(e) => setPhoneForm({ ...phoneForm, modelName: e.target.value })}
                    placeholder="e.g. Galaxy A15 5G / Redmi Note 13"
                    required
                  />
                </div>
                <div className="field">
                  <label>Primary IMEI 1 (15-Digit) <span className="req">*</span></label>
                  <input
                    value={phoneForm.imei1}
                    onChange={(e) => setPhoneForm({ ...phoneForm, imei1: e.target.value })}
                    placeholder="15-digit number"
                    required
                  />
                </div>
                <div className="field">
                  <label>Secondary IMEI 2 (If Dual SIM)</label>
                  <input
                    value={phoneForm.imei2}
                    onChange={(e) => setPhoneForm({ ...phoneForm, imei2: e.target.value })}
                    placeholder="Secondary IMEI"
                  />
                </div>
                <div className="field">
                  <label>Serial Number (S/N)</label>
                  <input
                    value={phoneForm.serialNo}
                    onChange={(e) => setPhoneForm({ ...phoneForm, serialNo: e.target.value })}
                    placeholder="e.g. R58N..."
                  />
                </div>
                <div className="field">
                  <label>RAM &amp; Storage</label>
                  <input
                    value={phoneForm.ramStorage}
                    onChange={(e) => setPhoneForm({ ...phoneForm, ramStorage: e.target.value })}
                    placeholder="e.g. 6GB / 128GB"
                  />
                </div>
                <div className="field">
                  <label>Color</label>
                  <input
                    value={phoneForm.color}
                    onChange={(e) => setPhoneForm({ ...phoneForm, color: e.target.value })}
                    placeholder="e.g. Midnight Black"
                  />
                </div>
                <div className="field">
                  <label>Category</label>
                  <select
                    value={phoneForm.category}
                    onChange={(e) => setPhoneForm({ ...phoneForm, category: e.target.value as any })}
                  >
                    <option value="New Mobile">New Mobile (Sealed Box)</option>
                    <option value="Second-Hand Mobile">Second-Hand Mobile (Used)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Purchase Cost Price / pc (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={phoneForm.purchaseCost || ""}
                    onChange={(e) => setPhoneForm({ ...phoneForm, purchaseCost: Number(e.target.value) })}
                    placeholder="Cost price"
                  />
                </div>
                <div className="field">
                  <label>Confidential Price (₹) <span className="hint">(optional)</span></label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={phoneForm.confidentialPrice || ""}
                    onChange={(e) => setPhoneForm({ ...phoneForm, confidentialPrice: Number(e.target.value) })}
                    placeholder="Khali chhod sakte hain"
                  />
                  <div className="hint">Staff isse neeche kabhi nahi bech payega.</div>
                </div>
                <div className="field">
                  <label>Showroom Selling Price (₹) <span className="req">*</span></label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={phoneForm.sellingPrice || ""}
                    onChange={(e) => setPhoneForm({ ...phoneForm, sellingPrice: Number(e.target.value) })}
                    placeholder="Selling price"
                    required
                  />
                </div>
                <div className="field">
                  <label>MRP (₹) <span className="hint">(optional — Box OCR auto-fills isse)</span></label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={phoneForm.mrp || ""}
                    onChange={(e) => setPhoneForm({ ...phoneForm, mrp: Number(e.target.value) })}
                    placeholder="Khali chhod sakte hain"
                  />
                </div>
                <div className="field">
                  <label>Supplier / Distributor</label>
                  <input
                    value={phoneForm.supplier}
                    onChange={(e) => setPhoneForm({ ...phoneForm, supplier: e.target.value })}
                    placeholder="e.g. Balaji Telecom Wholesale"
                  />
                </div>
                <div className="field">
                  <label>Warranty Duration (Months)</label>
                  <input
                    type="number"
                    min="0"
                    value={phoneForm.warrantyMonths}
                    onChange={(e) => setPhoneForm({ ...phoneForm, warrantyMonths: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsAddUnitModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  <CheckCircle2 size={14} /> Add Phone Unit to Inventory
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isOcrOpen && ownerMode && (
        <BoxOcrModal
          isOpen={isOcrOpen}
          onClose={() => setIsOcrOpen(false)}
          onApplyResult={(res) => {
            handleOcrResult(res);
            setIsAddUnitModalOpen(true);
          }}
          defaultType="box"
        />
      )}
    </div>
  );
};
