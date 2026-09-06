/**
 * Appearance store — theme, light/dark mode, density and text scale.
 *
 * Why a store and not React context alone: appearance is read by non-React code
 * too (the print helper, the Tauri window chrome), and writing it must not
 * re-render the tree. Everything visual is applied by mutating four attributes /
 * two variables on <html>; React never re-renders on a theme change.
 *
 * Persisted to localStorage so a cold start paints the right theme immediately.
 * The Settings screen later mirrors this into the user's Supabase row so the
 * choice follows them to the Android app, but localStorage stays the fast path.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DENSITY_SCALE,
  TEXT_SCALE,
  getTheme,
  isThemeId,
  isThemeMode,
  type Density,
  type TextSize,
  type ThemeId,
  type ThemeMode,
} from "./themes";

export interface AppearanceState {
  themeId: ThemeId;
  mode: ThemeMode;
  /** When true, `mode` tracks the OS `prefers-color-scheme` instead of the pick. */
  followSystem: boolean;
  density: Density;
  textSize: TextSize;
  /** Owner preference: keep the sidebar collapsed to icons. */
  sidebarCollapsed: boolean;

  setTheme: (id: ThemeId) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setFollowSystem: (follow: boolean) => void;
  setDensity: (density: Density) => void;
  setTextSize: (size: TextSize) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const STORAGE_KEY = "ds-nexus.appearance";

function systemMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export const useAppearance = create<AppearanceState>()(
  persist(
    (set, get) => ({
      themeId: "midnight",
      mode: "light",
      followSystem: false,
      density: "cosy",
      textSize: "md",
      sidebarCollapsed: false,

      // Picking a theme also adopts the mode it was designed in, unless the user
      // has explicitly asked to follow the OS. Choosing "Paper Light" and
      // landing in dark sepia is never what someone meant.
      setTheme: (id) => {
        const theme = getTheme(id);
        const next = get().followSystem ? systemMode() : theme.defaultMode;
        set({ themeId: theme.id, mode: next });
      },
      setMode: (mode) => set({ mode, followSystem: false }),
      toggleMode: () =>
        set((s) => ({ mode: s.mode === "dark" ? "light" : "dark", followSystem: false })),
      setFollowSystem: (follow) =>
        set(follow ? { followSystem: true, mode: systemMode() } : { followSystem: false }),
      setDensity: (density) => set({ density }),
      setTextSize: (textSize) => set({ textSize }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      // Guard against a hand-edited or stale payload: anything unrecognised
      // silently reverts to the default rather than booting an unthemed shell.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppearanceState>;
        return {
          ...current,
          themeId: isThemeId(p.themeId) ? p.themeId : current.themeId,
          mode: isThemeMode(p.mode) ? p.mode : current.mode,
          followSystem: typeof p.followSystem === "boolean" ? p.followSystem : false,
          density: p.density && p.density in DENSITY_SCALE ? p.density : current.density,
          textSize: p.textSize && p.textSize in TEXT_SCALE ? p.textSize : current.textSize,
          sidebarCollapsed:
            typeof p.sidebarCollapsed === "boolean" ? p.sidebarCollapsed : false,
        };
      },
    },
  ),
);
