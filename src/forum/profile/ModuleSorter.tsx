import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { animate, LayoutGroup, motion, useMotionValue, useSpring } from "motion/react";
import { GripVertical } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { transitions } from "../motion/motion-tokens";

type Drag = {
  id: string; pointerId: number;
  grabX: number; grabY: number; x: number; y: number;
};
type Pending = { id: string; pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; row: HTMLElement };

const COLUMN = 6, MOUSE_SLOP = 4, TOUCH_SLOP = 8, LONG_PRESS = 260, EDGE = 64;
const MAKE_WAY = { type: "spring", stiffness: 380, damping: 34, mass: .9 } as const;

function moveWithin(list: string[], from: string, to: string, after: boolean) {
  if (from === to || !list.includes(from)) return list;
  const rest = list.filter((m) => m !== from), at = rest.indexOf(to);
  if (at < 0) return list;
  const next = [...rest];
  next.splice(at + (after ? 1 : 0), 0, from);
  return next;
}

export default function ModuleSorter({ order, labels, reduced, disabled, onCommit }: {
  order: string[]; labels: Record<string, string>; reduced: boolean; disabled?: boolean; onCommit: (next: string[]) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [preview, setPreview] = useState<string[] | null>(null);
  const [active, setActive] = useState("");
  const [settling, setSettling] = useState("");
  const drag = useRef<Drag | null>(null), pending = useRef<Pending | null>(null);
  const shown = preview || order;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const dx = useMotionValue(0), dy = useMotionValue(0);
  const lift = useSpring(0, transitions.responsive);

  const slot = (id: string) => {
    const row = rows.current.get(id), box = grid.current?.getBoundingClientRect();
    if (!row || !box) return null;
    return { left: box.left + row.offsetLeft, top: box.top + row.offsetTop, width: row.offsetWidth, height: row.offsetHeight };
  };
  const place = () => {
    const current = drag.current, home = current && slot(current.id);
    if (!current || !home) return;
    dx.set(current.x - current.grabX - home.left);
    dy.set(current.y - current.grabY - home.top);
  };
  const retarget = () => {
    const current = drag.current;
    if (!current) return;
    const list = shownRef.current;
    for (const id of list) {
      if (id === current.id) continue;
      const box = slot(id);
      if (!box || current.x < box.left || current.x > box.left + box.width || current.y < box.top - 6 || current.y > box.top + box.height + 6) continue;
      const next = moveWithin(list, current.id, id, current.y > box.top + box.height / 2);
      if (next.join() !== list.join()) setPreview(next);
      return;
    }
  };
  useLayoutEffect(place, [shown.join(), active]);

  const begin = (id: string, pointerId: number, x: number, y: number) => {
    const home = slot(id);
    if (!home) return;
    drag.current = { id, pointerId, grabX: x - home.left, grabY: y - home.top, x, y };
    dx.jump(0); dy.jump(0);
    setPreview(order);
    setActive(id);
    setSettling("");
    lift.set(1);
    navigator.vibrate?.(8);
  };
  const end = (commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const next = shownRef.current;
    lift.set(0);
    setActive("");
    setSettling(current.id);
    const motion = reduced ? { duration: 0 } : transitions.surface;
    animate(dx, 0, motion);
    animate(dy, 0, { ...motion, onComplete: () => setSettling((id) => (id === current.id ? "" : id)) });
    setPreview(null);
    if (commit && next.join() !== order.join()) onCommit(next);
  };
  const cancelPending = () => {
    if (pending.current?.timer) clearTimeout(pending.current.timer);
    pending.current = null;
  };

  useEffect(() => {
    let frame = 0;
    const scroll = () => {
      frame = 0;
      const current = drag.current;
      if (!current) return;
      const speed = current.y < EDGE ? -(EDGE - current.y) : current.y > innerHeight - EDGE ? current.y - (innerHeight - EDGE) : 0;
      if (speed) { scrollBy(0, speed * .35); place(); retarget(); frame = requestAnimationFrame(scroll); }
    };
    const move = (event: PointerEvent) => {
      const wait = pending.current;
      if (wait && wait.pointerId === event.pointerId) {
        const distance = Math.hypot(event.clientX - wait.x, event.clientY - wait.y);
        if (wait.timer && distance > TOUCH_SLOP) return cancelPending();
        if (!wait.timer && distance > MOUSE_SLOP) { cancelPending(); begin(wait.id, wait.pointerId, wait.x, wait.y); }
      }
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      place(); retarget();
      if (!frame) frame = requestAnimationFrame(scroll);
    };
    const up = (event: PointerEvent) => {
      if (pending.current?.pointerId === event.pointerId) cancelPending();
      if (drag.current?.pointerId === event.pointerId) end(event.type === "pointerup");
    };
    const touch = (event: TouchEvent) => { if (drag.current) event.preventDefault(); };
    const keys = (event: KeyboardEvent) => { if (event.key === "Escape" && drag.current) { setPreview(order); end(false); } };
    const onScroll = () => place();
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    addEventListener("touchmove", touch, { passive: false });
    addEventListener("keydown", keys);
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      removeEventListener("touchmove", touch);
      removeEventListener("keydown", keys);
      removeEventListener("scroll", onScroll);
    };
  });
  useEffect(() => () => cancelPending(), []);

  const press = (id: string, fromGrip: boolean) => (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (!fromGrip && (event.target as Element).closest("button")) return;
    const row = rows.current.get(id);
    if (!row) return;
    cancelPending();
    const touchLike = event.pointerType !== "mouse";
    if (touchLike && fromGrip) return begin(id, event.pointerId, event.clientX, event.clientY);
    const wait: Pending = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, row, timer: null };
    if (touchLike) wait.timer = setTimeout(() => { if (pending.current === wait) { pending.current = null; begin(id, wait.pointerId, wait.x, wait.y); } }, LONG_PRESS);
    pending.current = wait;
  };
  const nudge = (id: string, step: number) => {
    const index = order.indexOf(id), target = order[index + step];
    if (target) onCommit(moveWithin(order, id, target, step > 0));
  };

  const row = (id: string, index: number) => {
    const lifted = active === id || settling === id;
    return <motion.li key={id} ref={(node) => { if (node) rows.current.set(id, node); else rows.current.delete(id); }}
      layoutId={lifted ? undefined : `profile-module-${id}`} layout={lifted ? false : "position"}
      transition={reduced ? { duration: 0 } : MAKE_WAY}
      className={`profile-module ${active === id ? "is-dragging" : ""} ${lifted ? "is-lifted" : ""}`}
      style={lifted ? { x: dx, y: dy, "--lift": lift } as any : undefined}
      onPointerDown={press(id, false)} onContextMenu={(event) => { if (pending.current || drag.current) event.preventDefault(); }}>
      <span><i className="profile-module-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>{labels[id]}</span>
      <LiquidButton type="button" className="profile-grip" disabled={disabled}
        aria-label={`调整「${labels[id]}」的位置，可用上下方向键`}
        onPointerDown={press(id, true)}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!step) return;
          event.preventDefault();
          nudge(id, step);
        }}>
        <GripVertical size={16} />
      </LiquidButton>
    </motion.li>;
  };

  return <div className={`profile-grid profile-module-grid ${active ? "is-sorting" : ""}`} ref={grid}>
    <LayoutGroup>
      {[shown.slice(0, COLUMN), shown.slice(COLUMN)].map((column, c) =>
        <ul className="profile-module-list" key={c}>{column.map((id, i) => row(id, c * COLUMN + i))}</ul>)}
    </LayoutGroup>
  </div>;
}
