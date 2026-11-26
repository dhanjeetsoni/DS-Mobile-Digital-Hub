export type SyncActivity={device_id:string|null;queued_by:string|null;created_at:string;updated_at:string|null;status:string|null};
export function summarizeDeviceActivity(rows:SyncActivity[],currentDevice:string){
 const map=new Map<string,{id:string;last:string;first:string;accounts:number;sampledOperations:number;pending:number;failed:number;current:boolean}>();
 const people=new Map<string,Set<string>>();
 for(const r of rows){if(!r.device_id)continue;const id=r.device_id;const last=r.updated_at||r.created_at;const old=map.get(id)||{id,last,first:r.created_at,accounts:0,sampledOperations:0,pending:0,failed:0,current:id===currentDevice};
 if(last>old.last)old.last=last;if(r.created_at<old.first)old.first=r.created_at;old.sampledOperations++;if(["pending","processing","queued"].includes(r.status||""))old.pending++;if(["failed","abandoned","error"].includes(r.status||""))old.failed++;
 const set=people.get(id)||new Set<string>();if(r.queued_by)set.add(r.queued_by);people.set(id,set);old.accounts=set.size;map.set(id,old);}
 return [...map.values()].sort((a,b)=>b.last.localeCompare(a.last));
}
