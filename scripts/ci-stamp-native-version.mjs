import {readFileSync,writeFileSync} from "node:fs";
const [version,buildArg]=process.argv.slice(2);
const build=Number(buildArg);
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(version||"")||!Number.isSafeInteger(build)||build<=1000000||build>2100000000)throw Error("Invalid native version/build");
const base="src-tauri/tauri.conf.json",mobile="src-tauri/tauri.mobile-android.conf.json";
const c=JSON.parse(readFileSync(base,"utf8"));c.version=version;writeFileSync(base,JSON.stringify(c,null,2)+"\n");
const m=JSON.parse(readFileSync(mobile,"utf8"));m.bundle??={};m.bundle.android??={};m.bundle.android.versionCode=build;writeFileSync(mobile,JSON.stringify(m,null,2)+"\n");
console.log("Native version "+version+"; Android versionCode "+build);
