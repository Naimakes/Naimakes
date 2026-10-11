import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert } from "lucide-react";
import { GlassOptics } from "../motion/GlassOptics";
import { useMotionPreferences } from "../motion/motion-preferences";
import "./validation-hint.css";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (node: EventTarget | null): node is Field =>
  node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;

const claimed = new WeakSet<Element>();
export function validationHandled(field: EventTarget | null) {
  if (field instanceof Element) claimed.add(field);
}

const plural = (field: Field) => (field instanceof HTMLSelectElement ? "选择" : "填写");
export function validationText(field: Field): string {
  const v = field.validity;
  const length = field.value.length;
  if (v.customError) return field.validationMessage;
  if (v.valueMissing) {
    if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) return "这一项需要先勾选。";
    return `这里还没有${plural(field)}。`;
  }
  if (v.typeMismatch && field instanceof HTMLInputElement) {
    if (field.type === "email") return "邮箱地址还不完整，比如 you@example.com。";
    if (field.type === "url") return "请填写完整网址，以 https:// 开头。";
    return "这里的格式还不对。";
  }
  if (!(field instanceof HTMLSelectElement)) {
    if (v.tooShort) return `至少要 ${field.minLength} 个字，现在有 ${length} 个。`;
    if (v.tooLong) return `最多 ${field.maxLength} 个字，现在有 ${length} 个。`;
  }
  if (v.patternMismatch) return field.title || "这里的格式和要求的不一样。";
  if (v.rangeUnderflow && field instanceof HTMLInputElement) return `不能小于 ${field.min}。`;
  if (v.rangeOverflow && field instanceof HTMLInputElement) return `不能大于 ${field.max}。`;
  if (v.stepMismatch) return "这个数值不在允许的间隔上。";
  if (v.badInput) return "这里的内容没能读懂，重新写一次吧。";
  return field.validationMessage || "这里还需要再看一眼。";
}

type Hint = { id: number; field: Field; message: string };
type Place = { id: number; left: number; top: number; arrow: number; side: "top" | "bottom" };
const GAP = 10, MARGIN = 12, ARROW_INSET = 22;

export function ValidationHintHost() {
  const [hint, setHint] = useState<Hint | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPreferences();

  useEffect(() => {
    let sequence = 0, pending: Field | null = null;
    const onInvalid = (event: Event) => {
      const field = event.target;
      if (!isField(field)) return;
      event.preventDefault();
      if (pending) return;
      pending = field;
      queueMicrotask(() => {
        const target = pending;
        pending = null;
        if (!target || !target.isConnected) return;
        if (claimed.has(target)) { claimed.delete(target); return; }
        setHint({ id: ++sequence, field: target, message: validationText(target) });
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      });
    };
    document.addEventListener("invalid", onInvalid, true);
    return () => document.removeEventListener("invalid", onInvalid, true);
  }, [reduced]);

  useEffect(() => {
    if (!hint) return;
    const close = () => setHint((current) => (current?.id === hint.id ? null : current));
    const field = hint.field;
    const timer = setTimeout(close, 5200);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointer = (event: PointerEvent) => {
      if (!field.contains(event.target as Node) && !ref.current?.contains(event.target as Node)) close();
    };
    field.addEventListener("input", close);
    field.addEventListener("change", close);
    field.addEventListener("blur", close);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(timer);
      field.removeEventListener("input", close);
      field.removeEventListener("change", close);
      field.removeEventListener("blur", close);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [hint]);

  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!hint || !bubble) return;
    const position = () => {
      const anchor = hint.field.getBoundingClientRect();
      const width = bubble.offsetWidth, height = bubble.offsetHeight;
      const view = window.visualViewport;
      const viewLeft = view?.offsetLeft || 0, viewTop = view?.offsetTop || 0;
      const viewWidth = view?.width || innerWidth, viewHeight = view?.height || innerHeight;
      const below = anchor.bottom + GAP;
      const flip = below + height > viewTop + viewHeight - MARGIN && anchor.top - GAP - height >= viewTop + MARGIN;
      const top = flip ? anchor.top - GAP - height : below;
      const maxLeft = Math.max(viewLeft + MARGIN, viewLeft + viewWidth - width - MARGIN);
      const left = Math.min(maxLeft, Math.max(viewLeft + MARGIN, anchor.left + anchor.width / 2 - width / 2));
      const arrow = Math.min(Math.max(ARROW_INSET, anchor.left + anchor.width / 2 - left), Math.max(ARROW_INSET, width - ARROW_INSET));
      setPlace((current) =>
        current && current.id === hint.id && current.left === left && current.top === top && current.arrow === arrow && current.side === (flip ? "top" : "bottom")
          ? current
          : { id: hint.id, left, top, arrow, side: flip ? "top" : "bottom" });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(bubble);
    observer.observe(hint.field);
    addEventListener("scroll", position, true);
    addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      removeEventListener("scroll", position, true);
      removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [hint]);

  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!hint || !bubble) return;
    if (typeof bubble.showPopover !== "function") { bubble.classList.add("is-fallback"); return; }
    if (!bubble.matches(":popover-open")) bubble.showPopover();
    return () => { if (bubble.isConnected && bubble.matches(":popover-open")) bubble.hidePopover(); };
  }, [hint]);

  const ready = place?.id === hint?.id ? place : null;
  return createPortal(
    <AnimatePresence>
      {hint && (
        <motion.div
          key={hint.id}
          ref={ref}
          popover={typeof document !== "undefined" && "popover" in HTMLElement.prototype ? "manual" : undefined}
          className="validation-hint"
          role="alert"
          data-side={ready?.side || "bottom"}
          style={{
            left: ready?.left ?? 0,
            top: ready?.top ?? 0,
            visibility: ready ? "visible" : "hidden",
            ["--hint-arrow" as string]: `${ready?.arrow ?? ARROW_INSET}px`,
          }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: ready?.side === "top" ? 6 : -6, filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, scale: 0.96, filter: "blur(4px)", transition: { duration: 0.18 } }}
          transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 30, mass: 0.7, opacity: { duration: 0.18 }, filter: { duration: 0.2 } }}
        >
          <GlassOptics />
          <span className="validation-hint-symbol" aria-hidden="true"><CircleAlert size={17} strokeWidth={1.9} /></span>
          <span className="validation-hint-message">{hint.message}</span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
