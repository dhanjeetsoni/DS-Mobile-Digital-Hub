import type {Database,Product,Sale} from "../types";
export type RecordHit={kind:"product"|"customer"|"invoice"|"imei";id:string;label:string;detail:string;route:string};
export function findWorkspaceRecords(query:string, data:{products:Product[];customers:Database["customers"];sales:Sale[];imei:Database["imeiRegistry"]}, allowed:ReadonlySet<string>, privateAccess:boolean):RecordHit[]{
 const q=query.trim().toLowerCase();if(q.length<2)return [];
 const match=(...values:(string|null|undefined)[])=>values.some(v=>typeof v==="string"&&v.toLowerCase().includes(q));
 const result:RecordHit[]=[];const add=(hit:RecordHit)=>{if(result.length<30)result.push(hit)};
 if(allowed.has("products")||allowed.has("sell"))for(const p of data.products){if(match(p.name,p.brand,p.sku,p.barcode))add({kind:"product",id:p.id,label:p.name,detail:[p.brand,p.sku].filter(Boolean).join(" · "),route:allowed.has("products")?"products":"sell"});if(result.length>=10)break;}
 if(!privateAccess)return result;
 if(allowed.has("customerDirectory"))for(const c of data.customers){if(match(c.name,c.phone))add({kind:"customer",id:c.id,label:c.name,detail:"Customer profile",route:"customerDirectory"});if(result.filter(x=>x.kind==="customer").length>=6)break;}
 if(allowed.has("invoices"))for(const s of data.sales){if(match(s.invoiceNo,s.customer?.name,s.customer?.phone))add({kind:"invoice",id:s.id,label:s.invoiceNo,detail:"Invoice · "+s.date,route:"invoices"});if(result.filter(x=>x.kind==="invoice").length>=6)break;}
 if(allowed.has("imeiTracker"))for(const u of data.imei){if(match(u.imei1,u.imei2,u.serialNo))add({kind:"imei",id:u.id,label:u.imei1,detail:"Device · "+u.status,route:"imeiTracker"});if(result.filter(x=>x.kind==="imei").length>=6)break;}
 return result;
}
