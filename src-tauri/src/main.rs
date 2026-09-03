#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // STEP 12.2 — App Update & OTA Push System (Windows). Only meaningful
        // for the Windows desktop shell — the two Android builds
        // (tauri.staff-android.conf.json / tauri.owner-android.conf.json)
        // never call check()/downloadAndInstall() from this plugin, they use
        // the plain-APK download flow in useAppUpdateCheck.ts /
        // UpdateAvailablePill.tsx instead (see Master Plan Step 12.1). Safe
        // to register on every target regardless, since it simply never gets
        // invoked on Android.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Lets src/services/windowsUpdater.ts call relaunch() after a
        // successful downloadAndInstall(), so the person doesn't have to
        // manually reopen the app post-update.
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running DS Mobile & Digital Hub");
}
