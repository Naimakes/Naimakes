import { GlassOptics, useGlassTracking } from "./GlassOptics";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { motion, useTransform } from "motion/react";
import { ArrowLeft, X } from "lucide-react";
import { LiquidButton } from "./LiquidButton";
import { recentOrigin, returnOrigin, type Origin } from "./motion-origin";
import { useMorph } from "./use-morph";
import { useMotionPreferences } from "./motion-preferences";
import { focusQuietly } from "./quiet-focus";

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  actions?: ReactNode;
  motionKey?: string;
  origin?: Origin | null;
  page?: boolean;
  resizable?: boolean;
  backLabel?: string;
};
type Entry = ModalProps & { key: string; owner: string; open: boolean; source: Origin | null };
let entries: Entry[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => entries;
let locks = 0, priorOverflow = "";
export function lockScroll() {
  if (locks++ === 0) { priorOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  return () => { if (--locks === 0) document.body.style.overflow = priorOverflow; };
}

const COMPACT_QUERY = "(max-width: 760px)";
const compactMedia = typeof window !== "undefined" ? matchMedia(COMPACT_QUERY) : null;
const subscribeCompact = (fn: () => void) => { compactMedia?.addEventListener("change", fn); return () => compactMedia?.removeEventListener("change", fn); };
export const useCompactScreen = () => useSyncExternalStore(subscribeCompact, () => !!compactMedia?.matches, () => false);

export function ModalRegistration(props: ModalProps) {
  const owner = useId(), key = useRef(owner), latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    const options = latest.current;
    const returning = entries.find((e) => !e.open && (e.motionKey || e.title) === (options.motionKey || options.title));
    key.current = returning?.key || owner;
    const entry: Entry = { ...options, owner, key: key.current, open: true, source: returning ? returning.source : options.origin === undefined ? recentOrigin() : options.origin };
    entries = returning ? entries.map((e) => e.key === key.current ? entry : e) : [...entries, entry];
    emit();
    return () => {
      entries = entries.map((e) => e.owner === owner ? { ...e, open: false, source: returnOrigin(e.source) } : e);
      emit();
    };
  }, [owner]);
  useLayoutEffect(() => {
    entries = entries.map((e) => e.owner === owner ? { ...e, ...props } : e);
    emit();
  });
  return null;
}

