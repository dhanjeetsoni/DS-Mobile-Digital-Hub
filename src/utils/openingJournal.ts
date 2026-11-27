export const OPENING_ACCOUNTS=[["Cash","debit"],["Bank (owner-confirmed)","debit"],["Inventory","debit"],["Customer receivables","debit"],["Finance receivable","debit"],["Opening fixed assets","debit"],["Supplier payables","credit"],["Tax payable","credit"],["Opening loans payable","credit"],["Opening owner equity","credit"]] as const;
export function validateOpening(values:Record<string,string>){
 const lines:{account:string;debit:number;credit:number}[]=[];let debit=0,credit=0,invalid=false;
 for(const [account,side] of OPENING_ACCOUNTS){const raw=(values[account]||"").trim();if(!raw)continue;if(!/^-?\d{1,13}(\.\d{1,2})?$/.test(raw)){invalid=true;continue;}const paise=Math.round(Number(raw)*100);if(!Number.isSafeInteger(paise)||Math.abs(paise)>100000000000000||(paise<0&&account!=="Opening owner equity")){invalid=true;continue;}if(!paise)continue;const isDebit=side==="debit"||paise<0;const n=Math.abs(paise);if(isDebit)debit+=n;else credit+=n;lines.push({account,debit:isDebit?n/100:0,credit:isDebit?0:n/100});}
 return {lines,debit:debit/100,credit:credit/100,valid:!invalid&&lines.length>=2&&debit===credit&&debit>0,invalid};
}
