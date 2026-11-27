import type {Database} from "../types";
import {round2} from "./indianCurrency";
export function recordedTaxReview(db:Pick<Database,"sales"|"returns"|"exchanges"|"purchases">,month:string){
 const rows:{reference:string;date:string;net:number;tax:number;gross:number}[]=[],issues:string[]=[];const seen=new Set<string>();
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return {rows,issues:["Select a valid month."],net:0,tax:0,gross:0,purchases:0};
 const matches=(d:string)=>d?.slice(0,7)===month;
 for(const s of db.sales.filter(s=>matches(s.date))){
  if(!s.id||seen.has(s.id)){issues.push(s.invoiceNo+": duplicate or missing invoice ID");continue;}seen.add(s.id);
  if(s.status==="Cancelled"){issues.push(s.invoiceNo+": cancellation requires tax-period review");continue;}
  if(s.taxAmount==null){issues.push(s.invoiceNo+": recorded tax amount absent");continue;}
  const {total,subtotal,discount,taxAmount}=s;
  if(![total,subtotal,discount,taxAmount].every(n=>Number.isFinite(n)&&n>=0)||discount>subtotal||round2(subtotal-discount+taxAmount)!==round2(total)){issues.push(s.invoiceNo+": inconsistent invoice tax amounts");continue;}
  rows.push({reference:s.invoiceNo,date:s.date,net:round2(subtotal-discount),tax:round2(taxAmount),gross:round2(total)});
 }
 for(const r of db.returns||[])if(matches(r.date))issues.push(r.returnNo+": credit-note/tax allocation not recorded");
 for(const r of db.exchanges||[])if(matches(r.date))issues.push(r.exchangeNo+": replacement tax allocation not recorded");
 const purchases=(db.purchases||[]).filter(p=>matches(p.date)).length;
 if(purchases)issues.push(purchases+" purchases: input tax credit not established from gross purchase records");
 return {rows,issues,net:round2(rows.reduce((a,r)=>a+r.net,0)),tax:round2(rows.reduce((a,r)=>a+r.tax,0)),gross:round2(rows.reduce((a,r)=>a+r.gross,0)),purchases};
}
