import React,{useEffect,useState} from "react";
export function MoneyAnimation(){
 const [items,setItems]=useState<number[]>([]);
 useEffect(()=>{
  const tick=()=>{if(document.hidden||document.documentElement.dataset.retailMotion!=="cinematic"||window.matchMedia("(prefers-reduced-motion: reduce)").matches){setItems([]);return;}setItems(v=>[...v.slice(-2),Date.now()]);};
  const id=window.setInterval(tick,12000);return()=>window.clearInterval(id);
 },[]);
 return <>{items.map((id,i)=><span aria-hidden="true" key={id} className="money-float" style={{left:`${15+i*17}%`,top:`${58+i*5}%`,"--money-x":`${20+i*13}px`,pointerEvents:"none"} as React.CSSProperties}>₹</span>)}</>;
}
