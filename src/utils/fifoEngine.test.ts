import {describe,it,expect,vi} from "vitest";
import type {Database} from "../types";
import {consumeFIFO,addStockBatch,fifoCostTotal,getAvailableStock,todayStr,nowTimeStr} from "./fifoEngine";
function fixture(){const db={stockBatches:[]} as unknown as Database;addStockBatch(db,"a",2,10,"2026-11-25");addStockBatch(db,"a",3,20,"2026-11-26");return db;}
describe("FIFO transaction integrity",()=>{it("does not mutate any batch on failed allocation",()=>{const db=fixture(),before=structuredClone(db.stockBatches);expect(()=>consumeFIFO(db,"a",6)).toThrow("Insufficient stock");expect(db.stockBatches).toEqual(before);});it("allocates oldest batches and commits exact cost",()=>{const db=fixture();expect(fifoCostTotal(consumeFIFO(db,"a",3))).toBe(40);expect(getAvailableStock(db,"a")).toBe(2);});it("rejects invalid quantities without mutation",()=>{for(const qty of [NaN,Infinity,-1,0,0.001]){const db=fixture(),before=structuredClone(db.stockBatches);expect(()=>consumeFIFO(db,"a",qty)).toThrow();expect(db.stockBatches).toEqual(before);}});it("uses the shop's India calendar even across UTC midnight",()=>{vi.useFakeTimers();try{vi.setSystemTime(new Date("2026-11-26T19:00:00Z"));expect(todayStr()).toBe("2026-11-27");expect(nowTimeStr()).toBe("00:30");}finally{vi.useRealTimers();}});});


describe("FIFO cost integrity",()=>{
  it("rejects invalid cost in a later batch before consuming any stock",()=>{
    for(const cost of [NaN,Infinity,-Infinity,-1]){
      const db=fixture();db.stockBatches[1].purchasePrice=cost;
      const before=structuredClone(db.stockBatches);
      expect(()=>consumeFIFO(db,"a",3)).toThrow("Invalid stock batch purchase cost");
      expect(db.stockBatches).toEqual(before);
    }
  });
  it("preserves legitimate zero-cost stock",()=>{
    const db=fixture();db.stockBatches[0].purchasePrice=0;
    expect(fifoCostTotal(consumeFIFO(db,"a",2))).toBe(0);
  });
  it("refuses invalid historical cost rather than reporting false profit",()=>{
    for(const purchasePrice of [NaN,Infinity,-1]) expect(()=>fifoCostTotal([{batchId:"a",qty:1,purchasePrice}])).toThrow();
    expect(()=>fifoCostTotal([{batchId:"a",qty:NaN,purchasePrice:10}])).toThrow();
    expect(fifoCostTotal([])).toBe(0);
  });
});
