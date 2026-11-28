export function formatServiceBill(b:any,clean:(v:unknown)=>string):{reference:string;lines:string[]}|null{
 if(!b||typeof b.reference!=="string"||!clean(b.reference)||typeof b.kind!=="string"||!clean(b.kind)||!Number.isFinite(b.total)||b.total<0||!Array.isArray(b.items)||!b.items.length||b.items.length>1000||!b.items.every((i:any)=>i&&typeof i.name==="string"&&clean(i.name)&&Number.isFinite(i.quantity)&&i.quantity>0&&Number.isFinite(i.unitPrice)&&i.unitPrice>=0))return null;
 const reference=clean(b.reference);
 // Exchange totals are net settlement; repair delivery can include advances.
 // Do not calculate new revenue or proof of payment from item values.
 return {reference,lines:["DS MOBILE & DIGITAL HUB",clean(b.kind),"Bill: "+reference,"Date: "+clean(b.date)+" "+clean(b.time),"Sold by: "+clean(b.soldBy),"Payment: "+clean(b.payment),"Items:",...b.items.map((i:any)=>clean(i.name)+" x "+i.quantity+" @ INR "+i.unitPrice),"Total: INR "+b.total]};
}
export function telegramFailure(status:number,body:any):{message:string;review:boolean;retrySeconds:number}{
 if(status===429&&body?.ok===false&&body?.error_code===429){
  const delay=Number(body?.parameters?.retry_after);
  return {message:"Telegram rate limit; retry scheduled",review:false,retrySeconds:Number.isFinite(delay)&&delay>0?Math.min(86400,Math.ceil(delay)):120};
 }
 // A non-success response can be ambiguous (including a gateway error).
 // Do not resend unless the provider explicitly confirms a rate-limit rejection.
 return {message:"DELIVERY_REVIEW_REQUIRED: Telegram request rejected or uncertain (HTTP "+status+")",review:true,retrySeconds:0};
}
