# DS Mobile & Digital Hub — Master Plan (v3, Zero-to-Launch Edition)

_Aapne bola "shop abhi chalu nahi hua" — isliye plan ko maine **zero se shuru karke ek chalu, polished shop tak** ki journey ki tarah likha hai, na ki sirf "purane bugs ki list" ki tarah. Matlab: agar koi bilkul nayi copy is app ki aaj install kare, to step 1 se end tak follow karke ek fully-working, professional shop-management app (Windows + Staff Android + Owner Android) ban jaaye._

_Yeh v3 hai — aapne 3 naye bade features bheje (Staff Dedicated Android App, Tempered/Curved Glass ka smart AI + screen-size search + offline download, aur App Update Push system) — inko poori detail ke saath add kiya gaya hai. Neeche "Kya Naya Hai V3 Mein" section hai._

---

## 🆕 Kya Naya Hai V3 Mein (v2 se farak)

1. **Naye Step 1.5 – 1.8 add kiye** — Staff Dedicated Android App, random unguessable ID/Password generation, Owner ka Live Access Control Panel (Add/Delete/Pause/Resume), aur Owner ka apna full-access Android App — sab real-time auto-sync ke saath Windows app ke.
2. **Naya Step 3.4 add kiya** — Tempered/Curved Glass jaise multi-model products ke liye AI ka full behaviour: short model names → full names, screen-size auto-detect & save, **"same screen size" smart fallback search** (agar exact model na mile), aur **Normal vs Curved Glass** ke alag categories lekin unified search.
3. **Naya Step 3.5 add kiya** — Offline-First Data Sync: Staff Android app mein ek "Download Area" jahan se stock/photos/details local mein save ho jaayein taaki internet na ho tab bhi app flawlessly chale, aur baad mein auto-sync ho jaaye.
4. **Naya Step 12 add kiya** — App Update & OTA Push System (Windows + dono Android apps ke liye) — purana Step 12 (Testing) ab **Step 13** ban gaya hai.
5. INDEX aur Confirm-section ko naye steps ke hisaab se update kiya gaya hai.

---

## 📋 INDEX

- **STEP 1** — Foundation: Login & Access (Owner + Staff) — _ab Staff/Owner Android Apps bhi isi mein_
- **STEP 2** — Foundation: AI Key Pool + Base System Health
- **STEP 3** — Core Data: Add Stock, Multi-Model Products, 4-Tier Pricing, Glass Smart-Search, Offline Sync
- **STEP 4** — Selling Flow: POS, Insufficient-Stock Fix, No-Discount Removal, Confidential Price Request
- **STEP 5** — Gifts System
- **STEP 6** — AI Everywhere: Photo Stock Finder (Snap & Sell) + Micro-AI Helpers
- **STEP 7** — Storage & Backup Architecture (Cloudflare / Supabase / Telegram)
- **STEP 8** — Invoice Redesign
- **STEP 9** — Owner Command Center: Status Dashboard + Grouped UI + Animations
- **STEP 10** — Stability & Crash-Proofing Pass
- **STEP 11** — Day-Zero Setup Wizard (first launch experience)
- **STEP 12** — App Update & OTA Push System (Windows + Android)
- **STEP 13** — Testing & Go-Live Checklist
- **Delivery Process** (kaam kaise hoga, part-wise)
- **Confirm Karne Wali Baatein**

---

## STEP 1 — Foundation: Login & Access (Owner + Staff)

_Sabse pehle yeh, kyunki jab tak login hi confusing/broken hai, aap khud app use nahi kar paoge, staff ko de nahi paoge — sab kuch isi ke upar khada hai._

### 1.1 Owner Login
- Email + Password (jaisa abhi hai) — real cloud account, ek baar verify hota hai.

### 1.2 Staff Login — Naya Simplified Tarika
- **Koi email nahi.** Owner apne "Staff Access Manager" section mein jaake button dabayega **"Generate Staff ID"** → system khud ek Staff ID (jaise `STAFF-1234`) aur ek temporary password bana dega.
- Owner yeh ID/Password staff ko bol dega (WhatsApp/verbally/kagaz par — jaisa chaahe).
- Staff apne phone/PC par sirf **Staff ID + Password** daalke login karega — bas.
- Login hote hi turant us store ka data **automatically sync** ho jaayega, koi extra "connect" step nahi.
- Owner chaahe to kisi bhi Staff ID ko **ek click mein disable/regenerate** kar sake (agar staff badal jaaye ya password bhool jaaye).

### 1.3 Staff Access Manager ka bug fix
- Abhi "Store abhi set nahi hua — Cloud & Security se pehle sign in karo" wala error sign-in hone ke baad bhi aa raha hai.
- **Fix:** yeh check galat time pe run ho raha hai (store ID load hone se pehle hi check kar leta hai). Ek proper "loading" state dikhayenge jab tak store confirm na ho jaaye, uske baad hi real status check hoga.

