export function settlementEvidence(input:{reference:string;date:string;saleDate:string;today:string;amount:string;expected:number;confirmed:boolean}):string|null{
 if(!input.confirmed)return "Confirm that you checked the actual bank credit.";
 if(!input.reference.trim()||input.reference.trim().length>120||/^BANK-UTR-\d+$/i.test(input.reference.trim()))return "Enter the actual bank transaction reference, not an invented UTR.";
 const date=input.date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<input.saleDate||date>input.today)return "Settlement date must be valid, on or after sale and not in the future.";
 const actual=Number(input.amount);
 if(!input.amount.trim()||!Number.isFinite(actual)||actual<=0||!Number.isFinite(input.expected)||input.expected<=0||Math.abs(actual-input.expected)>0.005)return "Bank credit does not match expected payout. Review the difference before marking fully settled.";
 return null;
}
export function recordedSettlementHasReference(ref?:string){return !!ref?.trim()&&!/^BANK-UTR-\d+$/i.test(ref.trim());}

export function duplicateSettlementReference(reference:string,invoiceId:string,sales:{id:string;financeDetails?:{utrRef?:string;payoutStatus?:string}}[]):boolean{const key=reference.trim().toUpperCase();return !!key&&sales.some(s=>s.id!==invoiceId&&s.financeDetails?.payoutStatus==="Settled in Bank"&&s.financeDetails?.utrRef?.trim().toUpperCase()===key);}
