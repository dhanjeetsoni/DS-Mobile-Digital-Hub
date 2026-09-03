/**
 * The only place in the app that writes theme state to the DOM.
 *
 * A theme change is: two attribute writes and two variable writes on <html>.
 * No React render, no CSS-in-JS injection, no stylesheet swap — which is what
 * makes flipping through ten themes in Settings feel instant even on the shop's
 * low-end Android tablet.
 */

import { DENSITY_SCALE, TEXT_SCALE } from "./themes";
import { useAppearance, type AppearanceState } from "./useAppearance";

type Visual = Pick<AppearanceState, "themeId" | "mode" | "density" | "textSize">;

let lastThemeColor = "";

export function applyAppearance(s: Visual): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  root.dataset.theme = s.themeId;
  root.dataset.mode = s.mode;
  root.style.setProperty("--density", String(DENSITY_SCALE[s.density]));
  root.style.setProperty("--text-scale", String(TEXT_SCALE[s.textSize]));

  // Keep the Android status bar and the PWA splash in step with the canvas.
  // Read the *computed* value so it always matches whatever themes.css resolved
  // to, instead of a hex duplicated in TypeScript that could drift.
  const canvas = getComputedStyle(root).getPropertyValue("--canvas").trim();
  if (canvas && canvas !== lastThemeColor) {
    lastThemeColor = canvas;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = canvas;
  }
}

/**
 * Wire the store to the DOM and to the OS colour-scheme setting.
 * Call once, before the first React render, and keep the returned disposer for
 * hot-reload cleanliness.
 */
export function startAppearanceSync(): () => void {
  applyAppearance(useAppearance.getState());

  const unsubscribe = useAppearance.subscribe(applyAppearance);

  if (typeof window === "undefined" || !window.matchMedia) return unsubscribe;

  const query = window.matchMedia("(prefers-color-scheme: light)");
  const onSystemChange = (event: MediaQueryListEvent): void => {
    // Only obey the OS while the user has asked us to follow it.
    if (!useAppearance.getState().followSystem) return;
    useAppearance.setState({ mode: event.matches ? "light" : "dark" });
  };
  query.addEventListener("change", onSystemChange);

  return () => {
    unsubscribe();
    query.removeEventListener("change", onSystemChange);
  };
}