### 1.4 Telegram — Sirf Owner Ka Kaam
- Staff ko app mein **kabhi** "Connect Telegram" ka option nahi dikhega — jahan bhi abhi dikh raha hai (bug), usko owner-only bana denge.
- Sirf **Owner ka Telegram account** connected hota hai — aur uska bot hi sabko automatic invoices/reports/alerts bhejta hai. Staff ko is se koi matlab nahi.
- **Telegram Connect Fail Bug** ("Failed to send a request to the Edge Function"): iska root cause dhoondhenge — Edge Function deploy/env-variable issue ho sakta hai — aur error ko user-friendly banayenge (abhi generic error aata hai, hume exact reason pata chalna chahiye debug karne ke liye).

### 1.5 Staff Dedicated Android App (Naya)
- Ek **poora alag, dedicated Android app** — staff ke saare kaam (Sell/Checkout, Stocks dekhna, Photo Stock Finder, Confidential Price request, jo bhi permission mile) usi ek app ke andar honge.
- App khulte hi sirf **Staff ID + Password** maangega — koi signup, koi email, koi extra step nahi.
- Staff ko sirf utna hi access milega jitna Owner ne Windows app ke "Staff Access Manager" mein us ID ke liye set kiya hai (jaise ek staff sirf Sell kar sake, doosra Stocks bhi dekh sake — jo bhi permission-model already plan mein hai, wahi yahan bhi lagu hoga).
- **Real-time Auto-Sync (bahut zaroori):** Agar staff Android app se koi sale kare, wo **turant** (real-time, refresh ki zaroorat nahi) Owner ke Windows app mein bhi dikhega — aur vice-versa. Dono ek hi live backend (Supabase) use karenge, isliye ek jagah action hote hi doosri jagah update ho jaayega.

### 1.6 Random, Unguessable ID & Password Generation (Security — bahut important)
- **ID format:** Random alphanumeric (jaise `STF-7Q2K9`) — sequential/predictable (`STAFF-1`, `STAFF-2`) **nahi** honge, taaki koi ID guess na kar sake.
- **Password:** Cryptographically random string (upper+lower+digits mix, kam se kam 10-12 characters) — kabhi bhi simple pattern (`1234`, `staffname123`) nahi hoga, aur do alag staff ke passwords kabhi ek-jaisi lagne wali (confusing/similar) nahi honge.
- Generate hote hi Owner ko ek **"Reveal & Copy"** box mein ek baar dikhega — usse turant staff ko de sakte hain. Password sirf **hashed** form mein store hoga (asli password dobara plain-text mein dikh nahi sakta) — agar bhool jaaye to Owner **"Regenerate Password"** kar sakta hai (naya random password ban jaayega).

### 1.7 Owner ka Live Access Control Panel (Staff Access Manager ka upgrade)
Owner Section mein ek **live table** dikhega, har Staff ID ki row ke saath:
- Status: 🟢 **Active** / 🟡 **Paused** / ⚪ **Deleted**
- Created date, Last login / Last active time
- Actions (sirf Owner kar sakta hai — staff ko yeh options kabhi nahi dikhenge):
  - **Add New** (naya ID generate)
  - **Delete** (permanently hata do)
  - **Pause** (temporarily login block karo, ID delete nahi hoti — baad mein wapas activate ho sakti hai)
  - **Resume** (Pause hataake wapas active karo)
  - **Regenerate Password** (naya random password bana do, purana turant invalid)
- **Important:** Pause/Delete hote hi agar staff us waqt kahin logged-in hai, uska session **turant (real-time) kick** ho jaayega — sirf naye login attempt pe block nahi hoga, already-open session bhi turant band ho jaayegi.

### 1.8 Owner Android App — Full Access
- Owner ka apna alag Android app bhi banega — **Windows app jitna hi full access** (Status Dashboard, Pricing control, Reports, Staff Access Manager, sab kuch).
- Yeh bhi usi real-time auto-sync backbone pe chalega — Owner Android se kiya koi bhi change turant Windows app mein aur Staff Android mein reflect hoga.

**✅ Is Step ke baad aap kya kar paoge:** Owner login karke Staff IDs generate kar paoge (random, secure), staff apne dedicated Android app se seedha login kar paayega, Owner kabhi bhi kisi ID ko live Add/Pause/Resume/Delete kar payega, Telegram sirf owner side properly connect ho paayega, aur Owner khud bhi apne Android app se poora business chala paayega Windows jaisa hi.

---

## STEP 2 — Foundation: AI Key Pool + Base System Health

_Yeh dusra step isliye hai kyunki Step 3 (AI auto-fill), Step 6 (Photo Finder), aur bahut saari chhoti AI cheezein isi pool ko use karengi — pehle foundation banana zaroori hai._

### 2.1 Gemini — 10 API Keys, Auto-Rotation Pool
- Owner Settings mein 10 Gemini API keys daalne ka secure option.
- Jaisi hi ek key ka daily limit khatam ho, system **turant automatic** doosri key try karega — kisi bhi feature ko rukna nahi chahiye.
- Google ki daily quota apne aap agle din reset hoti hai, isliye alag se "manual reset" button ki zaroorat nahi — bas **status dikhna chahiye**.

