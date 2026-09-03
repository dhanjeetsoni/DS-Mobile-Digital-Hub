# STEP 13 — Testing & Go-Live Checklist

_Master Plan ka aakhri step. Iska kaam naya code likhna nahi hai — Steps 1
se 12 tak jo bana hai, usko ek jagah collect karke ek single "go-live se
pehle yeh sab check karo" checklist banana hai, plus jo bhi is session mein
khud automated tareeke se verify ho saka wo actually kar ke confirm karna._

---

## Part A — Is session mein khud verify kiya (automated, sandbox se)

Har pichhle step ke end mein "Test nahi kiya" wale gaps zyadatar ek hi wajah
se the: **is sandbox mein browser/display/real-device pipeline nahi hai**,
isliye koi bhi UI-click-through test yahan se possible nahi. Jo automated
tareeke se ho sakta tha, wo is session mein poora fresh-run karke confirm
kiya gaya (sirf pichhle logs par bharosa nahi kiya):

| Check | Result |
|---|---|
| `npm install` (fresh) | ✅ 276 packages, 0 vulnerabilities |
| `npx tsc --noEmit` (poora project) | ✅ 0 errors |
| `npm run build` (vite + esbuild server bundle) | ✅ Dono clean. Sirf wahi purana non-blocking >500kB main-chunk warning (Step 3 se already known, functionality par asar nahi) |
| `node scripts/static-audit.mjs` | ✅ 16/16 PASS |
| Live Supabase migrations (41) vs ZIP `supabase/migrations/` (41) | ✅ Sab match, koi naya drift nahi mila |
| Live Edge Functions (5: `staff-manage` v7, `telegram-connect` v12, `telegram-outbox-worker` v8, `r2-storage` v5, `app-update-manifest` v1) vs ZIP | ✅ `staff-manage` byte-for-byte diff kiya — identical. `telegram-connect` ka naya `botConfigured` field (Step 9.1 session mein reconcile hua tha) confirm kiya ki ZIP mein hai. Baaki dono (`r2-storage`, `app-update-manifest`) already Step 7.1/12 sessions mein hi live-se-pull karke ZIP mein sync kiye gaye the |
| `get_advisors(security)` | ✅ Koi *naya* finding nahi. Sab existing hain: (a) `anon`-executable SECURITY DEFINER RPCs — sab apna khud ka role-check karte hain (design pattern jo Steps 2.3/9.1 mein already accept kiya gaya tha), (b) RLS-enabled-no-policy tables (`app_versions`, `gemini_api_keys`, etc.) — jaan-bujhke deny-all-via-PostgREST, sirf RPC se access, (c) `project_staff_state` ka mutable search_path — pehle se known, low-severity |
| **Naya mila is session mein:** `auth_leaked_password_protection` WARN | 🟨 Genuinely actionable, koi purani session mein note nahi hua — neeche "Go-Live se pehle" list mein add kiya |

**Koi naya code-change nahi laga is session mein** — sab kuch already-shipped
code/config verify hi hua, kuch bhi tootta hua nahi mila.

---

## Part B — Go-Live se pehle, Owner ko khud (real device/browser chahiye) yeh sab ek baar chalake dekhna hai

_Yeh wahi list hai jo har Step ke apne "Test nahi kiya" note mein bikhri hui
thi — yahan ek jagah, logical order mein (login se lekar backup tak)._

### B1. Pehle-se-pending manual setup steps (in ke bina kuch features silently fallback/disabled rahenge)
- [ ] **Cloudflare R2 API Token** (Step 7.1) — `STEP7.1-CLOUDFLARE-SETUP.md` follow karo. Jab tak nahi hota: product photos data-URL fallback mein save hongi (kaam karega, par Storage Usage Meter ka Cloudflare card "unavailable" dikhayega, Step 7.2 ka photo-cleanup bhi silently no-op rahega).
- [ ] **`SUPABASE_SERVICE_ROLE_KEY`** env var set hai ki nahi (Step 2.1) — bina iske Gemini 10-key pool purane single-key `.env` fallback par chalega.
- [ ] **10 Gemini API keys** Owner Settings mein daalo (Step 2.1) — bina kisi key ke koi bhi AI feature (Add Stock auto-fill, Photo Stock Finder, Glass smart-search, AI Advice) kaam nahi karega.
- [ ] **Telegram Bot Token + Webhook Secret** env vars set hain (Step 1.4) — bina inke Owner "Connect Telegram" hi nahi kar payega.
- [ ] **`TAURI_SIGNING_PRIVATE_KEY`** GitHub secret (Step 12.2) — chat mein ek baar diya gaya tha, GitHub repo secrets mein daal ke apne computer se delete kar dena.
- [ ] **Android keystore secrets** (`ANDROID_KEYSTORE_BASE64` + password/alias) — `keytool` se generate karke GitHub secrets mein daalna (Step 12.2 ka CI workflow abhi placeholder par hai).
- [ ] **Leaked Password Protection enable karo** (naya, is session mein mila) — Supabase Dashboard → Authentication → Policies → "Leaked password protection" ON karo. 2-minute ka kaam, free tier par bhi available, HaveIBeenPwned check se compromised passwords block karta hai. Koi code-change ki zaroorat nahi.

