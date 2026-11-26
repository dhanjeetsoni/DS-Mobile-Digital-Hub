import React,{useState} from "react";
import {SlidersHorizontal,GripVertical,ChevronLeft,ChevronRight,Maximize2,Eye,EyeOff,RotateCcw} from "lucide-react";
import {normalizeMetrics,moveMetric,type MetricId,type MetricPreference} from "../utils/dashboardPreferences";
type Metric={id:MetricId;label:string;value:string;caption:string;className:string};
type Props={key?:string;scope:string;metrics:Metric[]};
const prefix="dsmdh_dashboard_layout_v1:";
function load(scope:string){try{return normalizeMetrics(JSON.parse(localStorage.getItem(prefix+scope)||"null"));}catch{return normalizeMetrics(null);}}
export function PersonalizedMetrics({scope,metrics}:Props){
 const [prefs,setPrefs]=useState<MetricPreference[]>(()=>load(scope));const [editing,setEditing]=useState(false);const [dragging,setDragging]=useState<MetricId|null>(null);
 const save=(next:MetricPreference[])=>{setPrefs(next);try{localStorage.setItem(prefix+scope,JSON.stringify(next));}catch{}};
 const update=(id:MetricId,field:"wide"|"hidden")=>save(prefs.map(p=>p.id===id?{...p,[field]:!p[field]}:p));
 return <section className="personalized-metrics" aria-label="Dashboard metrics">
  <div className="metric-toolbar"><strong>Business snapshot</strong><button type="button" className="btn sm" aria-expanded={editing} onClick={()=>setEditing(v=>!v)}><SlidersHorizontal size={14}/>{editing?"Done":"Customize dashboard"}</button>{editing&&<button type="button" className="btn sm" onClick={()=>save(normalizeMetrics(null))}><RotateCcw size={14}/>Reset layout</button>}</div>
  <div className="grid cols-4 retail-metrics metric-custom-grid">
   {prefs.map((pref,index)=>{const m=metrics.find(x=>x.id===pref.id);if(!m||pref.hidden&&!editing)return null;return <div key={m.id} data-metric-id={m.id} className={"card "+(m.id==="sales"?"accent ":"")+(pref.wide?"metric-wide ":"")+(pref.hidden?"metric-muted ":"")} draggable={editing} onDragStart={()=>setDragging(m.id)} onDragEnd={()=>setDragging(null)} onDragOver={e=>{if(editing)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(dragging)save(moveMetric(prefs,dragging,m.id));setDragging(null);}}>
    <h3>{m.label}</h3><div className={"big "+m.className}>{m.value}</div><div className="foot">{m.caption}</div>
    {editing&&<div className="metric-edit-controls"><GripVertical size={14}/><button type="button" aria-label={"Move "+m.label+" earlier"} disabled={index===0} onClick={()=>save(moveMetric(prefs,m.id,prefs[index-1].id))}><ChevronLeft size={16}/></button><button type="button" aria-label={"Move "+m.label+" later"} disabled={index===prefs.length-1} onClick={()=>save(moveMetric(prefs,m.id,prefs[index+1].id))}><ChevronRight size={16}/></button><button type="button" aria-label={"Resize "+m.label} aria-pressed={pref.wide} onClick={()=>update(m.id,"wide")}><Maximize2 size={16}/></button><button type="button" aria-label={(pref.hidden?"Show ":"Hide ")+m.label} aria-pressed={pref.hidden} onClick={()=>update(m.id,"hidden")}>{pref.hidden?<Eye size={16}/>:<EyeOff size={16}/>}</button></div>}
   </div>})}
  </div>
  {!editing&&prefs.every(p=>p.hidden)&&<div className="section">All metric cards hidden. Use Customize dashboard to restore them.</div>}
 </section>;
}
