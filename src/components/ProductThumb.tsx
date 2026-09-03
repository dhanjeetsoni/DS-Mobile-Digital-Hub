import React, { useState } from "react";
import { ImageOff, X } from "lucide-react";

interface ProductThumbProps {
  photo?: string;
  name?: string;
  size?: number;
}

// Small Flipkart-style rounded product thumbnail. Falls back to a neutral
// placeholder icon when a product has no photo yet (older items added
// before this feature existed). Click to view full-size.
export const ProductThumb: React.FC<ProductThumbProps> = ({ photo, name, size = 44 }) => {
  const [open, setOpen] = useState(false);

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
    cursor: photo ? "zoom-in" : "default",
  };

  return (
    <>
      <div style={boxStyle} onClick={() => photo && setOpen(true)} title={name || "Product photo"}>
        {photo ? (
          <img src={photo} alt={name || "Product"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <ImageOff size={Math.round(size * 0.4)} style={{ opacity: 0.35 }} />
        )}
      </div>

      {open && photo && (
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
            <img
              src={photo}
              alt={name || "Product"}
              style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 10, display: "block" }}
            />
            {name && (
              <div style={{ textAlign: "center", color: "#fff", marginTop: 8, fontWeight: 600 }}>{name}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
