import React, { useRef, useState } from "react";
import { Sparkles, Upload, CheckCircle2, AlertCircle, X, Plus, RefreshCw, Barcode, ShieldCheck, Search } from "lucide-react";
import { Database, Product } from "../types";
import { uid, genSku, genBarcode } from "../utils/fifoEngine";
import { processAccessoryOcr } from "../utils/aiOcr";
import { compressImageToDataUrl } from "../utils/imageCompress";
import { uploadProductPhotoOrFallback } from "../services/photoStorage";
import { useCompatibleModelsDisplay } from "../hooks/useCompatibleModelsDisplay";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: Database;
  storeId?: string;
  onCreated: (product: Product) => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

const BUILTIN_CATEGORY_OPTIONS = [
  "Tempered Glass",
  "Curved Glass",
  "Back Covers",
  "Charger",
  "Cable",
  "Earphones",
  "Accessories",
  "Spare Parts",
  "General",
];

// Step 6.3 — Micro-AI Helper: instant category suggestion while the Model
// name is typed BY HAND (no photo yet — Step 3.1's photo pipeline already
// handles category for the photo path). Deliberately a tiny local keyword
// match, not a Gemini call — this needs to update on every keystroke and
// the plan is explicit these small helpers must feel invisible/seamless,
// not add an "AI processing..." wait to a field that's typed one letter at
// a time. Curved is checked before flat glass so "Curved Tempered Glass"
// resolves correctly (matches the same wording Step 3.4 already uses).
function suggestCategoryFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  if (/curved|edge to edge|edge-to-edge/.test(t)) return "Curved Glass";
  if (/glass|tempered|screen guard|screen protector/.test(t)) return "Tempered Glass";
  if (/\bcover\b|\bcase\b|\bflip\b|\bback cover\b/.test(t)) return "Back Covers";
  if (/charger|adapter|adaptor/.test(t)) return "Charger";
  if (/cable|wire|cord|type-?c|lightning/.test(t)) return "Cable";
  if (/earphone|earbud|headphone|neckband|bluetooth|handsfree/.test(t)) return "Earphones";
  if (/spare|part|screen module|display panel|folder|flex\b/.test(t)) return "Spare Parts";
  return null;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  db,
  storeId,
  onCreated,
  toast,
}) => {
  const { closing, requestClose, runClosing } = useAnimatedClose(onClose);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Stable per-modal-session id used only as the Storage path segment for
  // this photo — independent of the product's own id (generated at Save
  // time) so the upload can start the moment a photo is picked.
  const photoPathIdRef = useRef<string>(uid("tmp"));

  const [photo, setPhoto] = useState<string>("");
  // True once `photo` holds a real Storage URL rather than a data: URL
  // fallback. Purely informational (small hint in the UI); Save works
  // either way.
  const [photoIsUploaded, setPhotoIsUploaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [aiApplied, setAiApplied] = useState(false);

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Tempered Glass");
  // Step 6.3: once the Owner/staff manually picks a category themselves
  // (or AI already filled it from a photo), the local suggestion below
  // stops offering — it should help before a choice is made, never fight
  // a choice that's already been made.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [compatibleModels, setCompatibleModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  // Step 3.2: once AI (or manual add) fills this with 40+ models (e.g. a
  // "Super X" universal glass), never dump all of them into the form at
  // once — that's both confusing and the exact pattern that caused UI
  // slow/crash (Step 10). Show top 5 + search + "Sabhi Dekhein" instead.
  const modelsDisplay = useCompatibleModelsDisplay(compatibleModels, 5);
  const [screenSizeInches, setScreenSizeInches] = useState<number>(0);
  // Step 3.4b: only set when this item covers a genuine RANGE of screen
  // sizes (e.g. a universal-fit / curved glass) — 0 means "single size,
  // same as screenSizeInches".
  const [screenSizeMaxInches, setScreenSizeMaxInches] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const isScreenAccessory = category === "Tempered Glass" || category === "Curved Glass" || category === "Back Covers";

  // These are always left blank for the shop to fill in — never guessed by AI.
  // Step 3.3 — 4-Tier Pricing: Original (purchasePrice) → Confidential →
  // Selling → MRP. Only Original + Selling were wired up before; this adds
  // the missing two tiers.
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [confidentialPrice, setConfidentialPrice] = useState<number>(0);
  const [sellingPrice, setSellingPrice] = useState<number>(0);
  const [mrp, setMrp] = useState<number>(0);
  // Step 2026-09-04 — "Super X glass" style brand-price auto-fill: many
  // accessory brands (a universal tempered-glass brand, a cable brand, etc)
  // sell every model at the exact same 4-tier price — only the Model name
  // changes per catalog entry. Once the shop has entered that brand's price
  // once for this category, every next model under the same
  // Brand + Category should not need retyping it. Purely a convenience
  // pre-fill: always editable, and never overwrites a price the shop has
  // already typed in this form.
  const [priceAutoFilledHint, setPriceAutoFilledHint] = useState<string>("");
  const priceFieldsAreBlank = () => !purchasePrice && !confidentialPrice && !sellingPrice && !mrp;
  const tryAutoFillPriceFromBrand = (brandValue: string, categoryValue: string) => {
    const brandKey = brandValue.trim().toLowerCase();
    if (!brandKey || !priceFieldsAreBlank()) return;
    const match = [...db.products]
      .filter((p) => p.brand?.trim().toLowerCase() === brandKey && p.category === categoryValue)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
    if (!match) { setPriceAutoFilledHint(""); return; }
    setPurchasePrice(match.purchasePrice || 0);
    setConfidentialPrice(match.confidentialPrice || 0);
    setSellingPrice(match.sellingPrice || 0);
    setMrp(match.mrp || 0);
    setPriceAutoFilledHint(`"${brandValue.trim()}" (${categoryValue}) ke pichhle products se price auto-fill ho gaya — chaho to edit kar sakte ho.`);
    toast(`Price "${brandValue.trim()}" brand se auto-fill ho gaya`, "green");
  };
  const [stock, setStock] = useState<number>(0);
  const [minStock, setMinStock] = useState<number>(2);
  const [supplier, setSupplier] = useState("");

  // Barcode: generated once here and saved on the product. Any future
  // camera/handheld scan of this exact code will auto-fill this product
  // into the POS cart with its current selling price.
  const [barcode, setBarcode] = useState<string>("");

  // Warranty: when enabled, checkout will require the customer's name &
  // phone for this product. When disabled, customer details stay optional.
  const [warrantyEnabled, setWarrantyEnabled] = useState<boolean>(false);
  const [warrantyMonths, setWarrantyMonths] = useState<number>(6);
  const [requireCustomerDetails, setRequireCustomerDetails] = useState<boolean>(false);

  if (!isOpen) return null;

  const resetForm = () => {
    setPhoto("");
    setPhotoIsUploaded(false);
    photoPathIdRef.current = uid("tmp");
    setScanError("");
    setAiApplied(false);
    setName("");
    setBrand("");
    setCategory("Tempered Glass");
    setCategoryTouched(false);
    setCompatibleModels([]);
    setModelInput("");
    setScreenSizeInches(0);
    setScreenSizeMaxInches(0);
    setNotes("");
    setPurchasePrice(0);
    setConfidentialPrice(0);
    setSellingPrice(0);
    setMrp(0);
    setStock(0);
    setMinStock(2);
    setSupplier("");
    setIsAddingCategory(false);
    setNewCategoryInput("");
    setBarcode("");
    setWarrantyEnabled(false);
    setWarrantyMonths(6);
    setRequireCustomerDetails(false);
  };

  const handleGenerateBarcode = () => {
    const code = genBarcode();
    setBarcode(code);
    toast(`Barcode generated: ${code} — Save karne par ye product ke saath save ho jayega`, "green");
  };

  // Owner-added categories (db.categories) merged with the built-in list, so
  // once a shop adds "Powerbanks" or "Smart Watches" it shows up here every
  // time — not just for that one save.
  const categoryOptions = Array.from(
    new Set([...BUILTIN_CATEGORY_OPTIONS, ...(db.categories || [])])
  );

  const commitNewCategory = () => {
    const cleaned = newCategoryInput.trim();
    if (!cleaned) { setIsAddingCategory(false); return; }
    if (!db.categories) db.categories = [];
    if (!db.categories.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      db.categories.push(cleaned);
    }
    setCategory(cleaned);
    setCategoryTouched(true);
    setIsAddingCategory(false);
    setNewCategoryInput("");
    toast(`"${cleaned}" category add ho gayi`, "green");
  };

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Compress once here — this same small JPEG is what goes to the AI
    // scanner. The permanent product photo is now uploaded to Supabase
    // Storage in parallel (see uploadProductPhotoOrFallback below) so the
    // synced JSON state only ever holds a short URL, not the image bytes —
    // if that upload fails (offline, cloud not configured) it falls back
    // to the old data: URL behaviour automatically, so nothing breaks.
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setPhoto(dataUrl); // optimistic preview while upload runs
      const uploadPromise = uploadProductPhotoOrFallback(storeId, photoPathIdRef.current, file)
        .then(({ url, uploaded }) => {
          setPhoto(url);
          setPhotoIsUploaded(uploaded);
        })
        .catch(() => {});
      await runScan(dataUrl);
      await uploadPromise;
    } catch (err: any) {
      toast(err?.message || "Photo process nahi ho payi, dobara try karein", "red");
    }
  };

  const runScan = async (imgData: string) => {
    setIsScanning(true);
    setScanError("");
    try {
      const result = await processAccessoryOcr(imgData);
      if (result.brand) setBrand(result.brand);
      if (result.category) { setCategory(result.category); setCategoryTouched(true); }
      if (result.brand || result.productName) {
        setName([result.brand, result.productName].filter(Boolean).join(" — "));
      }
      if (result.compatibleModels?.length) setCompatibleModels(result.compatibleModels);
      if (result.screenSizeInches) setScreenSizeInches(result.screenSizeInches);
      if (result.screenSizeMaxInches) setScreenSizeMaxInches(result.screenSizeMaxInches);
      if (result.notes) setNotes(result.notes);
      setAiApplied(true);
      toast(
        result.compatibleModels?.length
          ? `AI ne ${result.compatibleModels.length} models detect kiye — check karke Save karein`
          : "AI ne photo padh li, models nahi mile — neeche manually add karein",
        result.compatibleModels?.length ? "green" : "amber"
      );
    } catch (err: any) {
      setScanError(err.message || "AI scan fail ho gaya. Details manually bharein.");
    } finally {
      setIsScanning(false);
    }
  };

  const addModelFromInput = () => {
    const raw = modelInput.trim();
    if (!raw) return;
    // allow pasting/typing several models separated by comma or slash at once
    const parts = raw.split(/[,/]/).map((m) => m.trim()).filter(Boolean);
    const merged = [...compatibleModels];
    for (const part of parts) {
      if (!merged.some((m) => m.toLowerCase() === part.toLowerCase())) merged.push(part);
    }
    setCompatibleModels(merged);
    setModelInput("");
  };

  const removeModel = (m: string) => {
    setCompatibleModels(compatibleModels.filter((x) => x !== m));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand.trim()) {
      toast("Brand / Company daalna zaroori hai", "red");
      return;
    }
    if (!name.trim()) {
      toast("Model naam daalna zaroori hai", "red");
      return;
    }
    if (sellingPrice <= 0) {
      toast("Selling price daalna zaroori hai", "red");
      return;
    }
    // Step 3.3 — 4-Tier Pricing ordering: Original ≤ Confidential ≤ Selling.
    // Both extra tiers are optional (owner can leave them at 0 = "not set
    // yet"), but if the owner DOES set a Confidential Price it must sit
    // between Original and Selling, or the whole point of a protected
    // floor is defeated.
    if (confidentialPrice > 0 && purchasePrice > 0 && confidentialPrice < purchasePrice) {
      toast("Confidential Price, Original (Purchase) Price se kam nahi ho sakti.", "red");
      return;
    }
    if (confidentialPrice > 0 && sellingPrice < confidentialPrice) {
      toast("Selling Price, Confidential Price se kam nahi ho sakti — staff isse neeche kabhi bech nahi payega.", "red");
      return;
    }
    if (mrp > 0 && mrp < sellingPrice) {
      // Non-blocking — MRP is display/discount-calculation only, plan
      // doesn't forbid an unusual MRP, just flag it so it isn't a typo.
      toast("Note: MRP, Selling Price se kam hai — check kar lein ki yeh sahi hai.", "amber");
    }
    if (barcode.trim() && db.products.some((p) => p.barcode === barcode.trim())) {
      toast("Ye barcode already kisi doosre product mein use ho raha hai. Naya generate karein.", "red");
      return;
    }

    // ONE catalog item, no matter how many models it fits — stock, price
    // and SKU all live on this single record. Model search just filters
    // by compatibleModels; it never creates a separate row per model.
    const product: Product = {
      id: uid("p"),
      name: name.trim(),
      category,
      brand: brand.trim(),
      sku: genSku(category === "Tempered Glass" || category === "Curved Glass" ? "GLS" : category === "Back Covers" ? "CVR" : "ACC"),
      barcode: barcode.trim() || undefined,
      photo,
      purchasePrice: purchasePrice || null,
      pendingCost: !purchasePrice,
      confidentialPrice: confidentialPrice || null,
      sellingPrice,
      mrp: mrp || null,
      stock,
      minStock,
      warrantyEnabled,
      warrantyMonths: warrantyEnabled ? warrantyMonths : 0,
      requireCustomerDetails: warrantyEnabled ? true : requireCustomerDetails,
      supplier: supplier.trim(),
      notes: notes.trim(),
      compatibleModels,
      screenSizeInches: isScreenAccessory && screenSizeInches ? screenSizeInches : undefined,
      // Step 3.4b: only save a max when it's a real, distinct range (and
      // never below the min — a mistyped/garbage max shouldn't silently
      // widen the match window the wrong way).
      screenSizeMaxInches:
        isScreenAccessory && screenSizeMaxInches && screenSizeMaxInches > screenSizeInches
          ? screenSizeMaxInches
          : undefined,
      createdAt: new Date().toISOString(),
    };

    db.products.push(product);
    onCreated(product);
    toast(`${product.name} added — ${compatibleModels.length || 0} model(s) linked, stock ${stock}`, "green");
    runClosing(() => {
      resetForm();
      onClose();
    });
  };

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`}>
        <div className="modal-head">
          <h3>
            <Sparkles size={18} style={{ color: "var(--glow)", marginRight: "8px", verticalAlign: "middle" }} />
            Add New Product / Item (Glass, Cover, Charger, etc.)
          </h3>
          <button onClick={() => runClosing(() => { resetForm(); onClose(); })}>&times;</button>
        </div>

        <div className="grid cols-2" style={{ alignItems: "flex-start", gap: "18px" }}>
          {/* Left: photo + AI scan */}
          <div>
            <div
              style={{
                border: "2px dashed var(--line)",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
                background: "var(--card)",
                cursor: "pointer",
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {photo ? (
                <img src={photo} alt="Product" style={{ width: "100%", maxHeight: "260px", objectFit: "contain", borderRadius: "8px" }} />
              ) : (
                <div style={{ padding: "26px 10px" }}>
                  <Upload size={34} style={{ color: "var(--ink-soft)", marginBottom: "8px" }} />
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>Packaging ka photo lagayein</div>
                  <div className="hint">AI brand, product name, category aur sab compatible models khud padh lega</div>
                  <div className="hint" style={{ marginTop: "4px" }}>Ye photo compress hoke product ke saath hamesha save rahegi — sab staff ko dikhegi</div>
                  <button type="button" className="btn primary sm" style={{ marginTop: "12px" }}>
                    <Upload size={14} /> Select / Capture Photo
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={handleImageSelected}
              />
            </div>

            {photo && !isScanning && (
              <button type="button" className="btn sm" style={{ width: "100%", marginTop: "10px" }} onClick={() => runScan(photo)}>
                <RefreshCw size={13} /> Re-scan with AI
              </button>
            )}

            {isScanning && (
              <div style={{ textAlign: "center", padding: "20px 10px" }}>
                <Sparkles size={26} style={{ color: "var(--glow)", animation: "spinCheck 1s linear infinite" }} />
                <div style={{ fontWeight: 700, marginTop: "8px", fontSize: "13px" }}>AI photo padh raha hai...</div>
              </div>
            )}

            {scanError && (
              <div className="alert red" style={{ marginTop: "10px" }}>
                <AlertCircle size={16} />
                <span>{scanError}</span>
              </div>
            )}

            {aiApplied && !isScanning && (
              <div className="alert" style={{ marginTop: "10px", background: "var(--green-light)", color: "var(--green)" }}>
                <CheckCircle2 size={16} />
                <span>AI ne form fill kar diya hai — neeche check karke price/stock daalein.</span>
              </div>
            )}
          </div>

          {/* Right: form */}
          <form onSubmit={handleSave}>
            <div className="formgrid">
              <div className="field full" style={{ marginBottom: "2px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--glow)" }}>
                  Sirf 3 cheezein zaroori hain
                </div>
                <div className="hint" style={{ marginTop: "2px" }}>
                  Photo lagate hi AI in teeno ko khud bharne ki koshish karega — phir bhi hamesha edit kar sakte ho.
                </div>
              </div>

              <div className="field">
                <label>1. Brand / Company <span className="req">*</span></label>
                <input
                  value={brand}
                  onChange={(e) => { setBrand(e.target.value); setPriceAutoFilledHint(""); }}
                  onBlur={() => tryAutoFillPriceFromBrand(brand, category)}
                  placeholder="e.g. Super X"
                  required
                />
                <div className="hint">
                  Same Brand + Category ka pehle se koi product ho (e.g. "Super X" Tempered Glass, jisme har model ka price same rehta hai), to niche 4-Tier Pricing khud bhar jayegi.
                </div>
              </div>

              <div className="field">
                <label>2. Model <span className="req">*</span></label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Edge to Edge Tempered Glass" required />
              </div>

              <div className="field">
                <label>3. Category</label>
                {!isAddingCategory ? (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select
                      value={category}
                      onChange={(e) => { setCategory(e.target.value); setCategoryTouched(true); tryAutoFillPriceFromBrand(brand, e.target.value); }}
                      style={{ flex: 1 }}
                    >
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn sm"
                      title="Naya category naam khud add karein"
                      onClick={() => setIsAddingCategory(true)}
                    >
                      <Plus size={13} /> Naya
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      autoFocus
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewCategory(); }
                        if (e.key === "Escape") { setIsAddingCategory(false); setNewCategoryInput(""); }
                      }}
                      placeholder="e.g. Powerbanks, Smart Watches"
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn sm primary" onClick={commitNewCategory}>Add</button>
                    <button type="button" className="btn sm" onClick={() => { setIsAddingCategory(false); setNewCategoryInput(""); }}>&times;</button>
                  </div>
                )}
                {(() => {
                  // Step 6.3: only offered while typing by hand (no photo
                  // AI result and no manual pick yet) and only when it
                  // would actually change something — no chip for "we
                  // already agree".
                  if (categoryTouched) return null;
                  const suggestion = suggestCategoryFromText(`${brand} ${name}`);
                  if (!suggestion || suggestion === category || !categoryOptions.includes(suggestion)) return null;
                  return (
                    <button
                      type="button"
                      className="hint"
                      style={{
                        marginTop: "6px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--glow)",
                        fontWeight: 700,
                      }}
                      onClick={() => { setCategory(suggestion); setCategoryTouched(true); }}
                    >
                      <Sparkles size={12} /> AI Suggestion: "{suggestion}" — Apply karein
                    </button>
                  );
                })()}
              </div>

              {isScreenAccessory && (
                <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                  <label>Compatible Phone Models ({compatibleModels.length})</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addModelFromInput(); }
                      }}
                      placeholder="Type a model and press Enter — ya comma se kai models ek saath paste karein"
                    />
                    <button type="button" className="btn sm" onClick={addModelFromInput}>
                      <Plus size={13} /> Add
                    </button>
                  </div>

                  {compatibleModels.length > 5 && (
                    <div style={{ position: "relative", marginTop: "8px" }}>
                      <Search size={13} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }} />
                      <input
                        value={modelsDisplay.query}
                        onChange={(e) => modelsDisplay.setQuery(e.target.value)}
                        placeholder={`${compatibleModels.length} models mein dhoondein...`}
                        style={{ paddingLeft: "28px", fontSize: "12.5px" }}
                      />
                    </div>
                  )}

                  {compatibleModels.length > 0 && (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                        {modelsDisplay.visible.map((m) => (
                          <span
                            key={m}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "11.5px",
                              fontWeight: 600,
                              background: "var(--card)",
                              border: "1px solid var(--line)",
                              borderRadius: "999px",
                              padding: "3px 8px 3px 10px",
                            }}
                          >
                            {m}
                            <X size={12} style={{ cursor: "pointer" }} onClick={() => removeModel(m)} />
                          </span>
                        ))}
                        {modelsDisplay.isSearching && modelsDisplay.visible.length === 0 && (
                          <span className="hint">Koi model match nahi hua.</span>
                        )}
                      </div>
                      {modelsDisplay.canExpand && (
                        <button
                          type="button"
                          className="btn sm ghost"
                          style={{ marginTop: "8px" }}
                          onClick={() => modelsDisplay.setExpanded(true)}
                        >
                          Sabhi {modelsDisplay.total} Models Dekhein
                        </button>
                      )}
                      {modelsDisplay.expanded && !modelsDisplay.isSearching && (
                        <button
                          type="button"
                          className="btn sm ghost"
                          style={{ marginTop: "8px" }}
                          onClick={() => modelsDisplay.setExpanded(false)}
                        >
                          Kam Dikhayein
                        </button>
                      )}
                    </>
                  )}

                  <div style={{ marginTop: "10px" }}>
                    <label>Screen Size (inches) — optional, for AI matching</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="number" min="0" step="0.1"
                        value={screenSizeInches || ""}
                        onChange={(e) => setScreenSizeInches(Number(e.target.value) || 0)}
                        placeholder="e.g. 6.7"
                        style={{ maxWidth: "110px" }}
                      />
                      <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>se</span>
                      <input
                        type="number" min="0" step="0.1"
                        value={screenSizeMaxInches || ""}
                        onChange={(e) => setScreenSizeMaxInches(Number(e.target.value) || 0)}
                        placeholder="e.g. 6.9 (agar range)"
                        style={{ maxWidth: "140px" }}
                      />
                    </div>
                    <div className="hint" style={{ marginTop: "4px" }}>
                      Universal-fit / Curved Glass jaisi item ho jo ek se zyada screen-size cover kare, to doosra box (Max) bhi bhar dein — jaise 6.5 se 6.7. Ek hi size ke liye Max khaali chhod dein.
                      Model list mein na milne par bhi, isi screen-size range ke doosre phones staff ko search mein AI se dikh jayenge.
                    </div>
                  </div>

                  <div className="hint" style={{ marginTop: "6px" }}>
                    Ye ek hi item hai, chahe jitne models fit ho — stock aur price sirf ek baar niche bharna hai.
                  </div>
                </div>
              )}

              <div className="field full" style={{ borderTop: "1px solid var(--line)", paddingTop: "10px", marginTop: "4px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px" }}>Baaki Details (stock, price waghera)</div>
                <div className="hint" style={{ marginTop: "2px" }}>Yeh AI nahi bhar sakta — sirf aapko pata hai, isliye hamesha manually bharna hoga.</div>
              </div>

              <div className="field">
                <label>Stock Quantity <span className="req">*</span></label>
                <input type="number" min="0" value={stock} onChange={(e) => setStock(Number(e.target.value) || 0)} required />
              </div>

              <div className="field">
                <label>Low-Stock Alert Below</label>
                <input type="number" min="0" value={minStock} onChange={(e) => setMinStock(Number(e.target.value) || 0)} />
              </div>

              <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px" }}>4-Tier Pricing</div>
                <div className="hint" style={{ marginTop: "2px" }}>
                  Original (aapki kharidari) → Confidential (staff sirf Telegram-approval ke baad) → Selling (sab ko dikhta hai) → MRP (sirf display ke liye). Confidential aur MRP optional hain — khali chhod sakte hain.
                </div>
                {priceAutoFilledHint && (
                  <div className="hint" style={{ marginTop: "4px", color: "var(--glow)", fontWeight: 600 }}>
                    ✓ {priceAutoFilledHint}
                  </div>
                )}
              </div>

              <div className="field">
                <label>1. Original / Purchase Price (₹)</label>
                <input type="number" min="0" step="0.01" value={purchasePrice || ""} onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)} placeholder="0" />
                <div className="hint">Sirf aap dekhoge — staff ko kabhi nahi dikhta.</div>
              </div>

              <div className="field">
                <label>2. Confidential Price (₹) <span className="hint">(optional)</span></label>
                <input type="number" min="0" step="0.01" value={confidentialPrice || ""} onChange={(e) => setConfidentialPrice(Number(e.target.value) || 0)} placeholder="Khali chhod sakte hain" />
                <div className="hint">Staff isse neeche kabhi nahi bech payega — sirf aapke Telegram-approval se.</div>
              </div>

              <div className="field">
                <label>3. Selling Price (₹) <span className="req">*</span></label>
                <input type="number" min="0" step="0.01" value={sellingPrice || ""} onChange={(e) => setSellingPrice(Number(e.target.value) || 0)} placeholder="0" required />
                <div className="hint">Sab ko (staff + owner) yahi dikhta hai.</div>
              </div>

              <div className="field">
                <label>4. MRP (₹) <span className="hint">(optional)</span></label>
                <input type="number" min="0" step="0.01" value={mrp || ""} onChange={(e) => setMrp(Number(e.target.value) || 0)} placeholder="Khali chhod sakte hain" />
                <div className="hint">Sirf display/discount-calculation ke liye — profit isse kabhi calculate nahi hota.</div>
              </div>

              <div className="field">
                <label>Supplier / Distributor</label>
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Anand Telecom" />
              </div>

              <div className="field">
                <label>Rack / Location Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Rack B, Box 3" />
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
                <div className="hint" style={{ marginTop: "4px" }}>
                  Save karne ke baad, is barcode ko future mein scan karte hi ye product, uska price aur details automatically POS cart mein aa jayenge.
                </div>
              </div>

              {/* Step 2026-09-04: glass items (Tempered/Curved) never carry a
                  warranty in this business — showing the checkbox every time
                  just invites accidentally ticking it. Hidden outright for
                  these two categories; warrantyEnabled/requireCustomerDetails
                  stay at their default `false`, same as never ticking it by
                  hand, so nothing else needs to change. Back Covers is left
                  out on purpose — some cover brands do offer one. */}
              {category !== "Tempered Glass" && category !== "Curved Glass" && (
              <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                <label><ShieldCheck size={13} style={{ verticalAlign: "middle", marginRight: "4px" }} /> Warranty</label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "13px" }}>
                  <input type="checkbox" checked={warrantyEnabled} onChange={(e) => setWarrantyEnabled(e.target.checked)} />
                  Is product par warranty hai
                </label>
                {warrantyEnabled ? (
                  <>
                    <div style={{ marginTop: "8px" }}>
                      <label>Warranty Duration (months)</label>
                      <input type="number" min="1" value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value) || 1)} style={{ maxWidth: "140px" }} />
                    </div>
                    <div className="hint" style={{ marginTop: "6px" }}>
                      Warranty hone par, sell karte waqt customer ka naam aur phone number lena zaroori hoga.
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "13px", marginTop: "8px" }}>
                      <input type="checkbox" checked={requireCustomerDetails} onChange={(e) => setRequireCustomerDetails(e.target.checked)} />
                      Customer details phir bhi zaroori rakhein (optional)
                    </label>
                    <div className="hint" style={{ marginTop: "4px" }}>
                      Warranty nahi hai — customer details by default optional rahenge, jab tak upar wala checkbox tick na karein.
                    </div>
                  </>
                )}
              </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: "16px" }}>
              <button type="button" className="btn" onClick={() => runClosing(() => { resetForm(); onClose(); })}>Cancel</button>
              <button type="submit" className="btn primary">
                <CheckCircle2 size={16} /> Save Product to Catalog
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
