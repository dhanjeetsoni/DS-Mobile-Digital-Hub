// Keyset scan over immutable, unique relational IDs. A short page is not
// an end marker: the server may enforce a smaller response limit.
export async function collectCatalogRows<T extends {id:string}>(read:(after:string|null)=>Promise<T[]>):Promise<T[]>{
 const rows:T[]=[];let after:string|null=null;
 for(let page=0;page<1000;page++){
  const batch=await read(after);if(!Array.isArray(batch))throw Error("Invalid catalog page");
  if(!batch.length)return rows;
  for(const row of batch){
   if(!row||typeof row.id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)||after!==null&&row.id<=after)throw Error("Catalog cursor did not advance");
   rows.push(row);after=row.id;
  }
  if(rows.length>100000)throw Error("Catalog safety limit exceeded");
 }
 throw Error("Catalog pagination did not finish");
}
export function stockMapFromRows(rows:{id:string;client_id?:string|null;stock_qty:unknown}[]):Record<string,number>{
 const result:Record<string,number>=Object.create(null);
 for(const row of rows){
  const n=Number(row.stock_qty);
  if(row.stock_qty==null||!Number.isFinite(n))throw Error("Invalid live stock quantity");
  result[row.id]=n;
  if(row.client_id)result[row.client_id]=n;
 }
 return result;
}
