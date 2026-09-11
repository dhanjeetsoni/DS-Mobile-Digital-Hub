import React, { useRef, useState } from "react";
import { Camera, Sparkles, Upload, AlertCircle, RefreshCw, Plus, PackageSearch, Search } from "lucide-react";
import { Database, Product } from "../types";
import { inr } from "../utils/indianCurrency";
import { identifyProductPhoto, ProductPhotoResult } from "../utils/aiOcr";
import { compressImageToDataUrl, compressImageForScan } from "../utils/imageCompress";
import { naturalMatch } from "../utils/naturalSearch";

interface PhotoStockFinderViewProps {
  db: Database;
  onAddToCart: (p: Product) => void;
  onNavigateToPOS: () => void;
}

// Staff flow: snap/upload a photo of ANY item on the counter or rack ->
// AI identifies what it roughly is (never a price, never a stock number,
// those always come from the shop's own catalog) -> we search the shop's
// real product list by the AI's keywords -> staff picks the actual matching
// in-stock item and adds it straight to the bill. This turns "customer is
// holding up a box, what is this and do we have it" into one photo instead
// of typing / hunting shelves.
export const PhotoStockFinderView: React.FC<PhotoStockFinderViewProps> = ({
  db,
  onAddToCart,
  onNavigateToPOS,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProductPhotoResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runIdentify = async (imgData: string) => {
    setIsProcessing(true);
    setErrorMsg("");
    setResult(null);
    try {
      const res = await identifyProductPhoto(imgData);
      setResult(res);
      setManualQuery([res.brand, res.productName].filter(Boolean).join(" ") || res.searchKeywords.join(" "));
    } catch (err: any) {
      setErrorMsg(err.message || "AI photo search failed. Try typing the item name below instead.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 6.2 speed fix: this used to read the raw file straight off
  // FileReader and send THAT to the AI endpoint — a real phone camera photo
  // is routinely 3-15MB, so on ordinary shop wifi/mobile data the upload
  // itself (not Gemini) was the slow part of "AI photo pehchaan raha hai...".
  // Every other AI-photo entry point in the app (AddProductModal's box scan,
  // etc.) already runs the shot through the shared compressor first — this
  // view was the one place that had been missed. Compressing first (~1280px
  // longest side, ~220KB JPEG, same defaults used everywhere else) keeps the
  // photo legible while cutting the upload to a fraction of its size, which
  // is what actually gets this feature close to the plan's "bahot fast
  // response" target — Gemini's own inference time is not something this
  // app controls.
  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setErrorMsg("");
    setResult(null);
    (async () => {
      try {
        const dataUrl = await compressImageToDataUrl(file);
        setSelectedImage(dataUrl);
        // Phase 6 (AI accuracy): same higher-resolution copy used for the
        // Add Product scan — a brand/model printed on packaging is exactly
        // the kind of small text that benefits from more detail than the
        // smaller preview copy carries.
        const scanDataUrl = await compressImageForScan(file).catch(() => dataUrl);
        await runIdentify(scanDataUrl);
      } catch (err: any) {
        setIsProcessing(false);
        setErrorMsg(err?.message || "Photo process nahi ho payi. Dobara try karein.");
      }
    })();
  };

  // Phase 6 (matching improve) — bug fix: this used to prefer
  // result.searchKeywords whenever a scan had ever happened, even after
  // the person went on to edit the (fully editable) search box by hand —
  // so typing a different query after a photo scan silently kept
  // searching by the old, stale AI keywords instead of what was actually
  // typed. manualQuery is the single always-current source of truth (a
  // scan's keywords only ever *seed* it, right when runIdentify sets it);
  // tokenizing manualQuery itself here is always correct, scan or no scan.
  const searchTerms = manualQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Phase 6 (matching improve) — relevance ranking: previously this was an
  // unordered filter (any single keyword substring anywhere = a match),
  // so a broad AI guess like "cover" could surface every cover in stock in
  // arbitrary catalog order with no way to tell which one the photo
  // actually was. Score each candidate by how many distinct search terms
  // it actually contains (plus a small bonus for the natural-language
  // color-synonym match already used elsewhere in the app) and sort
  // best-first — a product matching 3 of 3 keywords now always outranks
  // one matching only 1 of 3, instead of both being tied for "some" match.
  const matches: Product[] = manualQuery.trim()
    ? db.products
        .map((p) => {
          const haystack = [p.name, p.brand, p.category, p.sku, p.notes, ...(p.compatibleModels || [])]
            .join(" ")
            .toLowerCase();
          const matchedTermCount = searchTerms.filter((t) => haystack.includes(t)).length;
          const naturalBonus = naturalMatch(haystack, manualQuery) ? 0.5 : 0;
          return { product: p, score: matchedTermCount + naturalBonus };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.product)
    : [];

  return (
    <div className="section">
      <div className="section-head">
        <div>
          <h2>📷 Photo Stock Finder — Snap &amp; Sell</h2>
          <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
            Kisi bhi item ki photo lo, AI pehchanega, phir stock mein dhoondh ke seedha bill mein add karo
          </span>
        </div>
        <button className="btn primary sm" onClick={onNavigateToPOS}>
          🛒 Go to Bill / POS
        </button>
      </div>

      <div className="grid cols-2" style={{ alignItems: "flex-start", gap: "18px" }}>
        {/* Left: photo capture */}
        <div>
          <div
            style={{
              border: "2px dashed var(--line)",
              borderRadius: "12px",
              padding: "20px",
              textAlign: "center",
              background: "var(--card)",
              cursor: "pointer",
              position: "relative",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            {selectedImage ? (
              <div style={{ position: "relative" }}>
                <img
                  src={selectedImage}
                  alt="Item preview"
                  style={{ width: "100%", maxHeight: "260px", objectFit: "contain", borderRadius: "8px" }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "8px",
                    right: "8px",
                    background: "rgba(0,0,0,0.7)",
                    color: "#fff",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    fontSize: "11px",
                  }}
                >
                  Click to change photo
                </div>
              </div>
            ) : (
              <div style={{ padding: "30px 10px" }}>
                <Camera size={38} style={{ color: "var(--ink-soft)", marginBottom: "8px" }} />
                <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>
                  Snap / Upload Item Photo
                </div>
                <div className="hint">Phone, glass, cover, charger, cable, earphones — kuch bhi</div>
                <button className="btn primary sm" style={{ marginTop: "12px" }}>
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

          {selectedImage && !isProcessing && (
            <button className="btn sm" style={{ width: "100%", marginTop: "10px" }} onClick={() => runIdentify(selectedImage)}>
              <RefreshCw size={13} /> Re-identify with AI
            </button>
          )}

          {isProcessing && (
            <div style={{ textAlign: "center", padding: "24px 10px" }}>
              <Sparkles size={28} style={{ color: "var(--glow)", animation: "spinCheck 1s linear infinite" }} />
              <div style={{ fontWeight: 700, marginTop: "10px", fontSize: "13px" }}>
                AI photo pehchaan raha hai...
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="alert red" style={{ marginTop: "12px" }}>
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {result && (
            <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "10px", marginTop: "12px" }}>
              <div className="kv"><span>AI ne pehchana:</span><b>{result.itemType || "—"}</b></div>
              {result.brand && <div className="kv"><span>Brand:</span><b>{result.brand}</b></div>}
              {result.productName && <div className="kv"><span>Item:</span><b>{result.productName}</b></div>}
              {result.color && <div className="kv"><span>Color:</span><b>{result.color}</b></div>}
              <div style={{ fontSize: "11px", color: "var(--ink-soft)", marginTop: "6px" }}>
                Price aur stock hamesha aapke apne catalog se hi aate hain — AI se nahi.
              </div>
            </div>
          )}

          {/* Manual/editable search box — always available, even without a photo */}
          <div className="field" style={{ marginTop: "14px" }}>
            <label>Search Query (photo se auto-fill, ya khud type karo)</label>
            <div style={{ position: "relative" }}>
              <input
                placeholder="e.g. Redmi cover, Boat earphones, 65W charger..."
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                style={{ paddingLeft: "34px" }}
              />
              <Search size={16} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }} />
            </div>
          </div>
        </div>

        {/* Right: matching catalog results */}
        <div>
          <div className="section-head">
            <h2 style={{ fontSize: "14px" }}>Matching Items in Your Stock</h2>
            {matches.length > 0 && <span className="badge ok">{matches.length} found</span>}
          </div>

          {!manualQuery.trim() ? (
            <div className="empty" style={{ background: "var(--paper)", borderRadius: "12px", padding: "30px 16px" }}>
              <PackageSearch size={32} style={{ margin: "0 auto 10px", opacity: 0.5, color: "var(--ink-soft)" }} />
              <div style={{ fontSize: "13.5px", color: "var(--ink-soft)" }}>
                Photo lo ya query type karo — matching stock items yahan dikhenge.
              </div>
            </div>
          ) : matches.length === 0 ? (
            <div className="empty" style={{ background: "var(--paper)", borderRadius: "12px", padding: "30px 16px" }}>
              <div style={{ fontSize: "13.5px", fontWeight: 700 }}>Koi matching item stock mein nahi mila</div>
              <div style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: "4px" }}>
                Query change karke try karein, ya Product Catalog mein naya item add karein.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {matches.slice(0, 20).map((p) => {
                const inStock = p.stock > 0;
                return (
                  <div
                    key={p.id}
                    className="card"
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "13.5px" }}>{p.name}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--ink-soft)" }}>
                        {p.brand ? `${p.brand} • ` : ""}{p.category}
                      </div>
                      <div style={{ fontSize: "12.5px", fontWeight: 700, marginTop: "4px" }}>{inr(p.sellingPrice)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`badge ${inStock ? (p.stock <= p.minStock ? "partial" : "ok") : "due"}`} style={{ fontSize: "10.5px" }}>
                        {inStock ? `Stock: ${p.stock}` : "Out of Stock"}
                      </span>
                      <button
                        className="btn primary sm"
                        disabled={!inStock}
                        style={{ display: "block", marginTop: "6px", opacity: inStock ? 1 : 0.5 }}
                        onClick={() => onAddToCart(p)}
                      >
                        <Plus size={13} /> Add to Bill
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
