export function formatOriginalPosBill(b:any,clean:(v:unknown)=>string):{reference:string;lines:string[]}|null{
 if(b?.schema!=="pos-v1"||typeof b.reference!=="string"||!Array.isArray(b.items)||!b.items.length||b.items.length>1000||!b.items.every((i:any)=>i&&typeof i.name==="string"&&Number.isFinite(i.quantity)&&i.quantity>0&&Number.isFinite(i.unitPrice)&&i.unitPrice>=0))return null;
 const reference=clean(b.reference),money=(v:any)=>v==null?"Not recorded": "INR "+String(v);
 const lines=["DS MOBILE & DIGITAL HUB","Invoice: "+reference,"Date (IST): "+clean(b.date),"Sold by: "+clean(b.soldBy),"Customer: "+clean(b.customer),"Phone: "+clean(b.phone),"Payment: "+clean(b.payment),"Status: "+clean(b.status),"Items:",...b.items.map((i:any)=>clean(i.name)+" x "+i.quantity+" @ "+money(i.unitPrice)+(i.gift?" (gift)":"")),"Subtotal: "+money(b.subtotal),"Discount: "+money(b.discount),"Tax: "+money(b.tax),"Total: "+money(b.total),"Paid: "+money(b.paid),"Due: "+money(b.due)];
 if(b.financeLoan!=null)lines.push("Finance loan: "+money(b.financeLoan));
 return {reference,lines};
}
