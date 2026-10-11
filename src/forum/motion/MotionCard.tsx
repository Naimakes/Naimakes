import { useRef, type ReactNode, type MouseEventHandler } from "react";
import { motion, useSpring, useMotionValue, useMotionTemplate } from "motion/react";
import { useMotionPreferences } from "./motion-preferences";
import { clamp, motionTokens, transitions } from "./motion-tokens";
export function MotionCard({ children, className = "", id, index = 0, onContextMenu }: { children: ReactNode; className?: string; id: string; index?: number; onContextMenu?: MouseEventHandler<HTMLElement> }) {
  const { reduced, tactile } = useMotionPreferences(), bounds = useRef<DOMRect | null>(null);
  const px = useMotionValue(50), py = useMotionValue(50), light = useSpring(0, motionTokens.spring.surface);
  const highlight = useMotionTemplate`radial-gradient(ellipse at ${px}% ${py}%, var(--glass-reflection), transparent 65%)`;
  return <motion.article className={`${className} motion-card`} data-post-id={id} data-motion-source="card" onContextMenu={onContextMenu}
    style={{ borderRadius: 24 }}
    initial={reduced ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.04 }}
    transition={{ ...transitions.surface, delay: Math.min(index, 4) * motionTokens.stagger }}
    onPointerEnter={(e) => { if (!tactile || e.pointerType !== "mouse") return; bounds.current = e.currentTarget.getBoundingClientRect(); light.set(1); }}
    onPointerMove={(e) => { if (!tactile || !bounds.current || e.pointerType !== "mouse") return; const r = bounds.current, u = clamp((e.clientX - r.left) / r.width), v = clamp((e.clientY - r.top) / r.height); px.set(u * 100); py.set(v * 100); }}
    onPointerLeave={() => { bounds.current = null; light.set(0); }}>
    {children}<motion.div className="card-reflection" aria-hidden="true" style={{ background: highlight, opacity: light }} />
  </motion.article>;
}
