import {describe,it,expect} from "vitest";
import {collectCatalogRows,stockMapFromRows} from "./liveCatalogPagination";
const id=(n:number)=>"00000000-0000-0000-0000-"+String(n).padStart(12,"0");
describe("cloud catalog pagination and stock identity",()=>{
 it("reads all 10,000 rows even when server caps pages at 137",async()=>{const input=Array.from({length:10000},(_,i)=>({id:id(i+1),client_id:"local-"+i,stock_qty:i%7}));let requests=0;const out=await collectCatalogRows(async after=>{requests++;return input.filter(x=>after===null||x.id>after).slice(0,137);});expect(out).toEqual(input);expect(requests).toBe(74);expect(stockMapFromRows(out)["local-9999"]).toBe(9999%7);});
 it("rejects a stuck cursor, malformed page or transport failure",async()=>{await expect(collectCatalogRows(async()=>[{id:id(1)}])).rejects.toThrow("cursor");await expect(collectCatalogRows(async()=>[{id:"bad"}])).rejects.toThrow("cursor");await expect(collectCatalogRows(async after=>{if(after)throw Error("offline");return [{id:id(1)}];})).rejects.toThrow("offline");});
 it("keeps relational and client identity with zero stock",()=>{const m=stockMapFromRows([{id:id(2),client_id:"product-A",stock_qty:"0"}]);expect(m[id(2)]).toBe(0);expect(m["product-A"]).toBe(0);expect(()=>stockMapFromRows([{id:id(2),stock_qty:null}])).toThrow("stock");});
});
