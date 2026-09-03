// Wires up Android release signing into the build.gradle.kts that
// `tauri android init` generates every CI run (src-tauri/gen/android is
// gitignored, so nothing here can be edited by hand and persist).
//
// Root cause this fixes: `tauri android init`'s template
// (crates/tauri-cli/templates/mobile/android/app/build.gradle.kts in the
// Tauri repo) never adds a signingConfigs block and never assigns a
// signingConfig to the "release" buildType. Wiring that up is documented
// as a manual, one-time edit in Tauri's own Android signing guide
// (https://tauri.app/distribute/sign/android) - fine for a local machine
// where you edit the file once, but useless in CI where the file is
// regenerated from scratch on every run.
//
// What this script does to [app]/build.gradle.kts:
//   1. Declares `keystorePropertiesFile` / `keystoreProperties`, loaded
//      from gen/android/keystore.properties if that file exists.
//   2. Adds a `signingConfigs { create("release") { ... } }` block using
//      the standard Gradle property names (storeFile, storePassword,
//      keyAlias, keyPassword) - the same names Tauri's current docs use.
//   3. Points the "release" buildType's signingConfig at it.
//   4. If keystore.properties does NOT exist (no release secret set
//      yet), falls back to the "debug" buildType's auto-generated
//      signingConfig instead of leaving "release" unsigned. Gradle only
//      auto-signs the "debug" buildType by default - "release" gets no
//      signing at all unless something assigns one - so without this
//      fallback a no-secret CI build produces an uninstallable,
//      unsigned release APK instead of a usable debug-signed one.
//
// Idempotent: safe to run more than once against the same file (checks
// for its own marker comment first).

import fs from "node:fs";

const gradleFilePath =
  process.argv[2] ?? "src-tauri/gen/android/app/build.gradle.kts";

const MARKER = "// >>> ds-mobile: CI-injected release signing config";

if (!fs.existsSync(gradleFilePath)) {
  console.error(`[ci-wire-android-signing] File not found: ${gradleFilePath}`);
  process.exit(1);
}

let content = fs.readFileSync(gradleFilePath, "utf8");

if (content.includes(MARKER)) {
  console.log(
    "[ci-wire-android-signing] Signing config already wired in - skipping (idempotent)."
  );
  process.exit(0);
}

// --- 1. Property loader, inserted right after the existing imports/plugins
//        block, before the `android {` block. `tauriProperties` in the
//        template already proves `Properties()` is imported and usable
//        via `.inputStream().use { load(it) }`, so we reuse that idiom
//        instead of adding a new java.io.FileInputStream import.
const propsLoaderBlock = `
${MARKER}
val dsKeystorePropertiesFile = rootProject.file("keystore.properties")
val dsKeystoreProperties = Properties().apply {
    if (dsKeystorePropertiesFile.exists()) {
        dsKeystorePropertiesFile.inputStream().use { load(it) }
    }
}
val dsHasReleaseKeystore = dsKeystorePropertiesFile.exists()
// <<< ds-mobile: CI-injected release signing config
`;

const androidBlockMatch = content.match(/\nandroid\s*\{/);
if (!androidBlockMatch) {
  console.error(
    "[ci-wire-android-signing] Could not find `android {` block - template may have changed, aborting without modifying the file."
  );
  process.exit(1);
}
content = content.replace(/\nandroid\s*\{/, `${propsLoaderBlock}\nandroid {`);

// --- 2. signingConfigs block, inserted as the first thing inside
//        `android { ... }` (i.e. right before `compileSdk = ...`).
const signingConfigsBlock = `    signingConfigs {
        create("release") {
            if (dsHasReleaseKeystore) {
                storeFile = rootProject.file(dsKeystoreProperties.getProperty("storeFile"))
                storePassword = dsKeystoreProperties.getProperty("storePassword")
                keyAlias = dsKeystoreProperties.getProperty("keyAlias")
                keyPassword = dsKeystoreProperties.getProperty("keyPassword")
            }
        }
    }
`;

const compileSdkMatch = content.match(/(\n    compileSdk = )/);
if (!compileSdkMatch) {
  console.error(
    "[ci-wire-android-signing] Could not find `compileSdk =` inside the android block - aborting without modifying the file."
  );
  process.exit(1);
}
content = content.replace(
  /(\n    compileSdk = )/,
  `\n${signingConfigsBlock}${compileSdkMatch[1]}`
);

// --- 3. Point the "release" buildType at it - falling back to the
//        auto-generated "debug" signingConfig when no release keystore
//        secret is set, so a no-secret CI run still produces an
//        installable (debug-signed) APK instead of an unsigned one.
const releaseBuildTypeMatch = content.match(
  /(\n {8}getByName\("release"\) \{\n)/
);
if (!releaseBuildTypeMatch) {
  console.error(
    "[ci-wire-android-signing] Could not find getByName(\"release\") buildType block - aborting without modifying the file."
  );
  process.exit(1);
}
content = content.replace(
  /(\n {8}getByName\("release"\) \{\n)/,
  `$1            signingConfig = if (dsHasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
`
);

fs.writeFileSync(gradleFilePath, content);
console.log(
  `[ci-wire-android-signing] Release signing wired into ${gradleFilePath} (hasReleaseKeystore will be resolved at Gradle configure time from keystore.properties).`
);
