import React, { useEffect, useRef, useState } from "react";
import { Shield, Sparkles, Printer, CheckCircle2, User, Camera, FileText, Upload, X, IdCard } from "lucide-react";
import { Database, SecondHandKYC } from "../types";
import { inr, numberToWordsIndian } from "../utils/indianCurrency";
import { uid, todayStr, genSku, addStockBatch } from "../utils/fifoEngine";
import { BoxOcrModal } from "./BoxOcrModal";
import { OcrPhoneResult } from "../utils/aiOcr";
import { uploadKycPhotoOrFallback, getKycPhotoSignedUrl, isKycStoragePath, KycPhotoKind } from "../services/kycPhotoStorage";
import { useAnimatedClose } from "../hooks/useAnimatedClose";

interface SecondHandKycModalProps {
  db: Database;
  onSave: (kyc: SecondHandKYC) => void;
  onClose: () => void;
  viewingKyc?: SecondHandKYC | null;
  storeId?: string;
  toast?: (msg: string, type?: "green" | "red" | "amber") => void;
}

// Shows a private KYC photo (docPhoto/sellerPhoto). The stored value is
// either a data: URL (renders directly) or a `kyc-photos` bucket path (needs
// a short-lived signed URL, fetched on mount) — see kycPhotoStorage.ts.
const KycPhotoThumb: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [src, setSrc] = useState<string | null>(isKycStoragePath(value) ? null : value);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!isKycStoragePath(value)) {
      setSrc(value);
      return;
    }
    getKycPhotoSignedUrl(value).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [value]);

  if (failed) return null;
  return (
    <div style={{ textAlign: "center" }}>
      {src ? (
        <img
          src={src}
          alt={label}
          style={{ width: "100%", maxWidth: "160px", maxHeight: "160px", objectFit: "cover", borderRadius: "8px", border: "1px solid var(--line)" }}
        />
      ) : (
        <div style={{ width: "160px", height: "160px", borderRadius: "8px", background: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "var(--ink-soft)" }}>
          Loading…
        </div>
      )}
      <div className="hint" style={{ marginTop: "4px" }}>{label}</div>
    </div>
  );
};

