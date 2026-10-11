import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useMotionPreferences } from "./motion-preferences";
import "./text-disclosure.css";

const heightSpring = { type: "spring", visualDuration: 0.42, bounce: 0 } as const;

export function TextDisclosure({ children, lines = 2, open: controlled, onOpenChange, onActivate, className = "", textClassName = "", tabIndex }: {
  children: ReactNode;
  lines?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onActivate?: () => void;
  className?: string;
  textClassName?: string;
  tabIndex?: number;
}) {
  const { reduced } = useMotionPreferences();
  const id = useId();
  const clip = useRef<HTMLDivElement>(null), text = useRef<HTMLParagraphElement>(null);
  const [local, setLocal] = useState(false);
  const open = controlled ?? local;
  const [overflows, setOverflows] = useState(false);
  const bounds = useRef({ collapsed: 0, full: 0, lineHeight: 0 });
  const animation = useRef<AnimationPlaybackControls | null>(null);
  const target = useRef<number | null>(null);
  const height = useMotionValue(0);

  const progress = useTransform(() => {
    const { collapsed, full } = bounds.current;
    return full > collapsed ? Math.min(1, Math.max(0, (height.get() - collapsed) / (full - collapsed))) : 1;
  });
  const rotate = useTransform(progress, p => p * 180);
  const fade = useTransform(progress, p => p >= 1 ? "none"
    : `linear-gradient(to bottom, #000 calc(100% - ${(1 - p) * bounds.current.lineHeight * .75}px), rgb(0 0 0 / ${(.2 + p * .8).toFixed(3)}) 100%)`);

  const measure = useCallback(() => {
    const el = text.current;
    if (!el?.offsetHeight) return null;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
    const margins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    const full = el.offsetHeight + margins;
    const collapsed = Math.min(full, Math.ceil(lineHeight * lines + margins));
    bounds.current = { collapsed, full, lineHeight };
    return { collapsed, full };
  }, [lines]);

  const settle = useCallback((animated: boolean) => {
    const size = measure();
    if (!size) return;
    const next = open ? size.full : size.collapsed;
    setOverflows(size.full > size.collapsed + 1);
    const first = target.current === null, moving = !!animation.current && height.isAnimating();
    if (!reduced && next === target.current && (moving || height.get() === next)) return;
    target.current = next;
    if (!first && !reduced && (animated || moving)) {
      animation.current?.stop();
      animation.current = animate(height, next, heightSpring);
    } else {
      animation.current?.stop();
      animation.current = null;
      height.jump(next);
      if (clip.current) clip.current.style.height = `${next}px`;
    }
  }, [measure, open, reduced, height]);

  const previous = useRef(open);
  useLayoutEffect(() => {
    const changed = previous.current !== open;
    previous.current = open;
    settle(changed);
  }, [open, settle]);

  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    const observer = new ResizeObserver(() => settle(false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [settle]);
  useLayoutEffect(() => () => animation.current?.stop(), []);

  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setLocal(next);
    onOpenChange?.(next);
  };

  return <div className={`text-disclosure ${className}`} data-open={open || undefined} data-overflows={overflows || undefined}>
    <motion.div ref={clip} id={id} className="text-disclosure-clip" style={{ height, maskImage: overflows ? fade : "none", WebkitMaskImage: overflows ? fade : "none" }}
      data-activatable={onActivate ? "" : undefined}
      onClick={onActivate ? () => { if (window.getSelection()?.isCollapsed !== false) onActivate(); } : undefined}>
      <p ref={text} className={`text-disclosure-text ${textClassName}`}>{children}</p>
    </motion.div>
    {overflows && <button type="button" className="text-disclosure-toggle" aria-expanded={open} aria-controls={id} tabIndex={tabIndex}
      onClick={(event) => { event.stopPropagation(); toggle(); }}>
      <span>{open ? "收起说明" : "展开说明"}</span>
      <motion.span className="text-disclosure-chevron" aria-hidden="true" style={{ rotate }}><ChevronDown size={14} strokeWidth={1.8} /></motion.span>
    </button>}
  </div>;
}
