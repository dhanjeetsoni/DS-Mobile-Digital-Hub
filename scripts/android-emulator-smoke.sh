#!/usr/bin/env bash
set -euo pipefail
root="${1:-src-tauri/gen/android/app/build/outputs/apk}"
out="${2:-android-runtime-review}"
mkdir -p "$out"
apk="$(find "$root" -type f -name '*universal*.apk' | sort | head -n1)"
if [ -z "$apk" ]; then echo "Universal APK missing for emulator test"; exit 1; fi
package="com.dsmobile.digitalhub"
adb wait-for-device
adb shell input keyevent 82 || true
adb install -r "$apk" | tee "$out/install.txt"
grep -q 'Success' "$out/install.txt"
adb logcat -c
activity="$(adb shell cmd package resolve-activity --brief "$package" | tr -d '\r' | tail -n1)"
if [[ "$activity" != "$package/"* ]]; then echo "Launcher activity not resolved: $activity"; exit 1; fi
adb shell am start -W -n "$activity" | tee "$out/launch.txt"
grep -q 'Status: ok' "$out/launch.txt"
passed=false
for attempt in $(seq 1 24); do
  if adb shell uiautomator dump /sdcard/dsmdh-ui.xml >/dev/null 2>&1 && adb pull /sdcard/dsmdh-ui.xml "$out/window.xml" >/dev/null 2>&1; then
    if python3 - "$out/window.xml" "$package" <<'PY'
import sys,xml.etree.ElementTree as ET
nodes=[n for n in ET.parse(sys.argv[1]).iter("node") if n.get("package")==sys.argv[2]]
texts=" ".join((n.get("text","")+" "+n.get("content-desc","")) for n in nodes)
assert "Owner Confidential Area" in texts and "Login (ID / Password)" in texts, "Expected login UI not rendered yet"
PY
    then passed=true; break; fi
  fi
  sleep 3
done
adb shell screencap -p /sdcard/dsmdh-screen.png && adb pull /sdcard/dsmdh-screen.png "$out/screen.png" || true
adb logcat -d -s AndroidRuntime chromium Tauri > "$out/runtime.txt" || true
adb shell dumpsys activity activities > "$out/activities.txt" || true
adb shell dumpsys webviewupdate > "$out/webview-provider.txt" || true
pid="$(adb shell pidof "$package" | tr -d '\r' | awk '{print $1}')"
if [[ -n "$pid" ]]; then adb logcat -d --pid="$pid" > "$out/app-process.txt" || true; fi
if [ "$passed" != true ]; then echo "Android app did not render expected login screen"; exit 1; fi
echo '{"installed":true,"loginScreenVerified":true,"scope":"Android emulator, no real account or physical hardware"}' > "$out/boot-verification.json"
