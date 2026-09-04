import { Database } from "../types";
import { useAppearance, getTheme, type ThemeId, type ThemeMode } from "@/theme";

/** Hue (0-360) of the four accent colours the export template ships. */
const EXPORT_PALETTE_HUES: Record<string, number> = {
  "cyber-blue": 189,
  "neon-purple": 292,
  "emerald-tech": 156,
};

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return -1; // achromatic (grey) — no meaningful hue
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function isNearBlack(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r <= 10 && g <= 10 && b <= 10;
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * The offline export is a single static HTML file with no React/zustand at
 * runtime, so it can't just read the live 10-theme Appearance Studio system —
 * it ships its own small, self-contained 4-theme palette (Part 2 kept this
 * separate on purpose). To still have the export "follow" whichever
 * Appearance Studio theme is active, without duplicating all 10 themes'
 * CSS into the export template, this picks whichever of the 4 export
 * palettes is the closest hue match to the live theme's brand colour.
 * Light mode always falls back to the export's built-in light default
 * (empty string — none of the 4 export palettes has a light variant).
 */
function pickExportPalette(themeId: ThemeId, mode: ThemeMode): string {
  if (mode === "light") return "";
  const [canvas, , brand] = getTheme(themeId).swatch.dark;
  if (isNearBlack(canvas)) return "amoled";
  const hue = hexToHue(brand);
  if (hue < 0) return "amoled"; // grey/neutral brand colour (e.g. Slate)
  let best = "cyber-blue";
  let bestDist = Infinity;
  for (const [key, refHue] of Object.entries(EXPORT_PALETTE_HUES)) {
    const dist = circularHueDistance(hue, refHue);
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  return best;
}

export function exportStandaloneHtml(db: Database) {
  // Follow whatever theme is live in Appearance Studio right now; only fall
  // back to the old db.settings.theme field (or the original default) if
  // the appearance store is somehow unavailable.
  let exportTheme = "";
  try {
    const appearance = useAppearance.getState();
    exportTheme = pickExportPalette(appearance.themeId, appearance.mode);
  } catch {
    exportTheme = db.settings.theme || "cyber-blue";
  }

  // Generate standalone HTML representation containing embedded database and self-contained scripts
  const htmlContent = `<!DOCTYPE html>
<html lang="en" data-theme="${exportTheme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${db.settings.shopName || "DS Mobile & Digital Hub Pro"}</title>
<style>
/* 11 Themes Engine Embedded */
:root{
  --navy:#0e1c3f; --navy-2:#16294f; --accent:#6d5ef8; --accent-2:#2f6fed;
  --blue:#2f6fed; --blue-light:#eaf1ff; --red:#e0313b; --red-light:#fdeaea;
  --green:#0f9d63; --green-light:#e6f9ef; --amber:#dd8c00; --amber-light:#fff4e0;
  --purple:#7c4dff; --purple-light:#f1ecff; --paper:#f3f5fb; --card:#ffffff;
  --card-glass: rgba(255,255,255,.78); --ink:#151a2e; --ink-soft:#636c85;
  --line:#e2e6f2; --radius:14px; --shadow:0 2px 8px rgba(20,25,50,.05);
  --shadow-lg:0 16px 48px rgba(20,25,50,.14); --glow:#6d5ef8; --glow-2:#2f6fed;
  --glow-soft: rgba(109,94,248,.22); --font: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --inv-navy:#0e1c3f; --inv-navy-2:#16294f; --inv-paper:#f3f5fb; --inv-line:#e2e6f2;
  --inv-ink:#151a2e; --inv-ink-soft:#636c85; --inv-blue-light:#eaf1ff;
  --inv-green:#0f9d63; --inv-green-light:#e6f9ef; --inv-amber:#dd8c00; --inv-amber-light:#fff4e0;
  --inv-red:#e0313b; --inv-red-light:#fdeaea;
}
html[data-theme="cyber-blue"]{ --navy:#040916; --navy-2:#08142c; --accent:#00d2ff; --accent-2:#3a7bd5; --blue:#00d2ff; --blue-light:#0b2240; --paper:#030712; --card:#091428; --card-glass: rgba(9,20,40,.72); --ink:#eef5ff; --ink-soft:#829ec4; --line:#162c52; --red:#ff4b60; --red-light:#381119; --green:#00e5a3; --green-light:#062d22; --amber:#ffb300; --amber-light:#382705; --purple:#9d7aff; --purple-light:#22174a; --glow:#00d2ff; --glow-2:#3a7bd5; --glow-soft: rgba(0,210,255,.24); }
html[data-theme="neon-purple"]{ --navy:#0c041c; --navy-2:#160933; --accent:#d843ff; --accent-2:#892cdc; --blue:#a960ff; --blue-light:#240c42; --paper:#070211; --card:#15082e; --card-glass: rgba(21,8,46,.72); --ink:#f6eeff; --ink-soft:#ad93ce; --line:#2f145c; --red:#ff3d81; --red-light:#380e1e; --green:#00e6a8; --green-light:#052e22; --amber:#ffb834; --amber-light:#382806; --purple:#d843ff; --purple-light:#350c4a; --glow:#d843ff; --glow-2:#892cdc; --glow-soft: rgba(216,67,255,.28); }
html[data-theme="emerald-tech"]{ --navy:#021710; --navy-2:#052d20; --accent:#00f5a0; --accent-2:#00b875; --blue:#00d9ff; --blue-light:#07282b; --paper:#010e0a; --card:#08241b; --card-glass: rgba(8,36,27,.72); --ink:#e6fff4; --ink-soft:#84bfa6; --line:#134533; --red:#ff4d67; --red-light:#381017; --green:#00f5a0; --green-light:#053825; --amber:#ffbe3b; --amber-light:#382907; --purple:#967aff; --purple-light:#1f1947; --glow:#00f5a0; --glow-2:#00b875; --glow-soft: rgba(0,245,160,.25); }
html[data-theme="amoled"]{ --navy:#000000; --navy-2:#050505; --accent:#00ffcc; --accent-2:#3b82f6; --blue:#00e5ff; --blue-light:#08181c; --paper:#000000; --card:#080808; --card-glass: rgba(8,8,8,.82); --ink:#ffffff; --ink-soft:#909090; --line:#1f1f1f; --red:#ff4055; --red-light:#29080c; --green:#00ff9d; --green-light:#042617; --amber:#ffb81c; --amber-light:#291d04; --purple:#a77bff; --purple-light:#1a1033; --glow:#00ffcc; --glow-2:#3b82f6; --glow-soft: rgba(0,255,204,.24); }

*{box-sizing:border-box;}
body{margin:0;font-family:var(--font);background:var(--paper);color:var(--ink);font-size:14px;}
#app{display:flex;min-height:100vh;}
#sidebar{width:260px;flex:0 0 260px;background:linear-gradient(180deg,var(--navy) 0%, var(--navy-2) 100%);color:var(--ink);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;border-right:1px solid var(--line);}
.brand{padding:20px 18px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;}
.brand .logo-badge{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;}
.nav{padding:12px 0;flex:1;}
.nav button.navitem{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;color:var(--ink-soft);padding:9px 18px;font-size:13px;border-left:3px solid transparent;cursor:pointer;}
.nav button.navitem:hover{background:var(--glow-soft);color:var(--ink);}
.nav button.navitem.active{background:var(--glow-soft);color:var(--ink);border-left-color:var(--glow);font-weight:700;}
#main{flex:1;min-width:0;display:flex;flex-direction:column;}
#topbar{background:var(--card-glass);backdrop-filter:blur(16px);border-bottom:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:20;}
#page{padding:22px 24px 60px;}
.grid{display:grid;gap:14px;}
.grid.cols-4{grid-template-columns:repeat(4,1fr);}
.grid.cols-3{grid-template-columns:repeat(3,1fr);}
.grid.cols-2{grid-template-columns:repeat(2,1fr);}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);}
.card.accent{border-color:var(--glow);}
.card h3{margin:0 0 4px;font-size:11.5px;color:var(--ink-soft);font-weight:800;text-transform:uppercase;}
.card .big{font-size:22px;font-weight:800;margin-top:4px;}
.card .big.green{color:var(--green);}
.card .big.blue{color:var(--blue);}
.card .big.red{color:var(--red);}
.card .big.amber{color:var(--amber);}
.section{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:16px;box-shadow:var(--shadow);}
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.btn{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;border-radius:10px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;cursor:pointer;}
.btn.primary{background:linear-gradient(135deg,var(--glow),var(--glow-2));border-color:transparent;color:#fff;}
.btn.sm{padding:5px 10px;font-size:12px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th,td{padding:10px;text-align:left;border-bottom:1px solid var(--line);}
th{color:var(--ink-soft);font-size:11px;text-transform:uppercase;background:var(--paper);}
.badge{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;}
.badge.ok{background:var(--green-light);color:var(--green);}
.badge.due{background:var(--red-light);color:var(--red);}
.badge.paid{background:var(--green-light);color:var(--green);}
.badge.partial{background:var(--amber-light);color:var(--amber);}
.badge.exch{background:var(--purple-light);color:var(--purple);}
.kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line);}
.invoice-paper{background:#fff;color:#151a2e;border:1px solid #e2e6f2;border-radius:10px;padding:20px;font-size:13px;}
.status-strip{padding:8px 16px;font-weight:800;font-size:12px;text-transform:uppercase;}
.status-strip.paid{background:#e6f9ef;color:#0f9d63;}
.status-strip.due{background:#fdeaea;color:#e0313b;}
@media print{ body *{visibility:hidden;} #print-area,#print-area *{visibility:visible;} #print-area{position:absolute;top:0;left:0;width:100%;} }
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div class="brand">
      <div class="logo-badge">${(db.settings.shopName || "DS").slice(0, 2).toUpperCase()}</div>
      <div>
        <div style="font-weight:800;font-size:14px;color:var(--ink);">${db.settings.shopName || "DS MOBILE"}</div>
        <div style="font-size:10px;color:var(--ink-soft);">Shop Manager Pro</div>
      </div>
    </div>
    <nav class="nav">
      <button class="navitem active" onclick="alert('Standalone mode running with ${db.products.length} products and ${db.sales.length} sales')">Dashboard</button>
      <button class="navitem" onclick="window.print()">Print Report</button>
    </nav>
  </aside>
  <div id="main">
    <div id="topbar">
      <h1 style="font-size:18px;margin:0;">${db.settings.shopName} — Standalone Edition</h1>
      <button class="btn primary sm" onclick="window.print()">Print Summary</button>
    </div>
    <div id="page">
      <div class="grid cols-4" style="margin-bottom:16px;">
        <div class="card accent"><h3>Total Products</h3><div class="big blue">${db.products.length}</div></div>
        <div class="card"><h3>Total Sales Logged</h3><div class="big green">${db.sales.length}</div></div>
        <div class="card"><h3>Registered Customers</h3><div class="big">${db.customers.length}</div></div>
        <div class="card"><h3>Repair Tickets</h3><div class="big purple">${db.jobs.length}</div></div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Showroom Inventory Catalog</h2></div>
        <table>
          <thead><tr><th>Product Name</th><th>Category</th><th>Brand</th><th>Price</th><th>Stock</th></tr></thead>
          <tbody>
            ${db.products.map((p) => `<tr><td><b>${p.name}</b></td><td>${p.category}</td><td>${p.brand || "—"}</td><td>₹${p.sellingPrice}</td><td>${p.stock}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<script>
window.DB = ${JSON.stringify(db, null, 2)};
console.log("DS Mobile Standalone Loaded", window.DB);
</script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `DS-Mobile-Digital-Hub-Standalone-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
}
