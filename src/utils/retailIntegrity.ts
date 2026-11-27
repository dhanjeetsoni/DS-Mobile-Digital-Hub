import type {Database,Sale,Product,CartItem} from "../types";
import {round2} from "./indianCurrency";
export const activeSale=(s:Sale)=>s.status!=="Cancelled";
export const isOnlinePayment=(method?:string)=>["UPI","Card","Bank Transfer"].includes(method||"");
export function saleReceipts(s:Sale){
 if(!activeSale(s))return {cash:0,online:0};
 if(s.isFinance)return {cash:round2(s.financeDetails?.downPayment||0),online:0}; // existing checkout records finance down payment as cash
 if(s.splitPayments)return {cash:round2(s.splitPayments.cash),online:round2(s.splitPayments.upi+s.splitPayments.card)};
 const paid=round2(s.amountPaid??0);
 return {cash:s.payment==="Cash"?paid:0,online:isOnlinePayment(s.payment)?paid:0};
}
export function paymentAllocationValid(total:number,amounts:number[]){
 return Number.isFinite(total)&&total>=0&&amounts.every(n=>Number.isFinite(n)&&n>=0)&&Math.round(total*100)===amounts.reduce((a,n)=>a+Math.round(n*100),0);
}
export type JournalRow={source:string;date:string;account:string;debit:number;credit:number};
export function previewSalesJournal(sales:Sale[]){
 const rows:JournalRow[]=[];const issues:string[]=[];
 const seen=new Set<string>();
 for(const s of sales.filter(activeSale)){
  if(!s.id||seen.has(s.id)){issues.push(s.invoiceNo+": missing or duplicate sale ID");continue;}seen.add(s.id);
  if(![s.total,s.amountPaid,s.dueAmount,s.taxAmount??0].every(Number.isFinite)||!Array.isArray(s.items)||!s.items.length){issues.push(s.invoiceNo+": invalid or incomplete monetary data");continue;}
  const receipt=saleReceipts(s);const total=round2(s.total);const paid=round2(s.amountPaid);const tax=round2(s.taxAmount||0);const due=round2(s.dueAmount);
  if(s.isFinance){issues.push(s.invoiceNo+": finance settlement needs separate posting");continue;}
  if(!paymentAllocationValid(total,[paid,due])||!paymentAllocationValid(paid,[receipt.cash,receipt.online])||tax<0||tax>total||s.items.some(i=>!Number.isFinite(i.cost)||i.cost<0)){issues.push(s.invoiceNo+": review payment/tax/cost fields");continue;}
  const post=(account:string,debit:number,credit:number)=>{if(debit||credit)rows.push({source:s.invoiceNo,date:s.date,account,debit:round2(debit),credit:round2(credit)});};
  post("Cash",receipt.cash,0);post("Online payment clearing",receipt.online,0);post("Customer receivables",due,0);post("Sales revenue",0,total-tax);post("Tax payable",0,tax);
  const cost=round2(s.items.reduce((a,i)=>a+i.cost,0));post("Cost of goods sold",cost,0);post("Inventory",0,cost);
 }
 return {rows,issues};
}
export function suggestCompatibleAccessories(products:Product[],cart:CartItem[],available:(p:Product)=>number){
 const phones=cart.filter(c=>c.isMobilePhone||["New Mobile","Second-Hand Mobile"].includes(c.category)).map(c=>products.find(p=>p.id===c.productId)).filter((p):p is Product=>!!p);
 const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
 const modelKeys=new Set(phones.flatMap(p=>[p.name,...(p.compatibleModels||[])].map(norm)).filter(x=>x.length>=4));
 if(!modelKeys.size)return [];
 return products.filter(p=>!p.isMobilePhone&&/glass|cover|case|charger|cable/i.test(p.category)&&!cart.some(c=>c.productId===p.id)&&available(p)>0&&(p.compatibleModels||[]).some(m=>modelKeys.has(norm(m)))).slice(0,6);
}
export function supplierComparison(db:Pick<Database,"purchases">,productId:string){
 const map=new Map<string,{name:string;quantity:number;total:number;lastDate:string}>();
 for(const p of db.purchases){if(p.productId!==productId||!p.supplier?.trim()||p.qty<=0||!Number.isFinite(p.total)||p.total<0)continue;const name=p.supplier.trim();const key=p.supplierId||name.toLowerCase();const row=map.get(key)||{name,quantity:0,total:0,lastDate:""};row.quantity+=p.qty;row.total+=p.total;if(p.date>row.lastDate)row.lastDate=p.date;map.set(key,row);}
 return [...map.values()].map(x=>({...x,average:round2(x.total/x.quantity)})).sort((a,b)=>a.average-b.average);
}
export function upcomingSupplierDues(db:Pick<Database,"suppliers">,today:string){
 return db.suppliers.filter(s=>s.totalPayable>0).map(s=>({id:s.id,name:s.name,amount:round2(s.totalPayable),date:s.nextRepaymentDueDate||"",overdue:!!s.nextRepaymentDueDate&&s.nextRepaymentDueDate<today})).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
}

export function validateDeviceIdentifiers(first:string,second:string,existing:{imei1:string;imei2?:string}[]):string|null{
 const a=first.trim(),b=second.trim();
 if(!/^\d{15}$/.test(a)||b&&!/^\d{15}$/.test(b))return "IMEI must contain exactly 15 digits.";
 if(b&&a===b)return "IMEI 1 and IMEI 2 must be different.";
 const used=new Set(existing.flatMap(u=>[u.imei1.trim(),u.imei2?.trim()]).filter(Boolean));
 if(used.has(a)||b&&used.has(b))return "This IMEI is already registered. Check both SIM slots.";
 return null;
}

export function validatePhoneRegistrationPrices(p:{purchaseCost:number;confidentialPrice:number;sellingPrice:number;mrp:number;warrantyMonths:number}):string|null{
 const prices=[p.purchaseCost,p.confidentialPrice,p.sellingPrice,p.mrp];
 if(prices.some(v=>!Number.isFinite(v)||v<0||Math.abs(v-round2(v))>1e-8))return "Enter valid, non-negative prices with at most two decimals.";
 if(p.sellingPrice<=0)return "Enter a positive selling price.";
 if(p.confidentialPrice>0&&p.confidentialPrice<p.purchaseCost)return "Confidential price cannot be below purchase cost.";
 if(p.sellingPrice<Math.max(p.purchaseCost,p.confidentialPrice))return "Selling price cannot be below purchase cost or confidential price.";
 if(p.mrp>0&&p.sellingPrice>p.mrp)return "Selling price cannot exceed the entered MRP.";
 if(!Number.isSafeInteger(p.warrantyMonths)||p.warrantyMonths<0)return "Warranty months must be a non-negative whole number.";
 return null;
}
