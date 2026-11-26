import React,{useEffect,useRef,useState} from "react";
import {supabase,isCloudConfigured} from "../services/supabaseClient";
import {deviceId} from "../services/repository";
import {summarizeDeviceActivity,type SyncActivity} from "../utils/deviceActivity";
import {StaffSessionControl} from "./StaffSessionControl";
type Props={storeId?:string;profileId?:string};
export function DeviceActivityPanel({storeId,profileId}:Props){
 const [snapshot,setSnapshot]=useState<{scope:string;rows:SyncActivity[];truncated:boolean;checked:string}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");const revision=useRef(0);const scope=String(storeId||"")+":"+String(profileId||"");
 useEffect(()=>{revision.current++;setSnapshot(null);setBusy(false);setError("");return()=>{revision.current++;};},[scope]);
 const refresh=async()=>{if(!storeId||!profileId||!isCloudConfigured)return;const req=++revision.current;setBusy(true);setError("");
 try{const {data:user,error:authError}=await supabase.auth.getUser();if(authError||user.user?.id!==profileId)throw Error("Session changed. Sign in again.");
 const {data:profile,error:profileError}=await supabase.from("profiles").select("id,role,store_id").eq("id",profileId).maybeSingle();if(profileError||!profile||profile.role!=="owner"||profile.store_id!==storeId)throw Error("Owner session required.");
 const {data:allowed,error:accessError}=await supabase.rpc("current_account_allowed");if(accessError||allowed!==true)throw Error("Account access could not be verified.");
 const rows:SyncActivity[]=[];const batch=200;const limit=1000;for(let start=0;start<limit;start+=batch){const {data,error}=await supabase.from("sync_queue").select("device_id,queued_by,created_at,updated_at,status").eq("store_id",storeId).order("updated_at",{ascending:false}).order("id",{ascending:false}).range(start,start+batch-1);if(error)throw error;if(req!==revision.current)return;const page=(data||[]) as SyncActivity[];rows.push(...page);if(page.length<batch)break;}
 const {data:after,error:afterError}=await supabase.auth.getUser();if(afterError||after.user?.id!==profileId)throw Error("Session changed. Sign in again.");
 if(req===revision.current)setSnapshot({scope,rows,truncated:rows.length>=limit,checked:new Date().toISOString()});
 }catch{if(req===revision.current){setSnapshot(null);setError("Could not verify device activity. Check your owner session and connection.");}}finally{if(req===revision.current)setBusy(false);}};
 const visible=snapshot?.scope===scope?snapshot:null;const devices=summarizeDeviceActivity(visible?.rows||[],deviceId);
 return <><StaffSessionControl profileId={profileId} storeId={storeId}/><section className="section"><div className="section-head"><div><h2>Device activity review</h2><p className="hint">Observed sync history, not an online-session list or device authorization system. Use existing Staff Access controls for account-level logout.</p></div><button type="button" className="btn sm" disabled={busy||!storeId||!profileId||!isCloudConfigured} onClick={refresh}>{busy?"Refreshing activity…":"Refresh device activity"}</button></div><p className="hint">This installation: {deviceId.slice(0,12)}…</p>{!storeId||!isCloudConfigured?<p className="hint">Local device. Cloud history is unavailable.</p>:null}{error&&<p className="alert red" role="status">{error}</p>}{visible&&<><p className="hint">{devices.length} observed device IDs · {visible.rows.length} sampled operations · checked {new Date(visible.checked).toLocaleString("en-IN")}{visible.truncated?" · latest 1,000 operations only":""}</p>{devices.length===0?<p className="hint">No sync activity recorded in this sample.</p>:<div className="table-wrap"><table><thead><tr><th>Device ID</th><th>Last recorded activity</th><th>Accounts</th><th>Operations</th><th>Pending</th><th>Failed / abandoned</th></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td>{d.id}{d.current?" (this installation)":""}</td><td>{new Date(d.last).toLocaleString("en-IN")}</td><td>{d.accounts}</td><td>{d.sampledOperations}</td><td>{d.pending}</td><td>{d.failed}</td></tr>)}</tbody></table></div>}</>}</section></>;
}
