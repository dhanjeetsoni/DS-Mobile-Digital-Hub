#!/usr/bin/env python3
"""Verify Tauri frontend asset references inside actual native binaries, APK identity and signing."""
import pathlib, sys, subprocess, zipfile, re, json, hashlib, os
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
class Entrypoint(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs=set()
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        url=a.get("src") if tag=="script" else a.get("href") if tag=="link" and a.get("rel") in ("stylesheet","modulepreload") else None
        if not url: return
        u=urlsplit(url)
        if u.scheme or u.netloc: return
        name=unquote(u.path).lstrip("/")
        if name.startswith("./"): name=name[2:]
        if name.endswith((".js",".css")): self.refs.add(name)
def frontend_refs(dist):
    parser=Entrypoint()
    parser.feed((dist/"index.html").read_text(encoding="utf-8"))
    refs=sorted(parser.refs)
    if not any(x.endswith(".js") for x in refs) or not any(x.endswith(".css") for x in refs):
        raise ValueError("Built frontend entrypoint lacks JS or CSS")
    if any(".." in pathlib.PurePosixPath(x).parts or not (dist/x).is_file() or (dist/x).stat().st_size==0 for x in refs):
        raise ValueError("Built frontend refers to absent or empty assets")
    return refs
def verify_embedded(z, refs):
    # Tauri frontendDist embeds compressed asset bytes and uncompressed asset-map keys in the app binary.
    # Never assume that assets/index.html is a standalone ZIP entry.
    libs=[n for n in z.namelist() if re.fullmatch(r"lib/[^/]+/libds_mobile_digital_hub_lib\.so",n)]
    if not libs: raise ValueError("Tauri native application library missing")
    for lib in libs:
        data=z.read(lib)
        if data[:4]!=b"\x7fELF": raise ValueError(f"{lib}: invalid ELF")
        missing=[name for name in ["index.html",*refs] if name.encode() not in data]
        if missing: raise ValueError(f"{lib}: embedded frontend asset keys missing: {missing}")
    return libs
def main():
    root=pathlib.Path(sys.argv[1])
    version_code=int(sys.argv[2])
    dist=pathlib.Path(sys.argv[3])
    refs=frontend_refs(dist)
    sdk=pathlib.Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
    tools=sorted((sdk/"build-tools").glob("*"),key=lambda p:tuple(int(x) for x in re.findall(r"\d+",p.name)),reverse=True)
    tool=next((p for p in tools if (p/"apksigner").is_file() and (p/"aapt").is_file()),None)
    if not tool: raise SystemExit("Android signing/manifest tools unavailable")
    apks=sorted(root.rglob("*.apk"))
    if not apks: raise SystemExit("No APK produced")
    report=[]
    for apk in apks:
        with zipfile.ZipFile(apk) as z:
            try: libraries=verify_embedded(z,refs)
            except ValueError as e: raise SystemExit(f"{apk.name}: {e}")
        badging=subprocess.check_output([str(tool/"aapt"),"dump","badging",str(apk)],text=True)
        match=re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'",badging)
        if not match or match.group(1)!="com.dsmobile.digitalhub" or int(match.group(2))!=version_code:
            raise SystemExit(f"{apk.name}: wrong package/versionCode: {match.groups() if match else 'missing'}")
        permissions=subprocess.check_output([str(tool/"aapt"),"dump","permissions",str(apk)],text=True)
        required=["CAMERA","USE_BIOMETRIC","BLUETOOTH_SCAN","BLUETOOTH_CONNECT","INTERNET"]
        missing=[p for p in required if not re.search(r"android\.permission\."+p+r"(?![A-Z_])",permissions)]
        if missing: raise SystemExit(f"{apk.name}: missing permissions {missing}")
        certs=subprocess.check_output([str(tool/"apksigner"),"verify","--print-certs",str(apk)],text=True)
        fingerprints=re.findall(r"certificate SHA-256 digest: ([0-9a-fA-F]+)",certs)
        if not fingerprints: raise SystemExit(f"{apk.name}: signing certificate fingerprint missing")
        if os.environ.get("REQUIRE_RELEASE_SIGNING")=="true" and "CN=Android Debug" in certs: raise SystemExit("Tagged release signed with debug certificate")
        with apk.open("rb") as fp: digest=hashlib.file_digest(fp,"sha256").hexdigest()
        report.append({"file":str(apk.relative_to(root)),"sha256":digest,"package":match.group(1),"versionCode":int(match.group(2)),"versionName":match.group(3),"certificateSha256":fingerprints,"requiredPermissions":required,"embeddedAssetKeysVerified":True,"entrypointAssets":refs,"nativeLibraries":libraries,"runtimeBootVerified":False,"debugCertificate":"CN=Android Debug" in certs})
    print(json.dumps(report,indent=2))
    (root/"apk-verification.json").write_text(json.dumps(report,indent=2)+"\n")
if __name__=="__main__": main()
