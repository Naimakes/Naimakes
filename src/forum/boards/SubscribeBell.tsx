import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { Bell, Plus } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { useMotionPreferences } from "../motion/motion-preferences";
import { motionTokens, transitions } from "../motion/motion-tokens";
import "./subscribe-bell.css";

export function SubscribeBell({
  subscribed,
  label,
  disabled,
  onToggle,
  size = 17,
  className = "",
}: {
  subscribed: boolean;
  label?: string;
  disabled?: boolean;
  onToggle: () => void;
  size?: number;
  className?: string;
}) {
  const hint = subscribed ? "关闭新帖提醒" : "开启新帖提醒";
  return (
    <LiquidButton
      type="button"
      className={`icon-button subscribe-bell ${subscribed ? "is-subscribed" : ""} ${className}`.trim()}
      aria-pressed={subscribed}
      aria-label={label ? `${hint}：${label}` : hint}
      data-tooltip={hint}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <BellGlyph active={subscribed} size={size} />
    </LiquidButton>
  );
}

function BellGlyph({ active, size }: { active: boolean; size: number }) {
  const { reduced, quality } = useMotionPreferences();
  const swing = useAnimationControls();
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current !== active && !reduced)
      swing.start(
        active
          ? { rotate: [0, -20, 15, -9, 5, 0], transition: { duration: 0.64, ease: "easeInOut" } }
          : { rotate: [0, 7, -3, 0], transition: { duration: 0.34, ease: "easeOut" } },
      );
    previous.current = active;
  }, [active, reduced, swing]);
  return (
    <motion.span className="bell-glyph" animate={swing} aria-hidden="true">
      <Bell size={size} strokeWidth={1.8} />
      <motion.span
        className="bell-fill"
        initial={false}
        animate={{ clipPath: active ? "inset(0% 0% 0% 0%)" : "inset(100% 0% 0% 0%)" }}
        transition={reduced ? { duration: 0 } : transitions.surface}
      >
        <Bell size={size} strokeWidth={1.8} fill="currentColor" />
      </motion.span>
      <AnimatePresence initial={false}>
        {!active && (
          <motion.span
            key="plus"
            className="bell-plus"
            initial={{ scale: 0, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0, rotate: 90 }}
            transition={transitions.tactile}
          >
            <Plus size={8} strokeWidth={3.4} />
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {active && quality === "full" && !reduced && (
          <motion.span
            key="halo"
            className="bell-halo"
            initial={{ opacity: 0.55, scale: 0.6 }}
            animate={{ opacity: 0, scale: 2.1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.overlay }}
          />
        )}
      </AnimatePresence>
    </motion.span>
  );
}
