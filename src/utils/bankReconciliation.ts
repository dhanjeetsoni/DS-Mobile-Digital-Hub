import type {Sale} from "../types";
import {round2} from "./indianCurrency";
type Credit={reference:string;date:string;amount:number};
const key=(v:string)=>v.trim().toUpperCase();
export function parseBankCredits(input:string):{credits:Credit[];issues:string[]}{
 const credits:Credit[]=[],issues:string[]=[];
 if(input.length>500000)return {credits,issues:["Statement exceeds 500 KB; split it into smaller batches."]};
 const lines=input.replace(/^\uFEFF/,"").trim().split(/\r?\n/);
 if(!input.trim())return {credits,issues:[]};
 if(lines[0].trim().toLowerCase()!=="reference,date,credit")return {credits,issues:["Use header reference,date,credit (ISO date, plain decimal credit)."]};
 if(lines.length>5001)return {credits,issues:["Use at most 5,000 statement lines."]};
 for(let i=1;i<lines.length;i++){
  if(!lines[i].trim())continue;
  const cells=lines[i].split(",").map(x=>x.trim());
  const [reference,date,amount]=cells;
  if(cells.length!==3||!reference||reference.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!/^\d+(\.\d{1,2})?$/.test(amount)||!Number.isSafeInteger(Math.round(Number(amount)*100))||Number(amount)<=0){issues.push("Line "+(i+1)+": invalid reference, ISO date or credit.");continue;}
  credits.push({reference,date,amount:Number(amount)});
 }
 return {credits,issues};
}
export function reconcileBankCredits(sales:Sale[],credits:Credit[]){
 const expected=sales.filter(s=>s.status!=="Cancelled"&&s.isFinance&&s.financeDetails?.payoutStatus==="Settled in Bank");
 const groups=new Map<string,Credit[]>();for(const c of credits){const k=key(c.reference);groups.set(k,[...(groups.get(k)||[]),c]);}
 const counts=new Map<string,number>();for(const s of expected){const k=key(s.financeDetails?.utrRef||"");counts.set(k,(counts.get(k)||0)+1);}
 const matched=new Set<string>();
 const rows=expected.map(s=>{
  const f=s.financeDetails!,k=key(f.utrRef||""),credits=groups.get(k)||[];
  let status:string;
  if(!k||!Number.isFinite(f.netBankReceivable)||f.netBankReceivable<=0||!f.settlementDate)status="Missing settlement evidence";
  else if((counts.get(k)||0)>1||credits.length>1)status="Duplicate / batch reference — review";
  else if(!credits.length)status="Not found in imported statement";
  else if(round2(credits[0].amount)!==round2(f.netBankReceivable))status="Amount mismatch";
  else if(credits[0].date!==f.settlementDate)status="Date mismatch";
  else{status="Matched";matched.add(k);}
  return {invoice:s.invoiceNo,reference:f.utrRef||"",expected:f.netBankReceivable,credited:credits.length===1?credits[0].amount:null,status};
 });
 return {rows,unmatched:credits.filter(c=>!matched.has(key(c.reference))),matched:rows.filter(r=>r.status==="Matched").length};
}
