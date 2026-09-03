import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:corsHeaders});
function secret(){const r=Deno.env.get("SUPABASE_SECRET_KEYS");if(r){try{return JSON.parse(r).default}catch{}}return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";}
function pub(){const r=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");if(r){try{return JSON.parse(r).default}catch{}}return Deno.env.get("SUPABASE_ANON_KEY")||"";}
function esc(s:string){return s.replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)").replace(/[^\x20-\x7E]/g,"?");}
function pdf(lines:string[]){const body=["BT","/F1 10 Tf","40 800 Td",...lines.slice(0,48).flatMap((x,i)=>[i?"0 -16 Td":"",`(${esc(x).slice(0,105)}) Tj`]),"ET"].filter(Boolean).join("\n");const objs=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${body.length} >>\nstream\n${body}\nendstream`];let out="%PDF-1.4\n",offs:number[]=[0];for(let i=0;i<objs.length;i++){offs.push(out.length);out+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`;}const x=out.length;out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offs.length;i++)out+=`${String(offs[i]).padStart(10,"0")} 00000 n \n`;out+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;return new TextEncoder().encode(out);}
Deno.serve(async(req)=>{
  // Called directly from the browser as the offline-queue "client-pump"
  // (App.tsx), so it needs the same CORS preflight handling as the other
  // two functions — this was missing here too.
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
  try{
  const url=Deno.env.get("SUPABASE_URL")||"";
  const admin=createClient(url,secret());
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN");
  if(!token)return json({error:"TELEGRAM_BOT_TOKEN is not configured"},503);

  // Scheduler mode: a Postgres cron job (pg_cron + pg_net) calls this on a
  // fixed interval and cannot carry a real user session, so it authenticates
  // with a shared secret instead and sweeps every store's due messages.
  const cronSecret=Deno.env.get("CRON_SECRET")||"";
  const providedCronSecret=req.headers.get("x-cron-secret")||"";
  const isCronSweep=cronSecret.length>0 && providedCronSecret.length>0 && providedCronSecret===cronSecret;

  let storeFilter: string|null=null;
  if(!isCronSweep){
    const auth=req.headers.get("Authorization");
    if(!auth)return json({error:"Unauthorized"},401);
    const user=createClient(url,pub(),{global:{headers:{Authorization:auth}}});
    const {data:{user:u}}=await user.auth.getUser();
    if(!u)return json({error:"Unauthorized"},401);
    const {data:p}=await admin.from("profiles").select("store_id,role").eq("id",u.id).maybeSingle();
    if(!p?.store_id)return json({error:"Store membership not found"},403);
    storeFilter=p.store_id;
  }

  let q=admin.from("telegram_outbox").select("id,chat_id,message,attempts,sale_id,invoice_id,store_id").eq("status","pending").lte("next_attempt_at",new Date().toISOString()).order("created_at",{ascending:true}).limit(isCronSweep?50:20);
  if(storeFilter)q=q.eq("store_id",storeFilter);
  const {data:rows,error}=await q;
  if(error)throw error;let sent=0,failed=0;for(const row of rows||[]){try{const claim=await admin.from("telegram_outbox").update({status:"sending",attempts:Number(row.attempts||0)+1,last_attempt_at:new Date().toISOString()}).eq("id",row.id).eq("status","pending").select("id").maybeSingle();if(claim.error||!claim.data)continue;const sale=row.sale_id?(await admin.from("sales").select("invoice_no,customer_name,customer_phone,payment_method,total,created_at").eq("id",row.sale_id).maybeSingle()).data:null;const items=row.sale_id?(await admin.from("sale_items").select("quantity,unit_price,product_id,products(model,brand)").eq("sale_id",row.sale_id)).data||[]:[];const inv=row.invoice_id?(await admin.from("invoices").select("invoice_no").eq("id",row.invoice_id).maybeSingle()).data:null;const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:row.chat_id,text:row.message})});const b=await r.json().catch(()=>({}));if(!r.ok||!b.ok)throw new Error(b.description||`Telegram HTTP ${r.status}`);const lines=["DS MOBILE & DIGITAL HUB",`Invoice: ${inv?.invoice_no||sale?.invoice_no||"-"}`,`Date: ${sale?.created_at||"-"}`,`Customer: ${sale?.customer_name||"Walk-in"}`,`Phone: ${sale?.customer_phone||"-"}`,`Payment: ${sale?.payment_method||"-"}`,"Products:"];for(const i of items as any[])lines.push(`${i.products?.model||i.products?.brand||"Product"} x ${i.quantity} @ ${i.unit_price}`);lines.push(`Total: ${sale?.total??"-"}`);const f=new FormData();f.append("chat_id",row.chat_id);f.append("caption",`Invoice ${inv?.invoice_no||sale?.invoice_no||"-"}`);f.append("document",new Blob([pdf(lines)],{type:"application/pdf"}),`${inv?.invoice_no||sale?.invoice_no||"invoice"}.pdf`);const d=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:f});const db=await d.json().catch(()=>({}));if(!d.ok||!db.ok)throw new Error(db.description||`Telegram document HTTP ${d.status}`);await admin.from("telegram_outbox").update({status:"sent",sent_at:new Date().toISOString(),last_error:null,telegram_message_id:String(b.result?.message_id||db.result?.message_id||"")}).eq("id",row.id);sent++;}catch(e){failed++;const attempts=Number(row.attempts||0)+1;await admin.from("telegram_outbox").update({status:attempts>=8?"failed":"pending",next_attempt_at:new Date(Date.now()+Math.min(300000,2000*Math.pow(2,Math.max(0,attempts-1)))).toISOString(),last_error:String(e)}).eq("id",row.id);}}return json({sent,failed,processed:(rows||[]).length});}catch(e){return json({error:String(e)},500)}});