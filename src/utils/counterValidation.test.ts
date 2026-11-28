
import {describe,it,expect} from "vitest";import {validMoney,validStockQuantity,stockDraftError,LatestDraft} from "./counterValidation";
describe("counter draft validation",()=>{
 it("accepts zero and paise, rejects NaN, infinity, negatives, fractional paise and unsafe money",()=>{for(const n of [0,0.01,149.75,99999.99])expect(validMoney(n)).toBe(true);for(const n of [NaN,Infinity,-1,0.001,Number.MAX_SAFE_INTEGER,"50",""])expect(validMoney(n)).toBe(false);});
 it("rejects fractional or out-of-range stock and invalid price ordering",()=>{expect(validStockQuantity(1.5)).toBe(false);expect(validStockQuantity(2147483648)).toBe(false);const d={quantity:2,selling:100,purchase:40,confidential:60,mrp:120};expect(stockDraftError(d)).toBe(null);expect(stockDraftError({...d,quantity:0,minimumQuantity:1})).not.toBe(null);expect(stockDraftError({...d,confidential:30})).not.toBe(null);expect(stockDraftError({...d,selling:59})).not.toBe(null);});
 it("only the most recent photo draft is saveable and only once",()=>{const d=new LatestDraft(),a=d.begin(),b=d.begin();expect(d.current(a)).toBe(false);expect(d.markReady(a)).toBe(false);expect(d.consume()).toBe(false);expect(d.markReady(b)).toBe(true);expect(d.consume()).toBe(true);expect(d.consume()).toBe(false);expect(d.current(b)).toBe(false);const c=d.begin();d.cancel();expect(d.markReady(c)).toBe(false);});
});