### 2.2 AI Key Status Widget (Owner-only)
Dikhega:
- Kaunsi key abhi **active** hai
- Kitni keys **available** hain, kitni **exhausted**
- Aaj total kitna AI use hua (rough estimate/count)

### 2.3 "AUTHENTICATION REQUIRED" errors ka fix
- Poori app mein jahan-jahan yeh error galat jagah aa raha hai (mostly staff jahan allowed hona chahiye wahan block ho raha hai, session expiry, ya RLS policy strict hai) — ek-ek jagah list banake verify/fix karenge.

**✅ Is Step ke baad aap kya kar paoge:** 10 keys daal paoge, unka status dekh paoge, aur AI features kabhi "key khatam" ki wajah se poori tarah band nahi honge.

---

## STEP 3 — Core Data: Add Stock, Multi-Model Products, 4-Tier Pricing

### 3.1 Add Stock — Simplified 3-Question Flow
Jab naya stock add karo, sirf 3 cheezein poochhi jaayengi:
1. Company/Brand
2. Model
3. Category

**Photo upload karte hi AI (Gemini Vision)** in teeno ko khud detect karke fill karne ki koshish karega (target: 99% cases mein sahi). Manually edit bhi kar sakte ho hamesha.
- Jo photo upload hui wahi photo **Stocks list mein product image** ki tarah dikhegi.

### 3.2 Multi-Model Compatible Products (jaise Tempered Glass) — Naya Data Design
_Yeh whiteboard ke "Super X" example se aaya hai — ek glass jo Realme/Samsung/OnePlus ke 40+ models fit karta hai._

- **Problem jo fix karna hai:** Abhi poori 40+ models ki list ek saath UI mein dump ho jaati hai — na sirf confusing lagta hai, balki isse UI **crash/lag** bhi karta hai (yeh Step 10 ke stability issue se directly juda hai).
- **Naya design:**
  - Har "compatibility group" (jaise ek particular glass design jo ek fixed set of models fit karta hai) apna **ek hi stock entry** hoga — stock count us poore group ka shared hota hai.
  - UI mein compatible models ki list **default mein sirf top kuch (jaise 5) dikhengi**, saath mein ek **search/typeahead box** ("apna model type karke dhoondo") — poori list sirf tab dikhegi jab user "Sabhi Models Dekhein / Extend" par click kare.
  - Agar do glass **design/list mein alag** hain (ek Realme-only, doosra Samsung-only), to woh **do alag stock entries** honge — kabhi merge nahi honge, chahe naam similar ho.

### 3.3 4-Tier Pricing System (bahut important — carefully implement karna hai)

| Price Type | Kise dikhta hai | Kaun set karta hai | Limit |
|---|---|---|---|
| **1. Original (Kharidari) Price** | **Sirf Owner** | Owner | Kabhi kisi aur ko nahi — API/export/report kahin bhi leak nahi hoga |
| **2. Confidential Price** | Owner hamesha; Staff sirf **per-request Telegram-approval** ke baad | Owner (Original se upar) | Staff isse **neeche** kabhi nahi bech sakta |
| **3. Selling Price** | Sab (Staff + Owner) | Owner | Staff isse neeche bhi bech sakta hai, par Confidential se neeche kabhi nahi |
| **4. MRP** | Sab | Owner | Sirf display/discount-calculation ke liye |

**Example:** Original ₹14 → Confidential ₹40 → Selling ₹120 → MRP jo bhi ho. Staff ₹120 se lekar ₹40 tak kahin bhi bech sakta hai, ₹40 se neeche kabhi nahi.

- **Profit calculation hamesha Original price ke hisaab se hoga**, chahe report kahin bhi ho: Example — ₹14 kharidari, ₹80 mein becha → profit ₹66.

**✅ Is Step ke baad aap kya kar paoge:** Naya product add karte waqt sirf 3 cheezein type karni hongi (baaki AI karega), multi-model accessories ka list gadbad nahi karega, aur 4 alag prices sahi logic ke saath kaam karenge.

### 3.4 Tempered/Curved Glass — AI Full Auto-Fill + Screen-Size Smart Search (Naya, Detailed)
_Aapke bheje gaye "Super X" glass photo se example: Company - SuperX, Category - Tempered Glass, aur photo pe likha hai "For: R-ME7/R-ME C17/A32/A33 2020/A53 2020/A54 4G/A53S/R-ME 8I/A55 4G/K9S/K10 4G/R-ME Q3S/Q5/R-ME 9I/..." (bahut saare short-form models)._

