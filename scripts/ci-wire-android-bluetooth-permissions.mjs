// Adds the Bluetooth/BLE manifest permissions the Phase 4 thermal-printer
// feature (src/services/thermalPrinter.ts, navigator.bluetooth) needs, to
// the AndroidManifest.xml that `tauri android init` generates every CI run
// (src-tauri/gen/android is gitignored — same reason
// ci-wire-android-signing.mjs exists for build.gradle.kts: nothing here can
// be hand-edited once and expected to persist).
//
// Permissions added:
//   - BLUETOOTH / BLUETOOTH_ADMIN, capped at maxSdkVersion 30 — the
//     pre-Android-12 permissions, harmless to also declare on newer OSes
//     but only actually enforced up to API 30.
//   - BLUETOOTH_SCAN / BLUETOOTH_CONNECT (API 31+, Android 12's replacement
//     model) — usesPermissionFlags="neverForLocation" on BLUETOOTH_SCAN
//     because this feature only ever looks for an already-known printer via
//     the OS device picker, never derives physical location from scan
//     results, so it can skip also requiring ACCESS_FINE_LOCATION on 12+.
//   - ACCESS_FINE_LOCATION, capped at maxSdkVersion 30 — Android's own BLE
//     scanning APIs require this pre-12 even though this app never reads
//     location data itself; without it, BLE device discovery silently
//     returns nothing on Android 6 through 11.
//
// IMPORTANT CAVEAT (documented here deliberately, not just in a commit
// message): manifest + runtime permissions are necessary but not
// sufficient. Whether `navigator.bluetooth` (Web Bluetooth) is actually
// exposed at all inside Tauri's Android WebView depends on the installed
// Android System WebView version/build — Web Bluetooth support in WebView
// (as opposed to full Chrome for Android) has historically been
// inconsistent across OEMs/OS versions. This cannot be verified from a
// sandboxed build environment without a real device — the Bluetooth Print
// button in InvoiceViewerModal.tsx feature-detects `"bluetooth" in
// navigator` and simply doesn't render if unsupported, so the worst case on
// an unsupported device is the button not appearing, not a crash.
//
// Idempotent: safe to run more than once against the same file.

import fs from "node:fs";

const manifestPath =
  process.argv[2] ?? "src-tauri/gen/android/app/src/main/AndroidManifest.xml";

const MARKER = "<!-- ds-mobile: CI-injected Bluetooth permissions (Phase 4 thermal printer) -->";

if (!fs.existsSync(manifestPath)) {
  console.error(`[ci-wire-android-bluetooth-permissions] File not found: ${manifestPath}`);
  process.exit(1);
}

let content = fs.readFileSync(manifestPath, "utf8");

if (content.includes(MARKER)) {
  console.log(
    "[ci-wire-android-bluetooth-permissions] Already wired in - skipping (idempotent)."
  );
  process.exit(0);
}

// Tauri's generated manifest already declares xmlns:android on <manifest>;
// BLUETOOTH_SCAN's usesPermissionFlags attribute needs no extra namespace
// (it's in the android: namespace already), so no xmlns:tools addition
// needed here.
const permissionsBlock = `    ${MARKER}
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
`;

const manifestOpenTagMatch = content.match(/(<manifest[^>]*>\n)/);
if (!manifestOpenTagMatch) {
  console.error(
    "[ci-wire-android-bluetooth-permissions] Could not find <manifest ...> opening tag - aborting without modifying the file."
  );
  process.exit(1);
}
content = content.replace(
  /(<manifest[^>]*>\n)/,
  `$1${permissionsBlock}`
);

fs.writeFileSync(manifestPath, content);
console.log(
  `[ci-wire-android-bluetooth-permissions] Bluetooth permissions wired into ${manifestPath}.`
);
