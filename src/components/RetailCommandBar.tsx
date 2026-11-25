import React,{useEffect,useRef,useState} from "react";
import {Search,Command,Star,History,Sun,Moon,X,ArrowRight} from "lucide-react";
import {useAppearance} from "../../theme/useAppearance";
type Tool={key:string;label:string;icon:React.ComponentType<{size?:number|string}>};
type Props={tools:Tool[];currentPage:string;onNavigate:(key:string)=>void};
const PIN_KEY="dsmdh_retail_favorites_v1";
function readPins():string[]{try{const v=JSON.parse(localStorage.getItem(PIN_KEY)||"[]");return Array.isArray(v)?v.filter((k:unknown)=>typeof k==="string").slice(0,20):[];}catch{return [];}}
export function RetailCommandBar({tools,currentPage,onNavigate}:Props){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[pins,setPins]=useState(readPins),[recent,setRecent]=useState<string[]>([]);
 const input=useRef<HTMLInputElement>(null), opener=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDivElement>(null);
 const mode=useAppearance(s=>s.mode),toggle=useAppearance(s=>s.toggleMode);
 const active=tools.find(t=>t.key===currentPage);
 const close=()=>{setOpen(false);setQuery("");requestAnimationFrame(()=>opener.current?.focus());};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"&&!document.querySelector(".modal")){e.preventDefault();setOpen(v=>!v);setQuery("");}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[]);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 useEffect(()=>{if(currentPage)setRecent(old=>[currentPage,...old.filter(k=>k!==currentPage)].slice(0,8));},[currentPage]);
 const normalized=query.trim().toLowerCase();
 const results=[...tools].sort((a,b)=>Number(pins.includes(b.key))-Number(pins.includes(a.key))||Number(recent.includes(b.key))-Number(recent.includes(a.key))).filter(t=>!normalized||t.label.toLowerCase().includes(normalized)||t.key.toLowerCase().includes(normalized));
 const go=(key:string)=>{close();onNavigate(key);};
 const pin=(key:string)=>{const next=pins.includes(key)?pins.filter(k=>k!==key):[...pins,key].slice(0,20);setPins(next);try{localStorage.setItem(PIN_KEY,JSON.stringify(next));}catch{}};
 return <div className="retail-command-bar">
   <div className="retail-page-title"><span>WORKSPACE</span><strong>{active?.label||"Counter"}</strong></div>
   <button type="button" ref={opener} className="retail-command-trigger" aria-label="Open global tool search" onClick={()=>{setOpen(true);setQuery("");}}><Search size={18}/><span>Search all tools and reports</span><kbd>Ctrl K</kbd></button>
   <button type="button" className="retail-theme-toggle" aria-label={mode==="light"?"Switch to dark mode":"Switch to light mode"} onClick={toggle}>{mode==="light"?<Moon size={19}/>:<Sun size={19}/>}</button>
   {open&&<div className="retail-command-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <div ref={dialog} className="retail-command-dialog" role="dialog" aria-modal="true" aria-label="Global tool search" onKeyDown={e=>{
      if(e.key==="Escape"){e.stopPropagation();close();}
      if(e.key==="Tab"){const f=Array.from(dialog.current?.querySelectorAll("button:not(:disabled),input")||[]) as HTMLElement[];if(f.length&&e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f[f.length-1].focus();}else if(f.length&&!e.shiftKey&&document.activeElement===f[f.length-1]){e.preventDefault();f[0].focus();}}
    }}>
      <div className="retail-command-input"><Search size={22}/><input ref={input} aria-label="Find a tool" placeholder="Find billing, stock, reports…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&results.length)go(results[0].key);}}/><button type="button" className="retail-icon-button" aria-label="Close global search" onClick={close}><X size={20}/></button></div>
      <div className="retail-command-hint"><History size={14}/> {normalized?results.length+" results":"Favorites and recent tools first"}<span><Command size={12}/> K</span></div>
      <div className="retail-command-results">{results.map(t=><div className="retail-command-row" key={t.key}><button type="button" className="retail-command-result" data-command-key={t.key} onClick={()=>go(t.key)}><span className="retail-tool-icon"><t.icon size={19}/></span><span>{t.label}</span><ArrowRight size={16}/></button><button type="button" aria-label={pins.includes(t.key)?"Unpin "+t.label:"Pin "+t.label} aria-pressed={pins.includes(t.key)} className="retail-icon-button" onClick={()=>pin(t.key)}><Star size={18} fill={pins.includes(t.key)?"currentColor":"none"}/></button></div>)}{!results.length&&<p className="retail-empty-search">No tools match your search.</p>}</div>
    </div>
   </div>}
 </div>;
}
export function RetailQuickRail({tools,currentPage,onNavigate}:Props){
 const keys=["dashboard","sell","products","xeroxGrid","imeiTracker","gallaClosing","jobs","khata","modelsearch","photoFinder","lowstock","salesToday"];
 const shortcuts=keys.map(k=>tools.find(t=>t.key===k)).filter((t):t is Tool=>!!t);
 return <nav className="retail-quick-rail" aria-label="Counter shortcuts">{shortcuts.map(t=><button type="button" key={t.key} onClick={()=>onNavigate(t.key)} aria-current={currentPage===t.key?"page":undefined} title={t.label}><span className="retail-quick-icon"><t.icon size={18}/></span><span>{t.label}</span></button>)}</nav>;
}
