import type {Database,Product} from "../types";
export type DeletedProductPhoto={productId:string;url:string};
// Apply a completed upload only to its original slot, on the current snapshot.
export function applyProductPhotoMigration(db:Database,productId:string,slot:number,source:string,url:string):Database|null{
 const product=db.products.find(p=>p.id===productId);if(!product||!source.startsWith("data:")||!url||!Number.isInteger(slot)||slot<0)return null;
 const photos=product.photos?.length?[...product.photos]:[product.photo];
 if(photos[slot]!==source)return null;
 if(slot===0&&product.photo&&product.photo!==source)return null;
 photos[slot]=url;
 return {...db,products:db.products.map(p=>p.id===productId?{...p,photos,photo:slot===0?url:p.photo}:p)};
}
// Remove only URLs acknowledged as deleted; never replace a newly uploaded photo.
export function clearConfirmedDeletedPhotos(db:Database,deleted:DeletedProductPhoto[]):Database{
 const byId=new Map<string,Set<string>>();for(const d of deleted){const set=byId.get(d.productId)||new Set<string>();set.add(d.url);byId.set(d.productId,set);}
 return {...db,products:db.products.map(p=>{const set=byId.get(p.id);if(!set)return p;const photos=p.photos?.filter(u=>!set.has(u));const photo=set.has(p.photo)?photos?.[0]||"":p.photo;return {...p,photo,...(p.photos?{photos}: {})};})};
}
export function stalePhotoEligible(p:Product,cutoff:number):boolean{
 const since=Date.parse(p.outOfStockSince||"");return Number.isFinite(p.stock)&&p.stock<=0&&Number.isFinite(since)&&since<=cutoff;
}
