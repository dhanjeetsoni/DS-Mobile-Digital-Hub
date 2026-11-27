export type Op = "+" | "-" | "×" | "÷";
export type Retail = "addGST" | "removeGST" | "markup" | "margin";
type History = { label: string; value: string };
export type CalcState = { display: string; left: number | null; op: Op | null; fresh: boolean; done: boolean; equation: string; repeat: {op: Op; right: number} | null; history: History[] };
export type CalcAction = {type:"digit";digit:string} | {type:"operator";op:Op} | {type:"retail";kind:Retail;rate:number} | {type:"recall";value:string} | {type:"decimal"|"equals"|"clear"|"backspace"|"percent"|"sign"|"clearHistory"};
export const initialCalculator = (): CalcState => ({display:"0",left:null,op:null,fresh:false,done:false,equation:"",repeat:null,history:[]});
const format = (n:number):string => Number.isFinite(n) ? String(Number(n.toPrecision(12))) : "Error";
const calculate = (a:number,op:Op,b:number):number => op==="+"?a+b:op==="-"?a-b:op==="×"?a*b:b===0?NaN:a/b;
const complete = (s:CalcState,n:number,label:string,repeat:CalcState["repeat"]=null):CalcState => {
  const value=format(n);
  return {...s,display:value,left:null,op:null,fresh:true,done:true,equation:label,repeat:value==="Error"?null:repeat,history:value==="Error"?s.history:[{label,value},...s.history].slice(0,30)};
};
export function calculatorReducer(s:CalcState,a:CalcAction):CalcState {
  if(a.type==="clear")return {...initialCalculator(),history:s.history};
  if(a.type==="clearHistory")return {...s,history:[]};
  if(a.type==="recall")return {...initialCalculator(),display:a.value,done:true,fresh:true,history:s.history};
  if(a.type==="digit"||a.type==="decimal"){
    const base=s.fresh||s.display==="Error"?"0":s.display;
    let value=base;
    if(a.type==="decimal"){if(!base.includes("."))value=base+".";}
    else if(/^\d$/.test(a.digit))value=base==="0"?a.digit:base==="-0"?"-"+a.digit:base.length<16?base+a.digit:base;
    return {...s,display:value,fresh:false,done:false,repeat:null,equation:s.op?s.equation:""};
  }
  if(s.display==="Error")return s;
  const n=Number(s.display);
  if(a.type==="backspace"){
    if(s.fresh)return {...s,display:"0",fresh:false,done:false,repeat:null,equation:s.op?s.equation:""};
    const v=s.display.slice(0,-1);
    return {...s,display:!v||v==="-"||v.includes("e")?"0":v,repeat:null};
  }
  if(a.type==="sign"){
    const base=s.op&&s.fresh?"0":s.display;
    return {...s,display:base.startsWith("-")?base.slice(1):"-"+base,fresh:false,done:false,repeat:null};
  }
  if(a.type==="operator"){
    const value=s.op&&s.left!==null&&!s.fresh?calculate(s.left,s.op,n):n;
    if(!Number.isFinite(value))return complete(s,value,"Cannot divide by zero or calculate this value");
    const display=format(value);
    return {...s,display,left:Number(display),op:a.op,fresh:true,done:false,equation:display+" "+a.op,repeat:null};
  }
  if(a.type==="percent"){
    const value=s.left!==null&&(s.op==="+"||s.op==="-")?s.left*n/100:n/100;
    return {...s,display:format(value),fresh:false,done:false,repeat:null};
  }
  if(a.type==="equals"){
    const op=s.op??s.repeat?.op;
    const left=s.op?s.left:n;
    const right=s.op?n:s.repeat?.right;
    if(!op||left===null||right===undefined)return s;
    return complete(s,calculate(left,op,right),format(left)+" "+op+" "+format(right)+" =",{op,right});
  }
  if(a.type==="retail"){
    if(!Number.isFinite(a.rate)||a.rate<0||a.rate>100||(a.kind==="margin"&&a.rate>=100))return s;
    const value=a.kind==="removeGST"?n/(1+a.rate/100):a.kind==="margin"?n/(1-a.rate/100):n*(1+a.rate/100);
    const label=a.kind==="removeGST"?"GST-exclusive base":a.kind==="addGST"?"Add GST":a.kind==="markup"?"Cost markup":"Gross margin";
    return complete(s,Math.round((value+Math.sign(value)*Number.EPSILON)*100)/100,format(n)+" · "+label+" "+a.rate+"% =");
  }
  return s;
}
