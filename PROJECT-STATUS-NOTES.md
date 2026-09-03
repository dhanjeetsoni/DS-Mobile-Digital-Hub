# DS Mobile & Digital Hub — Project Status Notes

_Yeh file kisi bhi AI assistant (Claude, ChatGPT, Gemini, koi bhi) ko dene ke
liye hai taaki wo bina poora context dobara samjhaye, seedha kaam continue
kar sake. Har baar jab bhi kisi AI se naya kaam karwao, is file ko update
karte jaana — end mein ek "Handoff Prompt" bhi hai jo copy-paste kar sakte ho._

**Last updated:** 2026-09-03

---

## 1. Project kya hai

Ek shop-management app (Windows + 2 Android apps — Staff aur Owner alag-alag)
ek mobile-phone-aur-accessories shop ke liye. Naam: **DS Mobile & Digital
Hub**. Poora plan ek single file mein hai: `DS_Mobile_Master_Plan.md` (13
Steps, Hinglish mein likha hua).

**Tech stack:** React + TypeScript + Vite (frontend), Tauri v2 (Windows +
Android native shell, ek hi codebase se), Supabase (auth/DB/edge functions),
Cloudflare R2 (photos/files storage), Telegram Bot (owner notifications +
weekly PDF reports), Gemini AI (10-key rotating pool — product photo
auto-fill, screen-size lookup, natural search).

---

## 2. Abhi status kya hai (2026-09-03 tak)

