import React,{useEffect,useRef,useState} from "react";
import {supabase,isCloudConfigured} from "../services/supabaseClient";
import {inr,round2} from "../utils/indianCurrency";
import {todayStr} from "../utils/fifoEngine";
import {downloadCsv} from "../utils/csvExport";
type Line={account:string;debit:number;credit:number};
type Event={id:number;invoice_no:string;event_kind:"posting"|"reversal";effective_date:string;recorded_at:string;reverses_id:number|null;lines:Line[]};
type Report={events:Event[];total:number;truncated:boolean};
export function CloudPosJournal(){
 const [from,setFrom]=useState(todayStr()),[to,setTo]=useState(todayStr()),[invoice,setInvoice]=useState(""),[report,setReport]=useState<Report|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const current=useRef(0),inFlight=useRef(false);
 useEffect(()=>()=>{current.current++;},[]);
 const run=async(post:boolean)=>{
  if(!isCloudConfigured||inFlight.current)return;
  if(!from||!to||to<from||(Date.parse(to)-Date.parse(from))/86400000>92){setMessage("Choose a date range of at most 93 days.");return;}
  if(post&&(!invoice.trim()||!window.confirm("Post or reconcile this synchronized POS invoice? Corrections create new reversal entries; previous entries remain in history.")))return;
  const seq=++current.current;inFlight.current=true;setBusy(true);setReport(null);setMessage("");
  try{
   let notice="";
   if(post){const {data,error}=await supabase.rpc("post_pos_journal_invoice",{p_invoice_no:invoice.trim()});if(error)throw error;
    notice=data?.status==="posted"?String(data.events)+" journal events appended.":data?.status==="unchanged"?"No change; duplicate posting prevented.":String(data?.reason||"Record requires manual review.");}
   const {data,error}=await supabase.rpc("read_pos_journal",{p_from:from,p_to:to});if(error)throw error;
   if(seq===current.current){setReport(data as Report);setMessage(notice||"Server journal loaded.");}
  }catch{if(seq===current.current)setMessage("Unable to complete cloud journal request. Verify owner access and connection; reloading the journal is safe.");}
  finally{inFlight.current=false;if(seq===current.current)setBusy(false);}
 };
 const lines=report?.events.flatMap(e=>e.lines.map(l=>({...l,id:e.id,invoice:e.invoice_no,kind:e.event_kind,date:e.effective_date,reverse:e.reverses_id,recorded:e.recorded_at})))||[];
 const debit=round2(lines.reduce((a,l)=>a+Number(l.debit),0)),credit=round2(lines.reduce((a,l)=>a+Number(l.credit),0));
 const clear=()=>{setReport(null);setMessage("");};
 return <section className="section retail-finance-preview"><div className="section-head"><div><h2>Cloud POS journal · posted entries</h2><p className="hint">Owner-reviewed, persisted double-entry events derived from synchronized invoice and FIFO records. Reconcile a changed or cancelled invoice by its invoice number. Not a full general ledger or GST return.</p></div></div>
 {!isCloudConfigured?<p className="hint">Cloud connection required. Local transaction preview remains available below.</p>:<><div className="formgrid"><label className="field">Invoice number<input value={invoice} maxLength={150} disabled={busy} onChange={e=>setInvoice(e.target.value)} placeholder="Synchronized invoice number"/></label><label className="field">From<input type="date" value={from} disabled={busy} onChange={e=>{setFrom(e.target.value);clear();}}/></label><label className="field">To<input type="date" value={to} disabled={busy} onChange={e=>{setTo(e.target.value);clear();}}/></label></div>
 <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}><button type="button" className="btn primary" disabled={busy||!invoice.trim()} onClick={()=>void run(true)}>Post / reconcile invoice</button><button type="button" className="btn" disabled={busy} onClick={()=>void run(false)}>Load posted journal</button><button type="button" className="btn sm" disabled={busy||!lines.length||!!report?.truncated} onClick={()=>downloadCsv("cloud-pos-journal",["Event","Invoice","Type","Effective date","Recorded at","Reverses","Account","Debit","Credit"],lines.map(l=>[l.id,l.invoice,l.kind,l.date,l.recorded,l.reverse??"",l.account,l.debit,l.credit]))}>Export loaded range</button></div>
 {message&&<p className="hint" role="status">{message}</p>}
 {report&&<><p className="hint">{report.total} posted events in selected date range. {report.truncated?"Showing 500 latest events; narrow the range before exporting.":"All events in selected range loaded."}</p><div className="grid cols-3"><div className="card"><h3>Loaded debits</h3><div className="big">{inr(debit)}</div></div><div className="card"><h3>Loaded credits</h3><div className="big">{inr(credit)}</div></div><div className="card"><h3>Difference</h3><div className="big">{inr(round2(debit-credit))}</div></div></div><div className="table-wrap"><table><thead><tr><th>Event</th><th>Invoice / type</th><th>Effective date</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{lines.map((l,i)=><tr key={l.id+":"+i}><td>{l.id}{l.reverse?" (reverses "+l.reverse+")":""}</td><td>{l.invoice} · {l.kind}</td><td>{l.date}</td><td>{l.account}</td><td>{inr(Number(l.debit))}</td><td>{inr(Number(l.credit))}</td></tr>)}</tbody></table></div></>}
 <p className="hint">Only explicitly posted invoices are included. Split receipts without verified channel details use collected-payments clearing. Finance, returns, exchanges, missing FIFO cost and deleted source records require separate review. Reversal date is reconciliation date; replacement posting uses original invoice date. Review all periods before financial reporting.</p></>}
 </section>;
}
