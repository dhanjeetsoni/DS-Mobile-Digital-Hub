import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceFiles = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (["node_modules",".git","dist"].includes(name)) continue;
    const p = path.join(dir,name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|css|json|sql)$/.test(name)) sourceFiles.push(p);
  }
}
walk(path.join(root,"src"));
walk(path.join(root,"supabase"));
walk(root);

const text = sourceFiles.map(p => fs.readFileSync(p,"utf8")).join("\n");
const checks = [
  ["Android creates exactly one visible main WebView", (()=>{const c=JSON.parse(fs.readFileSync(path.join(root,"src-tauri/tauri.mobile-android.conf.json"),"utf8"));const w=c.app?.windows;return Array.isArray(w)&&w.length===1&&w[0].label==="main"&&w[0].create===true&&w[0].visible===true&&w[0].url==="index.html"&&!w[0].minWidth&&!w[0].minHeight;})()],
  ["No Telegram bot token literal in client source", !/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/.test(text)],
  ["No Devanagari source text", !/[\u0900-\u097F]/.test(text)],
  ["No fake barcode image-data-as-SKU path", !/onScan\(result\)\s*;/.test(fs.readFileSync(path.join(root,"src/components/CameraScannerModal.tsx"),"utf8"))],
  ["FIFO has no purchase-price fallback argument", !/consumeFIFO\([^\n]+fallbackPrice/.test(fs.readFileSync(path.join(root,"src/utils/fifoEngine.ts"),"utf8"))],
  ["Server exposes health endpoint", /\/api\/health/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["Server has production SPA serving", /express\.static\(dist/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["Offline SQLite uses IndexedDB persistence", /indexedDB\.open\("ds-mobile-digital-hub"/.test(fs.readFileSync(path.join(root,"src/services/localSqlite.ts"),"utf8"))],
  ["Offline queue preserves operation id", /sqliteEnqueue\(operation, entity, \{ operationId, deviceId, payload, scope \}, operationId\)/.test(fs.readFileSync(path.join(root,"src/services/repository.ts"),"utf8"))],
  ["Offline replay retains original operation and account scope", (() => { const repo = fs.readFileSync(path.join(root,"src/services/repository.ts"),"utf8"); return repo.includes("envelope?.scope?.storeId !== profile.store_id") && repo.includes("envelope?.scope?.profileId !== profile.id") && repo.includes("envelope.operationId !== operationId") && repo.includes("ignoreDuplicates: true"); })()],
  ["Staff-safe state write RPC is used", /save_store_state_scoped/.test(fs.readFileSync(path.join(root,"src/services/repository.ts"),"utf8"))],
  ["Telegram connect Edge Function exists", fs.existsSync(path.join(root,"supabase/functions/telegram-connect/index.ts"))],
  ["Staff cloud snapshot is not skipped", !/cloudProfile\.role === ["']staff["']/.test(fs.readFileSync(path.join(root,"src/App.tsx"),"utf8").match(/if \(!cloudReady[\s\S]{0,120}/)?.[0] || "")],
  ["OCR endpoint requires Supabase auth", /requireSupabaseUser\(req,\s*res\)/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["Rate limiter evicts expired entries", /rateMap\.delete\(ip\)/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["IndexedDB connections close after transactions", /req\.result\.close\(\)/.test(fs.readFileSync(path.join(root,"src/services/localSqlite.ts"),"utf8"))],
  ["Supabase client fails closed without env", (() => { const sb = fs.readFileSync(path.join(root,"src/services/supabaseClient.ts"),"utf8"); return /isCloudConfigured/.test(sb) && !/\|\|\s*["']https:\/\//.test(sb); })()],
  ["All registered tool routes are implemented", (() => { const nav=fs.readFileSync(path.join(root,"src/components/Sidebar.tsx"),"utf8"); const app=fs.readFileSync(path.join(root,"src/App.tsx"),"utf8"); const keys=[...nav.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"[^"]+"/g)].map(m=>m[1]);return keys.length>=52&&new Set(keys).size===keys.length&&keys.every(k=>app.includes('case "'+k+'":')); })()],
  ["AI server checks current account access", (()=>{const server=fs.readFileSync(path.join(root,"server.ts"),"utf8");return server.includes('client.rpc("current_account_allowed")')&&server.includes('process.env.DSMDH_LOCAL_AI==="true"')&&!server.includes("storeIdByUserCache")&&[...server.matchAll(/const ctx = await requireSupabaseUserAndStore\(req, res\);\s*([^\n]+)/g)].every(m=>m[1].trim()==="if (!ctx) return;");})()],
  ["Cloud backup uses verified checkpoint RPC", /export_shop_checkpoint/.test(fs.readFileSync(path.join(root,"src/services/repository.ts"),"utf8"))],
  ["FIFO sale preparation is caught", /FIFO sale preparation failed/.test(fs.readFileSync(path.join(root,"src/App.tsx"),"utf8"))],
];
let failed=0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
process.exitCode = failed ? 1 : 0;
