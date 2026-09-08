import { supabase, getCurrentProfile, isCloudConfigured } from "./supabaseClient";

// Phase 5: Automatic crash reporting. Every crash diagnosed in this project
// so far required the owner to manually screenshot a log/error and paste it
// into a chat — this replaces that with an automatic, best-effort report
// straight to Supabase, so the owner (or whoever's helping them) can see
// what actually broke without needing physical/remote access to the device.
//
// Design constraints this deliberately respects, learned the hard way from
// this project's own sync_queue incident (an unbounded retry loop that
// hammered the DB for a day): a crash reporter must never itself become a
// source of crashes or spam. So:
//   - every call is wrapped so a failure here never throws or surfaces to
//     the user -- reporting a crash must never cause a second crash.
//   - a simple per-session cap (not a retry queue) bounds how many reports
//     one session can ever send, so a tight crash-loop can't flood the DB.
//   - no offline queueing/retrying: if the report can't be sent right now
//     (offline, RLS not resolved yet, etc.) it's just dropped. Best-effort
//     only, on purpose.

const MAX_REPORTS_PER_SESSION = 10;
let reportsSentThisSession = 0;
const recentMessages: string[] = []; // de-dupe identical back-to-back errors (e.g. a render loop)

function getPlatform(): string {
  const env = (import.meta as any).env || {};
  return String(env.VITE_APP_PLATFORM || (env.VITE_APP_VARIANT ? `${env.VITE_APP_VARIANT}-unknown` : "windows"));
}

function getAppVersion(): string {
  const env = (import.meta as any).env || {};
  return String(env.VITE_APP_BUILD || "unknown");
}

export async function reportCrash(
  message: string,
  stack?: string | null,
  phase: "boot" | "runtime" = "runtime",
  extra?: Record<string, unknown>,
) {
  try {
    if (!isCloudConfigured) return; // offline-only/local build, nowhere to send it
    if (reportsSentThisSession >= MAX_REPORTS_PER_SESSION) return;
    const dedupeKey = `${phase}:${message}`.slice(0, 300);
    if (recentMessages.includes(dedupeKey)) return;
    recentMessages.push(dedupeKey);
    if (recentMessages.length > 20) recentMessages.shift();

    const profile = await getCurrentProfile();
    if (!profile?.store_id) return; // not signed in yet -- nothing we can safely attribute this to

    reportsSentThisSession++;
    await supabase.from("crash_reports").insert({
      store_id: profile.store_id,
      profile_id: profile.id,
      role: profile.role || null,
      phase,
      platform: getPlatform(),
      app_version: getAppVersion(),
      message: String(message || "Unknown error").slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : null,
      extra: extra ?? null,
    });
  } catch {
    // A crash reporter that can itself throw defeats the point -- swallow
    // everything. If this insert fails (offline, RLS, whatever), the crash
    // simply goes unreported this time rather than compounding the problem.
  }
}

// Registers the two global handlers that catch errors happening anywhere
// during the session (not just at boot) -- calling this once from main.tsx,
// after the module has loaded, is enough to cover the whole app lifetime.
export function installGlobalCrashReporting() {
  window.addEventListener("error", (e) => {
    reportCrash(
      (e?.error && (e.error.stack || e.error.message)) || e?.message || "Unknown window error",
      e?.error?.stack,
      "runtime",
    );
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason: any = e?.reason;
    reportCrash(
      (reason && (reason.message || String(reason))) || "Unhandled promise rejection",
      reason?.stack,
      "runtime",
    );
  });
}
