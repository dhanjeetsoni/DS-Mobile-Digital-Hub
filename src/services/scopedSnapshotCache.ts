import type {Database} from "../types";
export type ScopedSnapshot={profileId:string;storeId:string;version:number;base:Database;local:Database;savedAt:number};
const DB="dsmdh-scoped-snapshots-v2",STORE="snapshots";
const legacyKey=(profileId:string)=>"dsmdh_scoped_state_v1_"+profileId;
const idbKey=(profileId:string,storeId:string)=>profileId+":"+storeId;
let tail:Promise<unknown>=Promise.resolve(),lastSavedAt=0;
function serialized<T>(fn:()=>Promise<T>):Promise<T>{const next=tail.then(fn,fn);tail=next.catch(()=>{});return next;}
function openDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);let failed=false;
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
  request.onblocked=()=>{failed=true;reject(Error("Scoped cache is blocked by another app instance"));};
  request.onerror=()=>{failed=true;reject(request.error||Error("Scoped cache unavailable"));};
  request.onsuccess=()=>{if(failed)request.result.close();else resolve(request.result);};
 });
}
async function readIdb(key:string):Promise<unknown>{
 const db=await openDb();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),request=tx.objectStore(STORE).get(key);tx.oncomplete=()=>resolve(request.result);tx.onabort=tx.onerror=()=>reject(tx.error||Error("Scoped cache read failed"));});}finally{db.close();}
}
async function putIdb(key:string,value:ScopedSnapshot):Promise<void>{
 const db=await openDb();
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE),get=store.get(key);let stale=false;get.onsuccess=()=>{if(get.result&&Number(get.result.savedAt)>value.savedAt){stale=true;tx.abort();return;}store.put(value,key);};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(stale?Error("A newer scoped cache already exists"):tx.error||Error("Scoped cache write failed"));});}finally{db.close();}
}
function valid(value:unknown,profileId:string,storeId:string):ScopedSnapshot|null{
 if(value==null)return null;
 if(typeof value!=="object")throw Error("Invalid scoped cache");
 const x=value as Partial<ScopedSnapshot>;
 if(x.storeId!==storeId||x.profileId&&x.profileId!==profileId)return null;
 const version=Number(x.version),savedAt=x.savedAt??0;
 if(!Number.isSafeInteger(version)||version<0||!Number.isSafeInteger(savedAt)||savedAt<0||!x.base||typeof x.base!=="object"||!x.local||typeof x.local!=="object"||!Array.isArray(x.base.products)||!Array.isArray(x.local.products))throw Error("Invalid scoped cache data");
 return {...x,profileId,storeId,version,savedAt} as ScopedSnapshot;
}
export function chooseScopedSnapshot(a:unknown,b:unknown,profileId:string,storeId:string):ScopedSnapshot|null{
 const first=valid(a,profileId,storeId),second=valid(b,profileId,storeId);
 if(!first)return second;if(!second)return first;
 return first.savedAt>second.savedAt?first:second;
}
export async function readScopedSnapshot(profileId:string,storeId:string):Promise<ScopedSnapshot|null>{
 await tail;
 let legacy:unknown=null;let legacyFailure:unknown;
 try{const raw=localStorage.getItem(legacyKey(profileId));if(raw)legacy=JSON.parse(raw);}catch(e){legacyFailure=e;}
 if(typeof indexedDB==="undefined"){if(legacyFailure)throw legacyFailure;return valid(legacy,profileId,storeId);}
 // A failed IndexedDB read must never be interpreted as a clean cache.
 const stored=await readIdb(idbKey(profileId,storeId));
 if(legacyFailure&&stored==null)throw legacyFailure;
 return chooseScopedSnapshot(legacy,stored,profileId,storeId);
}
export async function writeScopedSnapshot(scope:{profileId:string;storeId:string;version:number;state:Database},local:Database):Promise<void>{
 const savedAt=lastSavedAt=Math.max(Date.now(),lastSavedAt+1);
 // Detach both snapshots immediately: later edits cannot alter a queued write.
 const envelope:ScopedSnapshot=structuredClone({profileId:scope.profileId,storeId:scope.storeId,version:scope.version,base:scope.state,local,savedAt});
 let localSaved=false;
 try{localStorage.setItem(legacyKey(scope.profileId),JSON.stringify(envelope));localSaved=true;}catch{}
 if(typeof indexedDB==="undefined"){if(!localSaved)throw Error("Local snapshot storage is full or unavailable");return;}
 try{await serialized(()=>putIdb(idbKey(scope.profileId,scope.storeId),envelope));}
 catch(error){if(!localSaved||String(error).includes("newer scoped cache"))throw error;}
}
