export type ProbeRequest=(method:"PUT"|"GET"|"DELETE",body?:string)=>Promise<Response>;
export type ProbeResult={ok:boolean;stage:string;cleanupVerified:boolean};
export async function probeStorage(request:ProbeRequest,marker:string):Promise<ProbeResult>{
 let stage="create",created=false,cleanupVerified=false,passed=false;
 const matches=async(response:Response)=>response.ok&&(response.headers.get("content-length")===null||Number(response.headers.get("content-length"))<=1024)&&await response.text()===marker;
 try{
  const put=await request("PUT",marker);if(!put.ok)throw Error("create rejected");created=true;
  stage="read";if(!await matches(await request("GET")))throw Error("readback mismatch");
  stage="create-only";const duplicate=await request("PUT",marker+"-replacement");if(![409,412].includes(duplicate.status))throw Error("overwrite was not rejected");
  stage="unchanged";if(!await matches(await request("GET")))throw Error("original bytes changed");
  passed=true;
 }catch{
  // A timeout may have committed the original PUT. Only clean up a test
  // object we can prove we created, never a preexisting unknown object.
  if(!created)try{const r=await request("GET");created=await matches(r);cleanupVerified=r.status===404;}catch{}
 }finally{
  if(created){
   try{const removed=await request("DELETE");cleanupVerified=removed.ok&&(await request("GET")).status===404;}catch{}
  }
 }
 return {ok:passed&&cleanupVerified,stage:passed?(cleanupVerified?"complete":"cleanup"):stage,cleanupVerified};
}
