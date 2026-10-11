import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useMotionPreferences } from "./motion-preferences";
import { transitions } from "./motion-tokens";

export type StatusState = { state: "busy" | "done" | "error"; at: number } | null;

const HOLD = 2200, FADE = 520, DOT = 28;

export function StatusPill({ status, labels, className = "" }: {
  status: StatusState;
  labels: { busy?: string; done: string; error: string };
  className?: string;
}) {
  const { reduced } = useMotionPreferences();
  const [phase, setPhase] = useState<"hidden" | "dot" | "pill">("hidden");
  useEffect(() => {
    if (!status) return;
    if (status.state === "busy") { setPhase("dot"); return; }
    setPhase("pill");
    const collapse = setTimeout(() => setPhase("dot"), HOLD);
    const hide = setTimeout(() => setPhase("hidden"), HOLD + FADE);
    return () => { clearTimeout(collapse); clearTimeout(hide); };
  }, [status]);
  const state = status?.state || "done";
  const label = state === "busy" ? labels.busy || "" : state === "done" ? labels.done : labels.error;
  const Icon = state === "busy" ? LoaderCircle : state === "done" ? Check : CircleAlert;
  const spring = reduced ? { duration: 0 } : transitions.responsive;
  return <span className={`status-pill-slot ${className}`} role="status" aria-live="polite">
    <AnimatePresence initial={false}>
      {phase !== "hidden" && <motion.span key="pill" className="status-pill" data-state={state}
        initial={reduced ? { opacity: 0, width: DOT } : { opacity: 0, scale: .4, width: DOT }}
        animate={{ opacity: 1, scale: 1, width: phase === "pill" ? "auto" : DOT }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .4 }}
        transition={spring}>
        <span className="status-pill-dot" aria-hidden="true"><Icon size={14} strokeWidth={2.2} className={state === "busy" ? "spin" : undefined} /></span>
        <motion.span className="status-pill-label" animate={{ opacity: phase === "pill" ? 1 : 0 }} transition={{ duration: phase === "pill" ? .22 : .12, delay: phase === "pill" ? .08 : 0 }}>{label}</motion.span>
      </motion.span>}
    </AnimatePresence>
  </span>;
}
