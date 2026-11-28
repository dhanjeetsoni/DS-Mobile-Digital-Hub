import {useCallback,useEffect,useRef,useState} from "react";
export const CLOSE_MS=180;
export function useAnimatedClose(onClose:()=>void,ms:number=CLOSE_MS){
 const [closing,setClosing]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),locked=useRef(false),latest=useRef(onClose);
 latest.current=onClose;
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;locked.current=false;},[]);
 const runClosing=useCallback((after?:()=>void)=>{
  if(locked.current)return;locked.current=true;setClosing(true);
  const quiet=document.documentElement.dataset.retailMotion==="quiet"||window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  timer.current=setTimeout(()=>{timer.current=null;(after||latest.current)();},quiet?0:ms);
 },[ms]);
 const requestClose=useCallback(()=>runClosing(),[runClosing]);
 return {closing,requestClose,runClosing};
}