**a) Short Names → Full Names, Auto-Expand**
- AI photo se yeh sab padhega: Company Name, Category, aur poori compatibility list (jo abbreviated/short form mein likhi hoti hai, jaise `R-ME7`, `A33 2020`, `1+NORD N100`).
- AI in short names ko apne knowledge se **poore/official model names** mein expand karke fill karega — Example: `R-ME7` → `Realme 7`, `A33 2020` → `Realme A33 (2020)`, `1+NORD N100` → `OnePlus Nord N100`.
- Yeh poori list (chahe 40+ models ho) **ek hi stock entry** banayegi — count hamesha **1 glass = 1 unit** rahega (jaisa 3.2 mein design kiya), sirf uske "compatible models" field mein poori list save hogi.

**b) Screen-Size Auto-Detection (Naya)**
- Glass ki photo pe screen-size kabhi likha nahi hota — isliye AI khud compatible models ki list dekhkar (apne knowledge/lookup se) yeh figure out karega ki yeh glass kis **screen size** (jaise "6.7 inch") ke liye design hua hai, aur usko ek **searchable field** mein save karega.
- Agar list mein models thodे alag-alag screen sizes ke ho (jaise universal-fit glass), AI ek **range** save karega (jaise "6.5–6.7 inch") — galat single number force nahi karega.
- **Search ka fayda:** Owner/Staff "6.7 inch" search karke seedha saare matching glasses dekh sakte hain, sirf model-naam se search karne ke alawa.

**c) "Same Screen-Size" Smart Fallback Search (Naya — bahut useful)**
_Example jo aapne diya: maan lo "Realme P4" ka glass stock mein nahi hai, lekin uska screen size pata hai (AI ko), aur us screen-size ka koi doosra glass stock mein hai._
- Jab koi "Realme P4" search kare aur exact match na mile:
  1. AI (agar online hai) turant "Realme P4" ka screen size lookup karega.
  2. Phir stock mein us **same screen-size** wale doosre glasses dhoondega.
  3. Result mein dikhayega **saath ek clear warning/note**: _"Exact model match nahi mila, lekin same screen size (X inch) ka glass available hai"_ — product photo ke saath.
- Yeh sirf ek helpful suggestion hai, galti se exact-match jaisa confuse nahi karega — warning hamesha visible rahega.

**d) Screen-Size Data ka Local Caching (Offline ke liye zaroori)**
- Jo bhi model ↔ screen-size mapping ek baar AI ne lookup kar li, wo **save/cache** ho jaayegi (Supabase mein) — taaki agli baar wahi model dobara internet-lookup ke bina bhi turant match ho sake.
- Isse offline mode mein bhi (jo models pehle se lookup ho chuke hain unke liye) yeh feature **kaam karta rahega** — sirf bilkul naye/pehli-baar-dekhe models ke liye internet chahiye hoga.

**e) Normal Tempered Glass vs Curved Glass — Alag Categories, Ek Search**
- "Tempered Glass" (flat/normal) aur "Curved Glass" (edge-to-edge curved, jaisa Super X hai) — yeh do **alag categories/sections** honge stock mein (taaki organize rahe, alag jagah dikhein).
- Lekin **search karne par dono ek sath** result mein aayenge (search category-blind hoga) — user ko yaad nahi rakhna padega ki wo product kis category mein rakha hai.

**✅ Is Step ke baad aap kya kar paoge:** Glass jaisa koi bhi multi-model product photo se add karte hi poori model-list full names mein aur screen-size sab auto-fill ho jaayega, exact model na milne par bhi same-screen-size ka alternative mil jaayega (warning ke saath), aur yeh sab offline mein bhi (jo pehle se cache ho chuka hai) kaam karega.

### 3.5 Offline-First Data Sync — "Download Area" (Staff Android App ke liye)
- Staff jab apne Android app mein login karega, ek **"Download Area"** milega jahan se wo apne store ka zaroori data (stock list, product photos, screen-size mappings, aur baaki details) **local device mein download** kar sakta hai.
- Isse agar internet chala jaaye, staff ka app **flawlessly kaam karta rahega** (dikhana, search karna, sell karna local mein record hoga) — jaisi hi internet wapas aaye, sab **automatically sync** ho jaayega Owner ke Windows/Supabase backend ke saath.
- Yeh Step 1.5 ke Staff Android App aur 3.4(d) ke screen-size caching, dono ka combined foundation hai — poori app "offline-first" soch ke saath banegi, sirf online-only nahi.

**✅ Is Step ke baad aap kya kar paoge:** Staff ka Android app internet chale jaane par bhi ruke ga nahi — kaam continue hoga aur baad mein sab sync ho jaayega.

---

## STEP 4 — Selling Flow: POS, Bug Fixes, No-Discount Removal, Confidential Price Request

### 4.1 "Insufficient Stock / Inventory Mismatch" Bug Fix
- Yeh sabse critical hai — abhi stock dikhne ke bawajood sale block ho rahi hai.
- **Kya galat ho sakta hai:** `product.stock` field aur asli FIFO `stockBatches` ka total kabhi-kabhi match nahi karta (jaisa StockAdjustView review mein dekha tha) — checkout ka check purane/mismatch field pe bharosa kar leta hai.
- **Fix:**
  1. Checkout ka check **asli batches ka sum** use karega, sirf ek field pe blind bharosa nahi.
  2. Owner ke liye ek chhota **"Stock Health Check"** tool banayenge jo kabhi bhi mismatch dikhe to ek-click mein sync/fix kar de.
