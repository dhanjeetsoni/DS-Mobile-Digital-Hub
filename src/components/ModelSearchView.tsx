import React, { useState } from "react";
import { Search, Shield, Smartphone, Plus, Layers, CheckCircle2, Box, Sparkles } from "lucide-react";
import { Database, Product } from "../types";
import { inr } from "../utils/indianCurrency";
import { lookupScreenSize } from "../utils/aiOcr";
import { naturalMatch } from "../utils/naturalSearch";
import { useCompatibleModelsDisplay } from "../hooks/useCompatibleModelsDisplay";

// A glass/cover recorded for e.g. 6.7" is treated as fitting a phone whose
// AI-looked-up screen size is within this many inches — phones of the same
// size class print near-identical panel cutouts.
const SCREEN_SIZE_TOLERANCE = 0.15;

interface ModelSearchViewProps {
  db: Database;
  onAddToCart: (p: Product) => void;
  onNavigateToPOS: () => void;
}

// Popular mobile brands & default model catalog mappings
const POPULAR_BRANDS = ["All Brands", "Xiaomi / Redmi", "Samsung", "Realme", "Vivo", "Oppo", "OnePlus", "Apple iPhone", "Motorola", "Infinix / Tecno", "Poco"];

export const ModelSearchView: React.FC<ModelSearchViewProps> = ({
  db,
  onAddToCart,
  onNavigateToPOS,
}) => {
  const [selectedBrand, setSelectedBrand] = useState("All Brands");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<"ALL" | "GLASS" | "COVER">("ALL");
  const [aiScreenSize, setAiScreenSize] = useState<number>(0);
  const [aiLookupState, setAiLookupState] = useState<"idle" | "loading" | "done" | "none">("idle");

  // Collect all products in Tempered Glass, Curved Glass and Back Covers.
  // Step 3.4e: Tempered Glass (flat/normal) and Curved Glass are organized
  // as separate categories in the catalog, but this Quick Finder search is
  // deliberately category-blind — both show up together here.
  const glassAndCoverProducts = db.products.filter(
    (p) =>
      p.category === "Tempered Glass" ||
      p.category === "Curved Glass" ||
      p.category === "Back Covers" ||
      (p.compatibleModels && p.compatibleModels.length > 0) ||
      p.name.toLowerCase().includes("glass") ||
      p.name.toLowerCase().includes("cover")
  );

  const filteredItems = glassAndCoverProducts.filter((p) => {
    if (
      selectedCategoryTab === "GLASS" &&
      p.category !== "Tempered Glass" &&
      p.category !== "Curved Glass" &&
      !p.name.toLowerCase().includes("glass")
    ) {
      return false;
    }
    if (selectedCategoryTab === "COVER" && p.category !== "Back Covers" && !p.name.toLowerCase().includes("cover")) {
      return false;
    }
    if (selectedBrand !== "All Brands") {
      const b = selectedBrand.toLowerCase();
      const matchBrand = p.brand.toLowerCase().includes(b.split(" ")[0].toLowerCase()) ||
        p.name.toLowerCase().includes(b.split(" ")[0].toLowerCase()) ||
        (p.compatibleModels || []).some((m) => m.toLowerCase().includes(b.split(" ")[0].toLowerCase()));
      if (!matchBrand) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = naturalMatch(p.name, searchQuery);
      const matchBrand = naturalMatch(p.brand, searchQuery);
      const matchSku = p.sku.toLowerCase().includes(q);
      const matchCompat = (p.compatibleModels || []).some((m) => naturalMatch(m, searchQuery));
      const matchNotes = naturalMatch(p.notes || "", searchQuery);
      return matchName || matchBrand || matchSku || matchCompat || matchNotes;
    }
    return true;
  });

  // If the exact model name isn't in anyone's compatibleModels list, fall
  // back to AI: ask what screen size that phone has, then show accessories
  // recorded with a matching screenSizeInches. Staff still confirms fit
  // before selling — this only narrows the shelf search.
  // Step 3.4b/c: an item's screen-size compatibility may be a single value
  // OR a genuine range (screenSizeInches = min, screenSizeMaxInches = max,
  // for universal-fit / curved-glass items) — a phone matches if its AI
  // looked-up size falls anywhere inside [min - tolerance, max + tolerance].
  const screenSizeMatches = aiScreenSize
    ? glassAndCoverProducts.filter((p) => {
        if (!p.screenSizeInches) return false;
        const min = p.screenSizeInches;
        const max = p.screenSizeMaxInches && p.screenSizeMaxInches > min ? p.screenSizeMaxInches : min;
        return aiScreenSize >= min - SCREEN_SIZE_TOLERANCE && aiScreenSize <= max + SCREEN_SIZE_TOLERANCE;
      })
    : [];

  const runAiScreenSizeSearch = async () => {
    if (!searchQuery.trim()) return;
    setAiLookupState("loading");
    try {
      const size = await lookupScreenSize(searchQuery.trim());
      if (size) {
        setAiScreenSize(size);
        setAiLookupState("done");
      } else {
        setAiScreenSize(0);
        setAiLookupState("none");
      }
    } catch {
      setAiScreenSize(0);
      setAiLookupState("none");
    }
  };

  return (
    <div className="section">
      <div className="section-head">
        <div>
          <h2>🔍 Tempered Glass &amp; Back Cover Quick Finder</h2>
          <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
            Instant compatibility search for any phone model to locate rack box &amp; add to bill
          </span>
        </div>
        <button className="btn primary sm" onClick={onNavigateToPOS}>
          🛒 Go to Bill / POS
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="searchbar" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            placeholder="🔍 Type Phone Model e.g. 'Redmi Note 12', 'Vivo V29', 'iPhone 15', 'Realme C55'..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setAiScreenSize(0);
              setAiLookupState("idle");
            }}
            style={{ paddingLeft: "38px", fontSize: "15px" }}
            autoFocus
          />
          <Search size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }} />
        </div>
        {searchQuery && (
          <button className="btn sm ghost" onClick={() => setSearchQuery("")}>
            Clear
          </button>
        )}
      </div>

      {/* Category Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {[
          { id: "ALL", label: "🛡️📱 All Glass & Covers" },
          { id: "GLASS", label: "🛡️ Tempered Glass Only (11D / 21D / UV)" },
          { id: "COVER", label: "📱 Back Covers Only (Smoke / TPU / Leather)" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedCategoryTab(tab.id as any)}
            style={{
              padding: "6px 14px",
              borderRadius: "999px",
              fontSize: "12.5px",
              fontWeight: 700,
              border: "1px solid",
              cursor: "pointer",
              background: selectedCategoryTab === tab.id ? "var(--accent)" : "var(--paper)",
              color: selectedCategoryTab === tab.id ? "#ffffff" : "var(--ink)",
              borderColor: selectedCategoryTab === tab.id ? "var(--accent)" : "var(--line)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Brand Chips */}
      <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "10px", marginBottom: "16px" }}>
        {POPULAR_BRANDS.map((brand) => (
          <button
            key={brand}
            onClick={() => setSelectedBrand(brand)}
            style={{
              padding: "5px 12px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid",
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: selectedBrand === brand ? "var(--navy)" : "var(--card)",
              color: selectedBrand === brand ? "#ffffff" : "var(--ink-soft)",
              borderColor: selectedBrand === brand ? "var(--navy)" : "var(--line)",
            }}
          >
            {brand}
          </button>
        ))}
      </div>

      {/* Items Results Grid */}
      {filteredItems.length === 0 && screenSizeMatches.length === 0 ? (
        <div className="empty" style={{ background: "var(--paper)", borderRadius: "12px", padding: "36px 20px" }}>
          <Box size={36} style={{ margin: "0 auto 12px", opacity: 0.5, color: "var(--ink-soft)" }} />
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--ink)" }}>No matching glass or covers found</div>
          <div style={{ fontSize: "12.5px", color: "var(--ink-soft)", marginTop: "4px" }}>
            Try searching for a different keyword like "11D", "Vivo", "Matte", or add this model in Product Catalog.
          </div>
          {searchQuery.trim() && aiLookupState !== "loading" && (
            <button className="btn primary sm" style={{ marginTop: "14px" }} onClick={runAiScreenSizeSearch}>
              <Sparkles size={13} /> AI se "{searchQuery}" ka screen-size match dhoondo
            </button>
          )}
          {aiLookupState === "loading" && (
            <div style={{ marginTop: "14px", fontSize: "12.5px", fontWeight: 700 }}>
              <Sparkles size={14} style={{ animation: "spinCheck 1s linear infinite", verticalAlign: "middle", marginRight: "6px" }} />
              AI phone ka screen size check kar raha hai...
            </div>
          )}
          {aiLookupState === "none" && (
            <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--ink-soft)" }}>
              AI ko is model ka screen size pata nahi chala. Model manually catalog mein add karein.
            </div>
          )}
        </div>
      ) : (
        <>
          {screenSizeMatches.length > 0 && filteredItems.length === 0 && (
            <div className="alert" style={{ marginBottom: "12px", background: "var(--blue-light)", color: "var(--blue)" }}>
              <Sparkles size={16} />
              <span>
                Exact model list mein nahi mila, lekin AI ke hisaab se iska screen size ~{aiScreenSize}" hai — same size ke {screenSizeMatches.length} item(s) neeche dikhaye gaye hain. Sell karne se pehle fit check kar lein.
              </span>
            </div>
          )}
          <div className="grid cols-3" style={{ gap: "14px" }}>
          {(filteredItems.length > 0 ? filteredItems : screenSizeMatches).map((p) => (
            <GlassCoverResultCard key={p.id} product={p} onAddToCart={onAddToCart} />
          ))}
          </div>
        </>
      )}
    </div>
  );
};

