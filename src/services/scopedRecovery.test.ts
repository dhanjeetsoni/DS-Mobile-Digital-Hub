import {describe,it,expect} from "vitest";import {scopeMatches,scopedQueueRows,chooseSnapshotRecovery} from "./scopedRecovery";import type {Database} from "../types";
const scope={profileId:"owner",storeId:"shop"},other={profileId:"staff",storeId:"shop"};
const db=(a:number,b:number)=>({products:[{id:"a",n:a},{id:"b",n:b}],settings:{}} as unknown as Database);
const prior=(local:Database,base=db(1,1))=>({scope,base,local,version:2,conflicts:[]});
const cache=(local:Database,base=db(1,1))=>({...scope,base,local,version:2,savedAt:10});
describe("account-scoped local recovery",()=>{
 it("never displays or exports another account, another shop, or unscoped entries",()=>{const row=(id:string,s:any)=>[id,"sale","invoice",JSON.stringify({scope:s})];expect(scopedQueueRows([row("a",scope),row("b",other),row("c",{...scope,storeId:"other"}),row("d",null),["bad","sale","invoice","{"]],scope).map(x=>x.id)).toEqual(["a"]);expect(scopeMatches(null,scope)).toBe(false);});
 it("merges independent SQLite and cache changes",()=>{const r=chooseSnapshotRecovery(prior(db(2,1)),cache(db(1,3)),scope);expect(r.review).toEqual([]);expect(r.active?.local).toEqual(db(2,3));});
 it("archives both conflicting branches instead of selecting silently",()=>{const r=chooseSnapshotRecovery(prior(db(2,1)),cache(db(3,1)),scope);expect(r.active).toBeNull();expect(r.review.map(x=>x.local)).toEqual([db(2,1),db(3,1)]);expect(r.review[0].conflicts).toEqual(["products[a].n"]);});
 it("accepts a confirmed causal successor and preserves unrelated bases for review",()=>{expect(chooseSnapshotRecovery(prior(db(2,1)),cache(db(2,3),db(2,1)),scope).active?.local).toEqual(db(2,3));expect(chooseSnapshotRecovery(prior(db(2,1)),cache(db(8,9),db(7,7)),scope).review).toHaveLength(2);});
});
