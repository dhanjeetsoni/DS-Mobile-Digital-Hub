// Conservative three-way merge: preserve disjoint edits; report conflicting edits
// instead of silently picking a winner. Identified collections merge per record.
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function sameState(a: unknown,b: unknown): boolean {
  if (Object.is(a,b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length===b.length && a.every((v,i)=>sameState(v,b[i]));
  if (object(a) && object(b)) {
    const keys=Object.keys(a), other=Object.keys(b);
    return keys.length===other.length && keys.every(k=>Object.prototype.hasOwnProperty.call(b,k) && sameState(a[k],b[k]));
  }
  return false;
}
function identified(v: unknown): v is Array<Record<string,unknown> & {id:string}> {
  return Array.isArray(v) && v.every(x=>object(x) && typeof x.id==="string" && x.id.length>0) && new Set(v.map(x=>x.id)).size===v.length;
}
export function mergeStoreState<T>(base:T,local:T,remote:T): {state:T;conflicts:string[]} {
  const conflicts:string[]=[];
  const merge=(b:unknown,l:unknown,r:unknown,path:string):unknown=>{
    if(sameState(l,r)) return l;
    if(sameState(l,b)) return r;
    if(sameState(r,b)) return l;
    if(identified(b)&&identified(l)&&identified(r)){
      const bm=new Map(b.map(x=>[x.id,x])),lm=new Map(l.map(x=>[x.id,x])),rm=new Map(r.map(x=>[x.id,x]));
      const ids=new Set([...rm.keys(),...lm.keys(),...bm.keys()]);
      return [...ids].map(id=>merge(bm.get(id),lm.get(id),rm.get(id),path+"["+id+"]")).filter(x=>x!==undefined);
    }
    if(object(b)&&object(l)&&object(r)){
      const result:Record<string,unknown>={};
      for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
        if(k==="__proto__"||k==="constructor"||k==="prototype") continue;
        const value=merge(b[k],l[k],r[k],path?path+"."+k:k);
        if(value!==undefined) result[k]=value;
      }
      return result;
    }
    conflicts.push(path||"root"); return r;
  };
  return {state:merge(base,local,remote,"") as T,conflicts};
}