// Split out as its own component (not inlined in the .map() above) purely
// so it can call the useCompatibleModelsDisplay hook — each card needs its
// own independent expand/search state, and Hooks can't be called inside a
// loop in the parent's render.
interface GlassCoverResultCardProps {
  product: Product;
  onAddToCart: (p: Product) => void;
}

const GlassCoverResultCard: React.FC<GlassCoverResultCardProps> = ({ product: p, onAddToCart }) => {
  const isGlass = p.category === "Tempered Glass" || p.name.toLowerCase().includes("glass");
  const inStock = p.stock > 0;
  const models = p.compatibleModels || [];
  // Step 3.2: a "Super X"-style universal glass can list 40+ models — never
  // dump them all here. Top 5 by default, a small filter box to search
  // within just this item's list, and "Sabhi Dekhein" to expand on demand.
  const modelsDisplay = useCompatibleModelsDisplay(models, 5);

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${isGlass ? "var(--green)" : "var(--blue)"}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "18px" }}>{isGlass ? "🛡️" : "📱"}</span>
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 800,
                textTransform: "uppercase",
                padding: "2px 6px",
                borderRadius: "4px",
                background: isGlass ? "var(--green-light)" : "var(--blue-light)",
                color: isGlass ? "var(--green)" : "var(--blue)",
              }}
            >
              {p.category}
            </span>
          </div>
          <span
            className={`badge ${inStock ? (p.stock <= p.minStock ? "partial" : "ok") : "due"}`}
            style={{ fontSize: "10.5px" }}
          >
            {inStock ? `Stock: ${p.stock}` : "Out of Stock"}
          </span>
        </div>

        <div style={{ marginTop: "8px", fontWeight: 800, fontSize: "14.5px", color: "var(--ink)" }}>
          {p.name}
        </div>

        {p.brand && (
          <div style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: "2px" }}>
            Brand / Series: <b>{p.brand}</b>
          </div>
        )}

        {/* Compatible Models List — collapsed to top 5 + search + expand (Step 3.2) */}
        {models.length > 0 && (
          <div style={{ marginTop: "8px", background: "var(--paper)", padding: "6px 8px", borderRadius: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
              <div style={{ fontSize: "10px", fontWeight: 800, color: "var(--ink-soft)", textTransform: "uppercase" }}>
                Compatible Models ({models.length}):
              </div>
            </div>

            {models.length > 5 && (
              <div style={{ position: "relative", marginTop: "4px" }}>
                <Search size={11} style={{ position: "absolute", left: "6px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }} />
                <input
                  value={modelsDisplay.query}
                  onChange={(e) => modelsDisplay.setQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="is list mein dhoondein..."
                  style={{ paddingLeft: "22px", fontSize: "11px", padding: "4px 8px 4px 22px", height: "auto" }}
                />
              </div>
            )}

            <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
              {modelsDisplay.visible.length > 0
                ? modelsDisplay.visible.join(" • ")
                : <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>Koi model match nahi hua.</span>}
            </div>

            {modelsDisplay.canExpand && (
              <button
                type="button"
                className="btn sm ghost"
                style={{ marginTop: "6px", fontSize: "11px", padding: "3px 8px" }}
                onClick={(e) => { e.stopPropagation(); modelsDisplay.setExpanded(true); }}
              >
                Sabhi {modelsDisplay.total} Models Dekhein
              </button>
            )}
            {modelsDisplay.expanded && !modelsDisplay.isSearching && (
              <button
                type="button"
                className="btn sm ghost"
                style={{ marginTop: "6px", fontSize: "11px", padding: "3px 8px" }}
                onClick={(e) => { e.stopPropagation(); modelsDisplay.setExpanded(false); }}
              >
                Kam Dikhayein
              </button>
            )}
          </div>
        )}

        {/* Rack / Box Location Notes */}
        {p.notes && (
          <div style={{ fontSize: "11.5px", color: "var(--amber)", marginTop: "6px", fontWeight: 600 }}>
            📍 Rack: {p.notes}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "14px",
          paddingTop: "10px",
          borderTop: "1px solid var(--line-light)",
        }}
      >
        <div>
          <div style={{ fontSize: "10px", color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 700 }}>
            Selling Price
          </div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)" }}>{inr(p.sellingPrice)}</div>
        </div>

        <button
          className="btn primary sm"
          disabled={!inStock}
          onClick={() => onAddToCart(p)}
          style={{ opacity: inStock ? 1 : 0.5 }}
        >
          <Plus size={13} /> {inStock ? "+ Add to Bill" : "Out of Stock"}
        </button>
      </div>
    </div>
  );
};