- _(Chunki shop abhi live nahi hua, koi purana corrupted data nahi hai — isliye yeh fix "future-proofing" hai, taaki jab live ho to yeh dubara na ho.)_

### 4.2 "No Discount" Option Poori Tarah Hatana
- Aapne clearly likha: _"no discount ye option kabhi bhi na dikhe, jitna mein sell ho utna price rahega — 120 ka glass staff ne 80 mein becha, bas baat khatam."_
- Matlab: Sell screen mein koi bhi manual "No Discount" checkbox/flag **nahi hona chahiye**. Jo bhi final price staff/owner daalega, wahi final hai — discount % **hamesha automatic** MRP vs Actual-Sold-Price se calculate hoga (Step 5 dekhen), koi manual override cheez nahi.
- Jahan bhi purane code mein aisa koi "no discount" flag/checkbox mil jaaye, use poori tarah hataayenge.

### 4.3 Confidential Price — Per-Product Telegram Request Flow
- Har stock item ke saath ek **"Confidential Price"** button hoga.
- Staff click karega → ek Telegram message Owner ke paas jaayega jisme **exact product detail** likha hoga — Naam, Model, Category (jaise: _"Sampark, Model-466, Category-Speaker ka Confidential Price dekhna chahta hai [Staff Name]"_) — taaki Owner bina app khole bhi samajh jaaye kaunsa product hai.
- Owner approve karega → **sirf usi specific product** ka confidential price staff ko dikhega (permanent nahi, sirf uss request/session ke liye).

### 4.4 Connection Status Indicator (Chhota, Sabko Dikhega)
_Yeh Step 9 ke bade "Owner-only Status Dashboard" se **alag** cheez hai — yeh chhota, hamesha visible indicator hai._
- Ek chhota badge/dot (jaise top bar mein) jo dikhayega: **Online (synced)** ya **Offline**.
- Agar offline hai, to ek **"Retry Sync"** button dikhega, aur agar user kuch na bhi kare, system **khud automatically retry** karta rahega background mein.

**✅ Is Step ke baad aap kya kar paoge:** Sale kabhi galat "insufficient stock" error se block nahi hogi, koi confusing "no discount" checkbox nahi milega, staff confidential price sahi tarike se maang paayega (owner ko pata rahega kya maanga gaya), aur sabko pata rahega ki app online hai ya offline.

---

## STEP 5 — Gifts System

### 5.1 Auto-Discount (Manual Nahi)
- `Discount % = (MRP − Selling Price) / MRP × 100` — **hamesha auto-calculate**, kabhi type nahi karna padega.
- Stocks list mein Staff + Owner dono ko yeh % dikhega.
- Jab actual sale ho, jitne mein becha uska bhi discount % nikalke **Invoice mein** dikhega ("MRP ₹X, Sold ₹Y, Discount Z%").
- **Cyber Café section par yeh lagu nahi hoga** — sirf normal products par.

### 5.2 Gifts
- **Mobile (New) aur Second-Hand Phone** sale screens mein **"Add Gift"** button.
- Gift add karte waqt **poore stock mein se search karke** koi bhi product select kar sakte ho (Earbuds, Glass, etc.) — uski quantity 1 kam ho jaayegi stock se, bina paisa liye.
- **Invoice mein:** Discount info + gift product ka naam + uska MRP + ek chhota **"🎁 Complimentary Gift"** celebratory badge, taaki customer khush ho.

**Profit Calculation Example (recheck kiya hua):**
- Phone: MRP ₹5500, Original ₹3000, Selling ₹4999, Confidential ₹3500, Actual Sold ₹4000.
- Gift (Earbuds): Original ₹149.
- Calculation: ₹4000 (sold) − ₹3000 (original) = ₹1000 bacha → minus Gift ka Original cost ₹149 → **Actual Profit = ₹851**.
  > _Note: Aapne ₹850 bola tha; ₹149 ko exact rakhne par ₹851 aata hai. App mein hamesha **exact original price** use hoga, koi rounding nahi — taaki paisa-paisa sahi ho._

### 5.3 Owner Reports — "Gifts Cost" Section (Naya)
- Do numbers: (a) **Original-price-basis** total gift cost, (b) **Selling-price-basis** total gift value.
- Dono ke liye 3 filters: **Total (All-Time)**, **This Month**, **This Year**.

**✅ Is Step ke baad aap kya kar paoge:** Discount kabhi manually likhna nahi padega, gift dena aasan hoga (search-se-select), aur invoice + owner reports dono mein sahi hisaab dikhega.

---

## STEP 6 — AI Everywhere: Photo Stock Finder (Snap & Sell) + Micro-AI Helpers

