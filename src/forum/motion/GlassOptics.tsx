import { useRef } from "react";
import { useMotionTemplate, useSpring } from "motion/react";
import { motionTokens, clamp } from "./motion-tokens";
export function GlassOptics() {
  return <span className="glass-refraction" aria-hidden="true"/>;
}
export function useGlassTracking() {
  const bounds = useRef<DOMRect | null>(null), x = useSpring(25,motionTokens.spring.surface), y = useSpring(0,motionTokens.spring.surface);
  const background = useMotionTemplate`radial-gradient(ellipse at ${x}% ${y}%, var(--glass-reflection), transparent 65%)`;
  return { background, handlers: {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { bounds.current = event.currentTarget.getBoundingClientRect(); },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => { if (!bounds.current || event.pointerType !== "mouse") return; const rect = bounds.current; x.set(clamp((event.clientX-rect.left)/rect.width)*100); y.set(clamp((event.clientY-rect.top)/rect.height)*100); },
    onPointerLeave: () => { x.set(25); y.set(0); },
  } };
}
