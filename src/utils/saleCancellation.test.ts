import {describe,it,expect} from "vitest";
import type {Database,Sale} from "../types";
import {restoreCancelledSaleStock} from "./saleCancellation";
const fixture=()=>{
 const unit={id:"u",productId:"p",imei1:"123456789012345",status:"Sold",soldInvoiceNo:"S1",soldDate:"2026-11-26"};
 const db={products:[{id:"p",stock:0,isMobilePhone:true,units:[{...unit}]}],imeiRegistry:[{...unit}],stockBatches:[],returns:[],exchanges:[]} as unknown as Database;
 const sale={id:"s",invoiceNo:"S1",status:"Paid",items:[{productId:"p",qty:1,purchasePrice:200,cost:200,batchConsumption:[{batchId:"b",qty:1,purchasePrice:200}],selectedImeis:[unit.imei1]}]} as unknown as Sale;
 return {db,sale};
};
describe("sale cancellation stock integrity",()=>{
 it("restores only device assigned to invoice and clears stale sold metadata",()=>{const {db,sale}=fixture();restoreCancelledSaleStock(db,sale,"2026-11-27");expect(db.products[0].stock).toBe(1);expect(db.stockBatches[0].purchasePrice).toBe(200);expect(db.imeiRegistry![0].status).toBe("In Stock");expect(db.products[0].units![0].soldInvoiceNo).toBeUndefined();});
 it("rejects reassigned IMEI without stock mutation",()=>{const {db,sale}=fixture();db.imeiRegistry![0].soldInvoiceNo="S2";const before=structuredClone(db);expect(()=>restoreCancelledSaleStock(db,sale,"2026-11-27")).toThrow();expect(db).toEqual(before);});
 it("restores exact original FIFO cost layers",()=>{const {db,sale}=fixture();db.products[0].isMobilePhone=false;sale.items[0]={...sale.items[0],qty:3,cost:40,purchasePrice:13.33,selectedImeis:[],batchConsumption:[{batchId:"a",qty:2,purchasePrice:10},{batchId:"b",qty:1,purchasePrice:20}]};restoreCancelledSaleStock(db,sale,"2026-11-27");expect(db.stockBatches.map(x=>[x.qty,x.purchasePrice])).toEqual([[2,10],[1,20]]);});
 it("refuses returned items and invalid later line without partial mutation",()=>{const {db,sale}=fixture();sale.items.push({...sale.items[0],productId:"missing"});const before=structuredClone(db);expect(()=>restoreCancelledSaleStock(db,sale,"2026-11-27")).toThrow();expect(db).toEqual(before);sale.items.pop();sale.items[0].returnedQty=1;expect(()=>restoreCancelledSaleStock(db,sale,"2026-11-27")).toThrow();expect(db).toEqual(before);});
});
