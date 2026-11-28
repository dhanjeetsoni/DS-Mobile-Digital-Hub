import {createClient} from "npm:@supabase/supabase-js@2";
import {isInvoiceTemplate,consentValid} from "./readiness.ts";
const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const hex=(a:Uint8Array)=>Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");
const admin=url&&key?createClient(url,key,{auth:{persistSession:false}}):null;
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST"||!admin||!anon)return reply({error:"Unavailable"},405);
 try{
  const secret=Deno.env.get("CRON_SECRET")||"",provided=req.headers.get("x-cron-secret")||"",cron=!!secret&&provided===secret;
  let p:{id:string;store_id:string;role:string}|null=null;
  if(cron){p={id:"",store_id:Deno.env.get("WHATSAPP_STORE_ID")||"",role:"owner"};}
  else{
   const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
   const {data:u,error:ue}=await admin.auth.getUser(token);if(ue||!u.user)return reply({error:"Authentication required"},401);
   const caller=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
   const {data:allowed,error:ae}=await caller.rpc("current_account_allowed");if(ae||allowed!==true)return reply({error:"Access denied"},403);
   const {data:profile,error:pe}=await admin.from("profiles").select("id,store_id,role").eq("id",u.user.id).maybeSingle();if(pe||!profile?.store_id)return reply({error:"Access denied"},403);p=profile;
  }
  if(!p)return reply({error:"Access denied"},403);
  const store=Deno.env.get("WHATSAPP_STORE_ID")||"",phoneId=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")||"",access=Deno.env.get("WHATSAPP_ACCESS_TOKEN")||"",version=Deno.env.get("WHATSAPP_GRAPH_VERSION")||"",template=Deno.env.get("WHATSAPP_INVOICE_TEMPLATE")||"",language=Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE")||"";
  const configured=/^[0-9a-f-]{36}$/.test(store)&&store===p.store_id&&/^\d+$/.test(phoneId)&&!!access&&/^v\d+\.\d+$/.test(version)&&/^[a-z0-9_]+$/.test(template)&&/^[a-z]{2}(_[A-Z]{2})?$/.test(language);
  const request=await req.json().catch(()=>null);
  if(request?.action==="readiness"){
   if(!cron&&p.role!=="owner")return reply({error:"Owner access required"},403);
   const missing:string[]=[];
   if(!/^[0-9a-f-]{36}$/.test(store)||store!==p.store_id)missing.push("WHATSAPP_STORE_ID");
   if(!/^\d+$/.test(phoneId))missing.push("WHATSAPP_PHONE_NUMBER_ID");
   if(!access)missing.push("WHATSAPP_ACCESS_TOKEN");
   if(!/^v\d+\.\d+$/.test(version))missing.push("WHATSAPP_GRAPH_VERSION");
   if(!/^[a-z0-9_]+$/.test(template))missing.push("WHATSAPP_INVOICE_TEMPLATE");
   if(!/^[a-z]{2}(_[A-Z]{2})?$/.test(language))missing.push("WHATSAPP_TEMPLATE_LANGUAGE");
   const waba=Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID")||"";
   if(!/^\d+$/.test(waba))missing.push("WHATSAPP_BUSINESS_ACCOUNT_ID");
   if(!Deno.env.get("WHATSAPP_APP_SECRET"))missing.push("WHATSAPP_APP_SECRET");
   if(!Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN"))missing.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
   let phoneVerified=false,templateVerified=false;
   if(configured){
    const get=async(path:string,params:Record<string,string>)=>{const u=new URL("https://graph.facebook.com/"+version+"/"+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const response=await fetch(u,{headers:{Authorization:"Bearer "+access},signal:AbortSignal.timeout(10000)});if(!response.ok)return null;return response.json().catch(()=>null);};
    try{const data=await get(phoneId,{fields:"id"});phoneVerified=data?.id===phoneId;}catch{}
    if(/^\d+$/.test(waba))try{const data=await get(waba+"/message_templates",{name:template,fields:"name,status,language,category,components",limit:"100"});templateVerified=Array.isArray(data?.data)&&data.data.some((t:any)=>isInvoiceTemplate(t,template,language));}catch{}
   }
   return reply({ready:configured&&missing.length===0&&phoneVerified&&templateVerified,configured,missing,phoneVerified,templateVerified,webhookSecretsConfigured:!missing.includes("WHATSAPP_APP_SECRET")&&!missing.includes("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),scope:"Read-only Meta configuration probe; no customer message sent, callback not verified"});
  }
  if(!configured)return reply({configured:false,accepted:0});
  const stale=new Date(Date.now()-600000).toISOString();
  await admin.from("sales").update({whatsapp_delivery_state:"review",whatsapp_delivery_error:"Interrupted provider request; do not resend without checking."}).eq("store_id",store).eq("whatsapp_delivery_state","processing").lt("whatsapp_claimed_at",stale);
  const {data:shop,error:se}=await admin.from("stores").select("name").eq("id",store).maybeSingle();if(se||!shop)return reply({error:"Shop unavailable"},503);
  let q=admin.from("sales").select("id,invoice_no,customer_phone,total,status,created_by,whatsapp_consent_at,whatsapp_attempts,whatsapp_consent_phone").eq("store_id",store).eq("whatsapp_delivery_state","queued").not("whatsapp_consent_at","is",null).lte("whatsapp_next_attempt_at",new Date().toISOString()).order("created_at").limit(cron?3:5);
  if(p.role!=="owner")q=q.eq("created_by",p.id);
  const {data:rows,error:qe}=await q;if(qe)return reply({error:"Queue unavailable"},503);
  let accepted=0,review=0;
  for(const s of rows||[]){
   const attempts=Number(s.whatsapp_attempts||0)+1;
   const {data:claim,error:ce}=await admin.from("sales").update({whatsapp_delivery_state:"processing",whatsapp_claimed_at:new Date().toISOString(),whatsapp_attempts:attempts}).eq("id",s.id).eq("store_id",store).eq("whatsapp_delivery_state","queued").eq("whatsapp_attempts",attempts-1).select("id,status,customer_phone,total,invoice_no,created_by,whatsapp_consent_phone").maybeSingle();
   if(ce||!claim)continue;
   const finish=async(state:string,issue:string|null,id?:string)=>{const {data,error}=await admin!.from("sales").update({whatsapp_delivery_state:state,whatsapp_delivery_error:issue,...(id?{whatsapp_provider_id:id}:{})}).eq("id",s.id).eq("store_id",store).eq("whatsapp_delivery_state","processing").eq("whatsapp_attempts",attempts).select("id").maybeSingle();if(error||!data)throw Error("Provider checkpoint failed");};
   try{
    if(claim.status==="Cancelled"){await finish("skipped","Invoice cancelled");continue;}
    if(!consentValid(s.whatsapp_consent_at)){await finish("review","Consent older than seven days; confirm again before sending");continue;}
    let digits=String(claim.customer_phone||"").replace(/[^0-9]/g,"");if(digits.length===10)digits="91"+digits;
    if(digits!==claim.whatsapp_consent_phone){await finish("review","Recipient changed after checkout consent; do not send.");continue;}
    if(!/^91[6-9][0-9]{9}$/.test(digits)||!Number.isFinite(Number(claim.total))||Number(claim.total)<0||!claim.created_by){await finish("review","Receipt details need review");continue;}
    const bearer=hex(crypto.getRandomValues(new Uint8Array(32))),hash=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(bearer)))),now=new Date(),expires=new Date(now.valueOf()+6*86400000);
    const {error:le}=await admin.from("customer_share_links").insert({token_hash:hash,store_id:store,kind:"receipt",resource_id:s.id,created_by:claim.created_by,created_at:now.toISOString(),expires_at:expires.toISOString()});if(le)throw Error("Receipt link creation failed");
    const link=url+"/functions/v1/customer-share?token="+bearer;
    const parameters=[String(shop.name).replace(/[\r\n]/g," ").slice(0,80),String(claim.invoice_no).slice(0,100),"INR "+Number(claim.total).toFixed(2),link].map(text=>({type:"text",text}));
    const res=await fetch("https://graph.facebook.com/"+version+"/"+phoneId+"/messages",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:digits,type:"template",template:{name:template,language:{code:language},components:[{type:"body",parameters}]}}),signal:AbortSignal.timeout(25000)});
    const result=await res.json().catch(()=>null);const id=result?.messages?.[0]?.id;
    if(res.status===429&&result?.error&&!id&&attempts<5){
      const seconds=Math.min(3600,Math.max(120,Number(res.headers.get("retry-after"))||120*2**(attempts-1)));
      const {error:retry}=await admin.from("sales").update({whatsapp_delivery_state:"queued",whatsapp_claimed_at:null,whatsapp_next_attempt_at:new Date(Date.now()+seconds*1000).toISOString(),whatsapp_delivery_error:"Provider rate limit; retry scheduled"}).eq("id",s.id).eq("store_id",store).eq("whatsapp_delivery_state","processing").eq("whatsapp_attempts",attempts);
      await admin.from("customer_share_links").update({revoked_at:new Date().toISOString()}).eq("token_hash",hash).eq("store_id",store);
      if(retry)throw Error("Retry checkpoint failed");
      continue;
    }
    if(!res.ok||typeof id!=="string"||!id||id.length>300){await finish("review","Provider did not acknowledge request; review in Meta before retry");review++;continue;}
    const {error:accept}=await admin.rpc("record_whatsapp_provider_acceptance",{p_store:store,p_sale:s.id,p_provider_id:id});if(accept)throw Error("Provider acceptance checkpoint failed");accepted++;
   }catch{try{await finish("review","Request not confirmed; check provider before retry");}catch{}review++;}
  }
  return reply({configured:true,accepted,review});
 }catch{return reply({error:"Worker unavailable; queued records retained"},503);}
});