import type {Database} from "../types";
import {round2} from "./indianCurrency";
import {previewSalesJournal,saleReceipts,isOnlinePayment,type JournalRow} from "./retailIntegrity";
function channel(method?:string){if(method==="Cash")return "Cash";if(isOnlinePayment(method))return "Online payment clearing";if(method==="Cheque")return "Cheque clearing";return null;}
export function buildAccountingReview(db:Database,date:string){
 const matches=(d:string)=>!date||d===date;
 const preview=previewSalesJournal(db.sales.filter(s=>matches(s.date)));
 const rows:JournalRow[]=[...preview.rows],issues=[...preview.issues];const seen=new Set<string>();
 const post=(source:string,d:string,kind:string,amount:number,debit:string|null,credit:string|null)=>{
 if(!matches(d))return;const key=kind+":"+source;
 if(seen.has(key)){issues.push(key+": duplicate source ID");return;}seen.add(key);
 if(!Number.isFinite(amount)||amount<0||!debit||!credit){issues.push(key+": amount or payment channel requires review");return;}
 const rounded=round2(amount);if(!rounded)return;
 rows.push({source:key,date:d,account:debit,debit:rounded,credit:0},{source:key,date:d,account:credit,debit:0,credit:rounded});
 };
 for(const p of db.purchases||[]){const credit=p.paymentStatus==="Paid Cash"?"Cash":p.paymentStatus==="Paid Online"?"Online payment clearing":p.paymentStatus==="Purchased on Credit (Udhaar)"?"Supplier payables":null;post(p.id,p.date,"Purchase",p.total,"Inventory purchases (gross)",credit);}
 for(const p of db.supplierPayments||[])post(p.id,p.date,"Supplier payment",p.amount,"Supplier payables",channel(p.method));
 for(const c of db.customers||[])for(const [index,p] of (c.payments||[]).entries())post(c.id+":"+index,p.date,"Customer collection",p.amount,channel(p.method),"Customer receivables");
 for(const [kind,list] of [["Shop expense",db.expenses?.shop||[]],["Personal withdrawal",db.expenses?.personal||[]],["Other expense",db.expenses?.other||[]]] as const)for(const e of list)post(e.id,e.date,kind,e.amount,kind==="Personal withdrawal"?"Owner drawings":kind,channel(e.method));
 for(const e of db.extraIncome||[])post(e.id,e.date,"Extra income",e.amount,channel(e.method),"Other income");
 for(const x of db.xeroxEntries||[])post(x.id,x.date,"Counter service",x.totalAmount,channel(x.paymentMethod),"Counter service revenue (gross)");
 for(const x of db.lenderTransactions||[]){const method=channel(x.method);if(x.type==="Additional Principal Taken")post(x.id,x.date,"Loan",x.amount,method,"Loan payable");else if(x.type==="Principal Repayment")post(x.id,x.date,"Loan",x.amount,"Loan payable",method);else if(x.type==="Interest Paid")post(x.id,x.date,"Loan",x.amount,"Interest expense",method);}
 for(const r of db.returns||[])if(matches(r.date))issues.push("Return "+r.returnNo+": tax and inventory reversal needs review");
 for(const x of db.exchanges||[])if(matches(x.date))issues.push("Exchange "+x.exchangeNo+": settlement and inventory reversal needs review");
 for(const j of db.jobs||[])if(matches(j.receivedDate)||!!j.deliveredDate&&matches(j.deliveredDate))issues.push("Repair "+j.jobNo+": advance and delivery postings need review");
 for(const x of db.secondHandKYCs||[])if(matches(x.date))issues.push("Buyback "+x.voucherNo+": inventory cost and payment needs review");
 const debit=round2(rows.reduce((a,r)=>a+r.debit,0)),credit=round2(rows.reduce((a,r)=>a+r.credit,0));
 return {rows,issues,debit,credit,difference:round2(debit-credit)};
}
export function paymentReview(db:Pick<Database,"sales"|"gallaClosings">,date:string){
 const sales=db.sales.filter(s=>s.date===date&&s.status!=="Cancelled");
 const received=sales.reduce((a,s)=>{const p=saleReceipts(s);return {cash:a.cash+p.cash,online:a.online+p.online};},{cash:0,online:0});
 const closing=(db.gallaClosings||[]).filter(x=>x.date===date).slice().sort((a,b)=>b.closedAt.localeCompare(a.closedAt))[0];
 const unallocated=sales.filter(s=>!s.isFinance&&Math.abs(round2(s.amountPaid)-round2(saleReceipts(s).cash+saleReceipts(s).online))>0.005).map(s=>s.invoiceNo);
 return {cash:round2(received.cash),online:round2(received.online),unallocated,closing:closing?{cashExpected:closing.expectedCash,cashCounted:closing.actualCashCounted,cashDifference:round2(closing.actualCashCounted-closing.expectedCash),onlineExpected:closing.expectedOnlinePayment,onlineCounted:closing.onlinePaymentReceived,onlineDifference:round2(closing.onlinePaymentReceived-closing.expectedOnlinePayment)}:null};
}
