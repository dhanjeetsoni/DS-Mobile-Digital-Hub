// STEP 12.2 — Windows silent auto-update, the real native path.
//
// The Tauri Updater plugin (registered in src-tauri/src/main.rs, endpoint +
// pubkey configured in src-tauri/tauri.conf.json's "plugins.updater") polls
// supabase/functions/app-update-manifest on its own in the background —
// that part needs zero JS. This file is only for the "Update Available"
// pill's button: turning "there's an update" into an actual one-tap
// download+install+relaunch *inside the running app*, instead of the
// manual "open the .exe download link and double-click it yourself"
// fallback UpdateAvailablePill.tsx used before this was wired.
//
// `@tauri-apps/plugin-updater` / `@tauri-apps/plugin-process` only exist
// inside an actual Tauri window — importing them at the top of a file
// that also runs in the browser dev server or an Android WebView would
// throw at module-load time, not call time. Every export below dynamic-
// imports instead, and detectTauriRuntime() gates all of it so Android
// (which never has these plugins registered — see main.rs's comment) and
// the plain `npm run dev` browser preview both safely no-op.
export function detectTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
}

export type WindowsUpdateProgress =
  | { phase: "checking" }
  | { phase: "downloading"; downloadedBytes: number; contentLength: number | null }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

/**
 * Runs the full Step 12.2 flow: check -> download -> install -> relaunch.
 * Only ever call this from the Windows build (gate with detectTauriRuntime()
 * first, same as UpdateAvailablePill.tsx does) — on Android this function
 * still safely resolves to an error progress event rather than throwing,
 * since the plugin import itself is dynamic.
 */
export async function checkDownloadInstallAndRelaunch(onProgress?: (p: WindowsUpdateProgress) => void): Promise<void> {
  if (!detectTauriRuntime()) {
    onProgress?.({ phase: "error", message: "Yeh sirf Windows app ke andar kaam karta hai." });
    return;
  }
  onProgress?.({ phase: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      // Nothing live yet, or already on the latest version — not an
      // error, just nothing to do. The pill that triggered this button
      // already only renders when checkForAppUpdate() (the Supabase-RPC
      // side, see appVersion.ts) says something newer exists, so this
      // path is rare — mainly a race where the two checks briefly
      // disagree (e.g. signature missing so app-update-manifest is still
      // returning 204 while a Windows row without a signature is live).
      onProgress?.({ phase: "done" });
      return;
    }

    let downloadedBytes = 0;
    let contentLength: number | null = null;
    onProgress?.({ phase: "downloading", downloadedBytes: 0, contentLength: null });

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? null;
        onProgress?.({ phase: "downloading", downloadedBytes: 0, contentLength });
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        onProgress?.({ phase: "downloading", downloadedBytes, contentLength });
      } else if (event.event === "Finished") {
        onProgress?.({ phase: "installing" });
      }
    });

    onProgress?.({ phase: "done" });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    onProgress?.({ phase: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
