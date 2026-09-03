# Sale Sync, Pending Indicator &amp; Owner Correction Window — Part 3 of 3 (DONE)

## Ye ab kaam karta hai

1. **Sale → stock → invoice, bina extra approval ke** — jaise hi koi sale
   complete hoti hai, stock turant kam ho jaata hai aur invoice turant ban
   jaati hai (ye behavior already tumhare app mein tha; is part mein maine
   isko verify/confirm kiya, koi naya approval-step nahi joda).
2. **Offline sale bhi safe** — agar net na ho, sale local device par (sql.js
   offline queue) save ho jaati hai, invoice turant dikhta/print hota hai;
   net wapas aate hi automatic sync ho jaata hai (`startConnectivitySync` +
   har 15 second ka background pump — dono pehle se the).
3. **Naya: "X pending sync" badge** — top bar mein ab dikhta hai kitni
   sales/entries abhi tak cloud par sync nahi hui. Ye number local queue se
   aata hai isliye poori tarah offline bhi sahi dikhta hai. Click karne se
   turant manual sync try hota hai.
4. **Naya: Owner Correction Window** — Settings → "Sale Correction Window
   (days)" — default **10 din**, owner jitna chahe utna set kar sakta hai
   (0 se 365 tak).
5. **Naya: All Invoices mein owner ke liye do action** (sirf correction
   window ke andar dikhte hain — window khatam hote hi "🔒 Locked" dikhega
   aur buttons gayab ho jayenge):
   - **"Correct Amount"** — payment mode / amount paid / due amount theek
     karne ke liye. Customer ka due automatically adjust hota hai. Har
     correction ka note + kisne kiya + kab kiya, sab save hota hai
     (`editHistory`).
   - **"Cancel Sale"** — poori galat sale ko reverse karta hai: stock wapas
     product mein add ho jaata hai, IMEI wapas "In Stock" ho jaata hai,
     customer ka due/loyalty points reverse ho jaate hain, aur sale
     "Cancelled" status mein chali jaati hai (delete nahi hoti — audit ke
     liye record reh jaata hai, reason bhi save hota hai).

## Jaan-bujh kar simple rakha (important)

Sale ke **items/quantity/rate edit karna** (line-item level) is version mein
nahi diya — kyunki wo FIFO stock-batches, IMEI status, aur warranty dates
sabko ek saath sahi tarike se rewind/reapply karna padta, jisme galti hone
par stock/accounts kharab ho sakte the. Iski jagah safe approach rakha:
**"Cancel Sale" karo (stock wapas aa jayega) → phir sahi item/rate se naya
sale bana do.** Agar aage chalke sirf paisa nahi, **item bhi edit** karna ho
to bata dena — alag se, zyada dhyan se banayenge taaki stock кभी galat na ho.

## Files change hue
- `src/types.ts` — `Settings.saleCorrectionWindowDays`, aur `Sale` mein
  `createdAt`, `editedAt/editedBy/editHistory`,
  `cancelledAt/cancelledBy/cancelReason`, `status` mein `"Cancelled"` add.
- `src/App.tsx`:
  - `saleRecord.createdAt` set hota hai har naye sale par.
  - Settings page mein naya "Sale Correction Window (days)" field.
  - `isSaleWithinCorrectionWindow()`, `handleCancelSale()`,
    `handleSaveCorrection()` naye helpers.
  - All Invoices table mein status badge + owner-only action buttons.
  - Naya "Correct Amount" modal.
  - `pendingSyncCount` state + top-bar "⏳ N pending sync" badge (local
    sql.js queue se, 4-second poll).

## Deploy
Is part mein koi Supabase migration/function change nahi hai — sab kuch
client-side (React) hai. Normal build/deploy se chala jayega.

## ⚠️ Zaroori — is sandbox ki limitation
Yahan internet access nahi hai, isliye `npm install` / `npm run build` chala
ke poora compile + runtime test nahi ho paaya. Maine jo verify kiya:
- `tsc` se saare naye/edited files ka **syntax check** — koi parse error
  nahi mila.
- `App.tsx` (3300+ lines) ka brace/paren/bracket balance check — sab match
  kar raha hai.

Ye guarantee nahi karta ki sab kuch runtime par bilkul waisa hi chalega jaisa
socha gaya — **deploy se pehle apne machine par ek baar `npm install` +
`npm run build` (ya `npm run tauri build` agar Windows app bana rahe ho)
zaroor chalana**, aur ek test sale + ek test cancel + ek test correction
manually try karke dekh lena.

## ✅ VERIFIED — 2026-09-01 (network-enabled sandbox)
Is update mein internet access available tha, isliye poora verify ho gaya:
- `npm install` — 235 packages, **0 vulnerabilities**, koi peer-dep error nahi.
- `npx tsc --noEmit` — **zero type errors**, poora clean pass.
- `npm run build` (vite build + esbuild server bundle) — **successful**,
  `dist/` folder poora ban gaya (`index.html`, JS/CSS assets, `sql-wasm.wasm`,
  `server.mjs`). Sirf ek non-blocking warning tha (JS chunk >500kB — sirf
  optimization suggestion, code-splitting ke liye; koi error nahi, koi
  functionality issue nahi).
- Koi fix ki zaroorat nahi padi — Part 3.1 + 3.2 dono clean verify ho gaye.

Upar wala "⚠️ Zaroori" waala limitation-note ab **resolved** hai — us waqt
sandbox mein internet nahi tha, is baar tha, aur build cleanly pass hua.

## Teeno parts ka pura summary
- **Part 1**: Staff Login ID/Password + simple ON/OFF access switch.
- **Part 2**: No-restriction / Full-day / Custom hours-minutes access
  window, offline-safe auto-logout, aur sirf grant ke baad ki sales/galla
  dikhna.
- **Part 3**: Pending-sync indicator, aur owner ke liye sale
  correct/cancel karne ka A-to-Z (10-din, configurable) window.
