
/** Preserve explicit zero for free services, reject malformed amounts and fractional paise. */
export function validMoney(value:unknown):value is number{
 if(typeof value!=="number"||!Number.isFinite(value)||value<0)return false;
 const paise=value*100;return Number.isSafeInteger(Math.round(paise))&&Math.abs(paise-Math.round(paise))<0.00001;
}
export function validStockQuantity(value:unknown,minimum=0):boolean{
 return typeof value==="number"&&Number.isSafeInteger(value)&&value>=minimum&&value<=2147483647;
}
export function stockDraftError(d:{quantity:number;minimumStock?:number;selling:number;purchase:number;confidential:number;mrp:number;minimumQuantity?:number}):string|null{
 if(!validStockQuantity(d.quantity,d.minimumQuantity??0)||!validStockQuantity(d.minimumStock??0))return "Stock quantity must be a non-negative whole number.";
 if(![d.selling,d.purchase,d.confidential,d.mrp].every(validMoney)||d.selling<=0)return "Enter valid prices (up to 2 decimal places) and a positive selling price.";
 if(d.confidential>0&&d.purchase>0&&d.confidential<d.purchase)return "Confidential price cannot be below purchase price.";
 if(d.confidential>d.selling)return "Selling price cannot be below confidential price.";
 return null;
}
export class LatestDraft{
 private generation=0;private open=false;private ready=false;
 begin(){this.open=true;this.ready=false;return ++this.generation;}
 current(id:number){return this.open&&id===this.generation;}
 markReady(id:number){if(!this.current(id))return false;this.ready=true;return true;}
 consume(){if(!this.open||!this.ready)return false;this.cancel();return true;}
 cancel(){this.open=false;this.ready=false;this.generation++;}
}