**✅ Saare 13 Steps complete hain** (Master Plan v3, "Zero-to-Launch
Edition"). Poori history `DS_Mobile_Master_Plan_Completed_Points.md` mein
hai — har step ka kya-kiya, kya-fix-hua, kya-verify-hua sab likha hai.

Naya deliverable is session ka: **`STEP13-TESTING-GOLIVE-CHECKLIST.md`** —
go-live se pehle real device/browser par manually kya-kya test karna hai,
uski ordered checklist.

### Live cloud resources (already set up, koi naya banane ki zaroorat nahi)
- **Supabase project:** `vjimgnmbgghtsfafamye` ("DS mobile & Digital Hub"), region `ap-northeast-2`. 41 migrations applied, 5 Edge Functions deployed (`staff-manage`, `telegram-connect`, `telegram-outbox-worker`, `r2-storage`, `app-update-manifest`).
- **Cloudflare R2:** 2 buckets already banaye hue hain (`ds-mobile-digital-hub`, `ds-mobile-digital-hub-private`) — code inhe use karne ke liye ready hai.
- **GitHub repo:** `github.com/dhanjeetsoni/DS-Mobile-Digital-Hub` — is session mein poora source push kiya gaya (commit `3c04938`), saath mein `.github/workflows/build-and-release.yml` (tag-triggered CI: Windows installer + signed Android APKs + GitHub Release).

### ⬜ Abhi bhi manual/pending hai (koi bhi AI khud nahi kar sakta — sirf aap kar sakte ho)
1. **Cloudflare R2 API Token** banana (Access Key ID + Secret) — guide: `STEP7.1-CLOUDFLARE-SETUP.md`. Jab tak nahi hota, photos data-URL fallback mein save hoti rahengi (kaam karega, optimal nahi).
2. **10 Gemini API keys** Owner Settings mein daalna — bina inke AI features (auto-fill, photo finder) kaam nahi karenge.
3. **Telegram Bot Token + Webhook Secret** — Supabase Edge Function env vars mein set karna.
4. **`TAURI_SIGNING_PRIVATE_KEY`** — pichli session mein generate hui thi, chat mein ek baar di gayi thi — GitHub repo Secrets mein daalni hai.
5. **Android keystore** (`keytool` se generate) — GitHub Secrets mein daalni hai (`ANDROID_KEYSTORE_BASE64` + password/alias) — guide: `STEP12-APP-UPDATE-SETUP.md`.
6. **Supabase Dashboard → Authentication → Leaked Password Protection** — abhi OFF hai, ek-click ON karna hai (naya finding, Step 13 session mein mila).
7. **Real-device testing** — poora `STEP13-TESTING-GOLIVE-CHECKLIST.md` ka Part B (login, staff sync, Telegram approve/deny, offline mode, print, app-update pill, waghera) — sandbox mein possible nahi, real phone/browser chahiye.

### Deliberately-later / non-blocking (koi urgency nahi)
- `EditProductModal.tsx` mein compatible-models/screen-size edit karne ka option nahi (sirf naya-product-add mein hai).
- List-heavy screens mein real virtualization (`react-window`) nahi — abhi typical shop-scale data ke liye safe hai.
- Text-overflow truncation sirf table/list naam-cells mein hai, modal ke andar ke long-text fields mein nahi.
- ~15 `*View.tsx` files ke inline overlays ko sirf CSS fade milta hai, JS exit-animation hook nahi (Step 9.3 scope se bahar rakha gaya tha).
- Poora list Step 13 checklist ke "Part C" mein hai.

---

## 3. Kaam kaise continue karo (kisi bhi AI se)

1. Sabse latest ZIP GitHub repo se lo (`DS-Mobile-Digital-Hub`, branch `main`) — yeh hamesha sabse current source hai, chat-history wali purani zip files ab stale ho sakti hain.
2. `DS_Mobile_Master_Plan.md` (poora plan) + `DS_Mobile_Master_Plan_Completed_Points.md` (ab tak kya hua, poori detail) — dono AI ko do context ke liye.
3. Jo bhi naya kaam ho (bug fix, naya step, polish) — usi `..._Completed_Points.md` file mein **naya entry add karke** likhna (date + kya kiya + verify kaise kiya), purana kabhi delete nahi karna. Isse har AI/session ko poora audit-trail milta rahega.
4. Kaam khatam hone par: `npm install && npx tsc --noEmit && npm run build && node scripts/static-audit.mjs` — yeh 4 command hamesha clean pass hone chahiye, warna kuch tut gaya.
5. Naya ZIP banao, GitHub par push karo (ya jo bhi AI kaam kar raha hai, use bata do ki push kar de agar uske paas access hai).

---

## 4. Copy-Paste "Handoff Prompt" (kisi bhi AI/cloud ko dene ke liye)

Neeche wala poora block copy karke naye AI assistant ko paste kar do, saath
mein latest zip/GitHub link attach kar dena:

```
Main "DS Mobile & Digital Hub" naam ka ek shop-management app project
continue kar raha hoon (Windows + Staff Android + Owner Android, React +
TypeScript + Vite + Tauri v2 + Supabase + Cloudflare R2 + Telegram + Gemini
AI). Poora plan aur ab-tak-ka-kaam do files mein hai jo main de raha hoon:
DS_Mobile_Master_Plan.md (poora 13-step plan) aur
DS_Mobile_Master_Plan_Completed_Points.md (ab tak kya complete hua, detail
mein). GitHub repo: https://github.com/dhanjeetsoni/DS-Mobile-Digital-Hub
(branch: main) — yahi sabse current source hai.

Saare 13 steps already complete hain. Is waqt kaam ye chahiye: [YAHAN LIKHO
KYA CHAHIYE — jaise "Step X ka ek bug fix karo", "naya feature Y jodo",
"real-device testing ke results yeh aaye, isko fix karo" waghera]

Rules jo follow karne hain:
1. Pehle investigation karo (existing code padhkar) — turant naya code mat
   likho, pehle confirm karo ki jo maang rahe ho wo already bana hua hai ki
   nahi.
2. Live Supabase project (agar access ho) aur ZIP ke beech drift check karo
   pehle — kai baar pichli sessions mein live database ZIP se aage nikal
   chuka hota hai.
3. Kaam khatam hone par yeh 4 command chalao aur clean-pass confirm karo:
   npm install && npx tsc --noEmit && npm run build &&
   node scripts/static-audit.mjs
4. DS_Mobile_Master_Plan_Completed_Points.md mein naya entry add karo (date
   + kya kiya + kaise verify kiya) — purana content kabhi delete mat karo.
5. Naya ZIP do, aur agar GitHub push access ho to wahan bhi push kar do.

Batao pehle kya-kya samajh aaya, phir kaam shuru karo.
```

---

## 5. Zaroori security note

Agar kisi AI ko GitHub/Supabase/Cloudflare access dena ho, hamesha:
- **Scoped token** do (sirf ek repo, sirf zaroori permissions — Contents +
  Workflows, kabhi Secrets/Admin nahi)
- **Short expiry** rakho (7 din ya kam)
- Kaam khatam hote hi **turant revoke/delete** kar do
- Kabhi bhi `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`,
  `TAURI_SIGNING_PRIVATE_KEY`, ya Cloudflare R2 secret keys **kisi AI chat
  mein paste mat karo** — yeh sab sirf Supabase Dashboard / GitHub Secrets
  UI mein seedhe daalne wali cheezein hain, kisi AI ko inki zaroorat nahi
  padti apna kaam karne ke liye.
