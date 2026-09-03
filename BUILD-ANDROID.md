# Android Apps Banana (Staff + Owner) — BUILD-ANDROID Guide

Yeh guide **Step 1.5 aur 1.8** ka wo aakhri hissa poora karti hai jo pichhle
session mein pending chhoda gaya tha: _"asli `.apk` file banana"_. Is
sandbox/coding-environment mein Android SDK, NDK, Gradle, JDK install karna
possible nahi hai (na hi internet), isliye ab yeh kaam **GitHub Actions**
(`.github/workflows/android-build.yml`) khud kar dega — aapko apne computer
par kuch bhi install karne ki zaroorat nahi.

---

## Option A — GitHub Actions se (Recommended, kuch install nahi karna)

1. Is poore project ko GitHub repo mein push karo (agar already nahi kiya).
2. Repo ke **Settings → Secrets and variables → Actions** mein jaake (agar
   Play Store / production ke liye signed APK chahiye) yeh 4 secrets add karo:
   - `ANDROID_KEYSTORE_BASE64` — apne release keystore file ko
     `base64 -w0 your-release.keystore` command se convert karke uska output
     yahan paste karo.
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

   _(Agar abhi sirf testing karni hai, yeh secrets skip kar sakte ho — workflow
   khud ek unsigned/debug APK bana dega jo test-install ke liye kaam karega.)_

3. GitHub repo ke **Actions** tab mein jaao → **"Build Android Apps"**
   workflow select karo → **"Run workflow"** button dabao.
   - Yeh khud-ba-khud bhi chalega jab bhi `main` branch par `src/`,
     `src-tauri/`, ya `package.json` mein koi change push hoga.
4. Build complete hone ke baad (~10-15 minute), us workflow-run ke andar
   **Artifacts** section mein 2 alag APK milenge:
   - `ds-mobile-staff-apk` → Staff Android App
   - `ds-mobile-owner-apk` → Owner Android App
5. Download karke seedha kisi bhi Android phone par install kar do
   (pehli baar "Unknown apps install" permission dena hoga, jaisa kisi bhi
   sideloaded app ke liye lagta hai).

## Option B — Apne Computer Par Manually (agar CI use nahi karna)

Zaroorat: Android Studio (SDK + NDK ke saath), Rust, Node.js 20+, JDK 17.

```bash
npm install
npm install -g @tauri-apps/cli
npx tauri android init        # ek baar, project set up karta hai

# Staff app:
npm run android:staff:build

# Owner app:
npm run android:owner:build
```

Built APK yahan milega: `src-tauri/gen/android/app/build/outputs/apk/`

---

## Yeh Step 1.5 / 1.8 Ko Kaise Complete Karta Hai

| Zaroorat (Master Plan se) | Status |
|---|---|
| Dedicated Staff Android app (login-only, permission-based) | ✅ `App.tsx` variant switch (pichhle session mein bana) |
| Dedicated Owner Android app (full access) | ✅ `App.tsx` variant switch (pichhle session mein bana) |
| Real-time auto-sync dono ke saath Windows/Supabase ke | ✅ pehle se Supabase Realtime backbone (Step 1.7 fix se) |
| Alag installable apps, alag identity | ✅ `tauri.staff-android.conf.json` / `tauri.owner-android.conf.json` |
| **Asli `.apk` file ban paana** | ✅ **is guide/workflow se ab possible** |

Version-info file (`version-staff.json` / `version-owner.json`) bhi har build
ke saath generate hoti hai — yeh Step 12 (App Update & OTA Push System) ke
liye foundation hai; jab Step 12 par kaam hoga, isi file ko Supabase/Cloudflare
par host karke in-app "Update Available" check se compare kiya jaayega.

## Agla Kadam

Is guide/workflow ke saath **Step 1.5 aur 1.8 ab poori tarah complete** maane
ja sakte hain (groundwork + packaging, dono ho gaye). Agla kaam **Step 2**
(AI Key Pool + Base System Health) se shuru hoga.
