import {describe,it,expect} from "vitest";
import {mergeStoreState,sameState} from "./syncMerge";
describe("three-way store merge",()=>{
 it("merges different records",()=>{const b={rows:[{id:"a",n:1},{id:"b",n:1}]};const l={rows:[{id:"a",n:2},{id:"b",n:1}]};const r={rows:[{id:"a",n:1},{id:"b",n:3}]};expect(mergeStoreState(b,l,r)).toEqual({state:{rows:[{id:"a",n:2},{id:"b",n:3}]},conflicts:[]});});
 it("preserves independent additions",()=>{expect(mergeStoreState({rows:[]},{rows:[{id:"a",n:1}]},{rows:[{id:"b",n:2}]})).toEqual({state:{rows:[{id:"b",n:2},{id:"a",n:1}]},conflicts:[]});});
 it("reports conflicting quantities",()=>{const b={rows:[{id:"a",n:1}]};expect(mergeStoreState(b,{rows:[{id:"a",n:2}]},{rows:[{id:"a",n:3}]}).conflicts).toEqual(["rows[a].n"]);});
 it("preserves deletion against unchanged remote",()=>{const b={rows:[{id:"a",n:1}]};expect(mergeStoreState(b,{rows:[]},b).state).toEqual({rows:[]});});
 it("flags delete versus edit",()=>{expect(mergeStoreState({rows:[{id:"a",n:1}]},{rows:[]},{rows:[{id:"a",n:2}]}).conflicts).toEqual(["rows[a]"]);});
 it("merges independent settings",()=>{expect(mergeStoreState({a:1,b:1},{a:2,b:1},{a:1,b:3})).toEqual({state:{a:2,b:3},conflicts:[]});});
 it("recognizes equivalent key order",()=>{expect(sameState({a:1,b:2},{b:2,a:1})).toBe(true);});
});

it("reports a same-record concurrent edit without erasing unrelated additions",()=>{const b={rows:[{id:"a",n:1}]};const l={rows:[{id:"a",n:2},{id:"l",n:4}]};const r={rows:[{id:"a",n:3},{id:"r",n:5}]};expect(mergeStoreState(b,l,r)).toEqual({state:{rows:[{id:"a",n:3},{id:"r",n:5},{id:"l",n:4}]},conflicts:["rows[a].n"]});});
it("flags conflicting duplicate identifiers rather than pretending to merge them",()=>{const b={rows:[{id:"a",n:1}]};const l={rows:[{id:"a",n:2},{id:"a",n:3}]};const r={rows:[{id:"a",n:4}]};expect(mergeStoreState(b,l,r).conflicts).toEqual(["rows"]);});
