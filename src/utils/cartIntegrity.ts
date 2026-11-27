import type {CartItem,Product} from "../types";
export function cartStockQuantity(cart:CartItem[],productId:string,excludeIndex=-1){return cart.reduce((n,i,index)=>index!==excludeIndex&&i.productId===productId&&!i.isService?n+i.qty:n,0);}
export function allocateCartImeis(product:Product,cart:CartItem[],quantity:number,existing:string[]=[],specific?:string,excludeIndex=-1):string[]|null{
 if(!Number.isSafeInteger(quantity)||quantity<1)return null;
 const used=new Set(cart.flatMap((i,n)=>n===excludeIndex?[]:i.selectedImeis||[]));
 const units=product.units||[];
 // Staff projections and legacy products may not expose registered units.
 // Do not invent IMEIs. An explicit serial must match an actual in-stock unit.
 const available=units.filter(u=>u.status==="In Stock"&&u.imei1&&!used.has(u.imei1));
 if(!units.length)return specific?null:[];
 const chosen=existing.filter((id,i)=>existing.indexOf(id)===i&&available.some(u=>u.imei1===id)).slice(0,quantity);
 if(specific){const unit=available.find(u=>u.imei1===specific||u.imei2===specific);if(!unit||chosen.includes(unit.imei1)||chosen.length>=quantity)return null;chosen.push(unit.imei1);}
 for(const u of available){if(chosen.length>=quantity)break;if(!chosen.includes(u.imei1))chosen.push(u.imei1);}
 return chosen.length===quantity?chosen:null;
}
export function cartIdentifiersValid(cart:CartItem[]){const all=cart.flatMap(i=>i.selectedImeis||[]);return new Set(all).size===all.length&&cart.every(i=>!i.selectedImeis?.length||i.selectedImeis.length===i.qty);}