### 6.1 Purana "AI Box Scan" REPLACE Hoga (sirf fix nahi, naya banega)
- Aapne clearly bola: _"ai box ko replace karega aur ise bahot powerful aur fast banana."_
- Purana AI Box Scan feature hataayenge, aur uski jagah ek naya, unified, tez feature banayenge: **"Photo Stock Finder — Snap & Sell"**.

### 6.2 Photo Stock Finder — Snap & Sell (Dashboard, POS ke left mein)
- **Owner aur Staff dono** access kar sakte hain (staff ke liye bhi zaroor available, jaisa whiteboard mein likha).
- Photo upload/click karo → AI check karega:
  1. Yeh product shop ke stock mein hai ya nahi.
  2. Agar hai, to us exact item ko **result mein dikhaye** (current stock qty ke saath).
  3. Wahi se **seedha select karke Sell/Checkout mein add** kar sako — jaise ek visual search-based shortcut.
- Target: bahot fast response (loading spinner minimum ho), aur accurate match.

### 6.3 AI "Har Chhoti Si Chhoti Jagah" (Micro-AI Helpers)
_Yeh aapke Image 2 wale bade instruction se aaya hai — sirf 2 badi features tak simit nahi._
- 10-key pool (Step 2) ka use karke, chhoti-chhoti jagah pe bhi AI ka help milega, jaise:
  - Naya product add karte waqt naam/category suggest karna.
  - Owner Reports mein ek-click "AI Advice" (already partially bana hua hai, isko refine/expand karenge).
  - Search boxes mein natural-language type search (jaise "wo laal wala glass" type karne par bhi sahi result aana).
- Yeh sab **invisible/seamless** feel dena chahiye — user ko "AI processing ho raha hai" jaisa clunky wait nahi lagna chahiye.

**✅ Is Step ke baad aap kya kar paoge:** Ek hi tez, reliable photo-search feature hoga (staff bhi use kar payega), aur poori app mein chhote-chhote jagah pe AI ka smart help milega.

---

## STEP 7 — Storage & Backup Architecture (Cloudflare / Supabase / Telegram)

### 7.1 Naya Storage Split
| Data Type | Kahan Jaayega |
|---|---|
| Text data (stock details, prices, IDs, passwords, app logic/state) | **Supabase** |
| Heavy files — Invoices (PDF), Product photos, KYC photos, box-scan images | **Cloudflare** |
| Sabka backup copy | **Telegram** (already automatic, weekly) |

### 7.2 Delete Policy (Purana Hataya Ja Raha Hai)
- **Purana (hata diya):** Heavy files weekly auto-delete hoti thi.
- **Naya:**
  - Koi bhi file **kabhi automatically permanently delete nahi hogi**.
  - Telegram weekly backup jaisa hai waisa hi rahega — sirf backup, original delete nahi.
  - **Product Photos:** Jab tak product **manually delete** na ho ya **"out of stock" 3 mahine se zyada** na ho jaaye, photo safe rahegi. 3 mahine ke baad hi auto-cleanup (storage bharne se bachega).
  - **Invoices/PDFs:** Kabhi auto-delete nahi. Owner ke paas **"Export & Clear"** tool — jaise "last 1/3 month ka combined PDF banao" → phir purane individual records delete karo. Yeh sirf Owner kar sakta hai, manually.

### 7.3 Storage Usage Meter (Owner-only Status Dashboard ka hissa — Step 9 mein full detail)
- Har storage (Supabase, Cloudflare) ka **kitna use hua / kitna baaki** dikhega, aur **Warning (amber) / Critical (red)** alert jab bharne wala ho.

**✅ Is Step ke baad aap kya kar paoge:** Koi bhi zaroori file galti se delete nahi hogi, storage kabhi bina warning ke full nahi hoga, aur PDF/invoice cleanup poori tarah aapke control mein hoga.

---

## STEP 8 — Invoice Redesign

### 8.1 Hataani Hain
- ❌ Top mein alag se dikh raha **timestamp**.
- ❌ Neeche dikh raha **file location / local save path / debug text**.

### 8.2 Add Karni Hain
- ✅ Warranty products ke liye **blank "Authorized Signature" box**.
- ✅ Premium/professional look — behtar layout, spacing, shop branding prominent ("customer bill dekhkar khush ho jaaye").
- ✅ Discount aur Gift info (Step 5) properly, achhe se formatted.

**✅ Is Step ke baad aap kya kar paoge:** Har invoice professional dikhega, customer ko discount/gift clearly samajh aayega, aur warranty ke liye signature jagah ready milegi.

---

## STEP 9 — Owner Command Center: Status Dashboard + Grouped UI + Animations

### 9.1 Full System Status Dashboard (Owner-only)
Dikhega (green/red indicator har ek ke liye):
- Gemini AI (kaunsi key active — Step 2 se)
- Telegram Bot
- Telegram Owner Account (connected/disconnected)
- Staff Connections (kitne staff devices online/synced)
- Cloudflare Storage
- Supabase Storage & Database
- **Storage Usage Meter** (Step 7.3 se) — har jagah ka % use + warning/critical alerts.

