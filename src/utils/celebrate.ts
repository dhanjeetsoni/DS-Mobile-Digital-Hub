/**
 * A tiny, dependency-free confetti burst — used to make a success moment
 * (a green toast right now; easy to call from anywhere else later) feel
 * a bit more fun without pulling in a confetti library.
 *
 * Deliberately vanilla DOM, not a React component: it's fire-and-forget
 * ("something good just happened"), so it doesn't need React state, and a
 * plain function is the smallest, safest way to call it from anywhere —
 * including non-component code — without prop-drilling a component down
 * through the tree.
 */

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#eab308"];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getLayer(): HTMLDivElement {
  let layer = document.getElementById("fx-confetti-layer") as HTMLDivElement | null;
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "fx-confetti-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

/**
 * Spawn a short confetti burst near the top of the screen (where toasts
 * appear). Cleans up after itself; safe to call repeatedly in a row.
 */
export function celebrate(pieceCount = 18): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;

  const layer = getLayer();
  const originX = window.innerWidth - 140; // near the toast stack, top-right

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    const round = Math.random() > 0.5;
    piece.className = `fx-confetti-piece${round ? " round" : ""}`;

    const angle = Math.random() * Math.PI - Math.PI / 2; // fan out sideways/down
    const distance = 60 + Math.random() * 120;
    const x = Math.sin(angle) * distance;
    const y = 100 + Math.random() * 120;
    const rot = 180 + Math.random() * 360;
    const duration = 0.7 + Math.random() * 0.6;
    const delay = Math.random() * 0.15;
    const color = COLORS[i % COLORS.length];

    piece.style.setProperty("--fx-x", `${x}px`);
    piece.style.setProperty("--fx-y", `${y}px`);
    piece.style.setProperty("--fx-rot", `${rot}deg`);
    piece.style.left = `${originX + (Math.random() * 40 - 20)}px`;
    piece.style.top = "24px";
    piece.style.background = color;
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay = `${delay}s`;

    layer.appendChild(piece);
    window.setTimeout(() => piece.remove(), (duration + delay) * 1000 + 50);
  }
}
