import {postedStatements,type PostedAccount} from "./postedStatements";
const paise=(value:unknown)=>{
 if(typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!value.trim())throw Error("Invalid money amount");
 const n=Number(value),p=Math.round(n*100);
 if(!Number.isFinite(n)||!Number.isSafeInteger(p)||Math.abs(n-p/100)>.000001)throw Error("Invalid ledger amount");
 return p;
};
export function reviewPostedAccounts(rows:PostedAccount[]){
 const seen=new Set<string>();let opening=0,debit=0,credit=0,closing=0;
 const issues:{account:string;issue:string}[]=[];
 const normalized:PostedAccount[]=[];
 for(const row of rows){
  if(!row||typeof row.account!=="string"||!row.account.trim()||seen.has(row.account)){issues.push({account:String(row?.account||"Unknown"),issue:"Missing or duplicate account"});continue;}
  seen.add(row.account);
  try{
   const [o,d,c,b]=[row.opening_net,row.debit,row.credit,row.closing_net].map(paise);
   if(d<0||c<0)throw Error("Negative debit or credit");
   if(o+d-c!==b)issues.push({account:row.account,issue:"Opening + debit - credit does not equal closing"});
   const totals=[opening+o,debit+d,credit+c,closing+b];
   if(!totals.every(Number.isSafeInteger))throw Error("Ledger total exceeds safe precision");
   [opening,debit,credit,closing]=totals;
   normalized.push({account:row.account,opening_net:o/100,debit:d/100,credit:c/100,closing_net:b/100});
  }catch(e){issues.push({account:row.account,issue:e instanceof Error?e.message:"Invalid ledger data"});}
 }
 if(opening!==0)issues.push({account:"Opening totals",issue:"Opening debits and credits differ"});
 if(debit!==credit)issues.push({account:"Period totals",issue:"Period debits and credits differ"});
 if(closing!==0)issues.push({account:"Closing totals",issue:"Closing debits and credits differ"});
 const statement=postedStatements(normalized);
 const exceptions=statement.accounts.filter(a=>a.group==="Unclassified / review"||a.group==="Assets"&&a.closing_net<0||a.group==="Liabilities"&&a.closing_net>0).map(a=>({account:a.account,issue:a.group==="Unclassified / review"?"Unclassified account: owner review required":"Unusual closing balance: verify source transactions"}));
 return {statement,issues,exceptions,totals:{opening:opening/100,debit:debit/100,credit:credit/100,closing:closing/100},valid:issues.length===0,hasOpening:seen.has("Opening owner equity"),empty:normalized.length===0};
}
export function postedBalanceSheetLines(report:ReturnType<typeof reviewPostedAccounts>):(string|number)[][]{
 const s=report.statement;
 const lines:(string|number)[][]=[];
 for(const group of ["Assets","Liabilities","Equity"]){for(const a of s.accounts.filter(x=>x.group===group))lines.push([group,a.account,group==="Assets"?a.closing_net:-a.closing_net]);}
 lines.push(["Equity","Cumulative posted result",s.cumulativeResult],["Equity","Less owner drawings",-s.drawings],["Total","Recorded assets",s.assets],["Total","Recorded liabilities and equity",s.liabilities+s.openingEquity+s.cumulativeResult-s.drawings],["Review","Unallocated residual",s.residual]);
 for(const a of s.unclassified)lines.push(["Unclassified / review",a.account,a.closing_net]);
 return lines;
}
