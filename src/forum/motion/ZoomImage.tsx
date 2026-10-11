import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { X } from "lucide-react";
import { LiquidButton } from "./LiquidButton";
import { lockScroll } from "./OverlayHost";
import { focusQuietly } from "./quiet-focus";
import { clamp, motionTokens, transitions } from "./motion-tokens";
import { useMotionPreferences } from "./motion-preferences";

export function ZoomImage({ alt = "图片", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [open, setOpen] = useState(false), image = useRef<HTMLImageElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const { tactile } = useMotionPreferences();
  const x = useSpring(0, motionTokens.spring.surface), y = useSpring(0, motionTokens.spring.surface);
  const bounds = useRef<DOMRect | null>(null);
  return <span className="zoom-image">
    <LiquidButton ref={trigger} type="button" className="image-zoom-trigger" aria-label={`放大查看：${alt}`} aria-haspopup="dialog" onClick={() => { x.jump(0); y.jump(0); setOpen(true); }}
      onPointerEnter={(e) => { bounds.current = e.currentTarget.getBoundingClientRect(); }}
      onPointerMove={(e) => { if (!tactile || !bounds.current || open) return; const r = bounds.current; x.set(((e.clientX - r.left) / r.width - 0.5) * 2); y.set(((e.clientY - r.top) / r.height - 0.5) * 2); }}
      onPointerLeave={() => { x.set(0); y.set(0); }}>
      <motion.img {...props as any} ref={image} alt={alt} loading={props.loading || "lazy"} style={{ x, y }} />
      <span className="image-zoom-hint" aria-hidden="true">查看大图 ↗</span>
    </LiquidButton>
    {open && image.current && <SharedImage source={image.current} trigger={trigger.current} src={props.src} alt={alt} onClosed={() => setOpen(false)} />}
  </span>;
}

type Box = { left: number; top: number; width: number; height: number };
const GENERIC_ALT = new Set(["图片", "讨论图片"]);
const DISMISS_DISTANCE = 120, DISMISS_VELOCITY = 700, TAP_SLOP = 6;

function fitBox(source: HTMLImageElement, from: Box): Box {
  const compact = innerWidth <= 760;
  const padX = compact ? 12 : 56, padY = compact ? 68 : 64;
  const width = source.naturalWidth || from.width, height = source.naturalHeight || from.height;
  const scale = Math.min((innerWidth - padX * 2) / width, (innerHeight - padY * 2) / height, Math.max(1, from.width / width));
  const w = width * scale, h = height * scale;
  return { left: (innerWidth - w) / 2, top: (innerHeight - h) / 2, width: w, height: h };
}
function visibleBox(element: HTMLElement): Box | null {
  if (!element.isConnected) return null;
  const r = element.getBoundingClientRect();
  if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function SharedImage({ source, trigger, src, alt, onClosed }: { source: HTMLImageElement; trigger: HTMLButtonElement | null; src?: string; alt: string; onClosed: () => void }) {
  const { reduced } = useMotionPreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const from = useRef<Box>(visibleBox(source) || { left: innerWidth / 2 - 40, top: innerHeight / 2 - 40, width: 80, height: 80 });
  const settle = (box: Box): Box => ({ left: box.left + box.width * .02, top: box.top + box.height * .02, width: box.width * .96, height: box.height * .96 });
  const radius = useRef(parseFloat(getComputedStyle(source.closest(".image-zoom-trigger") || source).borderTopLeftRadius) || 16);
  const [to, setTo] = useState<Box>(() => fitBox(source, from.current));
  const target = useRef(to);
  target.current = to;
  const primed = useRef(false);
  if (reduced && !primed.current) from.current = settle(to);
  primed.current = true;
  const closing = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; t: number; vx: number; vy: number; moved: boolean } | null>(null);

  const progress = useMotionValue(0), dx = useMotionValue(0), dy = useMotionValue(0), layout = useMotionValue(0);
  useLayoutEffect(() => { layout.set(layout.get() + 1); }, [to]);
  const pull = useTransform(() => clamp(Math.hypot(dx.get(), dy.get() * 1.2) / (innerHeight * .6)));
  const transform = useTransform(() => {
    layout.get();
    const p = progress.get(), a = from.current, b = target.current;
    const w = a.width + (b.width - a.width) * p, h = a.height + (b.height - a.height) * p;
    const cx = a.left + a.width / 2 + (b.left + b.width / 2 - a.left - a.width / 2) * p;
    const cy = a.top + a.height / 2 + (b.top + b.height / 2 - a.top - a.height / 2) * p;
    const s = (1 - pull.get() * .28);
    return `translate(${cx - b.left - b.width / 2 + dx.get()}px, ${cy - b.top - b.height / 2 + dy.get()}px) scale(${(w / b.width) * s}, ${(h / b.height) * s})`;
  });
  const borderRadius = useTransform(() => {
    layout.get();
    const p = progress.get(), a = from.current, b = target.current;
    const screen = radius.current + (18 - radius.current) * clamp(p);
    const w = a.width + (b.width - a.width) * p;
    return `${screen / Math.max(.05, (w / b.width) * (1 - pull.get() * .28))}px`;
  });
  const veil = useTransform(() => clamp(progress.get()) * (1 - pull.get() * .85));
  const chrome = useTransform(() => clamp((progress.get() - .55) / .45) * (1 - clamp(pull.get() * 3)));

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    drag.current = null;
    const back = visibleBox(source), end = target.current;
    if (reduced) from.current = settle(end);
    else if (back) from.current = back;
    else from.current = { left: end.left + end.width * .4, top: end.top + end.height * .4, width: end.width * .2, height: end.height * .2 };
    const motion = reduced ? { duration: .16, ease: "easeOut" as const } : transitions.spatial;
    animate(dx, 0, motion); animate(dy, 0, motion);
    animate(progress, 0, { ...motion, onComplete: () => onClosed() });
  };

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const auto = document.activeElement;
    if (auto instanceof HTMLElement && element.contains(auto)) focusQuietly(auto);
    const unlock = lockScroll();
    source.style.visibility = "hidden";
    const cancel = (event: Event) => { event.preventDefault(); close(); };
    const resize = () => setTo(fitBox(source, from.current));
    element.addEventListener("cancel", cancel);
    addEventListener("resize", resize);
    const opening = animate(progress, 1, reduced ? { duration: .16, ease: "easeOut" } : transitions.spatial);
    return () => {
      opening.stop();
      element.removeEventListener("cancel", cancel);
      removeEventListener("resize", resize);
      source.style.visibility = "";
      element.close();
      unlock();
      if (trigger?.isConnected) focusQuietly(trigger);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (closing.current || event.button !== 0) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { }
    dx.stop(); dy.stop();
    drag.current = { id: event.pointerId, x: event.clientX - dx.get(), y: event.clientY - dy.get(), t: event.timeStamp, vx: 0, vy: 0, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const nx = event.clientX - active.x, ny = event.clientY - active.y, dt = Math.max(1, event.timeStamp - active.t);
    active.vx = active.vx * .6 + ((nx - dx.get()) / dt) * 1000 * .4;
    active.vy = active.vy * .6 + ((ny - dy.get()) / dt) * 1000 * .4;
    active.t = event.timeStamp;
    if (Math.hypot(nx, ny) > TAP_SLOP) active.moved = true;
    dx.set(nx); dy.set(ny);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLImageElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    drag.current = null;
    if (!active.moved) return close();
    const distance = Math.hypot(dx.get(), dy.get());
    const outward = (dx.get() * active.vx + dy.get() * active.vy) / Math.max(1, distance);
    if ((distance > DISMISS_DISTANCE && outward > -200) || outward > DISMISS_VELOCITY) return close();
    animate(dx, 0, { ...transitions.surface, velocity: active.vx });
    animate(dy, 0, { ...transitions.surface, velocity: active.vy });
  };

  const caption = !GENERIC_ALT.has(alt.trim()) ? alt : "";
  return createPortal(<dialog ref={dialog} className="shared-image" aria-label={alt}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <motion.div className="shared-image-veil" aria-hidden="true" style={{ opacity: veil }} onClick={close} />
    <motion.img src={src} alt={alt} draggable={false} className="shared-image-photo"
      style={{ left: to.left, top: to.top, width: to.width, height: to.height, transform, borderRadius }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; animate(dx, 0, transitions.surface); animate(dy, 0, transitions.surface); }} />
    <motion.div className="shared-image-chrome" style={{ opacity: chrome }}>
      <LiquidButton type="button" className="icon-button shared-image-close" aria-label="关闭大图" onClick={close}><X size={19} /></LiquidButton>
      {caption && <p className="shared-image-caption">{caption}</p>}
    </motion.div>
  </dialog>, document.body);
}
