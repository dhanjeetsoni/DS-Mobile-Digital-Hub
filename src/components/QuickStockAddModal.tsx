import React, { useRef, useState } from "react";
import { Camera, RotateCcw, Loader2, CheckCircle2, Minus, Plus } from "lucide-react";
import { Database, Product, StockBatch } from "../types";
import { uid, genSku, genBarcode, todayStr } from "../utils/fifoEngine";
import { processAccessoryOcr } from "../utils/aiOcr";
import { compressImageToDataUrl, compressImageForScan } from "../utils/imageCompress";
import { uploadProductPhotoOrFallback } from "../services/photoStorage";
import { isCloudConfigured } from "../services/supabaseClient";
import { queueOfflineOperation, upsertProductCatalog } from "../services/repository";

interface QuickStockAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: Database;
  storeId?: string;
  onCreated: (product: Product) => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

/**
 * Phase 19 — Owner "Fast Stock Add" on DS Mobile
 * (DS_MOBILE_UNIFIED_APP_PLAN.md-style follow-up, PROJECT_PLAN.md Phase
 * 19). A deliberately narrow, camera-first alternative to the full
 * AddProductModal for the one thing an owner actually needs while
 * physically unpacking new stock in the shop: snap a photo, say how many
 * came in, and type the 4 prices. Everything else (exact name wording,
 * compatible-models list, specs) is AI's job here and the owner's job to
 * confirm later — this product saves as reviewStatus "pending_review" and
 * is invisible everywhere (Sell search, Today's Stock, Low Stock) until
 * verified in the Windows Stock Review Queue (StockReviewQueueView.tsx).
 * That verify step reuses the existing EditProductModal for full editing,
 * so this component does not need its own "fix a typo" UI at all.
 *
 * Deliberately NOT here (available Windows-side or in the full
 * AddProductModal instead): barcode, warranty, supplier/notes, a second
 * "back" photo, screen-size range, custom invoice terms. Adding any of
 * those to a screen meant to be used in a hurry, gloves-on, mid-unboxing,
 * would defeat the point.
 */
