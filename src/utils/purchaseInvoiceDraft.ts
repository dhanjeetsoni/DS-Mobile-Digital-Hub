export type DraftLine={name:string;quantity:number|null;unitPrice:number|null;gstPercent:number|null};
export type PurchaseInvoiceDraft={supplier:string;invoiceRef:string;invoiceDate:string;lines:DraftLine[];total:number|null};
const str=(x:unknown,max=200)=>typeof x==="string"?x.trim().slice(0,max):"";
const num=(x:unknown,max=100000000)=>typeof x==="number"&&Number.isFinite(x)&&x>=0&&x<=max?x:null;
export function normalizePurchaseInvoiceDraft(input:unknown):PurchaseInvoiceDraft{
 const d=(input&&typeof input==="object"?input:{}) as Record<string,unknown>;
 const date=str(d.invoiceDate,10);
 return {supplier:str(d.supplier),invoiceRef:str(d.invoiceRef,80),invoiceDate:/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:"",total:num(d.total),lines:(Array.isArray(d.lines)?d.lines:[]).slice(0,100).flatMap(x=>{if(!x||typeof x!=="object")return [];const row=x as Record<string,unknown>;const name=str(row.name);return name?[{name,quantity:num(row.quantity,100000),unitPrice:num(row.unitPrice),gstPercent:num(row.gstPercent,100)}]:[];})};
}
export function validPurchaseAmounts(qty:number,price:number){return Number.isSafeInteger(qty)&&qty>0&&Number.isFinite(price)&&price>=0&&Number.isFinite(qty*price)&&qty*price<=1000000000;}
