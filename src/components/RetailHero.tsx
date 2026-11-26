import React from "react";
import { ArrowRight, ShoppingBag, PackageCheck, ScanLine, Sparkles, Receipt } from "lucide-react";

type Props={kind:"dashboard"|"sell"|"products";title:string;subtitle:string;detail:string;onPrimary?:()=>void;onSecondary?:()=>void;primaryLabel?:string;secondaryLabel?:string};
export function RetailHero({kind,title,subtitle,detail,onPrimary,onSecondary,primaryLabel,secondaryLabel}:Props){
 return <section className={"retail-hero retail-hero-"+kind} aria-label={title}>
  <div className="retail-hero-copy">
   <span className="retail-eyebrow"><Sparkles size={14}/> DS MOBILE · RETAIL STUDIO</span>
   <h2>{title}</h2><p>{subtitle}</p>
   <span className="retail-hero-detail">{detail}</span>
   {(onPrimary||onSecondary)&&<div className="retail-hero-actions">
    {onPrimary&&<button type="button" onClick={onPrimary} className="retail-action-primary">{primaryLabel}<ArrowRight size={17}/></button>}
    {onSecondary&&<button type="button" onClick={onSecondary} className="retail-action-secondary">{secondaryLabel}</button>}
   </div>}
  </div>
  <div className="retail-art" aria-hidden="true">
   <div className="retail-orbit retail-orbit-one"/><div className="retail-orbit retail-orbit-two"/>
   <div className="retail-pedestal"/>
   <div className="retail-phone"><div className="retail-phone-camera"/><div className="retail-phone-screen"><ShoppingBag size={36}/><i/><i/><i/><div className="retail-phone-tile"><Receipt size={18}/><span/></div></div></div>
   <div className="retail-float retail-float-stock"><PackageCheck size={26}/></div>
   <div className="retail-float retail-float-scan"><ScanLine size={24}/></div>
   <div className="retail-spark retail-spark-one">✦</div><div className="retail-spark retail-spark-two">✧</div>
  </div>
 </section>;
}
export type RetailMotion="cinematic"|"balanced"|"quiet";
const KEY="dsmdh_retail_motion_v1";
export function getRetailMotion():RetailMotion{try{const v=localStorage.getItem(KEY);return v==="cinematic"||v==="quiet"?v:"balanced";}catch{return "balanced";}}
export function applyRetailMotion(value:RetailMotion){document.documentElement.dataset.retailMotion=value;try{localStorage.setItem(KEY,value);}catch{}}
