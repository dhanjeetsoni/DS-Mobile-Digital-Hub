# Staff Access Manager — Part 2 of 3 (DONE)

Part 1 diya tha: Login ID/Password banana, aur ek simple ON/OFF switch.
Part 2 ab access ka "kitna" aur "kabtak" control deta hai, aur offline hote
hue bhi expiry ko force karta hai.

## Ye ab kaam karta hai

1. **Owner mode → Staff Access Manager → "Grant Access"** — ab sirf ON/OFF
   nahi, teen options hain:
   - **No restriction** — koi time limit nahi, jab tak khud OFF na karo.
   - **Full day** — aaj raat 12 baje khud OFF ho jaata hai.
   - **Custom (hours/minutes)** — owner jitna time chahe utna de sakta hai.
2. **Har "Grant Access" ek fresh window shuru karta hai**: `visibility_from`
   us waqt ka timestamp ban jaata hai, isliye staff ko sirf ab se aage ki
   sales/galla dikhti hai — pichhli history (chahe pichhle access window ki
   ho) hidden rehti hai. Product catalog (A-Z) kabhi hidden nahi hota.
3. **Offline-safe auto-logout**: staff login karte waqt uska access window
   (`access_mode` + `access_expires_at`) device par cache ho jaata hai. Har 5
   second mein device apne khud ke clock se check karta hai — internet ho ya
   na ho, time poora hote hi staff turant logout ho jaata hai aur "Access
   Time Khatam Ho Gaya — Contact Shop Owner for Access" dikhta hai.
4. **Realtime OFF bhi turant asar karta hai**: agar shop online hai aur owner
   Staff Access Manager se "Turn OFF" dabaye, already-logged-in staff device
   par turant (offline-clock-check ka wait kiye bina) logout ho jaata hai.
5. **App dobara khulne par bhi re-check hota hai** — reload/restart ke baad
   bhi staff ka access fresh server se verify hota hai; disabled/expired ho
   chuka ho to seedha "Contact Shop Owner" screen dikhta hai, andar nahi jaane
   deta.
6. Dashboard ka "Today's Total Sales", "Estimated Cash in Galla", Recent
   Activity, aur "All Invoices" — sab staff ke liye ab `visibility_from` ke
   hisaab se filter hote hain.

## Files change hue
- `supabase/functions/staff-manage/index.ts` — naya staff create hote hi
  `visibility_from` bhi set hota hai.
- `src/services/staffAuth.ts` — `grantStaffAccess`, `revokeStaffAccess`,
  `isAccessWindowExpired`, aur offline-cache helpers
  (`cacheStaffSession`/`readCachedStaffSession`/`clearCachedStaffSession`).
- `src/components/StaffAccessView.tsx` — naya "Grant Access" modal (mode +
  hours/minutes), row par live countdown.
- `src/App.tsx` — bootstrap-time re-check, 5-second offline expiry watcher,
  realtime OFF-push channel, aur dashboard/invoices/recent-activity ab
  `visibleSales`/`visibleReturns`/`visibleXeroxEntries` use karte hain
  (owner/manager ke liye kuch bhi hidden nahi hota).
- `src/services/supabaseClient.ts` — `getCurrentProfile()` ab access/visibility
  columns bhi laata hai.

## Deploy karne ke liye
Part 1 ka migration/function pehle se deploy ho chuka hoga; Part 2 mein koi
naya migration nahi hai (columns Part 1 mein hi ban chuke the), sirf function
update hui hai:
```
supabase functions deploy staff-manage
```
Baaki sab client-side (React app) change hai — normal build/deploy se chala
jayega.

## Note
Is sandbox mein `npm install` ke liye internet access nahi hai, isliye
`npm run build` se full compile-check nahi ho paaya — sirf syntax-level TS
check kiya hai (koi parse/syntax error nahi mila). Deploy se pehle apne
machine par ek baar `npm run build` (ya `npm run tauri build`) zaroor chala
lena.

## Abhi baaki hai (Part 3 mein aayega)
- Realtime sale → stock deduct → invoice auto-generate bina extra
  owner-approval ke.
- Offline pe hui sale local save ho ke net aane par auto-sync + "X sales
  pending sync" indicator.
- Owner ke liye sale edit/delete/add A-to-Z rights.
- Har sale ka default 10-din ka correction/edit window (owner isko change bhi
  kar sakta hai), uske baad permanently lock.

Ready ho to "ok" bolo — Part 3 par shuru kar deta hoon.
