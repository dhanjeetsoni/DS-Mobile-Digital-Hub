// STEP 12.3 — mobile entry point. Tauri's Android/iOS build compiles this
// crate as a library (see the [lib] section in Cargo.toml) and calls run()
// through the tauri::mobile_entry_point macro; the Windows desktop binary
// (main.rs) calls the same run() function directly. Keeping the app setup
// in one place means the Windows and Android builds never drift apart.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // STEP 12.2 — App Update & OTA Push System (Windows). Only meaningful
    // for the Windows desktop shell — the two Android builds
    // (tauri.staff-android.conf.json / tauri.owner-android.conf.json)
    // never call check()/downloadAndInstall() from this plugin, they use
    // the plain-APK download flow in useAppUpdateCheck.ts /
    // UpdateAvailablePill.tsx instead (see Master Plan Step 12.1). Only
    // registered on desktop so the Android build doesn't need to link
    // against desktop-only plugin functionality it will never call.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            // Lets src/services/windowsUpdater.ts call relaunch() after a
            // successful downloadAndInstall(), so the person doesn't have
            // to manually reopen the app post-update.
            .plugin(tauri_plugin_process::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running DS Mobile & Digital Hub");
}
