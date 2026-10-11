import { useEffect, useRef } from "react";
import { Heart, Bookmark } from "lucide-react";
import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
import { useMotionPreferences } from "./motion-preferences";
import { motionTokens, transitions } from "./motion-tokens";
export function MotionCount({ value }: { value: number }) {
  const { reduced } = useMotionPreferences();
  return <span className="motion-count" aria-label={String(value)}><AnimatePresence initial={false} mode="popLayout"><motion.span key={value} aria-hidden="true" initial={reduced ? false : { y: 9, opacity: 0, filter: "blur(2px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }} exit={{ y: -8, opacity: 0 }} transition={transitions.responsive}>{value}</motion.span></AnimatePresence></span>;
}
export function ReactionIcon({ active, kind = "like", size = 16 }: { active: boolean; kind?: "like" | "bookmark"; size?: number }) {
  const { reduced, quality } = useMotionPreferences();
  const previous = useRef(active), scale = useSpring(1, motionTokens.spring.tactile);
  const fill = useSpring(active ? 1 : 0, motionTokens.spring.surface);
  const clip = useTransform(fill, (v) => `inset(${(1 - Math.min(1, Math.max(0, v))) * 100}% 0 0 0)`);
  useEffect(() => {
    fill.set(active ? 1 : 0);
    if (previous.current !== active && !reduced) { scale.jump(0.72); scale.set(1); }
    previous.current = active;
  }, [active, reduced, scale, fill]);
  const Icon = kind === "like" ? Heart : Bookmark;
  return <motion.span className={`reaction-icon reaction-${kind}`} style={{ scale: reduced ? 1 : scale }} aria-hidden="true">
    <Icon size={size} /><motion.span className="reaction-fill" style={{ clipPath: reduced ? (active ? "inset(0)" : "inset(100% 0 0 0)") : clip }}><Icon size={size} fill="currentColor" /></motion.span>
    <AnimatePresence initial={false}>{active && quality === "full" && <motion.span key="halo" className="reaction-halo" initial={{ opacity: 0.7, scale: 0.6 }} animate={{ opacity: 0, scale: 1.9 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.duration.overlay }} />}</AnimatePresence>
  </motion.span>;
}
export function FollowLabel({ followed }: { followed: boolean }) {
  const { reduced } = useMotionPreferences();
  return <motion.span className="follow-label" layout="position" transition={transitions.responsive}><AnimatePresence initial={false} mode="popLayout"><motion.span key={String(followed)} initial={reduced ? false : { opacity: 0, y: 5, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -4 }} transition={transitions.responsive}>{followed ? "已关注" : "关注"}</motion.span></AnimatePresence></motion.span>;
}
