import type {CartItem,Product,Sale} from "../types";
import {round2} from "./indianCurrency";
export type OfferKind="percent"|"quantity"|"bundle"|"buyget";
export function calculateOffer(cart:CartItem[],products:Product[],kind:OfferKind,percent:number,minQty:number){
 const items=cart.filter(c=>!c.isGift&&!c.isService&&c.qty>0);
 if(!Number.isFinite(percent)||percent<0||percent>100||!Number.isInteger(minQty)||minQty<2)return [];
 if(kind==="bundle"&&new Set(items.map(i=>i.productId)).size<2)return [];
 return items.flatMap(c=>{
  const p=products.find(x=>x.id===c.productId);
  if(!p||p.pendingCost||p.purchasePrice===null||!Number.isFinite(p.purchasePrice)||p.purchasePrice<0||!Number.isFinite(c.price)||c.price<=0)return [];
  if((kind==="quantity"||kind==="buyget")&&c.qty<minQty)return [];
  const floor=Math.max(p.purchasePrice,p.confidentialPrice??0);
  const rate=kind==="buyget"?100*Math.floor(c.qty/minQty)/c.qty:percent;
  const price=round2(c.price*(1-rate/100));
  return price<floor||price>=c.price?[]:[{productId:c.productId,oldPrice:c.price,newPrice:price,qty:c.qty,saving:round2((c.price-price)*c.qty)}];
 });
}
export function displaySnapshot(cart:CartItem[],discount:number,tax:number,total:number){
 return {items:cart.map(c=>({name:c.name,qty:c.qty,total:round2(c.qty*c.price)})),discount:round2(discount),tax:round2(tax),total:round2(total)};
}
export function salesRunRate(sales:Sale[],today:string){
 const end=new Date(today+"T00:00:00Z");if(!Number.isFinite(end.valueOf()))return null;
 const days=Array.from({length:28},(_,i)=>new Date(end.valueOf()-(28-i)*86400000).toISOString().slice(0,10));
 const map=new Map(days.map(d=>[d,0]));const active=new Set<string>();
 for(const s of sales){if(s.status==="Cancelled"||!map.has(s.date)||!Number.isFinite(s.total)||s.total<0)continue;map.set(s.date,(map.get(s.date)||0)+s.total);active.add(s.date);}
 if(active.size<20||!active.has(days[0])||!active.has(days[27]))return null;
 const daily=[...map.values()];const mean=daily.reduce((a,x)=>a+x,0)/28;
 return {activeDays:active.size,average:round2(mean),next7:round2(mean*7),next30:round2(mean*30)};
}