// Small tappable capture box — file input with `capture="environment"` opens
// the phone camera directly on mobile, falls back to gallery picker on
// desktop. Compression happens in the caller (handlePhotoSelected) so this
// component just shows a local preview + busy/remove state.
const PhotoCaptureBox: React.FC<{
  label: string;
  icon: React.ReactNode;
  preview: string;
  busy: boolean;
  onSelect: (file: File | null) => void;
  onRemove: () => void;
}> = ({ label, icon, preview, busy, onSelect, onRemove }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        width: "140px",
        border: "1.5px dashed var(--line)",
        borderRadius: "10px",
        padding: "8px",
        textAlign: "center",
        background: "var(--card)",
        position: "relative",
        cursor: busy ? "wait" : "pointer",
      }}
      onClick={() => !busy && !preview && inputRef.current?.click()}
    >
      {preview ? (
        <>
          <img src={preview} alt={label} style={{ width: "100%", height: "90px", objectFit: "cover", borderRadius: "6px" }} />
          {!busy && (
            <button
              type="button"
              className="btn sm"
              style={{ position: "absolute", top: "4px", right: "4px", padding: "2px 6px" }}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X size={12} />
            </button>
          )}
        </>
      ) : (
        <div style={{ padding: "16px 4px", color: "var(--ink-soft)" }}>{icon}</div>
      )}
      <div className="hint" style={{ marginTop: "4px", fontSize: "11px" }}>
        {busy ? "Uploading…" : label}
      </div>
      {!preview && (
        <button type="button" className="btn sm" style={{ marginTop: "4px", width: "100%" }} disabled={busy}>
          <Upload size={12} /> {busy ? "..." : "Select"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        disabled={busy}
        onChange={(e) => onSelect(e.target.files?.[0] || null)}
      />
    </div>
  );
};

export const SecondHandKycModal: React.FC<SecondHandKycModalProps> = ({
  db,
  onSave,
  onClose,
  viewingKyc,
  storeId,
  toast,
}) => {
  const [isOcrOpen, setIsOcrOpen] = useState(false);
  const { closing, requestClose } = useAnimatedClose(onClose);
  // Stable id for this in-progress KYC's photo paths, independent of the
  // final voucher/record id (generated at save time) — so upload can start
  // the moment a photo is picked, same pattern as AddProductModal.
  const kycPhotoIdRef = useRef<string>(uid("tmp"));
  const [docPhotoPreview, setDocPhotoPreview] = useState<string>("");
  const [sellerPhotoPreview, setSellerPhotoPreview] = useState<string>("");
  const [docPhotoBusy, setDocPhotoBusy] = useState(false);
  const [sellerPhotoBusy, setSellerPhotoBusy] = useState(false);
  const [formData, setFormData] = useState({
    sellerName: viewingKyc?.sellerName || "",
    sellerPhone: viewingKyc?.sellerPhone || "",
    sellerAddress: viewingKyc?.sellerAddress || "",
    aadhaarNumber: viewingKyc?.aadhaarNumber || "",
    idProofType: viewingKyc?.idProofType || "Aadhaar Card",
    brand: viewingKyc?.brand || "",
    modelName: viewingKyc?.modelName || "",
    imei1: viewingKyc?.imei1 || "",
    imei2: viewingKyc?.imei2 || "",
    serialNo: viewingKyc?.serialNo || "",
    color: viewingKyc?.color || "",
    ramStorage: viewingKyc?.ramStorage || "",
    conditionGrade: viewingKyc?.conditionGrade || "Good",
    purchaseAmountPaid: viewingKyc?.purchaseAmountPaid || 0,
    expectedSellingPrice: (viewingKyc?.purchaseAmountPaid || 0) * 1.25 || 0,
    paymentMethod: viewingKyc?.paymentMethod || "Cash",
    frpRemoved: viewingKyc?.frpRemoved ?? true,
    legalDeclarationConfirmed: viewingKyc?.legalDeclarationConfirmed ?? true,
    docPhoto: viewingKyc?.docPhoto || "",
    sellerPhoto: viewingKyc?.sellerPhoto || "",
  });

  const [errorMsg, setErrorMsg] = useState("");
  const isViewing = !!viewingKyc;

  // Compresses (any phone camera size, stays readable — see imageCompress.ts)
  // then uploads to the private kyc-photos bucket, optimistically previewing
  // the local blob immediately so the shopkeeper doesn't wait for the network.
  const handlePhotoSelected = async (kind: KycPhotoKind, file: File | null) => {
    if (!file) return;
    const setBusy = kind === "doc" ? setDocPhotoBusy : setSellerPhotoBusy;
    const setPreview = kind === "doc" ? setDocPhotoPreview : setSellerPhotoPreview;
    setBusy(true);
    try {
      const localUrl = URL.createObjectURL(file);
      setPreview(localUrl);
      const { value, uploaded } = await uploadKycPhotoOrFallback(storeId, kycPhotoIdRef.current, kind, file);
      setFormData((prev) => ({ ...prev, [kind === "doc" ? "docPhoto" : "sellerPhoto"]: value }));
      if (!uploaded) {
        toast?.("Photo save ho gayi (local) — cloud upload baad mein retry hoga", "amber");
      }
    } catch (err: any) {
      toast?.(err?.message || "Photo process nahi ho payi, dobara try karein", "red");
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (kind: KycPhotoKind) => {
    if (kind === "doc") {
      setDocPhotoPreview("");
      setFormData((prev) => ({ ...prev, docPhoto: "" }));
    } else {
      setSellerPhotoPreview("");
      setFormData((prev) => ({ ...prev, sellerPhoto: "" }));
    }
  };

  const handleOcrResult = (res: OcrPhoneResult) => {
    setFormData((prev) => ({
      ...prev,
      brand: res.brand || prev.brand,
      modelName: res.modelName || prev.modelName,
      imei1: res.imei1 || prev.imei1,
      imei2: res.imei2 || prev.imei2,
      serialNo: res.serialNo || prev.serialNo,
      color: res.color || prev.color,
      ramStorage: res.ramStorage || prev.ramStorage,
      purchaseAmountPaid: prev.purchaseAmountPaid || Math.round((res.sellingPriceSuggested || 10000) * 0.75),
      expectedSellingPrice: res.sellingPriceSuggested || Math.round((prev.purchaseAmountPaid || 10000) * 1.3),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formData.sellerName.trim() || !formData.sellerPhone.trim()) {
      setErrorMsg("Seller Name and Phone Number are strictly required.");
      return;
    }
    if (!formData.brand.trim() || !formData.modelName.trim()) {
      setErrorMsg("Phone Brand and Model Name are required.");
      return;
    }
    if (!formData.imei1.trim() || formData.imei1.trim().length < 14) {
      setErrorMsg("Valid 15-digit IMEI 1 is required for legal device tracking.");
      return;
    }
    // BUG FIX: no check meant the same physical secondhand device could be
    // bought back / registered twice, inflating stock for a phone the shop
    // doesn't actually have two of.
    const imei1Clean = formData.imei1.trim();
    const dupeInRegistry = (db.imeiRegistry || []).find((u) => u.imei1 === imei1Clean);
    const dupeInProducts = db.products.some((p) => (p.units || []).some((u) => u.imei1 === imei1Clean));
    if ((dupeInRegistry || dupeInProducts) && !isViewing) {
      setErrorMsg(`IMEI ${imei1Clean} is already registered in stock. Check the IMEI Audit list before adding again.`);
      return;
    }
    if (!formData.purchaseAmountPaid || formData.purchaseAmountPaid <= 0) {
      setErrorMsg("Purchase amount paid must be greater than 0.");
      return;
    }
    if (!formData.frpRemoved) {
      setErrorMsg("Please ensure iCloud / Google FRP lock is completely removed before buying.");
      return;
    }
    if (!formData.legalDeclarationConfirmed) {
      setErrorMsg("Legal owner declaration must be confirmed.");
      return;
    }

    const voucherNo = `KYC-${String(db.kycSeq || 1).padStart(5, "0")}`;
    db.kycSeq = (db.kycSeq || 1) + 1;

    // Also auto-register product into 2nd-Hand Mobile catalog
    const productName = `${formData.brand} ${formData.modelName} (Used ${formData.conditionGrade})${
      formData.ramStorage ? ` - ${formData.ramStorage}` : ""
    }`;

    let prod = db.products.find((p) => p.name.toLowerCase() === productName.toLowerCase());
    const imeiUnitId = uid("imei");

    if (!prod) {
      prod = {
        id: uid("p"),
        name: productName,
        category: "Second-Hand Mobile",
        brand: formData.brand,
        sku: genSku("2HD"),
        // sellerPhoto lives in the PRIVATE kyc-photos bucket (or a data: URL
        // fallback) — never assign a private storage path here, since
        // product.photo is rendered directly in <img src> across the app
        // (product lists, invoices) with no signed-URL handling. Only the
        // data: URL fallback case is safe to reuse as-is.
        photo: isKycStoragePath(formData.sellerPhoto) ? "" : formData.sellerPhoto || "",
        purchasePrice: formData.purchaseAmountPaid,
        pendingCost: false,
        sellingPrice: Number(formData.expectedSellingPrice) || Math.round(formData.purchaseAmountPaid * 1.3),
        stock: 1,
        minStock: 1,
        warrantyEnabled: true,
        warrantyMonths: 1, // 1 month shop warranty on testing
        requireCustomerDetails: true,
        supplier: `Seller: ${formData.sellerName} (${formData.sellerPhone})`,
        notes: `Bought back via ${voucherNo}. IMEI: ${formData.imei1}`,
        compatibleModels: [formData.modelName],
        isMobilePhone: true,
        units: [],
        createdAt: new Date().toISOString(),
      };
      db.products.push(prod);
    } else {
      prod.stock += 1;
    }

    const unit = {
      id: imeiUnitId,
      productId: prod.id,
      imei1: formData.imei1.trim(),
      imei2: formData.imei2.trim() || undefined,
      serialNo: formData.serialNo.trim() || undefined,
      color: formData.color.trim() || undefined,
      ramStorage: formData.ramStorage.trim() || undefined,
      condition: (formData.conditionGrade as any) || "Good",
      status: "In Stock" as const,
      costPrice: formData.purchaseAmountPaid,
      isSecondHand: true,
      sellerKycId: voucherNo,
      notes: `Bought from ${formData.sellerName} (Ph: ${formData.sellerPhone}) on ${todayStr()}`,
    };

    if (!prod.units) prod.units = [];
    prod.units.push(unit);
    if (!db.imeiRegistry) db.imeiRegistry = [];
    db.imeiRegistry.push(unit);

    // Add stock batch
    addStockBatch(db, prod.id, 1, formData.purchaseAmountPaid, todayStr(), {
      supplier: formData.sellerName,
      source: "buyback-kyc",
      ref: voucherNo,
    });

    const kycRecord: SecondHandKYC = {
      id: uid("kyc"),
      voucherNo,
      date: todayStr(),
      sellerName: formData.sellerName.trim(),
      sellerPhone: formData.sellerPhone.trim(),
      sellerAddress: formData.sellerAddress.trim(),
      aadhaarNumber: formData.aadhaarNumber.trim(),
      idProofType: formData.idProofType as any,
      brand: formData.brand.trim(),
      modelName: formData.modelName.trim(),
      imei1: formData.imei1.trim(),
      imei2: formData.imei2.trim() || undefined,
      serialNo: formData.serialNo.trim() || undefined,
      color: formData.color.trim() || undefined,
      ramStorage: formData.ramStorage.trim() || undefined,
      conditionGrade: formData.conditionGrade as any,
      purchaseAmountPaid: formData.purchaseAmountPaid,
      paymentMethod: formData.paymentMethod as any,
      frpRemoved: formData.frpRemoved,
      legalDeclarationConfirmed: formData.legalDeclarationConfirmed,
      docPhoto: formData.docPhoto,
      sellerPhoto: formData.sellerPhoto,
      registeredProductId: prod.id,
      createdAt: new Date().toISOString(),
    };

    onSave(kycRecord);
  };

  const handlePrintVoucher = () => {
    window.print();
  };

  return (
    <div className={`overlay show ${closing ? "closing" : ""}`}>
      <div className={`modal wide ${closing ? "closing" : ""}`}>
        <div className="modal-head">
          <h3>
            <Shield size={18} style={{ color: "var(--glow)", marginRight: "8px", verticalAlign: "middle" }} />
            {isViewing ? `2nd-Hand Buyback KYC Voucher — ${viewingKyc.voucherNo}` : "New 2nd-Hand Phone Buyback & KYC Registration"}
          </h3>
          <button onClick={requestClose}>&times;</button>
        </div>

        {!isViewing && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", background: "var(--blue-light)", padding: "10px 14px", borderRadius: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--navy)" }}>
              Have screenshot of "Settings &gt; About Phone" or ID proof?
            </span>
            <button className="btn primary sm" type="button" onClick={() => setIsOcrOpen(true)}>
              <Sparkles size={14} /> Scan About-Phone Screen with AI
            </button>
          </div>
        )}

        {isViewing ? (
          <div id="print-area">
            <div className="invoice-paper" style={{ padding: "20px" }}>
              <div className="status-strip ok">OFFICIAL USED DEVICE BUYBACK KYC &amp; LEGAL PURCHASE VOUCHER</div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: "12px", marginTop: "12px" }}>
                <div>
                  <h2 style={{ margin: 0, color: "var(--navy)", fontSize: "18px" }}>{db.settings.shopName}</h2>
                  <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>{db.settings.address} • Ph: {db.settings.phone}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: "15px" }}>{viewingKyc.voucherNo}</div>
                  <div style={{ fontSize: "12px" }}>Date: {viewingKyc.date}</div>
                </div>
              </div>

              <div className="invoice-tag-row" style={{ marginTop: "16px" }}>
                <div className="itag">SELLER NAME<b>{viewingKyc.sellerName}</b></div>
                <div className="itag">MOBILE NO<b>{viewingKyc.sellerPhone}</b></div>
                <div className="itag">GOVT ID / AADHAAR<b>{viewingKyc.idProofType}: {viewingKyc.aadhaarNumber || "Recorded"}</b></div>
                <div className="itag">PAYMENT METHOD<b>{viewingKyc.paymentMethod}</b></div>
              </div>

              <table style={{ marginTop: "12px" }}>
                <thead>
                  <tr>
                    <th>Device Details</th>
                    <th>IMEI 1</th>
                    <th>IMEI 2 / S/N</th>
                    <th>Grade</th>
                    <th>Amount Paid</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><b>{viewingKyc.brand} {viewingKyc.modelName}</b><br/><span className="hint">{viewingKyc.ramStorage} {viewingKyc.color}</span></td>
                    <td><b>{viewingKyc.imei1}</b></td>
                    <td>{viewingKyc.imei2 || viewingKyc.serialNo || "—"}</td>
                    <td><span className="badge ok">{viewingKyc.conditionGrade}</span></td>
                    <td><b>{inr(viewingKyc.purchaseAmountPaid)}</b></td>
                  </tr>
                </tbody>
              </table>

              <div className="amount-words" style={{ marginTop: "14px" }}>
                <b>Amount Paid in Words:</b> {numberToWordsIndian(viewingKyc.purchaseAmountPaid)}
              </div>

              {(viewingKyc.docPhoto || viewingKyc.sellerPhoto) && (
                <div style={{ display: "flex", gap: "16px", marginTop: "14px" }}>
                  {viewingKyc.docPhoto && <KycPhotoThumb value={viewingKyc.docPhoto} label="ID Proof Photo" />}
                  {viewingKyc.sellerPhoto && <KycPhotoThumb value={viewingKyc.sellerPhoto} label="Seller Photo" />}
                </div>
              )}

              <div style={{ marginTop: "16px", background: "var(--paper)", padding: "12px", borderRadius: "8px", fontSize: "11.5px", lineHeight: "1.6", color: "var(--ink-soft)" }}>
                <b>Seller Legal Undertaking &amp; Declaration:</b><br />
                I, <b>{viewingKyc.sellerName}</b>, hereby declare that I am the sole legal owner of the smartphone with IMEI <b>{viewingKyc.imei1}</b>. I confirm that all iCloud, Google FRP, and personal accounts have been permanently unlinked and formatted. This phone is not stolen, blacklisted, or tied to active unresolved finance disputes.
              </div>

              <div className="invoice-foot-grid" style={{ marginTop: "24px" }}>
                <div className="sign-box">
                  <div className="sign-line">Seller Signature</div>
                </div>
                <div className="sign-box">
                  <div className="sign-line">Store Authorized Signatory</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="grid cols-2" style={{ gap: "16px" }}>
              {/* Seller Information */}
              <div className="section" style={{ padding: "14px", boxShadow: "none" }}>
                <div className="section-head"><h2 style={{ fontSize: "14px" }}>1. Customer / Seller Details</h2></div>
                <div className="formgrid">
                  <div className="field">
                    <label>Seller Full Name <span className="req">*</span></label>
                    <input
                      value={formData.sellerName}
                      onChange={(e) => setFormData({ ...formData, sellerName: e.target.value })}
                      placeholder="e.g. Ramesh Kumar"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Mobile Number <span className="req">*</span></label>
                    <input
                      value={formData.sellerPhone}
                      onChange={(e) => setFormData({ ...formData, sellerPhone: e.target.value })}
                      placeholder="10-digit phone number"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>ID Proof Type</label>
                    <select
                      value={formData.idProofType}
                      onChange={(e) => setFormData({ ...formData, idProofType: e.target.value as any })}
                    >
                      <option>Aadhaar Card</option>
                      <option>Voter ID</option>
                      <option>Driving License</option>
                      <option>PAN Card</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>ID / Aadhaar Number</label>
                    <input
                      value={formData.aadhaarNumber}
                      onChange={(e) => setFormData({ ...formData, aadhaarNumber: e.target.value })}
                      placeholder="XXXX-XXXX-XXXX"
                    />
                  </div>
                  <div className="field full">
                    <label>Seller Complete Address</label>
                    <input
                      value={formData.sellerAddress}
                      onChange={(e) => setFormData({ ...formData, sellerAddress: e.target.value })}
                      placeholder="Village / Town / City"
                    />
                  </div>
                </div>

                {/* ID proof + seller photo capture — compressed & uploaded to
                    the private kyc-photos bucket (see kycPhotoStorage.ts) */}
                <div style={{ display: "flex", gap: "12px", marginTop: "12px", flexWrap: "wrap" }}>
                  <PhotoCaptureBox
                    label="ID Proof / Aadhaar Photo"
                    icon={<IdCard size={22} />}
                    preview={docPhotoPreview}
                    busy={docPhotoBusy}
                    onSelect={(f) => handlePhotoSelected("doc", f)}
                    onRemove={() => removePhoto("doc")}
                  />
                  <PhotoCaptureBox
                    label="Seller Photo"
                    icon={<Camera size={22} />}
                    preview={sellerPhotoPreview}
                    busy={sellerPhotoBusy}
                    onSelect={(f) => handlePhotoSelected("seller", f)}
                    onRemove={() => removePhoto("seller")}
                  />
                </div>
              </div>

              {/* Phone Specifications & IMEI */}
              <div className="section" style={{ padding: "14px", boxShadow: "none" }}>
                <div className="section-head"><h2 style={{ fontSize: "14px" }}>2. Phone Specifications &amp; IMEI</h2></div>
                <div className="formgrid">
                  <div className="field">
                    <label>Brand <span className="req">*</span></label>
                    <input
                      value={formData.brand}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      placeholder="e.g. Apple, Samsung, Realme"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Model Name <span className="req">*</span></label>
                    <input
                      value={formData.modelName}
                      onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                      placeholder="e.g. iPhone 12 / Redmi Note 11"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Primary IMEI 1 (15-Digit) <span className="req">*</span></label>
                    <input
                      value={formData.imei1}
                      onChange={(e) => setFormData({ ...formData, imei1: e.target.value })}
                      placeholder="15-digit IMEI"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Secondary IMEI 2 (Optional)</label>
                    <input
                      value={formData.imei2}
                      onChange={(e) => setFormData({ ...formData, imei2: e.target.value })}
                      placeholder="IMEI 2"
                    />
                  </div>
                  <div className="field">
                    <label>RAM &amp; Storage</label>
                    <input
                      value={formData.ramStorage}
                      onChange={(e) => setFormData({ ...formData, ramStorage: e.target.value })}
                      placeholder="e.g. 6GB / 128GB"
                    />
                  </div>
                  <div className="field">
                    <label>Color</label>
                    <input
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      placeholder="e.g. Black / Blue"
                    />
                  </div>
                  <div className="field">
                    <label>Physical Condition Grade</label>
                    <select
                      value={formData.conditionGrade}
                      onChange={(e) => setFormData({ ...formData, conditionGrade: e.target.value as any })}
                    >
                      <option value="Flawless">Flawless (Like New, 0 Scratches)</option>
                      <option value="Good">Good (Minor normal usage signs)</option>
                      <option value="Fair">Fair (Noticeable dents/scratches)</option>
                      <option value="Defective">Defective / Needs Parts Repair</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Serial Number (S/N)</label>
                    <input
                      value={formData.serialNo}
                      onChange={(e) => setFormData({ ...formData, serialNo: e.target.value })}
                      placeholder="Optional S/N"
                    />
                  </div>
                </div>
              </div>

              {/* Purchase Pricing & Legal Verification */}
              <div className="section" style={{ gridColumn: "1/-1", padding: "14px", boxShadow: "none" }}>
                <div className="section-head"><h2 style={{ fontSize: "14px" }}>3. Purchase Valuation &amp; Legal Undertaking</h2></div>
                <div className="formgrid">
                  <div className="field">
                    <label>Buyback Amount Paid to Customer (₹) <span className="req">*</span></label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.purchaseAmountPaid || ""}
                      onChange={(e) => setFormData({ ...formData, purchaseAmountPaid: Number(e.target.value) })}
                      placeholder="e.g. 7500"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Expected Showroom Selling Price (₹)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.expectedSellingPrice || ""}
                      onChange={(e) => setFormData({ ...formData, expectedSellingPrice: Number(e.target.value) })}
                      placeholder="e.g. 9999"
                    />
                  </div>
                  <div className="field">
                    <label>Payment Method Given to Customer</label>
                    <select
                      value={formData.paymentMethod}
                      onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as any })}
                    >
                      <option>Cash</option>
                      <option>UPI</option>
                      <option>Bank Transfer</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                    <input
                      type="checkbox"
                      checked={formData.frpRemoved}
                      onChange={(e) => setFormData({ ...formData, frpRemoved: e.target.checked })}
                    />
                    <b>FRP / iCloud Lock Removed:</b> Customer has signed out of Google / Apple ID and device is fully formatted.
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                    <input
                      type="checkbox"
                      checked={formData.legalDeclarationConfirmed}
                      onChange={(e) => setFormData({ ...formData, legalDeclarationConfirmed: e.target.checked })}
                    />
                    <b>Legal Ownership Undertaking:</b> Customer certifies that they are the genuine owner and this device is not disputed or stolen.
                  </label>
                </div>
              </div>
            </div>

            {errorMsg && <div className="alert red" style={{ marginTop: "12px" }}>{errorMsg}</div>}

            <div className="modal-actions" style={{ marginTop: "16px" }}>
              <button className="btn" type="button" onClick={requestClose}>Cancel</button>
              <button className="btn primary" type="submit">
                <CheckCircle2 size={14} /> Complete Buyback &amp; Register IMEI into Stock
              </button>
            </div>
          </form>
        )}

        {isViewing && (
          <div className="modal-actions" style={{ marginTop: "16px" }}>
            <button className="btn" onClick={requestClose}>Close</button>
            <button className="btn primary" onClick={handlePrintVoucher}>
              <Printer size={14} /> Print Legal Buyback Voucher
            </button>
          </div>
        )}

        {isOcrOpen && (
          <BoxOcrModal
            isOpen={isOcrOpen}
            onClose={() => setIsOcrOpen(false)}
            onApplyResult={handleOcrResult}
            defaultType="about_screen"
          />
        )}
      </div>
    </div>
  );
};