_(Note: yeh bade dashboard se alag hai Step 4.4 ka chhota "online/offline" badge jo sabko dikhta hai — dono cheezein sath-sath rahengi, alag purpose ke liye.)_

### 9.2 Grouping Logic (Image 2 ka core message)
- Related sections ek **collapsible group** mein rahenge. Example:
  - **💰 Money & Expenses** — Shop Expenses, Personal Drawings, Supplier Khata, Loan Tracker
  - **📦 Inventory** — Stock Adjust, Purchases, Low Stock Alerts
  - **👥 People** — Staff Access, Customer Directory, Loyalty
  - **📊 Reports** — Owner Reports, Monthly Review, Daily Review, Profit/Loss
  - **⚙️ System** — Status Dashboard, AI Keys, Storage
- Har group card jaisa dikhega — click/tap karne par andar ke options smoothly expand honge (nested — "ek section ke andar baaki sections").
- **Iterative review process:** Har group reorganize karne ke baad main pehle ek **preview/mockup dikhaunga**, aap "kaisa laga" bataoge, phir final version banayenge — jaisa aapne diagram mein "batao aese hi improve karo" likha hai.

### 9.3 Popup/Modal Animations
- Har modal/popup mein subtle **open/close animation** (fade + scale/3D depth feel, ~200ms) — flawless feel, koi sudden jarring pop-in nahi.
- Missing popups (jo abhi basic/plain hain) identify karke consistent style denge.

### 9.4 Text/Language Cleanup
- Confusing/technical/mixed-language text ko simple **Hinglish** mein rewrite karenge, jitna zaroori utna hi rakhenge.

**✅ Is Step ke baad aap kya kar paoge:** Owner Mode kholte hi confuse nahi hoge — sab related cheezein groups mein milengi, poora system health ek jagah dikhega, aur har popup smooth/professional feel dega.

---

## STEP 10 — Stability & Crash-Proofing Pass

_Aapne likha: "abhi bhi UI complicated hai, text UI crash kar rahe hain, flawlessly nahi hai."_

- **Root cause investigate karenge:** Bade lists (jaise Step 3.2 ka 40+ model list) bina pagination/search ke render hone se UI slow/crash hota hai — Step 3.2 ka fix isse directly kam karega.
- **General pass:** Har list-heavy screen (Stocks, Sales History, Reports) check karenge ki bade data ke saath bhi smooth chale (lazy-loading/virtualization jahan zaroori ho).
- **Text overflow/layout crash:** Jahan bhi long product names/lists layout todte hain, wahan text truncation + "..." + tooltip/expand pattern lagayenge.
- Yeh pass **Step 3, 6, 9 ke baad** hoga kyunki tab tak naya UI structure already ban chuka hoga — usi pe stability check karna zyada sahi hoga (purane UI pe fix karke, naya UI aane par dobara todna theek nahi).

**✅ Is Step ke baad aap kya kar paoge:** App kabhi random crash/freeze nahi karegi, chahe stock list kitni bhi badi ho.

---

## STEP 11 — Day-Zero Setup Wizard (First-Launch Experience)

_Chunki shop abhi live nahi hua, ek **first-time setup checklist** banayenge jo Owner ko literally step-by-step le jaayegi — taaki "kya pehle karu, kya baad mein" ka confusion na ho._

Jab Owner pehli baar (sab fixes ke baad) app kholega, ek simple checklist/wizard dikhega:

1. ✅ Shop details bharo (naam, address, phone, UPI, invoice terms)
2. ✅ Telegram account connect karo (Owner ka)
3. ✅ 10 Gemini API keys daalo
4. ✅ Cloudflare storage connect karo (agar setup pending ho, instructions milengi)
5. ✅ Pehla Staff ID generate karo (agar staff rakhna hai)
6. ✅ Pehla product add karo (test ke taur pe) — dekho AI auto-fill kaise kaam karta hai
7. ✅ Pricing samjho (Original/Confidential/Selling/MRP) — ek chhota interactive example/tutorial popup
8. ✅ Ek test sale karke dekho — invoice kaisa banta hai

Har step complete hone par checkmark lagega, aur poori wizard skip bhi kar sakte hain agar Owner directly jump karna chahe.

**✅ Is Step ke baad aap kya kar paoge:** Bina kisi confusion ke, 30-45 minute mein poora shop properly set ho jaayega, launch ke liye ready.

---

## STEP 12 — App Update & OTA Push System (Windows + Android)

_Aapka point: "app bana ke de diya staff ko ya window app ya owner android app, aage chalke koi feature ya update laana ho to use app hi update kar le" — matlab bina sabko manually reinstall karwaye, updates push ho sakein._