### B2. Step 1 — Login & Staff Access (real browser + phone chahiye)
- [ ] Owner Cloud Sign-In se login → Staff ID generate karo → "Reveal & Copy" screen sahi dikhti hai.
- [ ] Us Staff ID se ek doosre device/incognito window mein Staff login karo — sirf ID+Password poochta hai, koi email nahi.
- [ ] Staff device se ek sale karo → Owner ke Windows/browser session mein **turant** (bina refresh) dikhna chahiye (real-time sync). Ulta bhi try karo.
- [ ] Owner "Turn OFF" (Pause) dabaye jab staff already logged-in ho — us staff ka session turant kick hona chahiye (Step 1.7 ka real-time-kick fix).
- [ ] "Regenerate Password" try karo — naya reveal screen aana chahiye.

### B3. Step 3 — Stock & Pricing
- [ ] Ek naya product photo se add karo — AI se Brand/Model/Category auto-fill ho raha hai ki nahi (real Gemini key chahiye, is sandbox mein kabhi test nahi hua).
- [ ] Ek 40+ compatible-model wala glass add karo — list collapsed/searchable dikh rahi hai, crash nahi ho raha (Step 3.2/10.1).
- [ ] 4-tier pricing (Original/Confidential/Selling/MRP) set karo — Confidential ≥ Original, Selling ≥ Confidential validation block ho raha hai ki nahi.
- [ ] Staff Access Manager ke through, ek staff account se **Stocks table** dekho — Original aur Confidential Price kahin nahi dikhne chahiye (server-side redaction, Step 3.3).
- [ ] Curved Glass photo upload karo — category sahi detect ho rahi hai (Tempered se alag).
- [ ] Staff Android app mein "Download Area" se offline photos download karo, phir Airplane mode on karke app khol ke dekho — stock list + photos dikhni chahiye.

### B4. Step 4 — Selling Flow
- [ ] Staff login se ek line ka price Selling se neeche, Confidential se upar type karo — checkout hona chahiye.
- [ ] Confidential Price se neeche type karke checkout try karo — block hona chahiye (red floor-check).
- [ ] Staff se 🔒 button dabao ek product par → Owner ke Telegram par Approve/Deny buttons wala message aana chahiye → Approve dabao → staff device par turant (realtime) price + 5-min countdown dikhna chahiye.
- [ ] Wifi band karke dekho — chhota badge "Offline" dikhna chahiye, wifi wapas on karte hi "Syncing" phir "Online" hona chahiye, koi manual refresh ke bina.

### B5. Step 5 — Gifts
- [ ] Phone sale mein "Add Gift" se koi accessory free add karo — invoice par "🎁 Complimentary Gift" dikhna chahiye, total mein ₹0 count hona chahiye.
- [ ] Owner Reports → Gifts Cost section mein Total/Month/Year filters try karo.

### B6. Step 6 — AI Everywhere
- [ ] Photo Stock Finder se koi bhi shop item ki photo kheecho — AI identify kare, catalog mein match dhoondhe, seedha bill mein add ho sake (real Gemini key ke saath — is sandbox mein test nahi hua).
- [ ] Search box mein "laal" type karke koi red-named product dhoondo (natural-language colour search, Step 6.3).

### B7. Step 7 — Storage
- [ ] Settings/Status Dashboard mein Storage Usage Meter dekho — Supabase card turant dikhna chahiye, Cloudflare card tabhi jab R2 token set ho (B1 dekho).
- [ ] Kisi product ko out-of-stock karke 90 din wait karna practically possible nahi — bas confirm kar lena ki logic samajh aa gaya (`outOfStockSince` field product edit karke DB mein manually bhi verify kiya ja sakta hai).
- [ ] "Export & Clear Old Invoices" se ek range select karo, PDF print/save karo, checkbox tick karo, tabhi Delete button enable hona chahiye.

