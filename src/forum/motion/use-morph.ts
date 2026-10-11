import { useEffect, useState, useLayoutEffect, type RefObject } from "react";
import { useSpring, useTransform } from "motion/react";
import { useMotionPreferences } from "./motion-preferences";
import { clamp, ramp, motionTokens } from "./motion-tokens";
import type { Origin } from "./motion-origin";
export function useMorph(ref: RefObject<HTMLElement | null>, origin: Origin | null, open: boolean, onRest?: () => void, kind: "popover" | "dialog" = "dialog", restRadius = 24) {
 const { reduced }=useMotionPreferences();
 const progress=useSpring(0, kind === "dialog" ? motionTokens.spring.spatial : motionTokens.spring.surface);
 const [geometry,setGeometry]=useState({x:0,y:8,sx:.85,sy:.85,radius:24,width:0,height:0});
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;
  const measure=()=>{
   const width=el.offsetWidth,height=el.offsetHeight;if(!width||!height)return;
   const r=origin?.rect;
   const parent=el.offsetParent as HTMLElement|null;const pr=parent?.getBoundingClientRect();
   const fixed=getComputedStyle(el).position==="fixed";
   const left=kind==="dialog"?(innerWidth-width)/2:(fixed?0:(pr?.left||0))+el.offsetLeft;
   const top=kind==="dialog"?(innerHeight-height)/2:(fixed?0:(pr?.top||0))+el.offsetTop;
   setGeometry({x:r?r.left+r.width/2-left-width/2:0,y:r?r.top+r.height/2-top-height/2:8,sx:r?clamp(r.width/width,.06,2):.85,sy:r?clamp(r.height/height,.055,2):.85,radius:origin?.radius||24,width,height});
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(el);window.addEventListener("resize",measure);
  return()=>{observer.disconnect();window.removeEventListener("resize",measure);};
 },[origin,ref,kind]);
 useEffect(()=>{
  if(reduced){progress.jump(open?1:0);if(!open)onRest?.();}
  else if(!open&&progress.get()===0&&!progress.isAnimating())onRest?.();
  else progress.set(open?1:0);
 },[open,reduced,progress,onRest]);
 useEffect(()=>progress.on("animationComplete",()=>{if(!open&&Math.abs(progress.get())<.002)onRest?.();}),[open,onRest,progress]);
 const x=useTransform(progress,p=>reduced?0:geometry.x*(1-p));
 const y=useTransform(progress,p=>reduced?0:geometry.y*(1-p));
 const scaleX=useTransform(progress,p=>reduced?1:geometry.sx+(1-geometry.sx)*p);
 const scaleY=useTransform(progress,p=>reduced?1:geometry.sy+(1-geometry.sy)*p);
 const opacity=useTransform(progress,p=>reduced?p:ramp(p,0,.12));
 const borderRadius=useTransform(progress,p=>{
  const q=clamp(p),sx=geometry.sx+(1-geometry.sx)*q,sy=geometry.sy+(1-geometry.sy)*q;
  const radius=geometry.radius*(1-q)+restRadius*q;
  return `${radius/Math.max(.05,sx)}px / ${radius/Math.max(.05,sy)}px`;
 });
 const contentOpacity=useTransform(progress,p=>reduced?p:ramp(p,.36,.94));
 const contentFilter=useTransform(progress,p=>`blur(${reduced?0:(1-ramp(p,.3,.92))*3}px)`);
 const previewOpacity=useTransform(progress,p=>reduced?0:1-ramp(p,.06,.32));
 return {progress,geometry,style:{x,y,scaleX,scaleY,opacity,borderRadius,transformOrigin:"50% 50%"},contentStyle:{opacity:contentOpacity,filter:contentFilter},previewOpacity};
}
