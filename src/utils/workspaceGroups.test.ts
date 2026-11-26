import {describe,it,expect} from "vitest";
import {WORKSPACE_GROUPS} from "./workspaceGroups";
import {readFileSync} from "node:fs";
describe("owner workspace",()=>{it("contains exactly 12 groups and every registered tool exactly once",()=>{
 const source=readFileSync("src/components/Sidebar.tsx","utf8");
 const keys=[...source.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(m=>m[1]);
 const grouped=WORKSPACE_GROUPS.flatMap(g=>[...g.keys] as string[]);
 expect(WORKSPACE_GROUPS).toHaveLength(12);expect(grouped).toHaveLength(keys.length);expect(new Set(grouped).size).toBe(keys.length);expect([...grouped].sort()).toEqual([...keys].sort());
});});