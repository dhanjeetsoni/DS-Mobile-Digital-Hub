#!/usr/bin/env python3
"""Verify APK contents, native identity, permissions and actual signature before artifact upload."""
import pathlib, sys, subprocess, zipfile, re, json, hashlib, os
root=pathlib.Path(sys.argv[1])
version_code=int(sys.argv[2])
sdk=pathlib.Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
tools=sorted((sdk/"build-tools").glob("*"),key=lambda p:tuple(int(x) for x in re.findall(r"\d+",p.name)),reverse=True)
tool=next((p for p in tools if (p/"apksigner").is_file() and (p/"aapt").is_file()),None)
if not tool: raise SystemExit("Android signing/manifest tools unavailable")
apks=sorted(root.rglob("*.apk"))
if not apks: raise SystemExit("No APK produced")
report=[]
for apk in apks:
    with zipfile.ZipFile(apk) as z:
        names=z.namelist()
        htmls=[n for n in names if n.startswith("assets/") and n.endswith("/index.html")]
        if not htmls: raise SystemExit(f"{apk.name}: packaged frontend index.html missing")
        if not any(n.startswith("assets/") and n.endswith(".js") for n in names): raise SystemExit(f"{apk.name}: packaged JavaScript missing")
        if not any(n.startswith("assets/") and n.endswith(".css") for n in names): raise SystemExit(f"{apk.name}: packaged CSS missing")
    badging=subprocess.check_output([str(tool/"aapt"),"dump","badging",str(apk)],text=True)
    match=re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'",badging)
    if not match or match.group(1)!="com.dsmobile.digitalhub" or int(match.group(2))!=version_code:
        raise SystemExit(f"{apk.name}: wrong package/versionCode: {match.groups() if match else 'missing'}")
    permissions=subprocess.check_output([str(tool/"aapt"),"dump","permissions",str(apk)],text=True)
    required=["CAMERA","USE_BIOMETRIC","BLUETOOTH_SCAN","BLUETOOTH_CONNECT","INTERNET"]
    missing=[p for p in required if f"android.permission.{p}" not in permissions]
    if missing: raise SystemExit(f"{apk.name}: missing permissions {missing}")
    certs=subprocess.check_output([str(tool/"apksigner"),"verify","--print-certs",str(apk)],text=True)
    fingerprints=re.findall(r"certificate SHA-256 digest: ([0-9a-fA-F]+)",certs)
    if not fingerprints: raise SystemExit(f"{apk.name}: signing certificate fingerprint missing")
    if os.environ.get("REQUIRE_RELEASE_SIGNING")=="true" and "CN=Android Debug" in certs: raise SystemExit("Tagged release signed with debug certificate")
    with apk.open("rb") as fp: digest=hashlib.file_digest(fp,"sha256").hexdigest()
    report.append({"file":str(apk.relative_to(root)),"sha256":digest,"package":match.group(1),"versionCode":int(match.group(2)),"versionName":match.group(3),"certificateSha256":fingerprints,"requiredPermissions":required,"frontendAssetsVerified":True,"debugCertificate":"CN=Android Debug" in certs})
print(json.dumps(report,indent=2))
(root/"apk-verification.json").write_text(json.dumps(report,indent=2)+"\n")
