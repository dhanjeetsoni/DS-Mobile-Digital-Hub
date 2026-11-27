import {createClient} from "npm:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const hex=(a:Uint8Array)=>Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");
const admin=url&&key?createClient(url,key,{auth:{persistSession:false}}):null;
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST"||!admin||!anon)return reply({error:"Unavailable"},405);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const {data:u,error:ue}=await admin.auth.getUser(token);if(ue||!u.user)return reply({error:"Authentication required"},401);
  const caller=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
  const {data:allowed,error:ae}=await caller.rpc("current_account_allowed");if(ae||allowed!==true)return reply({error:"Access denied"},403);
  const {data:p,error:pe}=await admin.from("profiles").select("id,store_id,role").eq("id",u.user.id).maybeSingle();if(pe||!p?.store_id)return reply({error:"Access denied"},403);
  const store=Deno.env.get("WHATSAPP_STORE_ID")||"",phoneId=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")||"",access=Deno.env.get("WHATSAPP_ACCESS_TOKEN")||"",version=Deno.env.get("WHATSAPP_GRAPH_VERSION")||"",template=Deno.env.get("WHATSAPP_INVOICE_TEMPLATE")||"",language=Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE")||"";
  const configured=store===p.store_id&&/^\d+$/.test(phoneId)&&!!access&&/^v\d+\.\d+$/.test(version)&&/^[a-z0-9_]+$/.test(template)&&/^[a-z]{2}(_[A-Z]{2})?$/.test(language);
  if(!configured)return reply({configured:false,accepted:0});
  const stale=new Date(Date.now()-600000).toISOString();
  await admin.from("sales").update({whatsapp_delivery_state:"review",whatsapp_delivery_error:"Interrupted provider request; do not resend without checking."}).eq("store_id",store).eq("whatsapp_delivery_state","processing").lt("whatsapp_claimed_at",stale);
  const {data:shop,error:se}=await admin.from("stores").select("name").eq("id",store).maybeSingle();if(se||!shop)return reply({error:"Shop unavailable"},503);
  let q=admin.from("sales").select("id,invoice_no,customer_phone,total,status,created_by,whatsapp_consent_at").eq("store_id",store).eq("whatsapp_delivery_state","queued").not("whatsapp_consent_at","is",null).order("created_at").limit(10);
  if(p.role!=="owner")q=q.eq("created_by",p.id);
  const {data:rows,error:qe}=await q;if(qe)return reply({error:"Queue unavailable"},503);
  let accepted=0,review=0;
  for(const s of rows||[]){
   const {data:claim,error:ce}=await admin.from("sales").update({whatsapp_delivery_state:"processing",whatsapp_claimed_at:new Date().toISOString()}).eq("id",s.id).eq("store_id",store).eq("whatsapp_delivery_state","queued").select("id,status,customer_phone,total,invoice_no,created_by").maybeSingle();
   if(ce||!claim)continue;
   const finish=async(state:string,issue:string|null,id?:string)=>{const {error}=await admin!.from("sales").update({whatsapp_delivery_state:state,whatsapp_delivery_error:issue,...(id?{whatsapp_provider_id:id}:{})}).eq("id",s.id).eq("store_id",store).eq("whatsapp_delivery_state","processing");if(error)throw Error("Provider checkpoint failed");};
   try{
    if(claim.status==="Cancelled"){await finish("skipped","Invoice cancelled");continue;}
    if(Date.now()-Date.parse(s.whatsapp_consent_at)>7*86400000){await finish("review","Consent older than seven days; confirm again before sending");continue;}
    let digits=String(claim.customer_phone||"").replace(/[^0-9]/g,"");if(digits.length===10)digits="91"+digits;
    if(!/^91[6-9][0-9]{9}$/.test(digits)||!Number.isFinite(Number(claim.total))||Number(claim.total)<0||!claim.created_by){await finish("review","Receipt details need review");continue;}
    const bearer=hex(crypto.getRandomValues(new Uint8Array(32))),hash=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(bearer)))),now=new Date(),expires=new Date(now.valueOf()+6*86400000);
    const {error:le}=await admin.from("customer_share_links").insert({token_hash:hash,store_id:store,kind:"receipt",resource_id:s.id,created_by:claim.created_by,created_at:now.toISOString(),expires_at:expires.toISOString()});if(le)throw Error("Receipt link creation failed");
    const link=url+"/functions/v1/customer-share?token="+bearer;
    const parameters=[String(shop.name).replace(/[\r\n]/g," ").slice(0,80),String(claim.invoice_no).slice(0,100),"INR "+Number(claim.total).toFixed(2),link].map(text=>({type:"text",text}));
    const res=await fetch("https://graph.facebook.com/"+version+"/"+phoneId+"/messages",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:digits,type:"template",template:{name:template,language:{code:language},components:[{type:"body",parameters}]}}),signal:AbortSignal.timeout(25000)});
    const result=await res.json().catch(()=>null);const id=result?.messages?.[0]?.id;
    if(!res.ok||typeof id!=="string"||!id){await finish("review","Provider did not acknowledge request; review in Meta before retry");review++;continue;}
    await finish("accepted",null,id.slice(0,300));accepted++;
   }catch{try{await finish("review","Request not confirmed; check provider before retry");}catch{}review++;}
  }
  return reply({configured:true,accepted,review});
 }catch{return reply({error:"Worker unavailable; queued records retained"},503);}
});