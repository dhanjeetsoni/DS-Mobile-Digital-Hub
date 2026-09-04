import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Lock, Barcode, ShieldCheck, Upload, Sparkles, RefreshCw, AlertCircle, Trash2 } from "lucide-react";
import { Database, Product } from "../types";
import { genBarcode } from "../utils/fifoEngine";
import { compressImageToDataUrl } from "../utils/imageCompress";
import { processAccessoryOcr } from "../utils/aiOcr";
import { ProductThumb } from "./ProductThumb";
import { uploadProductPhotoOrFallback, deleteProductPhotoByUrl, isStorageUrl } from "../services/photoStorage";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface EditProductModalProps {
  isOpen: boolean;
  product: Product | null;
  ownerMode: boolean;
  db?: Database;
  storeId?: string;
  onClose: () => void;
  onSaved: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

// Owner-only editor for an EXISTING product's name/prices/details.
// Stock quantity is deliberately not editable here — quantity changes must
// go through Stock Adjustment / Purchases so the FIFO stockBatches ledger
// stays in sync with product.stock (see StockAdjustView's own bug-fix notes).
export const EditProductModal: React.FC<EditProductModalProps> = ({
  isOpen,
  product,
  ownerMode,
  db,
  storeId,
  onClose,
  onSaved,
  toast,
}) => {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  // Step 3.3 — 4-Tier Pricing: Original → Confidential → Selling → MRP.
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [confidentialPrice, setConfidentialPrice] = useState<number>(0);
  const [sellingPrice, setSellingPrice] = useState<number>(0);
  const [mrp, setMrp] = useState<number>(0);
  const [minStock, setMinStock] = useState<number>(0);
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [barcode, setBarcode] = useState("");
  const [warrantyEnabled, setWarrantyEnabled] = useState(false);
  const [warrantyMonths, setWarrantyMonths] = useState<number>(6);
  const [requireCustomerDetails, setRequireCustomerDetails] = useState(false);

  const [photo, setPhoto] = useState<string>("");
  const [isCompressing, setIsCompressing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // The photo URL/data-URL this product had when the modal opened — used so
  // a replaced/removed Storage photo can be best-effort deleted on Save
  // instead of being left orphaned in the bucket.
  const originalPhotoRef = useRef<string>("");
  const { closing, requestClose } = useAnimatedClose(onClose);

  useEffect(() => {
    if (product) {
      setName(product.name);
      setBrand(product.brand || "");
      setCategory(product.category);
      setPurchasePrice(product.purchasePrice || 0);
      setConfidentialPrice(product.confidentialPrice || 0);
      setSellingPrice(product.sellingPrice);
      setMrp(product.mrp || 0);
      setMinStock(product.minStock);
      setSupplier(product.supplier || "");
      setNotes(product.notes || "");
      setBarcode(product.barcode || "");
      setWarrantyEnabled(!!product.warrantyEnabled);
      setWarrantyMonths(product.warrantyMonths || 6);
      setRequireCustomerDetails(!!product.requireCustomerDetails);
      setPhoto(product.photo || "");
      originalPhotoRef.current = product.photo || "";
      setScanError("");
    }
  }, [product]);

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !product) return;
    setIsCompressing(true);
    try {
      // Compress once for the immediate preview (and for AI re-scan use
      // below); the permanent photo itself now uploads to Supabase Storage
      // — this product already has a stable id, so we can use it directly
      // as the Storage path instead of a temp id.
      const dataUrl = await compressImageToDataUrl(file);
      setPhoto(dataUrl);
      const { url, uploaded } = await uploadProductPhotoOrFallback(storeId, product.id, file);
      setPhoto(url);
      toast(
        uploaded
          ? "Photo cloud par upload ho gayi — \"Save Changes\" dabate hi product par lag jayegi"
          : "Photo compress ho gayi (offline/local) — \"Save Changes\" dabate hi permanently save ho jayegi",
        "green"
      );
    } catch (err: any) {
      toast(err?.message || "Photo process nahi ho payi, dobara try karein", "red");
    } finally {
      setIsCompressing(false);
    }
  };

  // Re-uses the already-saved product photo for a fresh AI read — no new
  // camera capture needed. Only fills fields that exist on this screen
  // (brand/category/name/notes); nothing is re-uploaded or duplicated.
  // If the photo now lives in Storage (a plain https URL) it's fetched and
  // converted back to a data: URL first, since the OCR endpoint needs the
  // actual image bytes, not a link to them.
  const handleRescan = async () => {
    if (!photo) return;
    setIsScanning(true);
    setScanError("");
    try {
      let imgData = photo;
      if (isStorageUrl(photo)) {
        const res = await fetch(photo);
        const blob = await res.blob();
        imgData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Saved photo load nahi ho payi"));
          reader.readAsDataURL(blob);
        });
      }
      const result = await processAccessoryOcr(imgData);
      if (result.brand) setBrand(result.brand);
      if (result.category) setCategory(result.category);
      if (result.brand || result.productName) {
        setName([result.brand, result.productName].filter(Boolean).join(" — "));
      }
      if (result.notes) setNotes(result.notes);
      toast("AI ne saved photo se details refresh kar di — check karke Save karein", "green");
    } catch (err: any) {
      setScanError(err.message || "AI scan fail ho gaya.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleGenerateBarcode = () => {
    const code = genBarcode();
    setBarcode(code);
    toast(`Barcode generated: ${code} — Save Changes dabate hi ye save ho jayega`, "green");
  };

  if (!isOpen || !product) return null;

  // Defense-in-depth: even if this modal is somehow opened while not in
  // owner mode, block the actual edit instead of trusting the caller.
  if (!ownerMode) {
    return (
      <div className={`overlay show ${closing ? "closing" : ""}`}>
        <div className={`modal ${closing ? "closing" : ""}`}>
          <div className="modal-head">
            <h3><Lock size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} /> Owner Access Required</h3>
            <button onClick={requestClose}>&times;</button>
          </div>
          <p className="hint">Price aur product details sirf owner edit kar sakte hain.</p>
          <div className="modal-actions">
            <button className="btn" onClick={requestClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast("Product ka naam daalna zaroori hai", "red");
      return;
    }
    if (sellingPrice <= 0) {
      toast("Selling price daalna zaroori hai", "red");
      return;
    }
    // Step 3.3 — 4-Tier Pricing ordering: Original ≤ Confidential ≤ Selling.
    if (confidentialPrice > 0 && purchasePrice > 0 && confidentialPrice < purchasePrice) {
      toast("Confidential Price, Original (Purchase) Price se kam nahi ho sakti.", "red");
      return;
    }
    if (confidentialPrice > 0 && sellingPrice < confidentialPrice) {
      toast("Selling Price, Confidential Price se kam nahi ho sakti — staff isse neeche kabhi bech nahi payega.", "red");
      return;
    }
    if (mrp > 0 && mrp < sellingPrice) {
      toast("Note: MRP, Selling Price se kam hai — check kar lein ki yeh sahi hai.", "amber");
    }
    if (barcode.trim() && db?.products?.some((p) => p.barcode === barcode.trim() && p.id !== product.id)) {
      toast("Ye barcode already kisi doosre product mein use ho raha hai. Naya generate karein.", "red");
      return;
    }

    product.name = name.trim();
    product.brand = brand.trim();
    product.category = category;
    product.purchasePrice = purchasePrice || null;
    product.pendingCost = !purchasePrice;
    product.confidentialPrice = confidentialPrice || null;
    product.sellingPrice = sellingPrice;
    product.mrp = mrp || null;
    product.minStock = minStock;
    product.supplier = supplier.trim();
    product.notes = notes.trim();
    product.barcode = barcode.trim() || undefined;
    product.warrantyEnabled = warrantyEnabled;
    product.warrantyMonths = warrantyEnabled ? warrantyMonths : 0;
    product.requireCustomerDetails = warrantyEnabled ? true : requireCustomerDetails;
    product.photo = photo;

    // Best-effort cleanup: if the photo was replaced or removed and the OLD
    // value was a real Storage URL, delete that now-unused object. Never
    // blocks or fails the save — see deleteProductPhotoByUrl.
    if (originalPhotoRef.current && originalPhotoRef.current !== photo && isStorageUrl(originalPhotoRef.current)) {
      void deleteProductPhotoByUrl(originalPhotoRef.current);
    }

    onSaved();
    toast(`${product.name} updated`, "green");
    requestClose();
  };

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`}>
        <div className="modal-head">
          <h3>Edit Product — {product.name}</h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        <form onSubmit={handleSave}>
          <div
            className="field full"
            style={{ display: "flex", gap: "12px", alignItems: "center", background: "var(--paper)", padding: "10px 12px", borderRadius: "8px", marginBottom: "12px" }}
          >
            <ProductThumb photo={photo} name={name} size={72} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>Product Photo</div>
              <div className="hint" style={{ marginBottom: "8px" }}>
                Compress hoke permanently save rahegi, sab staff login ko dikhegi — jab tak product delete na ho.
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" className="btn sm" disabled={isCompressing} onClick={() => fileInputRef.current?.click()}>
                  <Upload size={13} /> {photo ? "Photo Badlein" : "Photo Add Karein"}
                </button>
                {photo && (
                  <button type="button" className="btn sm" disabled={isScanning} onClick={handleRescan}>
                    <RefreshCw size={13} /> Re-scan with AI
                  </button>
                )}
                {photo && (
                  <button type="button" className="btn sm" onClick={() => setPhoto("")}>
                    <Trash2 size={13} /> Hatayein
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={handleImageSelected}
              />
              {isScanning && <div className="hint" style={{ marginTop: "6px" }}><Sparkles size={12} /> AI padh raha hai...</div>}
              {scanError && (
                <div className="alert red" style={{ marginTop: "6px", padding: "6px 8px" }}>
                  <AlertCircle size={14} />
                  <span>{scanError}</span>
                </div>
              )}
            </div>
          </div>

          <div className="formgrid">
            <div className="field full">
              <label>Product Name <span className="req">*</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="field">
              <label>Brand / Company</label>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>

            <div className="field">
              <label>Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>

            <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
              <div style={{ fontWeight: 700, fontSize: "13px" }}>4-Tier Pricing</div>
              <div className="hint" style={{ marginTop: "2px" }}>
                Original → Confidential (staff sirf Telegram-approval ke baad) → Selling (sab ko dikhta hai) → MRP (sirf display ke liye).
              </div>
            </div>

            <div className="field">
              <label>1. Original / Purchase Price (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={purchasePrice || ""}
                onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)}
                placeholder="0"
              />
              <div className="hint">Sirf aap dekhoge — staff ko kabhi nahi dikhta.</div>
            </div>

            <div className="field">
              <label>2. Confidential Price (₹) <span className="hint">(optional)</span></label>
              <input
                type="number" min="0" step="0.01"
                value={confidentialPrice || ""}
                onChange={(e) => setConfidentialPrice(Number(e.target.value) || 0)}
                placeholder="Khali chhod sakte hain"
              />
              <div className="hint">Staff isse neeche kabhi nahi bech payega.</div>
            </div>

            <div className="field">
              <label>3. Selling Price (₹) <span className="req">*</span></label>
              <input
                type="number" min="0" step="0.01"
                value={sellingPrice || ""}
                onChange={(e) => setSellingPrice(Number(e.target.value) || 0)}
                required
              />
              <div className="hint">Sab ko (staff + owner) yahi dikhta hai.</div>
            </div>

            <div className="field">
              <label>4. MRP (₹) <span className="hint">(optional)</span></label>
              <input
                type="number" min="0" step="0.01"
                value={mrp || ""}
                onChange={(e) => setMrp(Number(e.target.value) || 0)}
                placeholder="Khali chhod sakte hain"
              />
              <div className="hint">Sirf display/discount-calculation ke liye.</div>
            </div>

            <div className="field">
              <label>Low-Stock Alert Below</label>
              <input
                type="number" min="0"
                value={minStock}
                onChange={(e) => setMinStock(Number(e.target.value) || 0)}
              />
            </div>

            <div className="field">
              <label>Supplier / Distributor</label>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>

            <div className="field full">
              <label>Rack / Location Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
              <label><Barcode size={13} style={{ verticalAlign: "middle", marginRight: "4px" }} /> Barcode</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ""))}
                  placeholder="Generate karein ya khud type/scan karein"
                  style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                />
                <button type="button" className="btn sm primary" onClick={handleGenerateBarcode}>
                  <Barcode size={13} /> Generate Barcode
                </button>
              </div>
            </div>

            {/* Step 2026-09-04: same as AddProductModal — glass items never
                carry a warranty in this business, so hide the section for
                these two categories (kept in sync with the Add form). */}
            {category !== "Tempered Glass" && category !== "Curved Glass" && (
            <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
              <label><ShieldCheck size={13} style={{ verticalAlign: "middle", marginRight: "4px" }} /> Warranty</label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "13px" }}>
                <input type="checkbox" checked={warrantyEnabled} onChange={(e) => setWarrantyEnabled(e.target.checked)} />
                Is product par warranty hai
              </label>
              {warrantyEnabled ? (
                <div style={{ marginTop: "8px" }}>
                  <label>Warranty Duration (months)</label>
                  <input type="number" min="1" value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value) || 1)} style={{ maxWidth: "140px" }} />
                  <div className="hint" style={{ marginTop: "6px" }}>
                    Warranty hone par, sell karte waqt customer ka naam aur phone number lena zaroori hoga.
                  </div>
                </div>
              ) : (
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "13px", marginTop: "8px" }}>
                  <input type="checkbox" checked={requireCustomerDetails} onChange={(e) => setRequireCustomerDetails(e.target.checked)} />
                  Customer details phir bhi zaroori rakhein (optional)
                </label>
              )}
            </div>
            )}
          </div>

          <p className="hint" style={{ marginTop: "10px" }}>
            Stock quantity yahan se edit nahi hoti — usko "Stock Adjustment" page se badlein taaki hisaab sahi rahe.
          </p>

          <div className="modal-actions" style={{ marginTop: "16px" }}>
            <button type="button" className="btn" onClick={requestClose}>Cancel</button>
            <button type="submit" className="btn primary">
              <CheckCircle2 size={16} /> Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
