/**
 * DS Nexus — theme registry.
 *
 * The colours themselves live in `src/styles/themes.css`; this file is the
 * *catalogue*: the ids TypeScript will enforce, the human labels the picker
 * shows, and four swatch hexes per mode so the picker can preview a theme
 * without mounting it.
 *
 * Swatch hexes are duplicated from the CSS on purpose — they are only ever used
 * for the preview chips. Nothing in the running UI reads a literal colour, so
 * a drift here can never break a screen, and `themes.test.ts` keeps the two
 * lists honest about which ids exist.
 */

export const THEME_IDS = [
  "midnight",
  "nord",
  "emerald",
  "royal",
  "sunset",
  "rose",
  "cyber",
  "slate",
  "paper",
  "contrast",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_MODES = ["dark", "light"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** canvas, surface, brand, accent — in that order. */
export type Swatch = readonly [string, string, string, string];

export interface ThemeMeta {
  readonly id: ThemeId;
  readonly name: string;
  readonly tagline: string;
  /** Mode the theme was designed in; the picker starts here. */
  readonly defaultMode: ThemeMode;
  readonly swatch: Readonly<Record<ThemeMode, Swatch>>;
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "midnight",
    name: "Midnight",
    tagline: "Deep navy — the default face of DS Nexus",
    defaultMode: "dark",
    swatch: {
      dark: ["#0b1020", "#141b33", "#4f7cff", "#22d3ee"],
      light: ["#f5f7fd", "#ffffff", "#2e5bd8", "#0e7490"],
    },
  },
  {
    id: "nord",
    name: "Nord",
    tagline: "Arctic blue-grey, low glare for long shifts",
    defaultMode: "dark",
    swatch: {
      dark: ["#2e3440", "#333b49", "#88c0d0", "#b48ead"],
      light: ["#eceff4", "#ffffff", "#4a7f95", "#8a5f86"],
    },
  },
  {
    id: "emerald",
    name: "Emerald",
    tagline: "Cash green — profit reads at a glance",
    defaultMode: "dark",
    swatch: {
      dark: ["#071410", "#0f231d", "#2fbf7f", "#f5b544"],
      light: ["#f2faf6", "#ffffff", "#0f8a5f", "#b4741a"],
    },
  },
  {
    id: "royal",
    name: "Royal Purple",
    tagline: "Premium feel for the owner command center",
    defaultMode: "dark",
    swatch: {
      dark: ["#120a24", "#1e1539", "#a06bff", "#ffb3d9"],
      light: ["#f8f5ff", "#ffffff", "#7233d8", "#b83280"],
    },
  },
  {
    id: "sunset",
    name: "Sunset Orange",
    tagline: "Warm and high-energy for the retail floor",
    defaultMode: "dark",
    swatch: {
      dark: ["#180c07", "#26170f", "#ff7a2f", "#ffd166"],
      light: ["#fff8f3", "#ffffff", "#d4550a", "#9a6600"],
    },
  },
  {
    id: "rose",
    name: "Rose",
    tagline: "Soft magenta — accessories and gifts",
    defaultMode: "dark",
    swatch: {
      dark: ["#16090f", "#24121a", "#ff5d8f", "#a78bfa"],
      light: ["#fff5f8", "#ffffff", "#d81e60", "#6d3fd4"],
    },
  },
  {
    id: "cyber",
    name: "Cyber Neon",
    tagline: "Near-black with neon — the shop-window look",
    defaultMode: "dark",
    swatch: {
      dark: ["#05070d", "#0b1120", "#00e5ff", "#ff2bd6"],
      light: ["#f2f6f8", "#ffffff", "#0089a7", "#c0009c"],
    },
  },
  {
    id: "slate",
    name: "Slate Mono",
    tagline: "Monochrome — nothing competes with the numbers",
    defaultMode: "dark",
    swatch: {
      dark: ["#0e1013", "#191d22", "#d7dbe0", "#8b95a1"],
      light: ["#f4f5f7", "#ffffff", "#2b3138", "#5c6673"],
    },
  },
  {
    id: "paper",
    name: "Paper Light",
    tagline: "Warm paper — closest match to a printed invoice",
    defaultMode: "light",
    swatch: {
      dark: ["#14120e", "#211d18", "#c99a3f", "#7fa88a"],
      light: ["#f7f3ea", "#fffdf8", "#8a5a1a", "#2f6b4a"],
    },
  },
  {
    id: "contrast",
    name: "High Contrast",
    tagline: "Accessibility — AAA text, borders always visible",
    defaultMode: "light",
    swatch: {
      dark: ["#000000", "#0a0a0a", "#ffe600", "#00ffff"],
      light: ["#ffffff", "#ffffff", "#0000cc", "#7a0099"],
    },
  },
] as const;

/** Layout density. Drives `--density`, which every gap/pad/row-height derives from. */
export const DENSITIES = ["compact", "cosy", "roomy"] as const;
export type Density = (typeof DENSITIES)[number];

export const DENSITY_SCALE: Readonly<Record<Density, number>> = {
  compact: 0.86,
  cosy: 1,
  roomy: 1.14,
};

/** Global text scale. Multiplies the root font-size, so the whole UI grows. */
export const TEXT_SIZES = ["sm", "md", "lg", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const TEXT_SCALE: Readonly<Record<TextSize, number>> = {
  sm: 0.92,
  md: 1,
  lg: 1.08,
  xl: 1.18,
};

const THEME_BY_ID = new Map<ThemeId, ThemeMeta>(THEMES.map((t) => [t.id, t]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_BY_ID.has(value as ThemeId);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

/** Never throws: an unknown id (stale localStorage, hand-edited settings row)
 *  falls back to Midnight rather than rendering an unthemed white screen. */
export function getTheme(id: string | null | undefined): ThemeMeta {
  const found = isThemeId(id) ? THEME_BY_ID.get(id) : undefined;
  return found ?? (THEMES[0] as ThemeMeta);
}

