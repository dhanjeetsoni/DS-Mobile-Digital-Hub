
import type {CartItem} from "../types";
import {validMoney,validStockQuantity} from "../utils/counterValidation";
import {cartIdentifiersValid} from "../utils/cartIntegrity";

export interface ParkedCart {
 id:string;timestamp:number;customerName?:string;customerPhone?:string;customerAddress?:string;note?:string;items:CartItem[];discount:number;total:number;
}
const PREFIX="ds_parked_carts_v2_";
const LEGACY_KEY="ds_parked_carts_v1";
function key(scope:string){if(!scope)throw Error("Sign in before using held carts");return PREFIX+encodeURIComponent(scope);}
export function heldCartScope(profile:{id?:string;store_id?:string}|null,owner:boolean,cloudIdentitySeen:boolean):string{
 if(profile?.id&&profile.store_id)return JSON.stringify(["cloud",profile.store_id,profile.id]);
 if(cloudIdentitySeen)return "";
 return JSON.stringify(["local",owner?"owner":"staff"]);
}
function validItems(items:unknown):items is CartItem[]{
 return Array.isArray(items)&&items.length>0&&items.every(i=>i&&typeof i.productId==="string"&&typeof i.name==="string"&&validMoney(i.price)&&validStockQuantity(i.qty,1))&&cartIdentifiersValid(items as CartItem[]);
}
function parse(raw:string|null):ParkedCart[]{
 if(raw===null)return [];
 const carts=JSON.parse(raw);
 if(!Array.isArray(carts)||carts.some(c=>!c||typeof c.id!=="string"||!Number.isFinite(c.timestamp)||!validItems(c.items)||!validMoney(c.discount)||!validMoney(c.total))||new Set(carts.map(c=>c.id)).size!==carts.length)throw Error("Held cart storage needs recovery; no records changed");
 return carts;
}
export function getParkedCarts(scope:string,storage:Pick<Storage,"getItem">=localStorage):ParkedCart[]{return parse(storage.getItem(key(scope)));}
export function parkCart(scope:string,params:{items:CartItem[];customerName?:string;customerPhone?:string;customerAddress?:string;note?:string;discount?:number},storage:Pick<Storage,"getItem"|"setItem">=localStorage):ParkedCart{
 if(!validItems(params.items))throw Error("Cannot hold invalid cart");
 const carts=getParkedCarts(scope,storage);
 const subtotal=Math.round(params.items.reduce((sum,i)=>sum+i.price*i.qty,0)*100)/100;
 // Flat discounts are no longer authorized by POS; never revive a legacy override.
 if(!validMoney(subtotal)||Number(params.discount||0)!==0)throw Error("Review line prices before holding this cart");
 const saved:ParkedCart={id:"hold_"+crypto.randomUUID(),timestamp:Date.now(),customerName:params.customerName?.trim(),customerPhone:params.customerPhone?.trim(),customerAddress:params.customerAddress?.trim(),note:params.note?.trim(),items:structuredClone(params.items),discount:0,total:subtotal};
 storage.setItem(key(scope),JSON.stringify([saved,...carts]));return saved;
}
export function deleteParkedCart(scope:string,id:string,storage:Pick<Storage,"getItem"|"setItem">=localStorage):ParkedCart[]{
 const previous=getParkedCarts(scope,storage);if(!previous.some(c=>c.id===id))throw Error("Held cart is no longer available");
 const next=previous.filter(c=>c.id!==id);storage.setItem(key(scope),JSON.stringify(next));return next;
}
export function hasUnassignedLegacyCarts(storage:Pick<Storage,"getItem">=localStorage):boolean{
 try{return storage.getItem(LEGACY_KEY)!==null;}catch{return false;}
}
/** Only a standalone local owner can explicitly adopt legacy local drafts.
 * Never assign unscoped legacy data to a cloud identity or a staff login. */
export function recoverStandaloneLegacyCarts(scope:string,storage:Pick<Storage,"getItem"|"setItem">=localStorage):ParkedCart[]{
 if(scope!==heldCartScope(null,true,false)||storage.getItem("dsmdh_cloud_identity_seen"))throw Error("Unassigned drafts require owner recovery");
 const prior=getParkedCarts(scope,storage),legacy=parse(storage.getItem(LEGACY_KEY));
 const merged=[...prior,...legacy.filter(c=>!prior.some(p=>p.id===c.id)).map(c=>({...c,discount:0,total:Math.round(c.items.reduce((s,i)=>s+i.price*i.qty,0)*100)/100}))];
 storage.setItem(key(scope),JSON.stringify(merged));
 // Retain original archive intentionally. A marker avoids repeated import of
 // drafts the operator subsequently resumed/deleted.
 storage.setItem(PREFIX+"legacy_recovered","1");return merged;
}
export function legacyRecoveryAvailable(scope:string,storage:Pick<Storage,"getItem">=localStorage):boolean{
 try{return scope===heldCartScope(null,true,false)&&!storage.getItem("dsmdh_cloud_identity_seen")&&hasUnassignedLegacyCarts(storage)&&storage.getItem(PREFIX+"legacy_recovered")!=="1";}catch{return false;}
}
