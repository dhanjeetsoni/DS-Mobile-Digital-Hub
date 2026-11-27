import {createClient} from "@supabase/supabase-js";
import {receiptText,repairText,catalogText,catalogProjection,validBearer,validResource} from "./format.ts";
const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const admin=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const safe={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow, noarchive"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,...safe,"Content-Type":"application/json"}});
const plain=(body:string,status=200)=>new Response(body,{status,headers:{...safe,"Content-Type":"text/plain; charset=utf-8"}});
const hex=(arr:Uint8Array)=>Array.from(arr,b=>b.toString(16).padStart(2,"0")).join("");
const hash=async(token:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))));
const buckets=new Map<string,{until:number,count:number}>();
function rate(id:string,max:number){const now=Date.now();for(const [k,v] of buckets)if(v.until<=now)buckets.delete(k);if(!buckets.has(id)&&buckets.size>=3000)return false;const b=buckets.get(id)||{until:now+60000,count:0};b.count++;buckets.set(id,b);return b.count<=max;}
async function owner(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!admin||!anon||!token)return null;const {data,error}=await admin.auth.getUser(token);if(error||!data.user)return null;const caller=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});const {data:allowed,error:accessError}=await caller.rpc("current_account_allowed");if(accessError||allowed!==true)return null;const {data:p,error:pe}=await admin.from("profiles").select("id,role,store_id").eq("id",data.user.id).maybeSingle();return !pe&&p?.role==="owner"&&p.store_id?p:null;}
async function record(store:string,kind:string,id:string,byInvoice=false){
 if(!admin)return null;const {data:shop,error:shopError}=await admin.from("stores").select("name").eq("id",store).maybeSingle();if(shopError||!shop)return null;
 if(kind==="receipt"){const q=admin.from("sales").select("id,invoice_no,status,created_at,total,amount_paid,due_amount").eq("store_id",store);const {data:s,error}=await (byInvoice?q.eq("invoice_no",id):q.eq("id",id)).maybeSingle();if(error||!s||s.status==="Cancelled")return null;const {data:items,error:ie}=await admin.from("sale_items").select("quantity,unit_price,service_name,warranty_end,products(model,store_id)").eq("sale_id",s.id).limit(101);if(ie||!items||items.length>100)return null;const filtered=items.map((i:any)=>({...i,products:i.products?.store_id===store?{model:i.products.model}:null}));return {id:s.id,text:receiptText(shop.name,s,filtered)};}
 const {data:state,error}=await admin.from("store_state").select("state").eq("store_id",store).maybeSingle();if(error||!state?.state)return null;
 if(["catalog","catalog-price","catalog-rich","catalog-rich-price"].includes(kind)){if(id!=="shop")return null;const prices=kind==="catalog-price"||kind==="catalog-rich-price";return {id:"shop",text:catalogText(shop.name,state.state.products,prices),...(kind.startsWith("catalog-rich")?{catalog:catalogProjection(shop.name,state.state.products,prices,store,url)}:{})};}
 if(kind!=="repair"||!Array.isArray(state.state.jobs))return null;
 const j=state.state.jobs.find((j:any)=>j?.id===id);return j?{id:String(j.id),text:repairText(shop.name,j)}:null;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(!admin)return plain("Service unavailable.",503);
 try{
 const u=new URL(req.url);
 if(req.method==="GET"){
 const token=u.searchParams.get("token")||"";if(!validBearer(token))return plain("Link unavailable or expired.",404);
 const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";if(!rate("read:"+ip,60))return plain("Please try again shortly.",429);
 const {data:link,error}=await admin.from("customer_share_links").select("store_id,kind,resource_id").eq("token_hash",await hash(token)).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(error||!link)return plain("Link unavailable or expired.",404);
 const found=await record(link.store_id,link.kind,link.resource_id);return found?plain(found.text):plain("Link unavailable or expired.",404);
 }
 if(req.method!=="POST")return plain("Method not allowed.",405);
 const raw=await req.text();if(raw.length>2048)return json({error:"Request too large."},413);let body:any;try{body=JSON.parse(raw);}catch{return json({error:"Invalid request."},400);}
 if(body?.action==="read_catalog"){
  const token=typeof body.token==="string"?body.token:"";if(!validBearer(token))return json({error:"Link unavailable or expired."},404);
  const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";if(!rate("catalog:"+ip,60))return json({error:"Please try again shortly."},429);
  const {data:link,error}=await admin.from("customer_share_links").select("store_id,kind,resource_id,expires_at").eq("token_hash",await hash(token)).in("kind",["catalog-rich","catalog-rich-price"]).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(error||!link)return json({error:"Link unavailable or expired."},404);
  const found=await record(link.store_id,link.kind,link.resource_id);
  return found&&"catalog" in found&&found.catalog?json({...found.catalog,expiresAt:link.expires_at}):json({error:"Link unavailable or expired."},404);
 }
 const p=await owner(req);if(!p)return json({error:"Owner authentication required."},403);if(!rate("owner:"+p.id,20))return json({error:"Too many requests."},429);
 if(!validResource(body?.kind,body?.resourceId))return json({error:"Invalid record."},400);
 const found=await record(p.store_id,body.kind,body.resourceId,body.kind==="receipt");if(!found)return json({error:"Synchronized record not found. Check cloud sync first."},404);
 if(body.action==="revoke"){
 const {error}=await admin.from("customer_share_links").update({revoked_at:new Date().toISOString()}).eq("store_id",p.store_id).eq("kind",body.kind).eq("resource_id",found.id).is("revoked_at",null);if(error)return json({error:"Unable to revoke links."},503);return json({success:true});
 }
 if(body.action!=="create")return json({error:"Invalid action."},400);
 const token=hex(crypto.getRandomValues(new Uint8Array(32)));const now=new Date(),expires=new Date(now.valueOf()+6*86400000);
 const {error}=await admin.from("customer_share_links").insert({token_hash:await hash(token),store_id:p.store_id,kind:body.kind,resource_id:found.id,created_by:p.id,created_at:now.toISOString(),expires_at:expires.toISOString()});
 if(error)return json({error:"Unable to create link."},503);return json({success:true,url:url+"/functions/v1/customer-share?token="+token,expiresAt:expires.toISOString()});
 }catch{return req.method==="GET"?plain("Link unavailable.",503):json({error:"Service unavailable."},503);}
});