type Size = { width: number; height: number };
const MIN_WIDTH = 520, MIN_HEIGHT = 420, EDGE_GAP = 24;
const DIALOG_RADIUS = 26;
const sizeKey = (name: string) => "nmk-dialog-size:" + name;
function readSize(name: string): Size | null {
  try {
    const saved = JSON.parse(localStorage.getItem(sizeKey(name)) || "null");
    return saved && saved.width > 0 && saved.height > 0 ? saved : null;
  } catch {
    return null;
  }
}
const fitSize = (size: Size): Size => ({
  width: Math.round(Math.min(innerWidth - EDGE_GAP, Math.max(Math.min(MIN_WIDTH, innerWidth - EDGE_GAP), size.width))),
  height: Math.round(Math.min(innerHeight - EDGE_GAP, Math.max(Math.min(MIN_HEIGHT, innerHeight - EDGE_GAP), size.height))),
});
const handles = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
function useResizable(name: string, enabled: boolean, ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size | null>(() => (enabled ? readSize(name) : null));
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled || !size) return;
    const fit = () => setSize((current) => (current ? fitSize(current) : current));
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [enabled, !!size]);
  const start = (edge: (typeof handles)[number]) => (event: ReactPointerEvent<HTMLElement>) => {
    const dialog = ref.current;
    if (!dialog || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const from = { x: event.clientX, y: event.clientY, width: dialog.offsetWidth, height: dialog.offsetHeight };
    let latest: Size = { width: from.width, height: from.height };
    setActive(true);
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - from.x) * (edge.includes("e") ? 2 : edge.includes("w") ? -2 : 0);
      const dy = (e.clientY - from.y) * (edge.includes("s") ? 2 : edge.includes("n") ? -2 : 0);
      latest = fitSize({ width: from.width + dx, height: from.height + dy });
      setSize(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setActive(false);
      try { localStorage.setItem(sizeKey(name), JSON.stringify(latest)); } catch {}
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const reset = () => {
    setSize(null);
    try { localStorage.removeItem(sizeKey(name)); } catch {}
  };
  const nudge = (event: React.KeyboardEvent<HTMLElement>) => {
    const dialog = ref.current;
    const step = { ArrowRight: [48, 0], ArrowLeft: [-48, 0], ArrowDown: [0, 48], ArrowUp: [0, -48] }[event.key];
    if (!dialog || !step) return;
    event.preventDefault();
    const next = fitSize({ width: dialog.offsetWidth + step[0], height: dialog.offsetHeight + step[1] });
    setSize(next);
    try { localStorage.setItem(sizeKey(name), JSON.stringify(next)); } catch {}
  };
  return { size: enabled ? size : null, active, start, reset, nudge };
}

function GlassDialog({ entry }: { entry: Entry }) {
  const ref = useRef<HTMLDialogElement>(null), preview = useRef<HTMLDivElement>(null);
  const latest = useRef(entry); latest.current = entry;
  const { reduced, quality } = useMotionPreferences();
  const compact = useCompactScreen();
  const fullscreen = compact || !!entry.page;
  const resizable = !!entry.resizable && !fullscreen;
  const finish = useCallback(() => {
    const live = entries.find((e) => e.key === entry.key);
    if (!live || live.open) return;
    entries = entries.filter((e) => e.key !== entry.key); emit();
  }, [entry.key]);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const auto = document.activeElement;
    if (auto instanceof HTMLElement && dialog.contains(auto)) focusQuietly(auto);
    const unlock = lockScroll();
    const cancel = (e: Event) => { e.preventDefault(); if (latest.current.open) latest.current.onClose(); };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel); dialog.close(); unlock();
      const source = latest.current.source;
      const target = source?.element?.isConnected && !source.element.closest("[inert]") ? source.element : source?.fallback?.isConnected ? source.fallback : previous;
      if (target?.isConnected && !document.querySelector("dialog[open]:last-of-type")?.contains(document.activeElement)) focusQuietly(target);
    };
  }, []);
  const optical = useGlassTracking();
  const resize = useResizable(entry.motionKey || entry.title, !!entry.resizable, ref);
  const morph = useMorph(ref, entry.source, entry.open, finish, "dialog", fullscreen ? 0 : DIALOG_RADIUS);
  const backdrop = useTransform(morph.progress, (p) => Math.min(1, Math.max(0, p)) * (quality === "full" ? 1 : 0.85));
  useLayoutEffect(() => {
    if (!preview.current || !entry.source?.snapshot || reduced) return;
    const copy = entry.source.snapshot.cloneNode(true) as HTMLElement;
    copy.setAttribute("aria-hidden", "true"); copy.inert = true;
    preview.current.replaceChildren(copy);
  }, [entry.source, reduced]);
  const sourceWidth = entry.source?.rect.width || 1, sourceHeight = entry.source?.rect.height || 1;
  const sized = resize.size ? { width: resize.size.width, height: resize.size.height, maxWidth: "none", maxHeight: "none" } : null;
  return <motion.dialog ref={ref} {...optical.handlers}
    className={`modal liquid-dialog ${entry.wide ? "modal-wide" : ""} ${fullscreen ? "is-fullscreen" : ""} ${entry.page ? "is-page" : ""} ${resizable ? "is-resizable" : ""} ${resize.active ? "is-resizing" : ""} ${sized ? "is-sized" : ""} ${entry.className || ""}`}
    aria-label={entry.title} data-state={entry.open ? "open" : "closing"}
    style={{ ...morph.style, ...(sized && resizable ? sized : null), "--overlay-opacity": backdrop } as any}
    onClick={(e) => {
      if (e.target !== e.currentTarget || !entry.open || fullscreen) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) entry.onClose();
    }}>
    <GlassOptics/><motion.span className="glass-pointer-light" aria-hidden="true" style={{ background: optical.background }}/>
    {!reduced && entry.source?.snapshot && <motion.div className="morph-preview" aria-hidden="true" style={{ opacity: morph.previewOpacity }}>
      <div ref={preview} style={{ width: sourceWidth, height: sourceHeight, transformOrigin: "0 0", transform: `scale(${morph.geometry.width / sourceWidth}, ${morph.geometry.height / sourceHeight})` }} />
    </motion.div>}
    <motion.div className="modal-top" style={morph.contentStyle}>
      {fullscreen && <LiquidButton type="button" className={`modal-back ${entry.backLabel ? "button secondary" : "icon-button"}`} aria-label={entry.backLabel || "返回"} onClick={entry.onClose} disabled={!entry.open}><ArrowLeft size={18} />{entry.backLabel}</LiquidButton>}
      <span>{entry.title}</span>{entry.actions}
      {!fullscreen && <LiquidButton type="button" className="icon-button close-button" aria-label="关闭弹窗" onClick={entry.onClose} disabled={!entry.open}><X size={19} /></LiquidButton>}
    </motion.div>
    <motion.div className="modal-content" inert={!entry.open} style={morph.contentStyle}>{entry.children}</motion.div>
    {resizable && entry.open && handles.map((edge) => <span key={edge} className={`dialog-resize dialog-resize-${edge}`} aria-hidden={edge === "se" ? undefined : true}
      role={edge === "se" ? "separator" : undefined} aria-label={edge === "se" ? "调整窗口大小：拖动或使用方向键，双击恢复默认" : undefined} tabIndex={edge === "se" ? 0 : undefined}
      onPointerDown={resize.start(edge)} onDoubleClick={resize.reset} onKeyDown={edge === "se" ? resize.nudge : undefined} />)}
  </motion.dialog>;
}
export function OverlayHost() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return createPortal(<>{current.map((entry) => <GlassDialog key={entry.key} entry={entry} />)}</>, document.body);
}
