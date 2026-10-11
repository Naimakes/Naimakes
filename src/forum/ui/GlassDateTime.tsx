import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import { useMotionPreferences } from "../motion/motion-preferences";
import { motionTokens, transitions } from "../motion/motion-tokens";
import "./date-time-picker.css";

type Parts = { y: number; m: number; d: number; h: number; mi: number };

const ROW = 36;
const rise = (order: number) => ({
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { ...transitions.surface, delay: 0.06 + order * motionTokens.stagger * 3 },
});
const pageSlide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 36, filter: "blur(3px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (dir: number) => ({ opacity: 0, x: dir * -36, filter: "blur(3px)" }),
};
const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const format = (p: Parts) => `${dayKey(p.y, p.m, p.d)}T${pad(p.h)}:${pad(p.mi)}`;

function parse(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  const [y, m, d, h, mi] = match.slice(1).map((n) => Number(n ?? 0));
  return { y, m, d, h: h || 0, mi: mi || 0 };
}

function Wheel({ label, unit, count, value, limit, onChange }: {
  label: string; unit: string; count: number; value: number; limit: number; onChange: (n: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paint = () => {
    const el = scroller.current;
    if (!el) return;
    const center = el.scrollTop / ROW;
    el.querySelectorAll<HTMLElement>("[data-i]").forEach((item) => {
      const d = Number(item.dataset.i) - center;
      const a = Math.min(Math.abs(d), 3);
      item.style.transform = `rotateX(${Math.max(-60, Math.min(60, -d * 20))}deg) scale(${1 - a * 0.07})`;
      item.style.opacity = String(Math.max(0.12, 1 - a * 0.3));
    });
  };
  const align = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - value * ROW) > 1) el.scrollTo({ top: value * ROW, behavior: smooth ? "smooth" : "auto" });
    paint();
  };
  useLayoutEffect(() => {
    align();
    const frame = requestAnimationFrame(() => align());
    return () => cancelAnimationFrame(frame);
  }, [value]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onChange((value + delta + count) % count);
  };
  return (
    <motion.div className="glass-wheel" whileHover={{ y: -1 }} transition={transitions.responsive}>
      <span className="glass-wheel-label">{label}</span>
      <div className="glass-wheel-window">
        <motion.span
          key={value}
          className="glass-wheel-lens"
          aria-hidden="true"
          initial={{ scaleX: 1.08, scaleY: 1.16 }}
          animate={{ scaleX: 1, scaleY: 1 }}
          transition={transitions.tactile}
        >
          <small>{unit}</small>
        </motion.span>
        <div
          ref={scroller}
          className="glass-wheel-track"
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={value}
          aria-valuetext={`${pad(value)} ${unit}`}
          onKeyDown={step}
          onScroll={() => {
            paint();
            if (settle.current) clearTimeout(settle.current);
            settle.current = setTimeout(() => {
              const el = scroller.current;
              if (!el) return;
              const index = Math.max(0, Math.min(count - 1, Math.round(el.scrollTop / ROW)));
              if (index !== value) onChange(index);
              else align(true);
            }, 110);
          }}
        >
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              data-i={i}
              data-current={i === value}
              data-off={i > limit}
              onClick={() => scroller.current?.scrollTo({ top: i * ROW, behavior: "smooth" })}
            >
              {pad(i)}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default function GlassDateTime({ label, value, max, min, fallbackTime = "00:00", granularity = "datetime", onChange }: {
  label: string; value: string; max: string; min?: string; fallbackTime?: string;
  granularity?: "datetime" | "date"; onChange: (next: string) => void;
}) {
  const dateOnly = granularity === "date";
  const field = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = parse(value);
  const limit = parse(max)!;
  const floor = min ? parse(min) : null;
  const anchor = floor || limit;
  const [view, setViewState] = useState({ y: (current || anchor).y, m: (current || anchor).m, dir: 0 });
  const setView = (next: { y: number; m: number }) => setViewState((old) => ({
    ...next,
    dir: next.y * 12 + next.m === old.y * 12 + old.m ? old.dir : next.y * 12 + next.m > old.y * 12 + old.m ? 1 : -1,
  }));
  const { reduced } = useMotionPreferences();
  const bubble = useId();
  const [fh, fmi] = fallbackTime.split(":").map(Number);
  const shown: Parts = current || (floor ? { ...floor } : { ...limit, h: fh, mi: fmi });

  const commit = (p: Parts) => {
    const full = format(p);
    const clamped = full > format(limit) ? format(limit) : floor && full < format(floor) ? format(floor) : full;
    onChange(dateOnly ? clamped.slice(0, 10) : clamped);
  };
  const toggle = () => {
    if (!open) setView(current ? { y: current.y, m: current.m } : { y: anchor.y, m: anchor.m });
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !field.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const shift = (delta: number) => {
    const date = new Date(view.y, view.m - 1 + delta, 1);
    setView({ y: date.getFullYear(), m: date.getMonth() + 1 });
  };
  const maxDay = max.slice(0, 10);
  const minDay = min ? min.slice(0, 10) : "";
  const today = dayKey(anchor.y, anchor.m, anchor.d);
  const first = new Date(view.y, view.m - 1, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(view.y, view.m - 1, 1 - first + i);
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  });
  const canNext = dayKey(view.y, view.m, 1) < dayKey(limit.y, limit.m, 1);
  const canPrev = !floor || dayKey(view.y, view.m, 1) > dayKey(floor.y, floor.m, 1);
  const onMaxDay = dayKey(shown.y, shown.m, shown.d) === maxDay;
  const blocked = (key: string) => key > maxDay || (!!minDay && key < minDay);
  const text = current
    ? dateOnly
      ? `${current.y}年${current.m}月${current.d}日`
      : `${current.y}年${current.m}月${current.d}日 ${pad(current.h)}:${pad(current.mi)}`
    : dateOnly
      ? "选择日期"
      : "选择日期和时间";

  return (
    <div className="glass-datetime" ref={field} data-empty={!current}>
      <button
        type="button"
        className="glass-datetime-value"
        aria-label={`${label}：${current ? text : "未设置"}`}
        onClick={toggle}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={text}
            style={{ display: "inline-block" }}
            initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
            transition={transitions.responsive}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </button>
      <AnimatePresence initial={false}>
        {current && (
          <motion.button
            type="button"
            className="glass-datetime-clear"
            aria-label={`清除${label}`}
            onClick={() => onChange("")}
            initial={{ opacity: 0, scale: 0.4, rotate: -90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.4, rotate: 90 }}
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.85 }}
            transition={transitions.tactile}
          >
            <X size={13} />
          </motion.button>
        )}
      </AnimatePresence>
      <LiquidButton
        type="button"
        className="glass-datetime-icon"
        aria-label={`打开${label}日历`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <motion.span
          style={{ display: "grid" }}
          animate={open ? { rotate: -12, scale: 1.08 } : { rotate: 0, scale: 1 }}
          transition={transitions.tactile}
        >
          <CalendarDays size={17} />
        </motion.span>
      </LiquidButton>
      <LiquidPopover
        open={open}
        native
        role="region"
        label={dateOnly ? `${label}日期` : `${label}日期和时间`}
        className="glass-datetime-popup"
        triggerRef={field}
        panelRef={panel}
        radius={28}
        avoidAnchor
        onClose={() => setOpen(false)}
      >
        <MotionConfig reducedMotion={reduced ? "always" : "never"}>
        <div
          className="glass-datetime-panel"
          onKeyDown={(event) => { if (event.key === "Tab") event.stopPropagation(); }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && !panel.current?.contains(next) && !field.current?.contains(next)) setOpen(false);
          }}
        >
          <motion.section className="glass-calendar" {...rise(0)}>
            <header>
              <span className="glass-calendar-title">
                <AnimatePresence mode="popLayout" initial={false} custom={view.dir}>
                  <motion.strong
                    key={`${view.y}-${view.m}`}
                    custom={view.dir}
                    variants={pageSlide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={transitions.responsive}
                  >
                    {view.y}年{view.m}月
                  </motion.strong>
                </AnimatePresence>
              </span>
              <div>
                <LiquidButton type="button" className="glass-calendar-nav" aria-label="上个月" disabled={!canPrev} onClick={() => shift(-1)}>
                  <ChevronLeft size={16} />
                </LiquidButton>
                <LiquidButton type="button" className="glass-calendar-nav" aria-label="下个月" disabled={!canNext} onClick={() => shift(1)}>
                  <ChevronRight size={16} />
                </LiquidButton>
              </div>
            </header>
            <div className="glass-calendar-weekdays" aria-hidden="true">
              {weekdays.map((w) => <span key={w} className="glass-calendar-weekday">{w}</span>)}
            </div>
            <div className="glass-calendar-page">
            <AnimatePresence mode="popLayout" initial={false} custom={view.dir}>
            <motion.div
              key={`${view.y}-${view.m}`}
              className="glass-calendar-grid"
              role="grid"
              aria-label={`${view.y}年${view.m}月`}
              custom={view.dir}
              variants={pageSlide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transitions.surface}
            >
              {cells.map((c, i) => {
                const key = dayKey(c.y, c.m, c.d);
                const picked = !!current && key === dayKey(current.y, current.m, current.d);
                return (
                  <motion.button
                    key={key}
                    type="button"
                    role="gridcell"
                    aria-selected={picked}
                    aria-label={`${c.y}年${c.m}月${c.d}日`}
                    disabled={blocked(key)}
                    data-outside={c.m !== view.m}
                    data-today={key === today}
                    onClick={() => {
                      if (c.m !== view.m) setView({ y: c.y, m: c.m });
                      commit({ ...shown, y: c.y, m: c.m, d: c.d });
                    }}
                    whileHover={blocked(key) ? undefined : { scale: 1.08 }}
                    whileTap={blocked(key) ? undefined : { scale: 0.86 }}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...transitions.tactile, delay: Math.min(i, 41) * 0.006 }}
                  >
                    {picked && (
                      <motion.span
                        layoutId={`glass-date-bubble-${bubble}`}
                        className="glass-calendar-bubble"
                        transition={transitions.responsive}
                      />
                    )}
                    <span className="glass-calendar-day">{c.d}</span>
                  </motion.button>
                );
              })}
            </motion.div>
            </AnimatePresence>
            </div>
          </motion.section>
          {!dateOnly && (
          <motion.section className="glass-wheels" aria-label="时间" {...rise(1)}>
            <Wheel
              label="小时"
              unit="时"
              count={24}
              value={shown.h}
              limit={onMaxDay ? limit.h : 23}
              onChange={(h) => commit({ ...shown, h })}
            />
            <Wheel
              label="分钟"
              unit="分"
              count={60}
              value={shown.mi}
              limit={onMaxDay && shown.h >= limit.h ? limit.mi : 59}
              onChange={(mi) => commit({ ...shown, mi })}
            />
          </motion.section>
          )}
          <motion.footer className="glass-datetime-actions" {...rise(2)}>
            <LiquidButton type="button" className="button secondary" onClick={() => { onChange(""); setOpen(false); }}>
              清除
            </LiquidButton>
            <div>
              <LiquidButton type="button" className="button secondary" onClick={() => { const edge = min || max; onChange(dateOnly ? edge.slice(0, 10) : edge); setView({ y: anchor.y, m: anchor.m }); }}>
                {min ? "最早" : dateOnly ? "今天" : "此刻"}
              </LiquidButton>
              <LiquidButton type="button" className="button primary" onClick={() => setOpen(false)}>
                完成
              </LiquidButton>
            </div>
          </motion.footer>
        </div>
        </MotionConfig>
      </LiquidPopover>
    </div>
  );
}
