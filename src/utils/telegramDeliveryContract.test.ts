import {describe,it,expect} from "vitest";
import {formatServiceBill,telegramFailure} from "../../supabase/functions/telegram-outbox-worker/delivery-contract";
const clean=(x:unknown)=>String(x??"-").trim();
const valid={reference:"TEST-NOT-A-SALE",kind:"Exchange - net settlement",total:5,date:"2026-11-28",payment:"Not recorded",items:[{name:"Returned item",quantity:1,unitPrice:45},{name:"Replacement item",quantity:1,unitPrice:50}]};
describe("Telegram service and provider delivery contract",()=>{
 it("preserves the explicit net settlement instead of treating item totals as sales",()=>{const b=formatServiceBill(valid,clean);expect(b?.lines).toContain("Total: INR 5");expect(b?.lines).toContain("Returned item x 1 @ INR 45");});
 it("rejects malformed or non-finite quantities, values and missing references",()=>{for(const b of [{...valid,reference:" "},{...valid,total:NaN},{...valid,total:-1},{...valid,items:[{name:"item",quantity:0,unitPrice:2}]},{...valid,items:[{name:"item",quantity:1,unitPrice:Infinity}]},{...valid,items:[]}])expect(formatServiceBill(b,clean)).toBeNull();});
 it("allows legitimate zero value service records",()=>{expect(formatServiceBill({...valid,total:0,items:[{name:"Test",quantity:1,unitPrice:0}]},clean)?.lines).toContain("Total: INR 0");});
 it("retries only structured rate-limit rejection and bounds delay",()=>{expect(telegramFailure(429,{ok:false,error_code:429,parameters:{retry_after:30}})).toMatchObject({review:false,retrySeconds:30});expect(telegramFailure(429,{ok:false,error_code:429,parameters:{retry_after:999999}})).toMatchObject({review:false,retrySeconds:86400});for(const status of [400,401,403,429,500,502,503])expect(telegramFailure(status,{ok:false})).toMatchObject({review:true});});
});
