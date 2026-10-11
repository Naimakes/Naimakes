import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { FluidIndicator, FluidTabs, useFluidIndicator } from "../motion/FluidTabs";
import "./glass-segments.css";

export type MenuPoint = { preventDefault: () => void; clientX: number; clientY: number; currentTarget: EventTarget | null };

export function longPressMenu(open: (event: MenuPoint) => void) {
  let timer = 0;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const clear = () => { clearTimeout(timer); start = null; };
  return {
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      if (fired) return;
      open(event);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      fired = false;
      if (event.pointerType === "mouse") return;
      const target = event.currentTarget;
      start = { x: event.clientX, y: event.clientY };
      const { clientX, clientY } = event;
      timer = window.setTimeout(() => {
        fired = true;
        start = null;
        open({ preventDefault() {}, clientX, clientY, currentTarget: target });
        const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 700);
      }, 520);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}

type Segment<T extends string> = {
  id: T;
  label?: ReactNode;
  title?: string;
  icon?: ReactNode;
  count?: number;
  extra?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  reselect?: boolean;
};

export function GlassSegments<T extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
  columns,
  onItemMenu,
}: {
  items: readonly Segment<T>[];
  value: T | null;
  onChange: (next: T) => void;
  label: string;
  className?: string;
  columns?: number;
  onItemMenu?: (id: T, event: MenuPoint) => void;
}) {
  const focusable = items.some((item) => item.id === value && !item.disabled) ? value : items.find((item) => !item.disabled)?.id;
  return (
    <FluidTabs
      className={`glass-segments ${columns ? "is-grid " : ""}${className}`.trim()}
      style={columns ? ({ "--seg-cols": columns } as CSSProperties) : undefined}
      active={value ?? ""}
      label={label}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          tabIndex={item.id === focusable ? 0 : -1}
          disabled={item.disabled}
          aria-label={item.title}
          title={item.title}
          className={"glass-segment" + (item.danger ? " is-danger" : "")}
          onClick={() => (item.reselect || item.id !== value) && onChange(item.id)}
          {...(onItemMenu ? longPressMenu((event) => onItemMenu(item.id, event)) : {})}
        >
          {item.icon}
          {item.label != null && <span className="glass-segment-label">{item.label}</span>}
          {!!item.count && <em>{item.count}</em>}
          {item.extra}
        </button>
      ))}
    </FluidTabs>
  );
}

export type GlassAction = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  on?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  expanded?: boolean;
};

export function GlassActions({ items, label, className = "" }: { items: readonly GlassAction[]; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState("");
  useFluidIndicator(ref, hot);
  const point = (id: string) => ref.current?.dataset.fluidDragging !== "true" && setHot(id);
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className={`glass-segments glass-actions ${className} fluid-tabs`}
      onPointerLeave={() => point("")}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHot("")}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        e.preventDefault();
        buttons[(index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length].focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-fluid-item
          data-fluid-selected={item.id === hot}
          disabled={item.disabled}
          title={item.title}
          aria-pressed={item.on}
          aria-expanded={item.expanded}
          className={"glass-segment" + (item.danger ? " is-danger" : "") + (item.on ? " is-on" : "")}
          onPointerEnter={() => point(item.id)}
          onFocus={() => point(item.id)}
          onClick={() => {
            setHot(item.id);
            item.onClick();
          }}
        >
          {item.icon}
          <span className="glass-segment-label">{item.label}</span>
        </button>
      ))}
      <FluidIndicator />
    </div>
  );
}
