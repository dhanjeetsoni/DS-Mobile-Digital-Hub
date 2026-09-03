# STEP 12 — App Update & OTA Push System — Setup Guide

Yeh guide **ek baar** karni hai (setup), uske baad har naya release sirf
"build → App Versions panel mein upload → Make Live" hai — koi staff/owner
ko manually reinstall nahi karwana padega.

Master Plan ka Step 12 poora reference: `DS_Mobile_Master_Plan.md`.

---

## Kya already ban chuka hai (is ZIP mein)

- ✅ `supabase/migrations/20260903120000_app_versions_step12.sql` — DB table
  + RPCs (`get_live_app_versions`, `list_app_versions`, `publish_app_version`,
  `set_app_version_live`). **Already applied to your Supabase project.**
- ✅ `supabase/functions/app-update-manifest/` — Tauri Updater plugin ka
  dynamic-update-server endpoint. **Already deployed** (this exact copy was
  pulled back from your live Supabase project into this ZIP so the ZIP
  matches production — it wasn't in the previous WIP ZIP, a naya deploy tha
  jo direct Supabase mein hua tha).
- ✅ `src/services/appVersion.ts`, `src/hooks/useAppUpdateCheck.ts`,
  `src/components/UpdateAvailablePill.tsx`, `src/components/AppVersionsPanel.tsx`
  — the in-app "Update Available" pill (Step 12.1, all 3 shells) + Owner's
  "App Versions" panel (Step 12.3).
- ✅ `src/services/windowsUpdater.ts` — the real one-tap **silent** flow
  (check → download → install → relaunch) for the Windows build specifically
  (Step 12.2), wired into the pill's click handler.
- ✅ `src-tauri/tauri.conf.json`'s `plugins.updater` block, `src-tauri/Cargo.toml`,
  `src-tauri/src/main.rs`, `src-tauri/capabilities/default.json` — the native
  Tauri Updater plugin registration + a **real generated signing keypair**
  (public key already in `tauri.conf.json`; the private key was **not**
  put in this ZIP — see below).

## Kya abhi bhi zaroori hai (aapko karna hai)

### 1. Private signing key ko GitHub Secret banao

Iss session mein ek real updater keypair generate hua (`tauri signer generate`).
Public key already `src-tauri/tauri.conf.json` mein hai. Private key **sirf
chat message mein ek baar diya gaya hai** (ZIP file mein nahi — ZIP kahin bhi
share ho sakti hai, private key nahi honi chahiye).

- GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:
  - `TAURI_SIGNING_PRIVATE_KEY` = chat mein diya gaya poora private key text
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = khaali chhod do (key bina password
    ke bana hai) — ya agar chaho to naya password-protected key khud generate
    kar sakte ho: `npx tauri signer generate -w ./updater.key` (phir dono —
    public key `tauri.conf.json` mein paste karo, private key + password
    dono ko GitHub secrets mein daalo, aur `updater.key*` files delete kar do
    apne computer se).
- **Yeh key kabhi khona nahi chahiye** — kho gayi to purane installs ke liye
  future updates sign nahi ho paayenge (sabko fresh reinstall karna padega).
  Kahin surakshit jagah (password manager) bhi ek copy rakh lo.

### 2. Cloudflare R2 + Supabase secrets (agar Step 7.1 abhi tak nahi hua)

`app-update-manifest` aur `r2-storage` dono Edge Functions ko yeh already-set
secrets chahiye (`CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY_ID`,
`CF_R2_SECRET_ACCESS_KEY`, `CF_R2_BUCKET_PUBLIC`) — dekho
`STEP7.1-CLOUDFLARE-SETUP.md`. Agar wo already set hain (Step 7 complete ho
chuka hai), toh Step 12 ke liye kuch extra Cloudflare setup nahi chahiye —
`app` kind wahi bucket use karta hai jo product photos use karte hain.

### 3. CI build workflow

`.github/workflows/build-and-release.yml` (is ZIP mein add ki gayi hai) —
Windows installer aur dono Android APKs build karta hai jab aap ek git tag
push karte ho (jaise `v1.4.0`). Windows job automatically `.sig` file bhi
banata hai (upar wali secret ka use karke) aur dono ko ek GitHub Release mein
attach kar deta hai.

**Yeh workflow build/sign karta hai — publish/live nahi karta.** Publish
hamesha manual hai (Step 12.3 ka design hi yeh hai — ek galat build kabhi
apne aap kisi ke phone/PC tak nahi pahunch sakti):

1. Tag push karo → GitHub Release ban jaayega installer/.sig/APKs ke saath.
2. Release se files download karo.
3. App khol ke Owner login karo → **App Versions** panel (Sidebar → ⚙️ System).
4. Platform choose karo, version/build number bharo (tag jaisa hi, e.g.
   `1.4.0` / build `14`), file upload karo — Windows ke liye `.sig` file ka
   **content** bhi "Tauri Updater Signature" box mein paste karo.
5. Jab ready ho, **"Make Live"** dabao — tabhi devices tak update pahunchta hai.

_Note: is sandbox mein na Windows na Android build target available tha, isliye
yeh workflow khud run karke verify nahi ho paaya — pehli baar chalane par
GitHub Actions logs zaroor check karo. Android job ko apna keystore secret
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`) bhi chahiye hoga jo
abhi placeholder hai — Android Studio/`keytool` se banao aur usi naam se
GitHub secret add karo._

### 4. Per-build env vars

Har build se pehle `.env.example` dekho — `VITE_APP_PLATFORM`,
`VITE_APP_VERSION`, `VITE_APP_BUILD`, `VITE_APP_VARIANT` sahi set karo us
specific shell (Windows / Staff Android / Owner Android) ke hisaab se. CI
workflow yeh already sahi set karta hai per-job — local build karte ho to
khud dhyan rakhna.

---

## Kaise test karein (Step 13's checklist ka Step-12-specific hissa)

- [ ] Ek dummy version publish karo (App Versions panel) kisi bhi platform
      ke liye, phir "Make Live" dabao.
- [ ] Uss platform ke build number se **kam** build wala device/preview khol
      ke check karo pill dikh rahi hai ki nahi.
- [ ] Android: pill ka link tap karke APK download + system install-prompt
      aana chahiye.
- [ ] Windows (asli Tauri build ke andar hi, browser preview mein nahi):
      pill click karo → download % dikhna chahiye → install → app khud
      restart ho jaani chahiye.
- [ ] Windows signature ke bina publish karo (khaali chhodo) → confirm karo
      `app-update-manifest` 204 (no update) return karta hai — yeh jaan-
      boojh kar hai (unsigned build kabhi silent-install nahi honi chahiye).
