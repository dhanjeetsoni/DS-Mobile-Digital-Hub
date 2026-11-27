import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
vi.mock("sql.js",async()=>{const {createRequire}=await import("node:module");const req=createRequire(import.meta.url);const init=req("sql.js");return {default:()=>init({locateFile:()=>req.resolve("sql.js/dist/sql-wasm.wasm")})};});
import {sqliteEnqueue,sqliteList,sqliteRemove,sqliteReplace} from "./localSqlite";
describe("durable offline SQLite queue",()=>{
 let map:Map<string,string>;let fail=false;
 beforeEach(()=>{map=new Map();fail=false;vi.stubGlobal("indexedDB",undefined);vi.stubGlobal("navigator",{});vi.stubGlobal("localStorage",{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{if(fail)throw Error("quota exceeded");map.set(k,v);}});});
 afterEach(()=>vi.unstubAllGlobals());
 it("serializes concurrent writes and removals against durable state",async()=>{await Promise.all(Array.from({length:12},(_,i)=>sqliteEnqueue("sale","sales",{i},"op-"+i)));expect((await sqliteList()).length).toBe(12);await Promise.all([sqliteRemove("op-0"),sqliteReplace("sale","sales",{i:99},"op-1"),sqliteEnqueue("sale","sales",{i:12},"op-12")]);const rows=await sqliteList();expect(rows.length).toBe(12);expect(rows.some(r=>r[0]==="op-0")).toBe(false);expect(JSON.parse(String(rows.find(r=>r[0]==="op-1")?.[3]))).toEqual({i:99});});
 it("does not report an unpersisted mutation as durable",async()=>{await sqliteEnqueue("sale","sales",{i:1},"old");fail=true;await expect(sqliteEnqueue("sale","sales",{i:2},"lost")).rejects.toThrow("quota");fail=false;expect((await sqliteList()).map(r=>r[0])).toEqual(["old"]);await sqliteEnqueue("sale","sales",{i:3},"new");expect((await sqliteList()).map(r=>r[0]).sort()).toEqual(["new","old"]);});
});
