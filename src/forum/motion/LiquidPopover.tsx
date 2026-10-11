import { placePopup } from "../ui/popup-placement";
import { GlassOptics, useGlassTracking } from "./GlassOptics";
import { Children, isValidElement, useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type ReactElement } from "react";
import { motion, useTransform, type MotionValue } from "motion/react";
import { registerSourceParent, measureOrigin, type Origin } from "./motion-origin";
import { useMorph } from "./use-morph";
import { ramp } from "./motion-tokens";
import { focusQuietly } from "./quiet-focus";

type Props = { open: boolean; children: ReactNode; className: string; triggerRef?: RefObject<HTMLElement | null>; onClose?: () => void; style?: CSSProperties; label?: string; role?: "menu" | "navigation" | "region"; point?: { x: number; y: number }; native?: boolean; panelRef?: RefObject<HTMLDivElement | null>; onExited?: () => void; radius?: number; avoidAnchor?: boolean; };
export function LiquidPopover(props: Props) {
  const [retained, setRetained] = useState(props.open);
  useLayoutEffect(() => { if (props.open) setRetained(true); }, [props.open]);
  const exitRef = useRef(props.onExited); exitRef.current = props.onExited;
  const finish = useCallback(() => { setRetained(false); exitRef.current?.(); }, []);
  return props.open || retained ? <PopoverSurface {...props} onRest={finish} /> : null;
}
function PopoverSurface({ open, children, className, triggerRef, onClose, onRest, style, label, role = "menu", point, native, panelRef, radius, avoidAnchor }: Props & { onRest: () => void }) {
  const ownRef = useRef<HTMLDivElement>(null), ref = panelRef || ownRef;
  const [origin, setOrigin] = useState<Origin | null>(null);
  const latest = useRef(onClose); latest.current = onClose;
  const floating = native || role === "menu" || role === "navigation";
  useLayoutEffect(() => {
    const panel = ref.current; if (!panel || !floating) return;
    const trigger = triggerRef?.current || panel.parentElement?.querySelector<HTMLElement>("[aria-expanded]") || null;
    if (!trigger && !point) return;
    const position = () => {
      const viewport = window.visualViewport;
      const anchor = point ? { left:point.x,top:point.y,width:0,height:0 } : trigger?.getBoundingClientRect();
      if (!anchor) return;
      const view = {left:viewport?.offsetLeft || 0,top:viewport?.offsetTop || 0,width:viewport?.width || innerWidth,height:viewport?.height || innerHeight};
      panel.style.position = "fixed"; panel.style.margin = "0"; panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.maxHeight = `${Math.min(typeof style?.maxHeight === "number" ? style.maxHeight : Infinity, Math.max(120,view.height-24))}px`; panel.style.maxWidth = `${view.width-24}px`;
      if (avoidAnchor && !point) {
        const below = view.top + view.height - 12 - (anchor.top + anchor.height + 8);
        const above = anchor.top - 8 - (view.top + 12);
        if (panel.scrollHeight > below && panel.scrollHeight > above) panel.style.maxHeight = `${Math.max(120, Math.max(below, above))}px`;
      }
      const next=placePopup(anchor,{width:panel.offsetWidth,height:panel.offsetHeight},view,point?0:8);
      panel.style.left=`${next.left}px`; panel.style.top=`${next.top}px`;
    };
    position(); const observer=new ResizeObserver(position);observer.observe(panel);
    window.addEventListener("resize",position); window.addEventListener("scroll",position,true); window.visualViewport?.addEventListener("resize",position);
    return()=>{observer.disconnect();window.removeEventListener("resize",position);window.removeEventListener("scroll",position,true);window.visualViewport?.removeEventListener("resize",position);};
  }, [floating, open, triggerRef, point?.x, point?.y, avoidAnchor]);
  useLayoutEffect(() => {
    const panel=ref.current;if(!panel||!open||!onClose||role==="region")return;
    const trigger=triggerRef?.current||panel.parentElement?.querySelector<HTMLElement>("[aria-expanded]")||null;
    const initialDialog=document.querySelector("dialog[open]:last-of-type");
    const outside=(event:PointerEvent)=>{if(document.querySelector("dialog[open]:last-of-type")!==initialDialog)return;if(!panel.contains(event.target as Node)&&!trigger?.contains(event.target as Node))latest.current?.();};
    document.addEventListener("pointerdown",outside,true);
    return()=>{document.removeEventListener("pointerdown",outside,true);if(panel.contains(document.activeElement)&&trigger)focusQuietly(trigger);};
  },[open,role,triggerRef]);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (floating && panel?.showPopover) { panel.showPopover(); return () => { if (panel.matches(":popover-open")) panel.hidePopover(); }; }
  }, [floating, ref]);
  useLayoutEffect(() => {
    const trigger = triggerRef?.current || ref.current?.parentElement?.querySelector<HTMLElement>("[aria-expanded]") || null;
    if (point) setOrigin({ rect: { left: point.x - 8, top: point.y - 8, width: 16, height: 16 }, radius: 8, element: null, fallback: trigger, snapshot: null });
    else setOrigin(measureOrigin(trigger));
    if (trigger && ref.current) return registerSourceParent(ref.current,trigger);
  }, [triggerRef, point?.x, point?.y, open]);
  const optical = useGlassTracking();
  const morph = useMorph(ref, origin, open, onRest, "popover", radius ?? 24);
  const shift = useTransform(morph.progress, (p) => (1 - ramp(p, 0.45, 1)) * -4);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || role !== "menu" || !open) return;
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    items.forEach((button, i) => { button.setAttribute("role", "menuitem"); button.tabIndex = i === 0 ? 0 : -1; button.style.setProperty("--item-index", String(i)); });
    if (items[0]) focusQuietly(items[0]);
  }, [open, role]);
  return <motion.div ref={ref} {...optical.handlers} popover={floating ? "manual" : undefined} role={role} aria-label={label} aria-hidden={!open} inert={!open} className={`${className} liquid-popover glass-popup`} style={{ ...style, ...morph.style }} data-state={open ? "open" : "closing"}
    onKeyDown={(e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); latest.current?.(); origin?.element?.focus({ preventScroll: true }); return; }
      if (e.key === "Tab") { latest.current?.(); return; }
      if (role !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((item, j) => { item.tabIndex = j === next ? 0 : -1; }); items[next].focus();
    }}>
    <GlassOptics/><motion.span className="glass-pointer-light" aria-hidden="true" style={{ background: optical.background }}/><motion.div className="liquid-popover-content" style={{ ...morph.contentStyle, y: shift }}>{Children.toArray(children).map((child, index) => <MenuChild key={isValidElement(child) ? child.key || index : index} progress={morph.progress} index={index}>{child}</MenuChild>)}</motion.div>
  </motion.div>;
}

function MenuChild({ children, progress, index }: { children: ReactNode; progress: MotionValue<number>; index: number }) {
  const offset = Math.min(index, 8) * 0.025;
  const opacity = useTransform(progress, (p) => ramp(p, 0.32 + offset, 0.78 + offset));
  if (!isValidElement(children)) return children;
  const child = children as ReactElement<{ style?: CSSProperties }>;
  return <motion.div className="liquid-menu-item" style={{ opacity }}>{child}</motion.div>;
}
