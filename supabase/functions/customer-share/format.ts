// Public allowlist, no raw database objects or notes in customer response.
const line=(v:unknown)=>typeof v==="string"?v.replace(/[\r\n\x00-\x1f\x7f]/g," ").slice(0,180):"";
const amount=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0?"INR "+v.toFixed(2):"Not recorded";
export function receiptText(shop:unknown,s:any,items:any[]){
 const date=typeof s.created_at==="string"?s.created_at.slice(0,10):"";
 return [line(shop),"DIGITAL RECEIPT SUMMARY","Invoice: "+line(s.invoice_no),"Recorded: "+line(date),"Status: "+line(s.status),"",...items.map(i=>line(i.service_name||i.products?.model||"Item")+" x "+String(Number(i.quantity)||0)+" | "+amount(i.unit_price)+(i.warranty_end?" | Warranty until "+line(i.warranty_end):"")),"","Billed: "+amount(s.total),"Paid at sale: "+amount(s.amount_paid),"Customer due at sale: "+amount(s.due_amount),"","This is a receipt summary, not a replacement tax invoice. Subsequent returns and settlements may not be reflected. Contact the shop for the full invoice."].join("\n");
}
export function repairText(shop:unknown,j:any){
 const allowed=["Received","In Progress","Ready","Delivered","Cancelled / Returned"];
 return [line(shop),"REPAIR STATUS","Ticket: "+line(j.jobNo),"Received: "+line(j.receivedDate),"Status: "+(allowed.includes(j.status)?j.status:"Contact the shop"),"","Status reflects the last synchronized shop record. Contact the shop for pickup and charges."].join("\n");
}
export function validBearer(token:string){return /^[a-f0-9]{64}$/.test(token);}
export function validResource(kind:unknown,id:unknown){return (kind==="receipt"||kind==="repair")&&typeof id==="string"&&id.length>0&&id.length<=150&&!/[\x00-\x1f\x7f]/.test(id);}
