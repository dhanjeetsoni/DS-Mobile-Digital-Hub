// Adds the CAMERA manifest permission the barcode/QR scanner
// (src/components/CameraScannerModal.tsx, navigator.mediaDevices.
// getUserMedia) needs, to the AndroidManifest.xml that `tauri android init`
// generates every CI run (src-tauri/gen/android is gitignored — same
// reason ci-wire-android-signing.mjs and
// ci-wire-android-bluetooth-permissions.mjs exist: nothing here can be
// hand-edited once and expected to persist).
//
// Root cause this fixes: `tauri android init`'s template declares no
// CAMERA permission at all. getUserMedia() inside the WebView can only
// succeed if the *native* Android app already holds android.permission.
// CAMERA — without the manifest entry, the OS never lets the app hold that
// permission in the first place, so every getUserMedia() call fails
// immediately with a permission/NotAllowedError, which is exactly what
// CameraScannerModal.tsx's catch block reports as "Camera access denied or
// unavailable" (the screen the owner is actually seeing). Also declares
// FEATURE_CAMERA as not-required (uses-feature required="false") so the
// app still installs correctly on emulators or rare devices with no
// camera hardware, since manual barcode entry is a fallback either way.
//
// Also declares android:name="android.hardware.camera.autofocus" as not
// required for the same reason — barcode scanning still functions (if
// more slowly) without autofocus, and this must not become an install
// blocker on low-end hardware.
//
// IMPORTANT CAVEAT (documented here deliberately, same spirit as the
// Bluetooth script's caveat): the manifest permission is necessary but not
// sufficient on its own for a dangerous ("runtime") permission on Android
// 6+ — the user must also be prompted with the OS permission dialog at
// least once. Tauri/wry's Android WebView implementation is expected to
// trigger that OS prompt automatically the first time a page calls
// getUserMedia() and the manifest declares the permission (this is wry's
// documented PermissionRequest-to-ActivityCompat.requestPermissions
// bridging behaviour) — but this cannot be verified from a sandboxed build
// environment without a real device. If, after this fix, a device still
// shows "Camera access denied" on the *first* scan attempt, check whether
// Android's permission dialog appeared at all; if it never appears, that
// points at a wry-version-specific gap needing an explicit runtime
// permission request (e.g. a small Tauri plugin), not another manifest
// change. CameraScannerModal.tsx's manual-entry/photo-upload fallback
// means the worst case is degraded, not broken.
//
// Idempotent: safe to run more than once against the same file.

import fs from "node:fs";

const manifestPath =
  process.argv[2] ?? "src-tauri/gen/android/app/src/main/AndroidManifest.xml";

const MARKER = "<!-- ds-mobile: CI-injected Camera permission (barcode/QR scanner) -->";

if (!fs.existsSync(manifestPath)) {
  console.error(`[ci-wire-android-camera-permissions] File not found: ${manifestPath}`);
  process.exit(1);
}

let content = fs.readFileSync(manifestPath, "utf8");

if (content.includes(MARKER)) {
  console.log(
    "[ci-wire-android-camera-permissions] Already wired in - skipping (idempotent)."
  );
  process.exit(0);
}

const permissionsBlock = `    ${MARKER}
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
`;

const manifestOpenTagMatch = content.match(/(<manifest[^>]*>\n)/);
if (!manifestOpenTagMatch) {
  console.error(
    "[ci-wire-android-camera-permissions] Could not find <manifest ...> opening tag - aborting without modifying the file."
  );
  process.exit(1);
}
content = content.replace(
  /(<manifest[^>]*>\n)/,
  `$1${permissionsBlock}`
);

fs.writeFileSync(manifestPath, content);
console.log(
  `[ci-wire-android-camera-permissions] Camera permission wired into ${manifestPath}.`
);