### 12.1 Android Apps (Staff + Owner) — In-App Update Check
- Chunki yeh apps Play Store se nahi (sideload/direct-install) honge, ek **chhota internal update-checker** banayenge:
  - App khulte hi (ya periodically) ek "latest version" endpoint check karega (Supabase/Cloudflare pe hosted ek chhoti version-info file).
  - Agar installed version se naya version available hai, ek **"Update Available"** popup dikhega — ek-tap mein naya APK download + install ho jaayega.
- Owner naya APK build hone par usko upload karke us version-info ko **"live"** mark karega — bas itna karne se sab devices ko update mil jaayega.

### 12.2 Windows/Desktop App — Auto-Update
- App already **Tauri** (`src-tauri`) use kar raha hai, jisme built-in **Tauri Updater plugin** hota hai — isी ko properly configure karenge.
- App launch hone par khud check karega naya version hai ki nahi, agar hai to download + apply (with user confirmation prompt).

### 12.3 Owner ka "App Versions" Panel (Status Dashboard ka hissa)
- Owner ko dikhega: Staff Android App ka current live version, Owner Android App ka, aur Windows App ka.
- Naya version upload/publish karne ka simple interface (file upload + "Make this version Live" button).

**✅ Is Step ke baad aap kya kar paoge:** Aage chalkar koi bhi naya feature ya bug-fix layenge to sabko manually naya app dobara install karwane ki zaroorat nahi padegi — ek jagah se push karke sabtak pahuncha sakoge.

---

## STEP 13 — Testing & Go-Live Checklist

Har Step complete hone ke baad main ek chhota checklist dunga us specific step ke liye. Poora build hone ke baad, ek **final end-to-end checklist** hoga:

- [ ] Owner login → Staff ID generate → Staff login (naye device pe) → auto-sync check
- [ ] Naya product add karo → AI auto-fill check karo → 4 prices set karo
- [ ] Multi-model glass jaisa product add karke search/extend UI check karo
- [ ] Sale karo (Selling price se, Confidential se, Gift ke saath) → invoice check karo
- [ ] Confidential Price request bhejo (staff se) → Telegram par sahi product naam aaya check karo → approve karke dekho
- [ ] Photo Stock Finder se ek product dhoondo aur seedha sell karo
- [ ] Offline karke dekho — status badge aur retry check karo
- [ ] Ek AI key ko dummy-exhaust karke auto-switch check karo
- [ ] Owner Status Dashboard mein sab green dikhe (ya sahi red jaha issue ho)
- [ ] Invoice PDF Cloudflare mein jaa raha hai, weekly Telegram backup bhi ja raha hai, koi auto-delete nahi ho raha
- [ ] 3 mahine out-of-stock simulate karke photo cleanup check karo (ya code review se confirm)
- [ ] Staff Android app se login karke ek sale karo → turant Windows app mein dikh raha hai check karo (real-time sync)
- [ ] Owner Windows app se ek Staff ID Pause karo → us staff ka already-open session turant kick ho raha hai check karo
- [ ] Do alag Staff ID generate karke unke random passwords compare karo — dono alag, unguessable dikhne chahiye
- [ ] Glass jaisa multi-model product add karo → full model names + screen size auto-fill check karo
- [ ] Ek aisa model search karo jiska exact glass stock mein nahi hai lekin screen-size match karta hai → warning ke saath suggestion aana chahiye
- [ ] Staff Android app mein "Download Area" se data download karke phone ko offline karo → app kaam kar raha hai check karo, phir online karke sync confirm karo
- [ ] Ek dummy app-version publish karke dekho Android + Windows dono update-prompt dikha rahe hain ki nahi

---

## Delivery Process (Kaam Kaise Hoga)

1. **Ek Part start hoga** (jaise Step 1.1 se).
2. Part complete hote hi:
   - **Detailed report** — kya problem thi, root cause, kya fix kiya, kaunse files change hue.
   - **Updated ZIP** us part ke changes ke saath.
3. Agla part tab start hoga jab aap confirm karoge, ya turant "next part karo" bologe.
4. Har Step ke end mein chhota testing checklist milega (upar Step 13 jaisa, par us specific Step ke liye).

---

## ✅ Confirm Karne Wali Baatein

1. Kya yeh **naya "Step 1 se 13" order** (zero-se-launch journey) sahi lagta hai, ya kuch aur pehle chahiye?
2. **Multi-model glass ka data design** (3.2/3.4) — jaisa maine samjha, sahi hai na? (Ek design = ek stock entry, alag design = alag entry, full-name expand + screen-size auto-fill)
3. **Gift profit example** — ₹851 sahi calculation hai (exact ₹149 use karke), confirm karo.
4. Kya **Day-Zero Setup Wizard** (Step 11) chahiye, ya yeh extra lagta hai aur skip kar dein?
5. **Staff Android App aur Owner Android App** (Step 1.5-1.8) ka jaisa maine samjha, sahi hai na?
6. Kya hum **Step 1 (Login/Access)** se shuru karein?

Jab confirm kar do, main **Step 1.1** se part-wise kaam start karunga.
