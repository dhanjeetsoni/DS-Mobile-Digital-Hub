export type PostedAccount={account:string;opening_net:number;debit:number;credit:number;closing_net:number};
const classify=(a:string):string=>{if(["Cash","Online payment clearing","Collected payments clearing","Customer receivables","Inventory","Cheque clearing","Finance receivable","Bank (owner-confirmed)","Opening fixed assets"].includes(a))return "Assets";if(["Supplier payables","Tax payable","Opening loans payable"].includes(a))return "Liabilities";if(a==="Opening owner equity")return "Equity";if(a==="Owner drawings")return "Drawings";if(a==="Sales revenue")return "Revenue";if(["Cost of goods sold","Operating expenses","Finance dealer subvention"].includes(a))return "Expenses";return "Unclassified / review";};
const money=(x:number)=>Math.round((x+Number.EPSILON)*100)/100;
export function postedStatements(rows:PostedAccount[]){
 const accounts=rows.map(a=>({...a,group:classify(a.account),closingDebit:Math.max(Number(a.closing_net),0),closingCredit:Math.max(-Number(a.closing_net),0)}));
 const sum=(list:typeof accounts,fn:(a:typeof accounts[number])=>number)=>money(list.reduce((s,a)=>s+fn(a),0));
 const group=(name:string)=>accounts.filter(a=>a.group===name);
 const periodNet=(a:typeof accounts[number])=>Number(a.debit)-Number(a.credit);
 const revenue=-sum(group("Revenue"),periodNet),expenses=sum(group("Expenses"),periodNet);
 const assets=sum(group("Assets"),a=>Number(a.closing_net)),liabilities=-sum(group("Liabilities"),a=>Number(a.closing_net));
 const cumulativeResult=-sum([...group("Revenue"),...group("Expenses")],a=>Number(a.closing_net)),drawings=sum(group("Drawings"),a=>Number(a.closing_net));
 const openingEquity=-sum(group("Equity"),a=>Number(a.closing_net));
 const debit=sum(accounts,a=>a.closingDebit),credit=sum(accounts,a=>a.closingCredit);
 return {accounts,revenue,expenses,periodResult:money(revenue-expenses),assets,liabilities,openingEquity,cumulativeResult,drawings,residual:money(assets-liabilities-openingEquity-cumulativeResult+drawings),debit,credit,difference:money(debit-credit),unclassified:group("Unclassified / review")};
}
