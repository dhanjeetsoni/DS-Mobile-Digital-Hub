import type {Database,Sale} from "../types";
import {consumeFIFO} from "./fifoEngine";
import {round2} from "./indianCurrency";
export function returnSelectionIssue(db:Database,sale:Sale,selection:Record<string,number>,replacement?:{id:string;qty:number},verifiedImeis:Record<string,string>={}):string|null{
 if(sale.status==="Cancelled")return "Cancelled invoice cannot be returned.";
 const selected=Object.entries(selection).filter(([,q])=>q!==0);
 if(!selected.length)return "Select at least one return item.";
 if(!Number.isFinite(sale.total)||!Number.isFinite(sale.amountPaid)||sale.amountPaid<0||!Number.isFinite(sale.dueAmount)||sale.dueAmount!==0||sale.isFinance||!Number.isFinite(sale.discount)||sale.discount!==0||(sale.taxAmount??0)!==0)return "Invoice has credit, finance, discount or tax. Review refund allocation before processing.";
 for(const [id,qty] of selected){
  const lines=sale.items.filter(i=>i.productId===id);
  if(lines.length!==1)return "Multiple lines share a product. Review exact billed line before returning.";
  const line=lines[0],product=db.products.find(p=>p.id===id);
  if(!product||line.isService||!Number.isSafeInteger(qty)||qty<=0||qty>line.qty||!Number.isFinite(line.price)||line.price<0||!Number.isFinite(line.purchasePrice)||line.purchasePrice<0)return "Invalid return quantity, product or original cost.";
  if(product.isMobilePhone||line.selectedImeis?.length){
   const imei=verifiedImeis[id];
   if(replacement||qty!==1||!imei||!/^\d{15}$/.test(imei)||!line.selectedImeis?.includes(imei))return "Serialized phone return requires one physically verified billed IMEI; exchange requires separate review.";
   const units=[...(product.units||[]),...(db.imeiRegistry||[]).filter(u=>u.productId===id)].filter(u=>u.imei1===imei);
   if(!units.length||new Set(units.map(u=>u.id)).size!==1||units.some(u=>u.status!=="Sold"||u.soldInvoiceNo!==sale.invoiceNo))return "Device is not consistently assigned to the original invoice.";
  }
 }
 const refund=round2(selected.reduce((sum,[id,qty])=>sum+sale.items.find(i=>i.productId===id)!.price*qty,0));
 const prior=(db.returns||[]).filter(x=>x.saleId===sale.id||x.invoiceNo===sale.invoiceNo).reduce((sum,x)=>sum+x.subtotalRefund,0)+(db.exchanges||[]).filter(x=>x.saleId===sale.id||x.invoiceNo===sale.invoiceNo).reduce((sum,x)=>sum+x.returnedValue,0);
 if(!Number.isFinite(prior)||round2(prior+refund)>round2(sale.amountPaid))return "Refund exceeds original collected payment.";
 if(replacement){
  const p=db.products.find(x=>x.id===replacement.id);
  if(!p||p.isMobilePhone||p.units?.length)return "Serialized replacement requires owner IMEI allocation.";
  try{consumeFIFO(structuredClone(db),replacement.id,replacement.qty);}catch{return "Replacement FIFO stock is incomplete; reconcile stock before exchange.";}
 }
 return null;
}

export function markVerifiedReturnedDevice(db:Database,productId:string,imei:string,invoice:string){const p=db.products.find(x=>x.id===productId);for(const u of [...(p?.units||[]),...(db.imeiRegistry||[]).filter(x=>x.productId===productId)])if(u.imei1===imei&&u.status==="Sold"&&u.soldInvoiceNo===invoice){u.status="In Stock";delete u.soldInvoiceNo;delete u.soldDate;}}
