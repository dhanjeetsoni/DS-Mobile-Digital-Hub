import { useCallback, useEffect, useRef, useState } from "react";
import { checkForAppUpdate, type AppUpdateInfo } from "../services/appVersion";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Step 12.1: "app khulte hi (ya periodically)"

/**
 * Step 12.1/12.2 — the in-app update checker every device runs (both
 * Android shells + Windows). Checks once on mount, then every 6h while the
 * app stays open. `dismiss()` only hides the pill for the rest of this
 * session (a real update stays "available" until the device actually
 * updates — closing the pill shouldn't make it forget).
 */
export function useAppUpdateCheck(enabled: boolean = true) {
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const recheck = useCallback(async () => {
    if (!enabled) return;
    try {
      const info = await checkForAppUpdate();
      setUpdateInfo(info);
    } catch {
      // Never surface this as an error toast — an update check failing
      // (offline, cloud not configured, etc) is not something the person
      // using the app needs to be interrupted about.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    recheck();
    timerRef.current = window.setInterval(recheck, RECHECK_INTERVAL_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [enabled, recheck]);

  return {
    updateInfo: dismissed ? null : updateInfo,
    dismiss: () => setDismissed(true),
    recheck,
  };
}