### B8. Step 8 — Invoice
- [ ] Ek real invoice print/print-preview karo (browser ya Tauri desktop) — koi bhi timestamp/file-path/URL line browser ki taraf se add nahi honi chahiye (Step 8.1's `@page{margin:0}` fix).
- [ ] Discount + Gift + Warranty teeno wali ek sale banao — "You saved ₹X" green banner aur "Warranty terms accepted" signature-sub-label dono dikhne chahiye.

### B9. Step 9 — Owner Command Center
- [ ] Status Dashboard kholo — 6 cards (Gemini/Telegram Bot/Telegram Owner/Staff/Cloudflare/Supabase) sahi rang (green/amber/red/grey) dikha rahe hain apni actual state ke hisaab se.
- [ ] Sidebar ke 6 groups (Money/Inventory/People/Invoices/Reports/System) collapse/expand karke dekho, badge counts sahi hain.
- [ ] Koi bhi modal khol/band karo — fade+scale animation smooth honi chahiye, sluggish nahi.

### B10. Step 10 — Stability
- [ ] Bahut saare products/customers wali list scroll karke dekho — lag/crash nahi hona chahiye (typical shop-scale data ke liye already safe; agar 2000+ records ho jaayein future mein, virtualization dobara dekhni hogi).
- [ ] Lambe product/customer naam wali table rows mein ellipsis (...) + hover-tooltip dikhna chahiye.

### B11. Step 11 — Setup Wizard
- [ ] Bilkul naye/khaali store se pehli baar login karo — Setup Wizard khud-ba-khud khulna chahiye.
- [ ] Har step ka CTA button sahi jagah le jaata hai, aur complete hote hi checklist mein turant reflect hota hai.

### B12. Step 12 — App Updates (real build/device chahiye)
- [ ] `git tag v1.0.1 && git push --tags` karke GitHub Actions workflow trigger karo — Windows installer + `.sig`, dono Android APKs, sab GitHub Release mein attach hone chahiye.
- [ ] Owner "App Versions" panel se ek build upload karo (abhi sirf "not-live" row banega) → "Make Live" dabao (yehi asli push moment hai) → ek dusre/purane build wale device par "Update Available" pill dikhna chahiye.
- [ ] Windows real Tauri build ke andar pill dabao — download %, "Installing...", phir apne aap relaunch hona chahiye (silent auto-update).
- [ ] Android APK ka pill tap karo — system Download Manager + "install unknown apps" prompt aana chahiye.
- [ ] Agar koi build kharab nikle, purani "Make Live" wapas dabao — turant rollback ho jaana chahiye (koi naya code nahi lagta).

### B13. Cross-cutting / Backup
- [ ] Poora ek din normal shop-use simulate karo (sales, purchase, stock adjust, return/exchange) phir Backup & Restore se export lo, ek fresh browser profile mein restore karke confirm karo sab data sahi aaya.
- [ ] Weekly Telegram report (Monday 9 AM IST cron) — agla Monday aane par apne aap Owner ko PDF milna chahiye, verify kar lena.

---

## Part C — Known, deliberately-out-of-scope items (future polish, blocker nahi)

_Yeh sab pichhle sessions ke notes se carry-forward hain — go-live ko block
nahi karte, par yahan ek jagah collect kiye taaki bhoolein nahi:_

1. `EditProductModal.tsx` mein `compatibleModels`/`screenSizeInches` edit karne ka option nahi hai (sirf naya product add karte waqt set hota hai) — Step 3.2/3.4 se carry-forward.
2. List-heavy screens mein real virtualization (`react-window` jaisa kuch) nahi hai — abhi typical shop-scale data (kuch sau–hazaar records) ke liye safe hai, bahut zyada badhne par dobara dekhna (Step 10.2).
3. Text-overflow truncation sirf table/list **naam cells** mein lagi hai — modals ke andar ke long notes/description fields abhi cover nahi hue (Step 10.3).
4. `App.tsx` ke inline overlays (job-cost-edit, Owner re-auth gate, CloudAuthPanel) aur ~15 aur `*View.tsx` files ke ad-hoc overlays — sirf CSS entrance-fade milta hai, JS-driven exit-animation hook abhi wire nahi hua (Step 9.3 scope se bahar rakha gaya tha).
5. `record_gemini_key_usage()` RPC dead code hai (kabhi call nahi hoti) — harmless, cleanup optional.

---

## Summary

**Automated/static verification (Part A): sab clean, is session mein khud
fresh-run karke confirm kiya — kuch bhi tootta hua nahi mila, koi naya code
badalne ki zaroorat nahi padi.**

**Manual/device verification (Part B): ek checklist ke roop mein taiyaar hai
— yeh wahi kaam hai jo sirf ek real browser/phone/CI runner se ho sakta hai,
jo is sandbox ke paas kabhi nahi tha (har pichhle step mein bhi yehi
limitation note hoti rahi hai). Owner isko apni raftaar se, ek-ek section
karke chala sakta hai — koi bhi item fail ho to wapas aake bata dena, us
specific step ka fix agli session mein turant hoga.**

App ab **feature-complete** hai (Steps 1–12 sab ✅) — Step 13 khud koi naya
feature nahi jodta, balki poore system ko production mein bharosemand tareeke
se launch karne ke liye ek verification pass deta hai.
