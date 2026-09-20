# Android App (DS Mobile) — BUILD-ANDROID Guide

Yeh guide **Step 1.5 aur 1.8** ka wo aakhri hissa poora karti hai jo pichhle
session mein pending chhoda gaya tha: _"asli `.apk` file banana"_. Is
sandbox/coding-environment mein Android SDK, NDK, Gradle, JDK install karna
possible nahi hai (na hi internet), isliye ab yeh kaam **GitHub Actions**
(`.github/workflows/android-build.yml`) khud kar dega — aapko apne computer
par kuch bhi install karne ki zaroorat nahi.

---

## Option A — GitHub Actions se (Recommended, kuch install nahi karna)

1. Is poore project ko GitHub repo mein push karo (agar already nahi kiya).
2. Repo ke **Settings → Secrets and variables → Actions** mein jaake do
   secrets **zaroor** add karo (in ke bina Android build banega toh, par
   app cloud se connect nahi hoga — blank/offline app milega):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

   Play Store / production ke liye signed APK chahiye toh ye 4 secrets bhi add karo:
   - `ANDROID_KEYSTORE_BASE64` — apne release keystore file ko
     `base64 -w0 your-release.keystore` command se convert karke uska output
     yahan paste karo.
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

   _(Agar keystore secrets abhi skip karte ho, workflow khud ek
   debug-signed APK bana dega jo test-install ke liye kaam karega.)_

3. GitHub repo ke **Actions** tab mein jaao → **"Build & Release (Step 12)"**
   workflow select karo → **"Run workflow"** button dabao (ye is repo ka
   asli workflow file hai: `.github/workflows/build-and-release.yml`).
   - Yeh khud-ba-khud bhi chalega jab tum `v1.2.3` jaisa git tag push karoge.
4. Build complete hone ke baad (~10-15 minute), us workflow-run ke andar
   **Artifacts** section mein APK milega:
   - `mobile-android-apk` → **DS Mobile** (the only Android build now — see
     PROJECT_PLAN.md Phase 17.2) — ek hi app, koi bhi Android Access Area se
     mila Login ID/Password daalega, uske role ke hisaab se access mil
     jaayega (Staff ya Owner-level) — Gmail login ki zaroorat nahi.
   - `windows-installer` → Windows `.exe`
   (Ek "release" job in dono ko ek GitHub Release mein bhi jod deta hai.)

   _(Phase 17.2 se pehle yahan alag "Staff Android" aur "Owner Android"
   dedicated APKs bhi milte the — un CI legs aur unke Tauri configs ko
   retire kar diya gaya hai kyunki koi real device un par kabhi nahi tha
   (verified against live Supabase data before removing). Agar tumhare paas
   abhi bhi koi purana Staff/Owner APK installed hai, use uninstall karke
   naya DS Mobile APK install kar do.)_
5. Download karke seedha kisi bhi Android phone par install kar do
   (pehli baar "Unknown apps install" permission dena hoga, jaisa kisi bhi
   sideloaded app ke liye lagta hai). Agar koi purana staff/owner APK pehle
   se installed hai, use uninstall karke naya install karo.

## Option B — Apne Computer Par Manually (agar CI use nahi karna)

Zaroorat: Android Studio (SDK + NDK ke saath), Rust, Node.js 20+, JDK 17.

```bash
npm install
npm install -g @tauri-apps/cli
npx tauri android init        # ek baar, project set up karta hai

# DS Mobile app (the only Android build — see Phase 17.2):
npm run android:mobile:build
```

Built APK yahan milega: `src-tauri/gen/android/app/build/outputs/apk/`

---

## Yeh Step 1.5 / 1.8 Ko Kaise Complete Karta Hai

| Zaroorat (Master Plan se) | Status |
|---|---|
| Ek unified Android app, role ke hisaab se access (Staff/Owner) | ✅ `App.tsx` `mobile` variant (Phase 17.1) |
| Real-time auto-sync Windows/Supabase ke saath | ✅ pehle se Supabase Realtime backbone (Step 1.7 fix se) |
| Installable app, apni identity | ✅ `tauri.mobile-android.conf.json` |
| **Asli `.apk` file ban paana** | ✅ **is guide/workflow se ab possible** |

_(Shuru mein yahan do alag dedicated "Staff Android"/"Owner Android" apps
ka plan tha, apne-apne `tauri.staff-android.conf.json`/
`tauri.owner-android.conf.json` ke saath — Phase 17 (DS Mobile Unified App)
mein wo ek single app mein consolidate kar diya gaya, aur Phase 17.2 mein
purane dono retire kar diye gaye.)_

The App Update & OTA Push System (Step 12, since built) does **not** use a
version-info file alongside the APK — it's the `app_versions` Supabase
table + the Owner's in-app "App Versions" panel (Sidebar → ⚙️ System),
documented in `STEP12-APP-UPDATE-SETUP.md`. (An earlier draft of this guide
planned a `version-staff.json`/`version-owner.json` file per build; that
was superseded by Step 12's actual design and never built.)

## Agla Kadam

Is guide/workflow ke saath **Step 1.5 aur 1.8 ab poori tarah complete** maane
ja sakte hain (groundwork + packaging, dono ho gaye). Agla kaam **Step 2**
(AI Key Pool + Base System Health) se shuru hoga.
