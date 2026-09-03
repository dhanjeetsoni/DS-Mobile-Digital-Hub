# Part 1 — Staff Sync Delete Bug, Dead PIN-Gate, Staff Direct-Nav Gap (ALL DONE)

## Kya fix hua

1. **Staff sync se deleted record wapas aana** — ab nahi hoga. Naya SQL
   migration (`supabase/migrations/20260830_staff_sync_delete_tombstones_v15.sql`)
   ek "tombstone" ledger banata hai: jab bhi koi record (purchase, supplier,
   supplier payment, KYC, IMEI, galla closing, exchange, ya koi bhi expense)
   store ki asli state se gayab hota hai — chahe owner ne delete kiya ho —
   wo record "tombstoned" mark ho jaata hai. Uske baad koi bhi staff device
   apna purana local copy sync kare, wo tombstoned record ab merge mein wapas
   nahi aayega. Agar wahi ID dobara genuinely bane (owner ne dobara wahi
   record bana diya), tombstone khud hi clear ho jaata hai.
   - Ye trigger-based hai (`store_state` table par), isliye owner ke full-save
     path (`save_store_state`) ko chhuna nahi pada — uska source is bundle
     mein nahi hai, isliye usse blind edit karna risky hota.
   - Deploy: `supabase db push` (sirf naya migration file apply karna hai,
     koi Edge Function change nahi).

2. **`OwnerReportsView.tsx` ka dead `isUnlocked` PIN-gate** — hata diya.
   Confirm kiya ki ye kabhi trigger hi nahi hota tha (`isUnlocked` hamesha
   `true` start hota tha, `false` karne ka koi code path nahi tha) — isliye
   koi security loss nahi hai, sirf confusing dead code tha. Asli protection
   `App.tsx`/`Sidebar.tsx` ka `ownerOnly` route guard hai, wo already sahi
   kaam karta hai.

## Bug #2 (staff direct-nav to Purchases/Suppliers) — ab poora fix ho gaya

Code padhne par pata chala ki iska bada hissa **already fix ho chuka tha**
(pichhle session ne beech mein kaam kiya tha) — `App.tsx` mein do jagah
guard hai jo kisi bhi `ownerOnly` page (jaise "Purchase History") ko
`ownerMode` ke bina URL/deep-link se khulne se rokta hai.

Ek cheez khuli reh gayi thi: **"Supplier / DLR Khata"** (`supplierKhata`
key) `Sidebar.tsx` mein `ownerOnly: false` tha — staff isko sidebar se bhi
dekh sakta tha aur seedha bhi khol sakta tha (naya supplier add karna,
payment log karna sab possible tha, bina owner ke). Ab **`ownerOnly: true`**
kar diya hai — "Purchase History" jaisa hi consistent treatment. Koi aur
change nahi chahiye tha kyunki page render karne wala code (`App.tsx`
`case "supplierKhata"`) already fully wahi do generic `ownerOnly` guards
(deep-link redirect + sidebar `onNavigate` PIN-prompt) use karta hai jo
baaki har owner-only page use karta hai — sirf flag change karne se turant
dono jagah protected ho gaya.

Isse ab teeno bugs (staff sync merge, staff direct-nav, dead PIN-gate)
Part 1 mein fully complete hain.

## Baaki sab kaam — parts mein divide kiya (Supabase point 5 chhoda hai)

`COPY-PASTE-HANDOFF.md` ki "Remaining work" list se, point 5
("Migrate Customer Khata/payments to normalized repository") ko touch nahi
kiya — jaisa bola tha. Baaki cheezein groups mein:

**Part 2 — Access gaps (chhote, focused fixes)**
- Bug #2 ka final fix (upar wale sawaal ka jawab aane ke baad).
- Point 11: Supabase leaked-password protection enable karna (Dashboard
  setting hai, code change nahi).

**Part 3 — Normalized-table migrations (bada, risky, ek-ek karke)**
- Point 1: Purchase UI → normalized Postgres repository.
- Point 2: Inventory/stock adjustment UI → normalized repository.
- Point 3: Returns/Exchanges → reversal transaction services.
- Point 4: Warranty → normalized repository.
- Point 6: Expenses & reports → SQL aggregates.
- Point 7: Staff-safe normalized read RPC/view layer for catalog/history.

(Ye sab is tombstone fix ke baad kaafi kam zaroori ho jaate hain security ke
liye — merge-bridge ab safe hai — par ye migrations phir bhi better
long-term architecture ke liye scope mein rehna chahiye.)

**Part 4 — Native builds & testing**
- Point 8: Android Staff app.
- Point 9: Rust install + Tauri Windows installer build.
- Point 10: Full authenticated 32-case E2E test matrix.
- Point 12: CI with locked dependencies.

Jab ready ho, bata do — "Part 2" bolo (ya seedha supplier khata wale sawaal
ka jawab), aage badh jaate hain.
