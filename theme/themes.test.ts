/**
 * Contract test between the TypeScript theme catalogue and the CSS palettes.
 *
 * The failure this prevents is a real one: add a theme to `THEMES`, forget the
 * CSS block, and the picker offers a theme that renders as unstyled inherited
 * colours. Nothing in a type system catches that, so we assert it here by
 * reading the stylesheet as text.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DENSITY_SCALE, TEXT_SCALE, THEMES, THEME_IDS, getTheme } from "../theme/themes";

const css = readFileSync(
  fileURLToPath(new URL("../styles/themes.css", import.meta.url)),
  "utf8",
);

/** Every token a theme must define in *both* of its blocks. */
const REQUIRED_TOKENS = [
  "canvas",
  "canvas-alt",
  "surface",
  "surface-2",
  "surface-3",
  "line",
  "line-strong",
  "ink",
  "ink-muted",
  "ink-faint",
  "brand",
  "brand-hi",
  "brand-fg",
  "brand-soft",
  "accent",
  "accent-fg",
  "accent-soft",
] as const;

function block(selector: string): string {
  const escaped = selector.replace(/[[\]"^$.*+?()\\|{}]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1] ?? "";
}

function declares(body: string, token: string): boolean {
  return new RegExp(`--${token}\\s*:`).test(body);
}

describe("theme catalogue", () => {
  it("exposes exactly ten themes with unique ids", () => {
    expect(THEMES).toHaveLength(10);
    expect(new Set(THEME_IDS).size).toBe(10);
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  it("gives every theme a name, a tagline and swatches for both modes", () => {
    for (const theme of THEMES) {
      expect(theme.name.length, theme.id).toBeGreaterThan(2);
      expect(theme.tagline.length, theme.id).toBeGreaterThan(8);
      for (const mode of ["dark", "light"] as const) {
        const swatch = theme.swatch[mode];
        expect(swatch, `${theme.id}/${mode}`).toHaveLength(4);
        for (const hex of swatch) {
          expect(hex, `${theme.id}/${mode}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it("falls back to Midnight for unknown or missing ids", () => {
    expect(getTheme(undefined).id).toBe("midnight");
    expect(getTheme(null).id).toBe("midnight");
    expect(getTheme("does-not-exist").id).toBe("midnight");
    expect(getTheme("emerald").id).toBe("emerald");
  });

  it("scales density and text size monotonically", () => {
    expect(DENSITY_SCALE.compact).toBeLessThan(DENSITY_SCALE.cosy);
    expect(DENSITY_SCALE.cosy).toBeLessThan(DENSITY_SCALE.roomy);
    expect(TEXT_SCALE.sm).toBeLessThan(TEXT_SCALE.md);
    expect(TEXT_SCALE.md).toBeLessThan(TEXT_SCALE.lg);
    expect(TEXT_SCALE.lg).toBeLessThan(TEXT_SCALE.xl);
    expect(DENSITY_SCALE.cosy).toBe(1);
    expect(TEXT_SCALE.md).toBe(1);
  });
});

describe("theme stylesheet", () => {
  it.each([...THEME_IDS])("%s declares every token in dark mode", (id) => {
    const body = block(`[data-theme="${id}"]`);
    expect(body, `missing [data-theme="${id}"] block`).not.toBe("");
    for (const token of REQUIRED_TOKENS) {
      expect(declares(body, token), `${id} dark is missing --${token}`).toBe(true);
    }
  });

  it.each([...THEME_IDS])("%s declares every token in light mode", (id) => {
    const body = block(`[data-theme="${id}"][data-mode="light"]`);
    expect(body, `missing light block for ${id}`).not.toBe("");
    for (const token of REQUIRED_TOKENS) {
      expect(declares(body, token), `${id} light is missing --${token}`).toBe(true);
    }
  });

  it("defines shared status colours once per mode", () => {
    for (const mode of ["dark", "light"] as const) {
      const body = block(`[data-mode="${mode}"]`);
      for (const token of ["ok", "warn", "danger", "info", "shade", "ink-invert"]) {
        expect(declares(body, token), `${mode} is missing --${token}`).toBe(true);
      }
    }
  });

  it("uses no literal colour outside a theme or mode block", () => {
    // Strip every selector body we expect to hold hexes, then assert nothing is
    // left. This is what keeps stray one-off colours out of the palette file.
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\[data-theme="[a-z]+"\](\[data-mode="[a-z]+"\])?\s*(\*\s*)?\{[^}]*\}/g, "")
      .replace(/\[data-mode="[a-z]+"\]\s*\{[^}]*\}/g, "");
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