export const QuickStockAddModal: React.FC<QuickStockAddModalProps> = ({
  isOpen,
  onClose,
  db,
  storeId,
  onCreated,
  toast,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoPathIdRef = useRef<string>(uid("qsa"));

  const [photo, setPhoto] = useState("");
  const [photoIsUploaded, setPhotoIsUploaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [aiName, setAiName] = useState("");
  const [aiBrand, setAiBrand] = useState("");
  const [aiCategory, setAiCategory] = useState("General");
  const [aiCompatibleModels, setAiCompatibleModels] = useState<string[]>([]);

  const [qty, setQty] = useState(1);
  const [sellingPrice, setSellingPrice] = useState<number>(0);
  const [confidentialPrice, setConfidentialPrice] = useState<number>(0);
  const [mrp, setMrp] = useState<number>(0);
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const resetForm = () => {
    setPhoto("");
    setPhotoIsUploaded(false);
    setIsScanning(false);
    setScanDone(false);
    setAiName("");
    setAiBrand("");
    setAiCategory("General");
    setAiCompatibleModels([]);
    setQty(1);
    setSellingPrice(0);
    setConfidentialPrice(0);
    setMrp(0);
    setPurchasePrice(0);
    photoPathIdRef.current = uid("qsa");
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanDone(false);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setPhoto(dataUrl);
      const uploadPromise = uploadProductPhotoOrFallback(storeId, photoPathIdRef.current, file)
        .then(({ url, uploaded }) => {
          setPhoto(url);
          setPhotoIsUploaded(uploaded);
        })
        .catch(() => {});

      setIsScanning(true);
      try {
        const scanDataUrl = await compressImageForScan(file).catch(() => dataUrl);
        const result = await processAccessoryOcr(scanDataUrl);
        setAiBrand(result.brand || "");
        setAiCategory(result.category || "General");
        setAiName([result.brand, result.productName].filter(Boolean).join(" — ") || "New Item");
        setAiCompatibleModels(result.compatibleModels || []);
      } catch {
        // AI scan failing is not fatal here — the owner can still save with
        // qty+prices, and the Windows review step can re-scan/edit anything
        // AI missed. This screen's whole point is speed, not blocking on AI.
        setAiName("New Item");
        toast("AI photo padh nahi paya — koi baat nahi, Windows par review karke naam/details theek kar lena.", "amber");
      } finally {
        setIsScanning(false);
        setScanDone(true);
      }
      await uploadPromise;
    } catch (err: any) {
      toast(err?.message || "Photo process nahi ho payi, dobara try karein", "red");
    }
  };

  const handleSave = () => {
    if (!photo) {
      toast("Pehle photo kheecho", "amber");
      return;
    }
    if (qty <= 0) {
      toast("Quantity 1 ya usse zyada honi chahiye", "amber");
      return;
    }
    if (sellingPrice <= 0) {
      toast("Selling Price bharna zaroori hai", "amber");
      return;
    }
    if (confidentialPrice > 0 && sellingPrice < confidentialPrice) {
      toast("Selling Price, Confidential Price se kam nahi ho sakti", "red");
      return;
    }
    setSaving(true);

    const category = aiCategory || "General";
    const product: Product = {
      id: uid("p"),
      name: aiName.trim() || "New Item",
      category,
      brand: aiBrand.trim(),
      sku: genSku(category === "Tempered Glass" || category === "Curved Glass" ? "GLS" : category === "Back Covers" ? "CVR" : "ACC"),
      barcode: genBarcode(),
      photo,
      photos: [photo],
      purchasePrice: purchasePrice || null,
      pendingCost: !purchasePrice,
      confidentialPrice: confidentialPrice || null,
      sellingPrice,
      mrp: mrp || null,
      stock: qty,
      minStock: 0,
      warrantyEnabled: false,
      warrantyMonths: 0,
      requireCustomerDetails: false,
      supplier: "",
      notes: "",
      compatibleModels: aiCompatibleModels,
      createdAt: new Date().toISOString(),
      // Phase 19 — hidden everywhere (Sell search, Today's Stock, Low
      // Stock) until the owner approves it in the Windows Stock Review
      // Queue. See catalogProducts in App.tsx for the one place this is
      // actually enforced.
      reviewStatus: "pending_review",
    };

    db.products.push(product);

    if (isCloudConfigured && storeId) {
      const idempotencyKey = crypto.randomUUID();
      upsertProductCatalog(storeId, product).catch(async (err) => {
        console.warn("Fast Stock Add cloud write failed; queueing for retry", err);
        try {
          await queueOfflineOperation("product", "products", { product }, idempotencyKey);
        } catch {
          // Local save already succeeded above; this is a best-effort mirror.
        }
      });
    }

    const openingBatch: StockBatch = {
      id: uid("batch"),
      productId: product.id,
      qty,
      remainingQty: qty,
      purchasePrice: purchasePrice || 0,
      date: todayStr(),
      supplier: "",
      source: "opening-stock",
      ref: product.id,
      createdAt: new Date().toISOString(),
    };
    if (!db.stockBatches) db.stockBatches = [];
    db.stockBatches.push(openingBatch);

    onCreated(product);
    toast(`${product.name} save ho gaya — Windows par verify karke Live karo`, "green");
    setSaving(false);
    resetForm();
    onClose();
  };

  return (
    <div className="overlay show">
      <div className="modal" style={{ maxWidth: "420px" }}>
        <div className="modal-head">
          <h3>⚡ Fast Stock Add</h3>
          <button onClick={() => { resetForm(); onClose(); }}>&times;</button>
        </div>

        <div className="hint" style={{ marginBottom: "12px" }}>
          Photo kheencho, quantity aur price daalo, Save karo. Yeh turant nahi
          bikega — Windows par verify karne ke baad hi "Live" hoga.
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handlePhoto}
        />

        <div
          style={{
            border: "2px dashed var(--line)",
            borderRadius: "12px",
            padding: "14px",
            textAlign: "center",
            background: "var(--card)",
            cursor: "pointer",
            marginBottom: "14px",
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {photo ? (
            <div style={{ position: "relative" }}>
              <img src={photo} alt="" style={{ width: "100%", maxHeight: "200px", objectFit: "contain", borderRadius: "8px" }} />
              <div style={{ marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "12px" }}>
                {isScanning ? (
                  <>
                    <Loader2 size={14} className="spin" /> AI padh raha hai…
                  </>
                ) : scanDone ? (
                  <>
                    <CheckCircle2 size={14} color="#22c55e" /> {aiName || "AI ne detect kiya"}
                  </>
                ) : null}
              </div>
              <button
                type="button"
                className="btn sm"
                style={{ marginTop: "8px" }}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                <RotateCcw size={13} /> Dobara Photo
              </button>
              {!photoIsUploaded && <div className="hint" style={{ marginTop: "4px" }}>Photo upload ho rahi hai…</div>}
            </div>
          ) : (
            <div style={{ padding: "24px 0" }}>
              <Camera size={36} style={{ opacity: 0.6 }} />
              <div style={{ marginTop: "8px", fontWeight: 700 }}>Photo Kheecho</div>
            </div>
          )}
        </div>

        <div className="field">
          <label>Quantity <span className="req">*</span></label>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button type="button" className="btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>
              <Minus size={16} />
            </button>
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              style={{ textAlign: "center", fontSize: "20px", fontWeight: 800, flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => setQty((q) => q + 1)}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="field" style={{ marginTop: "10px" }}>
          <label>Selling Price (₹) <span className="req">*</span></label>
          <input type="number" min="0" step="0.01" value={sellingPrice || ""} onChange={(e) => setSellingPrice(Number(e.target.value) || 0)} placeholder="0" />
        </div>
        <div className="field" style={{ marginTop: "10px" }}>
          <label>Confidential Price (₹) <span className="hint">(optional)</span></label>
          <input type="number" min="0" step="0.01" value={confidentialPrice || ""} onChange={(e) => setConfidentialPrice(Number(e.target.value) || 0)} placeholder="Khali chhod sakte hain" />
        </div>
        <div className="field" style={{ marginTop: "10px" }}>
          <label>MRP (₹) <span className="hint">(optional)</span></label>
          <input type="number" min="0" step="0.01" value={mrp || ""} onChange={(e) => setMrp(Number(e.target.value) || 0)} placeholder="0" />
        </div>
        <div className="field" style={{ marginTop: "10px" }}>
          <label>Original / Purchase Price (₹) <span className="hint">(optional)</span></label>
          <input type="number" min="0" step="0.01" value={purchasePrice || ""} onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)} placeholder="0" />
        </div>

        <div className="modal-actions" style={{ marginTop: "16px" }}>
          <button type="button" className="btn" onClick={() => { resetForm(); onClose(); }}>Cancel</button>
          <button type="button" className="btn primary" disabled={saving || isScanning} onClick={handleSave}>
            {saving ? "Saving…" : isScanning ? "AI ka wait karo…" : "Save (Verify ke liye bhejo)"}
          </button>
        </div>
      </div>
    </div>
  );
};
