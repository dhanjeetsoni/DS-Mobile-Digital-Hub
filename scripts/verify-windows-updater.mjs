import fs from "node:fs";
import path from "node:path";
import {createHash,createPublicKey,verify} from "node:crypto";
import {pathToFileURL} from "node:url";

// Tauri encodes the Minisign public key and detached signature as Base64.
// Verify both the prehashed artifact signature and authenticated comment.
function decode(value){if(typeof value!=="string"||!(/^[A-Za-z0-9+/]+={0,2}$/).test(value.trim()))throw Error("Invalid base64");const v=Buffer.from(value.trim(),"base64");if(v.toString("base64")!==value.trim())throw Error("Non-canonical base64");return v;}
export function verifyUpdaterSignature(publicKey,signature,artifactHash){
 const p=decode(publicKey).toString("utf8").trimEnd().split(/\r?\n/);
 const s=decode(signature).toString("utf8").trimEnd().split(/\r?\n/);
 if(p.length!==2||s.length!==4||!p[0].startsWith("untrusted comment: ")||!s[0].startsWith("untrusted comment: ")||!s[2].startsWith("trusted comment: "))throw Error("Invalid Minisign format");
 const pk=decode(p[1]),packet=decode(s[1]),commentSig=decode(s[3]);
 if(pk.length!==42||packet.length!==74||commentSig.length!==64||pk.subarray(0,2).toString()!=="Ed"||packet.subarray(0,2).toString()!=="ED"||!pk.subarray(2,10).equals(packet.subarray(2,10))||artifactHash.length!==64)throw Error("Unsupported algorithm or wrong signing key");
 const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),pk.subarray(10)]),format:"der",type:"spki"});
 const payloadSig=packet.subarray(10);
 if(!verify(null,artifactHash,key,payloadSig))throw Error("Artifact signature invalid");
 if(!verify(null,Buffer.concat([payloadSig,Buffer.from(s[2].slice("trusted comment: ".length),"utf8")]),key,commentSig))throw Error("Trusted comment signature invalid");
 return true;
}
async function hashFile(file,algorithm){const hash=createHash(algorithm);for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest();}
async function main(){
 const dir=process.argv[2],config=process.argv[3]||"src-tauri/tauri.conf.json";
 if(!dir)throw Error("Specify installer artifact directory");
 const publicKey=JSON.parse(fs.readFileSync(config,"utf8")).plugins?.updater?.pubkey;
 const installers=fs.readdirSync(dir).filter(f=>f.endsWith(".exe"));
 if(!installers.length)throw Error("Installer not found");
 const result=[];
 for(const f of installers){
  const file=path.join(dir,f),sig=file+".sig",has=fs.existsSync(sig);
  if(!has&&process.env.REQUIRE_UPDATER_SIGNATURE==="true")throw Error("Required signature missing");
  if(has)verifyUpdaterSignature(publicKey,fs.readFileSync(sig,"utf8"),await hashFile(file,"blake2b512"));
  result.push({file:f,sha256:(await hashFile(file,"sha256")).toString("hex"),signatureVerified:has});
 }
 fs.writeFileSync(path.join(dir,"updater-signature-verification.json"),JSON.stringify(result,null,2)+"\n");
 console.log("PASS installer signature verification (unsigned artifacts explicitly marked):",result.length);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
