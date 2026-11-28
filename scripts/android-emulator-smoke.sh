#!/usr/bin/env bash
set -euo pipefail
root="${1:-src-tauri/gen/android/app/build/outputs/apk}"
out="${2:-android-runtime-review}"
mkdir -p "$out"
apk="$(find "$root" -type f -name '*universal*.apk' | sort | head -n1)"
if [ -z "$apk" ]; then echo "Universal APK missing for emulator test"; exit 1; fi
package="com.dsmobile.digitalhub"
collect_diagnostics() {
  adb shell screencap -p /sdcard/dsmdh-screen.png && adb pull /sdcard/dsmdh-screen.png "$out/screen.png" || true
  adb logcat -d -s AndroidRuntime chromium Tauri ActivityTaskManager ActivityManager libc > "$out/runtime.txt" || true
  adb logcat -d -b crash > "$out/crash.txt" || true
  adb shell pidof "$package" > "$out/app-pid.txt" || true
  adb shell dumpsys activity activities > "$out/activities.txt" || true
  adb shell dumpsys webviewupdate > "$out/webview-provider.txt" || true
}
trap collect_diagnostics EXIT
adb wait-for-device
adb shell input keyevent 82 || true
adb install -r "$apk" | tee "$out/install.txt"
grep -q 'Success' "$out/install.txt"
adb shell pm clear "$package" | tee "$out/clear.txt"
grep -q 'Success' "$out/clear.txt"
adb logcat -c
activity="$(adb shell cmd package resolve-activity --brief "$package" | tr -d '\r' | tail -n1)"
if [[ "$activity" != "$package/"* ]]; then echo "Launcher activity not resolved: $activity"; exit 1; fi
adb shell am start -W -n "$activity" | tee "$out/launch.txt"
grep -q 'Status: ok' "$out/launch.txt"
wait_for_contract() {
  local phase="$1" point
  for attempt in $(seq 1 24); do
    if adb shell uiautomator dump /sdcard/dsmdh-ui.xml >/dev/null 2>&1 && adb pull /sdcard/dsmdh-ui.xml "$out/$phase.xml" >/dev/null 2>&1; then
      if point="$(python3 scripts/android-login-contract.py "$out/$phase.xml" "$package" "$phase" 2>"$out/$phase-check.txt")"; then
        printf '%s\n' "$point"; return 0
      fi
    fi
    sleep 3
  done
  cat "$out/$phase-check.txt" >&2 || true
  echo "Android unified login contract failed: $phase" >&2
  return 1
}
point="$(wait_for_contract ready)"
adb shell input tap $point
point="$(wait_for_contract validation)"
adb shell input tap $point
wait_for_contract reset >/dev/null
point="$(wait_for_contract focus_login)"
adb shell input tap $point
adb shell input text CI-NATIVE-ONLY
adb shell input keyevent 4
point="$(wait_for_contract focus_password)"
adb shell input tap $point
adb shell input text CI-NATIVE-PASSWORD
adb shell input keyevent 4
point="$(wait_for_contract typed)"
adb shell input tap $point
wait_for_contract cleared >/dev/null
adb shell input keyevent 3
adb shell am start -W -n "$activity" | tee "$out/resume.txt"
wait_for_contract cleared >/dev/null
cp "$out/cleared.xml" "$out/resumed.xml"
adb shell am force-stop "$package"
sleep 2
if adb shell pidof "$package" | grep -q "[0-9]"; then echo "Application was not stopped"; exit 1; fi
adb shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$activity" | tee "$out/relaunch.txt"
grep -q "Status: ok" "$out/relaunch.txt"
wait_for_contract cleared >/dev/null
cp "$out/cleared.xml" "$out/relaunched.xml"
echo '{"installed":true,"loginScreenVerified":true,"emptyCredentialRejectionVerified":true,"resetVerified":true,"typedCredentialMaskingVerified":true,"backgroundResumeVerified":true,"coldRelaunchVerified":true,"scope":"Android emulator unified mobile login; no real account or physical hardware"}' > "$out/boot-verification.json"
echo "PASS unified mobile APK launch, native login fields, empty credential rejection and reset"
