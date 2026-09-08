import React, { useState } from "react";
import { ImageOff, X, ChevronLeft, ChevronRight } from "lucide-react";

interface ProductThumbProps {
  photo?: string;
  // Phase 6 — "AI Photo Scan ... product view shows all photos provided".
  // Optional: callers that don't have/pass this keep getting the exact same
  // single-image thumbnail + zoom as before. When present with more than
  // one entry, the zoom view becomes a small prev/next gallery instead of a
  // single image — the small square thumbnail itself is unchanged either
  // way (still just `photo`), so no card/table layout anywhere is affected.
  photos?: string[];
  name?: string;
  size?: number;
}

// Small Flipkart-style rounded product thumbnail. Falls back to a neutral
// placeholder icon when a product has no photo yet (older items added
// before this feature existed). Click to view full-size (or a gallery, when
// more than one photo was provided for this product).
export const ProductThumb: React.FC<ProductThumbProps> = ({ photo, photos, name, size = 44 }) => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const gallery = (photos && photos.length > 0 ? photos : photo ? [photo] : []).filter(Boolean);
  const current = gallery[Math.min(index, gallery.length - 1)] || photo;

  const boxStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--paper)",
    border: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    position: "relative",
    cursor: photo ? "zoom-in" : "default",
  };

  return (
    <>
      <div style={boxStyle} onClick={() => photo && (setIndex(0), setOpen(true))} title={name || "Product photo"}>
        {photo ? (
          <img src={photo} alt={name || "Product"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <ImageOff size={Math.round(size * 0.4)} style={{ opacity: 0.35 }} />
        )}
        {gallery.length > 1 && (
          <div
            style={{
              position: "absolute", bottom: 1, right: 1, background: "rgba(0,0,0,0.65)", color: "#fff",
              fontSize: Math.max(8, Math.round(size * 0.22)), fontWeight: 700, borderRadius: 4, padding: "0 3px", lineHeight: "1.4",
            }}
          >
            {gallery.length}
          </div>
        )}
      </div>

      {open && current && (
        <div
          className="overlay show"
          style={{ zIndex: 9999, background: "rgba(0,0,0,0.75)" }}
          onClick={() => setOpen(false)}
        >
          <div style={{ position: "relative", maxWidth: "92vw", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <button
              className="btn sm"
              style={{ position: "absolute", top: -14, right: -14, borderRadius: "50%", width: 30, height: 30, padding: 0 }}
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
            {gallery.length > 1 && (
              <button
                className="btn sm"
                style={{ position: "absolute", top: "50%", left: -14, transform: "translateY(-50%)", borderRadius: "50%", width: 30, height: 30, padding: 0 }}
                onClick={() => setIndex((i) => (i - 1 + gallery.length) % gallery.length)}
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <img
              src={current}
              alt={name || "Product"}
              style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 10, display: "block" }}
            />
            {gallery.length > 1 && (
              <button
                className="btn sm"
                style={{ position: "absolute", top: "50%", right: -14, transform: "translateY(-50%)", borderRadius: "50%", width: 30, height: 30, padding: 0 }}
                onClick={() => setIndex((i) => (i + 1) % gallery.length)}
              >
                <ChevronRight size={16} />
              </button>
            )}
            {name && (
              <div style={{ textAlign: "center", color: "#fff", marginTop: 8, fontWeight: 600 }}>
                {name}{gallery.length > 1 ? ` (${index + 1}/${gallery.length})` : ""}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
