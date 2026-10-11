import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { rememberOrigin } from "./motion-origin";
import { transitions } from "./motion-tokens";
type PreferencesValue = { quality: "full" | "lite"; reduced: boolean; tactile: boolean };
const Preferences = createContext<PreferencesValue>({ quality: "full", reduced: false, tactile: true });
export const useMotionPreferences = () => useContext(Preferences);
export function MotionProvider({ children }: { children: ReactNode }) {
 const [fine,setFine] = useState(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
 const [reduced,setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
 const [small,setSmall] = useState(() => matchMedia("(max-width: 720px)").matches);
 useEffect(() => {
  const entries: [string,(value:boolean)=>void][] = [["(hover: hover) and (pointer: fine)",setFine],["(prefers-reduced-motion: reduce)",setReduced],["(max-width: 720px)",setSmall]];
  const cleanups = entries.map(([query,set]) => { const media=matchMedia(query); const update=()=>set(media.matches); media.addEventListener("change",update); return ()=>media.removeEventListener("change",update); });
  const capture=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target.closest<HTMLElement>("[data-motion-source],button,a,[role=button]"):null;if(target&&!target.matches(":disabled"))rememberOrigin(target);};
  const pointer=()=>{document.documentElement.dataset.inputMode="pointer";};
  const keyboard=(event:KeyboardEvent)=>{if(!event.metaKey&&!event.ctrlKey&&!event.altKey)document.documentElement.dataset.inputMode="keyboard";};
  document.addEventListener("pointerdown",pointer,true);
  document.addEventListener("keydown",keyboard,true);
  document.addEventListener("click",capture,true);
  return ()=>{cleanups.forEach(fn=>fn());document.removeEventListener("click",capture,true);document.removeEventListener("pointerdown",pointer,true);document.removeEventListener("keydown",keyboard,true);};
 },[]);
 useEffect(()=>{document.documentElement.dataset.motion=reduced?"reduced":small?"lite":"full";},[reduced,small]);
 const value=useMemo<PreferencesValue>(()=>({quality:small?"lite":"full",reduced,tactile:fine&&!reduced}),[fine,reduced,small]);
 return <Preferences.Provider value={value}><MotionConfig reducedMotion="user" transition={transitions.responsive}>{children}</MotionConfig></Preferences.Provider>;
}
