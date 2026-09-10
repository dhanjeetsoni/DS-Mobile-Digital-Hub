import React, { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ImageOff, Pencil, Trash2, ShoppingCart, Lock, Zap } from "lucide-react";
import type { Product } from "../types";
import { inr, computeDiscountPercent } from "../utils/indianCurrency";

interface ProductDetailViewProps {
  product: Product;
  stock: number;
  isOwner: boolean;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAddToCart?: () => void;
  // Phase 7 — Amazon-style "Buy Now": adds the item to the cart AND jumps
  // straight to the checkout (Sell) screen ready to complete the sale, as
  // opposed to Add to Cart which stays on this page (matches the real
  // Amazon/Flipkart distinction between the two buttons).
  onBuyNow?: () => void;
  // Phase 7 — "Confidential Price" button, reusing the existing Telegram
  // approve/deny flow (confidentialPrice.ts + telegram-connect Edge
  // Function) as-is. This page only surfaces the entry point — App.tsx
  // already owns the request/reveal modal + realtime subscription
  // (ConfidentialPriceModal, wired to the global confidentialPriceProduct
  // state the exact same way the Sell/POS catalog's own 🔒 button already
  // triggers it), so passing this callback is the entire integration.
  onConfidentialPrice?: () => void;
}

// Phase 7: "Dedicated product detail page per product (tap a product ->
// full page), showing MRP (struck through), discount %, and selling
// price, e-commerce style." A full-page takeover (not a modal) — App.tsx
// renders this INSTEAD of the normal page body while a product is being
// viewed, with its own Back button, matching how Amazon/Flipkart open a
// full product page rather than a popup when you tap an item.
export const ProductDetailView: React.FC<ProductDetailViewProps> = ({
  product,
  stock,
  isOwner,
  onBack,
  onEdit,
  onDelete,
  onAddToCart,
  onBuyNow,
  onConfidentialPrice,
}) => {
  const photos = product.photos && product.photos.length > 0 ? product.photos : product.photo ? [product.photo] : [];
  const [activePhoto, setActivePhoto] = useState(0);
  const pct = product.category !== "Cyber Cafe" ? computeDiscountPercent(product.mrp, product.sellingPrice) : null;
  const low = stock <= product.minStock;
  const out = stock <= 0;

  return (
    <div className="section product-detail-page">
      <button className="btn sm" onClick={onBack} style={{ marginBottom: "14px" }}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="product-detail-layout">
        {/* Photo gallery */}
        <div className="product-detail-gallery">
          <div className="product-detail-main-photo">
            {photos.length > 0 ? (
              <>
                <img src={photos[activePhoto]} alt={product.name} />
                {photos.length > 1 && (
                  <>
                    <button
                      className="product-detail-gallery-nav left"
                      onClick={() => setActivePhoto((i) => (i - 1 + photos.length) % photos.length)}
                      aria-label="Previous photo"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      className="product-detail-gallery-nav right"
                      onClick={() => setActivePhoto((i) => (i + 1) % photos.length)}
                      aria-label="Next photo"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="product-detail-no-photo">
                <ImageOff size={40} />
                <span>Photo nahi hai</span>
              </div>
            )}
            {out && <span className="product-card-oos-badge">Out of Stock</span>}
          </div>
          {photos.length > 1 && (
            <div className="product-detail-thumb-strip">
              {photos.map((p, i) => (
                <button
                  key={i}
                  className={`product-detail-thumb ${i === activePhoto ? "active" : ""}`}
                  onClick={() => setActivePhoto(i)}
                >
                  <img src={p} alt={`${product.name} ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="product-detail-info">
          <div className="product-detail-sub">{[product.brand, product.category].filter(Boolean).join(" · ")}</div>
          <h1 className="product-detail-name">{product.name}</h1>

          {/* e-commerce-style price block: MRP struck through, discount %, selling price */}
          <div className="product-detail-price-block">
            <span className="product-detail-price">{inr(product.sellingPrice)}</span>
            {product.mrp ? <span className="product-detail-mrp">{inr(product.mrp)}</span> : null}
            {pct !== null && pct > 0 && <span className="product-detail-discount-badge">{pct}% OFF</span>}
          </div>
          {product.mrp ? (
            <div className="hint" style={{ marginTop: "-4px" }}>MRP inclusive of all taxes</div>
          ) : null}

          {!isOwner && onConfidentialPrice && (
            <button
              className="btn sm ghost"
              style={{ marginTop: "10px" }}
              title="Confidential Price maangein (Owner approval zaroori)"
              onClick={onConfidentialPrice}
            >
              <Lock size={13} /> Confidential Price
            </button>
          )}

          <div className="product-detail-stock-row">
            <span className={`badge ${low ? "danger" : "ok"}`}>
              {out ? "Out of stock" : `${stock} in stock`}
            </span>
            {product.warrantyEnabled ? (
              <span className="badge ok">{product.warrantyMonths} month warranty</span>
            ) : null}
          </div>

          {product.compatibleModels && product.compatibleModels.length > 0 && (
            <div className="product-detail-section">
              <h3>Compatible Models ({product.compatibleModels.length})</h3>
              <div className="product-detail-chip-row">
                {product.compatibleModels.map((m) => (
                  <span key={m} className="product-detail-chip">{m}</span>
                ))}
              </div>
            </div>
          )}

          {(product.screenSizeInches || product.screenSizeMaxInches) ? (
            <div className="product-detail-section">
              <h3>Screen Size</h3>
              <p>
                {product.screenSizeMaxInches && product.screenSizeMaxInches !== product.screenSizeInches
                  ? `${product.screenSizeInches}" – ${product.screenSizeMaxInches}"`
                  : `${product.screenSizeInches}"`}
              </p>
            </div>
          ) : null}

          {product.notes ? (
            <div className="product-detail-section">
              <h3>Notes</h3>
              <p>{product.notes}</p>
            </div>
          ) : null}

          {product.specifications && product.specifications.length > 0 && (
            <div className="product-detail-section">
              <h3>Specifications</h3>
              <table className="product-detail-specs-table">
                <tbody>
                  {product.specifications.map((s, i) => (
                    <tr key={i}>
                      <td>{s.label}</td>
                      <td>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="product-detail-meta-row">
            <span>SKU: {product.sku}</span>
            {product.barcode ? <span>Barcode: {product.barcode}</span> : null}
          </div>

          <div className="product-detail-actions">
            {onBuyNow && !out && (
              <button className="btn primary product-detail-buynow-btn" onClick={onBuyNow}>
                <Zap size={15} /> Buy Now
              </button>
            )}
            {onAddToCart && !out && (
              <button className="btn" onClick={onAddToCart}>
                <ShoppingCart size={15} /> Add to Cart
              </button>
            )}
            {isOwner && onEdit && (
              <button className="btn" onClick={onEdit}>
                <Pencil size={14} /> Edit
              </button>
            )}
            {isOwner && onDelete && (
              <button className="btn danger" onClick={onDelete}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
