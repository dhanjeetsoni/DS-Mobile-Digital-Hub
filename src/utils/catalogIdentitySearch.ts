type CatalogRecord={name?:string;sku?:string;barcode?:string;units?:{imei1?:string;imei2?:string}[]};
const norm=(value:unknown)=>String(value??"").trim().toLowerCase().replace(/\s+/g," ");
/** Prefer exact product identity over broad fuzzy matches; retain fallback if there is no exact match. */
export function preferExactCatalogMatches<T extends CatalogRecord>(products:readonly T[],query:string):T[]{
 const q=norm(query);if(!q)return [...products];
 const ids=products.filter(p=>[p.sku,p.barcode,...(p.units||[]).flatMap(u=>[u.imei1,u.imei2])].some(x=>norm(x)===q));
 if(ids.length)return ids;
 const names=products.filter(p=>norm(p.name)===q);
 return names.length?names:[...products];
}
