const FORMAT="dsmdh-encrypted-backup-v1";
const ITERATIONS=600000;
const LIMIT=50*1024*1024;
const enc=new TextEncoder();
const aad=enc.encode(FORMAT+"|PBKDF2-SHA256|600000|AES-256-GCM");
function b64(bytes:Uint8Array):string{let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function unb64(value:unknown,max:number):Uint8Array<ArrayBuffer>{if(typeof value!=="string"||value.length>Math.ceil(max/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error("Invalid encrypted backup");const raw=atob(value);if(raw.length>max)throw Error("Encrypted backup is too large");return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function key(password:string,salt:Uint8Array<ArrayBuffer>){if(!globalThis.crypto?.subtle)throw Error("Secure cryptography is unavailable on this device.");const material=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
export function validBackupPassword(password:string){return password.length>=14&&password.length<=256;}
export function validateCheckpoint(v:any,storeId?:string):void{
 if(!v||typeof v!=="object"||v.format!=="dsmdh-business-v1"||typeof v.storeId!=="string"||!v.storeId||storeId&&v.storeId!==storeId||typeof v.backupId!=="string"||typeof v.exportedAt!=="string"||!Number.isFinite(Date.parse(v.exportedAt))||!(/^[a-f0-9]{64}$/i.test(v.sha256))||!v.payload||typeof v.payload!=="object"||Array.isArray(v.payload)||!v.counts||typeof v.counts!=="object")throw Error("Invalid or unrelated server checkpoint");
 for(const name of ["store_state","sales","sale_items","products","accounting_events"]){if(!Array.isArray(v.payload[name])||v.counts[name]!==v.payload[name].length)throw Error("Checkpoint missing required records: "+name);}
 for(const name of Object.keys(v.counts)){if(!Array.isArray(v.payload[name])||v.counts[name]!==v.payload[name].length)throw Error("Checkpoint count mismatch: "+name);}
}
export async function encryptCheckpoint(checkpoint:unknown,password:string):Promise<string>{
 validateCheckpoint(checkpoint);if(!validBackupPassword(password))throw Error("Use a passphrase of 14 to 256 characters.");
 const bytes=enc.encode(JSON.stringify(checkpoint));if(bytes.length>LIMIT)throw Error("Checkpoint exceeds 50 MiB; use operator export.");
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const k=await key(password,salt);
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},k,bytes);
 return JSON.stringify({format:FORMAT,kdf:"PBKDF2-SHA256",iterations:ITERATIONS,cipher:"AES-256-GCM",salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(cipher))});
}
export async function decryptCheckpoint(file:string,password:string):Promise<Record<string,unknown>>{
 if(!validBackupPassword(password)||file.length>Math.ceil((LIMIT+16)/3)*4+4096)throw Error("Invalid passphrase or encrypted backup size.");
 const v=JSON.parse(file);if(v?.format!==FORMAT||v.kdf!=="PBKDF2-SHA256"||v.iterations!==ITERATIONS||v.cipher!=="AES-256-GCM")throw Error("Unsupported encrypted backup format");
 const salt=unb64(v.salt,16),iv=unb64(v.iv,12),data=unb64(v.data,LIMIT+16);if(salt.length!==16||iv.length!==12||data.length<16)throw Error("Invalid encrypted backup");
 const k=await key(password,salt);
 let bytes:ArrayBuffer;try{bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:aad,tagLength:128},k,data);}catch{throw Error("Wrong passphrase or damaged backup.");}
 const checkpoint=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));validateCheckpoint(checkpoint);return checkpoint;
}
