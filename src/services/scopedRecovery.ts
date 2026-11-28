import type {Database} from "../types";
import type {ScopedSnapshot} from "./scopedSnapshotCache";
import {mergeStoreState,sameState} from "./syncMerge";
type Scope={profileId:string;storeId:string};
type Recovery={scope:Scope;base:Database;local:Database;version:number;conflicts:string[]};
export function scopeMatches(actual:Scope|null|undefined,expected:Scope|null|undefined):boolean{
 return !!actual&&!!expected&&!!expected.profileId&&!!expected.storeId&&actual.profileId===expected.profileId&&actual.storeId===expected.storeId;
}
export function scopedQueueRows(rows:readonly (readonly unknown[])[],scope:Scope){
 return rows.flatMap(row=>{
  try{const payload=JSON.parse(String(row[3]));if(!scopeMatches(payload?.scope,scope))return [];
   return [{id:String(row[0]),operation:String(row[1]),entity:String(row[2]),payload}];
  }catch{return [];}
 });
}
// Reconcile the two independently durable recovery sources. The cache is
// captured at each edit; SQLite may contain a distinct interrupted write.
// Never silently discard the SQLite branch when both contain changes.
export function chooseSnapshotRecovery(pending:Recovery|null,cached:ScopedSnapshot|null,scope:Scope):{active:Recovery|null;review:Recovery[]}{
 const prior=pending&&scopeMatches(pending.scope,scope)&&!sameState(pending.base,pending.local)?pending:null;
 const cache=cached&&scopeMatches(cached,scope)&&!sameState(cached.base,cached.local)?{scope,base:cached.base,local:cached.local,version:cached.version,conflicts:[]}:null;
 if(!cache)return {active:prior,review:[]};
 if(!prior)return {active:cache,review:[]};
 if(sameState(prior.base,cache.base)){
  const merged=mergeStoreState(prior.base,cache.local,prior.local);
  if(!merged.conflicts.length)return {active:{...cache,local:merged.state,version:Math.max(cache.version,prior.version)},review:[]};
  // Preserve both divergent sources for review; do not automatically
  // replay either branch when the intended winning edit is uncertain.
  return {active:null,review:[{...prior,conflicts:merged.conflicts},{...cache,conflicts:merged.conflicts}]};
 }
 if(sameState(prior.local,cache.base))return {active:cache,review:[]};
 if(sameState(cache.local,prior.base))return {active:prior,review:[]};
 return {active:null,review:[{...prior,conflicts:["recovery-base-version"]},{...cache,conflicts:["recovery-base-version"]}]};
}
