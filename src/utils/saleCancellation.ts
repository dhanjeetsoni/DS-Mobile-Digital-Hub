import type {Database,Sale,IMEIUnit} from "../types";
import {addStockBatch,fifoCostTotal} from "./fifoEngine";
import {round2} from "./indianCurrency";
export function restoreCancelledSaleStock(db:Database,sale:Sale,date:string):void{
 if(sale.status==="Cancelled")throw Error("Invoice is already cancelled.");
 if((db.returns||[]).some(r=>r.saleId===sale.id||r.invoiceNo===sale.invoiceNo)||(db.exchanges||[]).some(r=>r.saleId===sale.id||r.invoiceNo===sale.invoiceNo)||sale.items.some(i=>(i.returnedQty||0)>0))throw Error("Invoice has returns or exchanges. Review those before cancelling.");
 if(sale.isFinance&&sale.financeDetails?.payoutStatus!=="Pending Bank Settlement")throw Error("Finance settlement or dispute requires separate reconciliation before cancellation.");
 const seen=new Set<string>();
 const plan:{product:Database["products"][number];qty:number;lots:{qty:number;purchasePrice:number}[];units:IMEIUnit[]}[]=[];
 for(const item of sale.items){
  if(item.isService)continue;
  const product=db.products.find(p=>p.id===item.productId);
  if(!product||!Number.isFinite(item.qty)||item.qty<=0||!Number.isFinite(product.stock)||product.stock<0)throw Error("Original stock record is missing or invalid.");
  const lots=item.batchConsumption?.length?item.batchConsumption:[{qty:item.qty,purchasePrice:item.purchasePrice}];
  const qty=lots.reduce((sum,b)=>sum+b.qty,0);
  if(lots.some(b=>!Number.isFinite(b.qty)||b.qty<=0||!Number.isFinite(b.purchasePrice)||b.purchasePrice<0)||round2(qty)!==round2(item.qty)||!Number.isFinite(item.cost)||round2(fifoCostTotal(lots.map(b=>({batchId:null,...b}))))!==round2(item.cost))throw Error("Original FIFO cost cannot be reconciled. Review invoice before cancelling.");
  const identifiers=item.selectedImeis||[];
  if((product.isMobilePhone||identifiers.length>0)&&identifiers.length!==item.qty)throw Error("Original device identifiers are incomplete.");
  const units:IMEIUnit[]=[];
  for(const imei of identifiers){
   if(seen.has(imei))throw Error("Duplicate device identifier on invoice.");
   seen.add(imei);
   const matches=[...(product.units||[]),...(db.imeiRegistry||[]).filter(u=>u.productId===product.id)].filter(u=>u.imei1===imei);
   if(!matches.length||matches.some(u=>u.status!=="Sold"||u.soldInvoiceNo!==sale.invoiceNo)||new Set(matches.map(u=>u.id)).size!==1)throw Error("Device is not assigned to this active invoice. Review IMEI history before cancelling.");
   units.push(...matches);
  }
  plan.push({product,qty:item.qty,lots,units});
 }
 for(const entry of plan){
  entry.product.stock=round2(entry.product.stock+entry.qty);
  for(const lot of entry.lots)addStockBatch(db,entry.product.id,lot.qty,lot.purchasePrice,date,{source:"sale_cancel",ref:sale.invoiceNo});
  for(const unit of entry.units){unit.status="In Stock";delete unit.soldInvoiceNo;delete unit.soldDate;}
 }
}
