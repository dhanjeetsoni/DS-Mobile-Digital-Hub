import {createClient} from "npm:@supabase/supabase-js@2";
import {verifyMetaSignature,deliveryEvents,constantEqual} from "./verify.ts";
const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",secret=Deno.env.get("WHATSAPP_APP_SECRET")||"",verify=Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN")||"",store=Deno.env.get("WHATSAPP_STORE_ID")||"",phone=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")||"";
const admin=url&&key?createClient(url,key,{auth:{persistSession:false}}):null;
const reply=(body:string,status=200)=>new Response(body,{status,headers:{"Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8"}});
Deno.serve(async req=>{
 if(!admin||!secret||!verify||!store||!phone)return reply("Webhook not configured",503);
 if(req.method==="GET"){const u=new URL(req.url),challenge=u.searchParams.get("hub.challenge")||"";return u.searchParams.get("hub.mode")==="subscribe"&&constantEqual(u.searchParams.get("hub.verify_token")||"",verify)&&/^\d{1,100}$/.test(challenge)?reply(challenge):reply("Forbidden",403);}
 if(req.method!=="POST")return reply("Method not allowed",405);
 try{const len=Number(req.headers.get("content-length")||0);if(len>524288)return reply("Too large",413);const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>524288)return reply("Too large",413);
 if(!await verifyMetaSignature(bytes,req.headers.get("x-hub-signature-256")||"",secret))return reply("Forbidden",403);
 const body=JSON.parse(new TextDecoder().decode(bytes)),events=deliveryEvents(body,phone);
 for(const e of events){const {error}=await admin.rpc("record_whatsapp_delivery_event",{p_store:store,p_provider_id:e.id,p_status:e.status,p_at:e.at});if(error)return reply("Retry later",503);}
 return reply("OK");
 }catch{return reply("Invalid or unavailable callback",400);}
});