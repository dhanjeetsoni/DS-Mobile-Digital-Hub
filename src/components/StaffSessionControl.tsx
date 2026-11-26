import React,{useEffect,useRef,useState} from "react";
import {supabase,isCloudConfigured} from "../services/supabaseClient";
type SessionRow={session_id:string;installation_id:string;account_name:string;role:string;first_seen:string;last_seen:string;revoked_at:string|null;session_exists:boolean};
export function StaffSessionControl({profileId,storeId}:{profileId?:string;storeId?:string}){
 const scope=String(profileId||"")+":"+String(storeId||"");
 const [snapshot,setSnapshot]=useState<{scope:string;rows:SessionRow[]}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const epoch=useRef(0),pending=useRef(false);
 useEffect(()=>{epoch.current++;setSnapshot(null);setMessage("");setBusy(false);pending.current=false;return()=>{epoch.current++;};},[scope]);
 const run=async(session?:string)=>{if(!profileId||!storeId||!isCloudConfigured||pending.current)return;if(session&&!window.confirm("Revoke this staff login session? Other sessions stay active. A fresh login is still possible unless account access is disabled."))return;
 const seq=++epoch.current;pending.current=true;setBusy(true);setMessage("");try{
 const {data:user,error:authError}=await supabase.auth.getUser();if(authError||user.user?.id!==profileId)throw Error("Session changed");
 if(session){const {data,error}=await supabase.rpc("revoke_staff_session",{p_session_id:session});if(error)throw error;if(seq===epoch.current)setMessage(data===true?"Session revoked. Connected clients will be denied at their next access check.":"Session already revoked or no longer available.");}
 const {data,error}=await supabase.rpc("list_staff_sessions");if(error||!Array.isArray(data))throw Error("Unable to list sessions");
 if(seq===epoch.current)setSnapshot({scope,rows:data});
 }catch{if(seq===epoch.current){setSnapshot(null);setMessage("Could not verify staff sessions. Check cloud connection and owner login.");}}finally{if(seq===epoch.current){pending.current=false;setBusy(false);}}
 };
 const rows=snapshot?.scope===scope?snapshot.rows:null;
 return <section className="section"><div className="section-head"><div><h2>Staff login sessions</h2><p className="hint">Registered staff and manager sessions, not a hardware allowlist. An online app registers and rechecks access periodically. Revoking one session does not disable the account or prevent a new login. Offline access cannot be revoked instantly.</p></div><button className="btn sm" type="button" disabled={busy||!profileId||!storeId||!isCloudConfigured} onClick={()=>void run()}>Refresh sessions</button></div>{message&&<p className="hint" role="status">{message}</p>}{rows&&<>{rows.length===0?<p className="hint">No registered staff sessions yet.</p>:<div className="table-wrap"><table><thead><tr><th>Account</th><th>Installation</th><th>Last check</th><th>Session status</th><th>Action</th></tr></thead><tbody>{rows.map(r=><tr key={r.session_id}><td>{r.account_name} ({r.role})</td><td>{r.installation_id.slice(0,24)}</td><td>{new Date(r.last_seen).toLocaleString("en-IN")}</td><td>{r.revoked_at?"Revoked":r.session_exists?"Session recorded":"Session no longer exists"}</td><td><button type="button" className="btn sm danger" disabled={busy||!!r.revoked_at||!r.session_exists} onClick={()=>void run(r.session_id)}>Revoke session</button></td></tr>)}</tbody></table></div>}</>}</section>;
}
