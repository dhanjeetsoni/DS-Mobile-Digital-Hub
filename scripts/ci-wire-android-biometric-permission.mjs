// Adds the USE_BIOMETRIC (and legacy USE_FINGERPRINT, for API 24-27 —
// this app's minSdkVersion is 24) manifest permissions the Phase 6
// biometric unlock feature (@tauri-apps/plugin-biometric,
// src/services/pinAuth.ts's authenticateBiometric()) needs, to the
// AndroidManifest.xml that `tauri android init` generates every CI run
// (src-tauri/gen/android is gitignored — same reason
// ci-wire-android-camera-permissions.mjs and the other ci-wire-android-*
// scripts exist: nothing here can be hand-edited once and expected to
// persist).
//
// Root cause this fixes: verified directly against the published
// @tauri-apps/plugin-biometric package's own bundled AndroidManifest.xml
// (via its docs.rs source mirror) — it declares a `.BiometricActivity`
// entry but NO `<uses-permission>` for USE_BIOMETRIC at all. Android's own
// docs (developer.android.com, and every androidx.biometric integration
// guide) are explicit that USE_BIOMETRIC is a normal (no runtime-dialog)
// permission but MUST still be declared in the manifest for
// BiometricPrompt/BiometricManager to report anything other than
// "no biometric hardware" — so without this step, the plugin's own
// checkStatus() would always report isAvailable: false on every real
// device, regardless of whether the phone actually has a fingerprint
// sensor enrolled.
//
// Idempotent: safe to run more than once against the same file.

import fs from "node:fs";

const manifestPath =
  process.argv[2] ?? "src-tauri/gen/android/app/src/main/AndroidManifest.xml";

const MARKER = "<!-- ds-mobile: CI-injected Biometric permission (fingerprint/Face unlock) -->";

if (!fs.existsSync(manifestPath)) {
  console.error(`[ci-wire-android-biometric-permission] File not found: ${manifestPath}`);
  process.exit(1);
}

let content = fs.readFileSync(manifestPath, "utf8");

if (content.includes(MARKER)) {
  console.log(
    "[ci-wire-android-biometric-permission] Already wired in - skipping (idempotent)."
  );
  process.exit(0);
}

const permissionsBlock = `    ${MARKER}
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />
    <uses-permission android:name="android.permission.USE_FINGERPRINT" />
    <uses-feature android:name="android.hardware.fingerprint" android:required="false" />
`;

const manifestOpenTagMatch = content.match(/(<manifest[^>]*>\n)/);
if (!manifestOpenTagMatch) {
  console.error(
    "[ci-wire-android-biometric-permission] Could not find <manifest ...> opening tag - aborting without modifying the file."
  );
  process.exit(1);
}
content = content.replace(
  /(<manifest[^>]*>\n)/,
  `$1${permissionsBlock}`
);

fs.writeFileSync(manifestPath, content);
console.log(
  `[ci-wire-android-biometric-permission] Biometric permission wired into ${manifestPath}.`
);
