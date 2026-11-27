import React, {useEffect,useReducer,useRef,useState} from "react";
import {X,Copy,Check,Delete,History,Calculator,ArrowLeft,Trash2} from "lucide-react";
import {calculatorReducer,initialCalculator,type CalcAction,type Retail,type Op} from "../utils/counterCalculator";
import "./CounterCalculatorModal.css";

interface CounterCalculatorModalProps {isOpen:boolean;onClose:()=>void;onApplyToSell?:(amount:number)=>void}
const keys: {label:string;name:string;action:CalcAction;kind?:string}[]=[
 {label:"AC",name:"All clear",action:{type:"clear"},kind:"utility"},
 {label:"±",name:"Change sign",action:{type:"sign"},kind:"utility"},
 {label:"%",name:"Percent",action:{type:"percent"},kind:"utility"},
 {label:"÷",name:"Divide",action:{type:"operator",op:"÷"},kind:"operator"},
 ...["7","8","9"].map(digit=>({label:digit,name:digit,action:{type:"digit" as const,digit}})),
 {label:"×",name:"Multiply",action:{type:"operator",op:"×"},kind:"operator"},
 ...["4","5","6"].map(digit=>({label:digit,name:digit,action:{type:"digit" as const,digit}})),
 {label:"−",name:"Subtract",action:{type:"operator",op:"-"},kind:"operator"},
 ...["1","2","3"].map(digit=>({label:digit,name:digit,action:{type:"digit" as const,digit}})),
 {label:"+",name:"Add",action:{type:"operator",op:"+"},kind:"operator"},
 {label:"⌫",name:"Backspace",action:{type:"backspace"},kind:"utility"},
 {label:"0",name:"0",action:{type:"digit",digit:"0"}},
 {label:".",name:"Decimal point",action:{type:"decimal"}},
 {label:"=",name:"Equals",action:{type:"equals"},kind:"equals"}
];
export const CounterCalculatorModal:React.FC<CounterCalculatorModalProps>=({isOpen,onClose,onApplyToSell})=>{
 const [state,dispatch]=useReducer(calculatorReducer,undefined,initialCalculator);
 const [panel,setPanel]=useState<"keypad"|"retail"|"history">("keypad");
 const [copyStatus,setCopyStatus]=useState("");
 const [rate,setRate]=useState("18");
 const dialog=useRef<HTMLDivElement>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
  if(!isOpen)return;
  const previous=document.activeElement as HTMLElement|null;
  dialog.current?.focus();
  const handler=(e:KeyboardEvent)=>{
   if(e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();closeRef.current();return;}
   if(e.key==="Tab"){
    const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),[tabindex='0']")||[]);
    const first=nodes[0],last=nodes[nodes.length-1];
    if(first&&last&&(e.shiftKey?(document.activeElement===first||document.activeElement===dialog.current):document.activeElement===last)){e.preventDefault();(e.shiftKey?last:first).focus();}
    return;
   }
   if(e.target instanceof HTMLInputElement)return;
   if(e.key==="Enter"&&e.target instanceof HTMLButtonElement)return;
   let action:CalcAction|undefined;
   if(/^\d$/.test(e.key))action={type:"digit",digit:e.key};
   else if(["+","-","*","/"].includes(e.key))action={type:"operator",op:(e.key==="*"?"×":e.key==="/"?"÷":e.key) as Op};
   else if(e.key==="Enter"||e.key==="=")action={type:"equals"};
   else if(e.key===".")action={type:"decimal"};
   else if(e.key==="%")action={type:"percent"};
   else if(e.key==="Backspace")action={type:"backspace"};
   else if(e.key==="Delete"||e.key.toLowerCase()==="c")action={type:"clear"};
   if(action){e.preventDefault();e.stopImmediatePropagation();dispatch(action);}
  };
  window.addEventListener("keydown",handler,true);
  return()=>{window.removeEventListener("keydown",handler,true);if(previous?.isConnected)previous.focus();};
 },[isOpen]);
 if(!isOpen)return null;
 const n=Number(state.display);
 const valid=state.display!=="Error"&&Number.isFinite(n);
 const apply=(kind:Retail,r:number)=>{dispatch({type:"retail",kind,rate:r});setPanel("keypad");};
 const copy=async()=>{try{await navigator.clipboard.writeText(state.display);setCopyStatus("Copied");}catch{setCopyStatus("Copy unavailable");}};
 const custom=rate.trim()!==""&&Number.isFinite(Number(rate))&&Number(rate)>=0&&Number(rate)<=100;
 return <div className="ds-calc-backdrop" onClick={onClose}>
  <div className="ds-calc" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Counter calculator" onClick={e=>e.stopPropagation()}>
   <header className="ds-calc-header"><div className="ds-calc-heading"><Calculator size={21}/><div><strong>Calculator</strong><small>Counter &amp; retail tools</small></div></div><button type="button" aria-label="Close calculator" className="ds-calc-icon" onClick={onClose}><X size={23}/></button></header>
   <div className="ds-calc-display"><div className="ds-calc-equation">{state.equation||"Ready"}</div><output data-testid="calculator-result" aria-live="polite" className="ds-calc-number" style={{fontSize:state.display.length>12?"clamp(22px,6vw,32px)":undefined}}>{state.display}</output><div className="ds-calc-display-tools"><button type="button" disabled={!valid} onClick={copy}>{copyStatus==="Copied"?<Check size={16}/>:<Copy size={16}/>} {copyStatus||"Copy result"}</button>{onApplyToSell&&valid&&n>0&&<button type="button" onClick={()=>{onApplyToSell(n);onClose();}}>Apply ₹{n} to POS</button>}</div></div>
   <nav className="ds-calc-tabs" aria-label="Calculator mode">{(["keypad","retail","history"] as const).map(p=><button type="button" key={p} aria-pressed={panel===p} onClick={()=>setPanel(p)}>{p==="keypad"?<Calculator size={15}/>:p==="history"?<History size={15}/>:null}{p==="keypad"?"Standard":p==="retail"?"GST & pricing":"History"}</button>)}</nav>
   {panel==="keypad"?<div className="ds-calc-grid">{keys.map(k=><button type="button" key={k.name} aria-label={k.name} className={"ds-calc-key "+(k.kind||"digit")} aria-pressed={k.action.type==="operator"?state.op===k.action.op:undefined} onClick={()=>{dispatch(k.action);setCopyStatus("");}}>{k.name==="Backspace"?<Delete size={23}/>:k.label}</button>)}</div>:panel==="retail"?<section className="ds-calc-panel">
    <strong>GST calculator</strong><small>Choose a rate; remove GST to recover the tax-exclusive base.</small>
    <div className="ds-calc-retail">{[5,12,18,28].flatMap(r=>[<button key={"a"+r} onClick={()=>apply("addGST",r)}>+{r}% GST</button>,<button key={"r"+r} onClick={()=>apply("removeGST",r)}>Remove {r}%</button>])}</div>
    <label>Custom rate (%)<input type="number" min="0" max="100" inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)}/></label>
    <div className="ds-calc-retail"><button disabled={!custom} onClick={()=>apply("addGST",Number(rate))}>Add GST</button><button disabled={!custom} onClick={()=>apply("removeGST",Number(rate))}>Remove GST</button><button disabled={!custom} onClick={()=>apply("markup",Number(rate))}>Add markup</button><button disabled={!custom||Number(rate)>=100} onClick={()=>apply("margin",Number(rate))}>Target gross margin</button><button onClick={()=>apply("markup",25)}>25% markup</button><button onClick={()=>apply("markup",35)}>35% markup</button></div>
    <small>Markup is a percentage of cost; gross margin is a percentage of the selling price. Rates are arithmetic tools, not tax advice.</small>
   </section>:<section className="ds-calc-panel"><div className="ds-calc-history-head"><strong>Recent calculations</strong><button type="button" disabled={!state.history.length} onClick={()=>dispatch({type:"clearHistory"})}><Trash2 size={15}/> Clear</button></div>{state.history.length?state.history.map((h,i)=><button className="ds-calc-history-item" key={i} type="button" onClick={()=>{dispatch({type:"recall",value:h.value});setPanel("keypad");}}><small>{h.label}</small><strong>{h.value}</strong></button>):<p>No calculations yet.</p>}</section>}
   <footer className="ds-calc-footer">{panel!=="keypad"?<button type="button" onClick={()=>setPanel("keypad")}><ArrowLeft size={15}/> Back to keypad</button>:<span>Standard calculator · keyboard supported</span>}</footer>
  </div>
 </div>;
};
