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
  ["No Telegram bot token literal in client source", !/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/.test(text)],
  ["No Devanagari source text", !/[\u0900-\u097F]/.test(text)],
  ["No fake barcode image-data-as-SKU path", !/onScan\(result\)\s*;/.test(fs.readFileSync(path.join(root,"src/components/CameraScannerModal.tsx"),"utf8"))],
  ["FIFO has no purchase-price fallback argument", !/consumeFIFO\([^\n]+fallbackPrice/.test(fs.readFileSync(path.join(root,"src/utils/fifoEngine.ts"),"utf8"))],
  ["Server exposes health endpoint", /\/api\/health/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["Server has production SPA serving", /express\.static\(dist/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["Offline SQLite uses IndexedDB persistence", /indexedDB\.open\("ds-mobile-digital-hub"/.test(fs.readFileSync(path.join(root,"src/services/localSqlite.ts"),"utf8"))],
  ["Offline queue preserves operation id", /sqliteEnqueue\(operation, entity, \{ operationId, deviceId, payload \}, operationId\)/.test(fs.readFileSync(path.join(root,"src/services/repository.ts"),"utf8"))],
  ["Staff-safe state write RPC is used", /save_store_state_for_user/.test(fs.readFileSync(path.join(root,"src/services/repository.ts"),"utf8"))],
  ["Telegram connect Edge Function exists", fs.existsSync(path.join(root,"supabase/functions/telegram-connect/index.ts"))],
  ["Staff cloud snapshot is not skipped", !/cloudProfile\.role === ["']staff["']/.test(fs.readFileSync(path.join(root,"src/App.tsx"),"utf8").match(/if \(!cloudReady[\s\S]{0,120}/)?.[0] || "")],
  ["OCR endpoint requires Supabase auth", /requireSupabaseUser\(req, res\)/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["Rate limiter evicts expired entries", /rateMap\.delete\(ip\)/.test(fs.readFileSync(path.join(root,"server.ts"),"utf8"))],
  ["IndexedDB connections close after transactions", /req\.result\.close\(\)/.test(fs.readFileSync(path.join(root,"src/services/localSqlite.ts"),"utf8"))],
  ["Supabase client fails closed without env", (() => { const sb = fs.readFileSync(path.join(root,"src/services/supabaseClient.ts"),"utf8"); return /isCloudConfigured/.test(sb) && !/\|\|\s*["']https:\/\//.test(sb); })()],
  ["FIFO sale preparation is caught", /FIFO sale preparation failed/.test(fs.readFileSync(path.join(root,"src/App.tsx"),"utf8"))],
];
let failed=0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
process.exitCode = failed ? 1 : 0;
