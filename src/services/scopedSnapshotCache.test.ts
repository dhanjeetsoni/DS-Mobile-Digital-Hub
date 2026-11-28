import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import type {Database} from "../types";
import {chooseScopedSnapshot,readScopedSnapshot,writeScopedSnapshot} from "./scopedSnapshotCache";
const db=(value:string)=>({products:[{id:value}],settings:{}} as unknown as Database);
const record=(savedAt:number,storeId="shop",profileId="owner")=>({savedAt,version:4,base:db("base"),local:db(String(savedAt)),storeId,profileId});
describe("scoped snapshot cache",()=>{
 let map:Map<string,string>;let fail=false;
 beforeEach(()=>{map=new Map();fail=false;vi.stubGlobal("indexedDB",undefined);vi.stubGlobal("localStorage",{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{if(fail)throw Error("quota");map.set(k,v);}});});
 afterEach(()=>vi.unstubAllGlobals());
 it("keeps newest valid account-scoped snapshot",()=>{expect(chooseScopedSnapshot(record(3),record(5),"owner","shop")?.savedAt).toBe(5);expect(chooseScopedSnapshot(record(7,"other"),record(2),"owner","shop")?.savedAt).toBe(2);expect(chooseScopedSnapshot(record(5,"shop","staff"),null,"owner","shop")).toBeNull();});
 it("preserves local fallback where IndexedDB is genuinely unavailable",async()=>{await writeScopedSnapshot({profileId:"owner",storeId:"shop",version:4,state:db("base")},db("latest"));expect((await readScopedSnapshot("owner","shop"))?.local.products[0].id).toBe("latest");expect(await readScopedSnapshot("other","shop")).toBeNull();});
 it("fails closed on storage quota or malformed cache",async()=>{await writeScopedSnapshot({profileId:"owner",storeId:"shop",version:4,state:db("base")},db("old"));fail=true;await expect(writeScopedSnapshot({profileId:"owner",storeId:"shop",version:4,state:db("base")},db("new"))).rejects.toThrow("storage");expect((await readScopedSnapshot("owner","shop"))?.local.products[0].id).toBe("old");map.set("dsmdh_scoped_state_v1_owner","{");await expect(readScopedSnapshot("owner","shop")).rejects.toThrow();});
});
