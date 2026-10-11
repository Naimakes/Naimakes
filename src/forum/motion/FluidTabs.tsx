import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useMotionPreferences } from "./motion-preferences";
import { advanceFluid, createFluidState, fluidShape, type FluidState, type FluidTarget } from "./fluid-geometry";
import { installFluidDrag, fluidItemBox, fluidItems, fluidItemEnabled, fluidMultiRow, fluidVerticalNeighbor } from "./fluid-tabs-drag";
import "../styles/navigation.css";

export function useFluidIndicator(ref: RefObject<HTMLElement | null>, active: string) {
  const { reduced } = useMotionPreferences();
  const state = useRef<FluidState | null>(null);
  const target = useRef<FluidTarget | null>(null);
  const frame = useRef(0);
  const suppressedClick = useRef(0);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let disposed = false;
    let selected: HTMLElement | null = null;
    let previousTime = 0;
    const indicator = root.querySelector<HTMLElement>(".fluid-indicator");
    const highlight = () => {
      root.querySelectorAll<HTMLElement>("[data-fluid-item], [role=tab]").forEach(item => {
        item.dataset.fluidActive = String(item === selected);
      });
    };
    const paint = (shape: ReturnType<typeof fluidShape>) => {
      if (!indicator) return;
      indicator.style.transform = `translate3d(${shape.left}px,${shape.top}px,0) scaleY(${shape.scaleY})`;
      indicator.style.width = `${shape.width}px`;
      indicator.style.height = `${shape.height}px`;
      indicator.style.setProperty("--fluid-refraction", String(shape.refraction));
      indicator.dataset.direction = shape.direction > 0 ? "right" : "left";
      root.dataset.fluidMoving = String(!shape.settled);
      if (shape.arrived || reduced) highlight();
    };
    const tick = (time: number) => {
      if (disposed || !state.current || !target.current) return;
      const dt = previousTime ? (time - previousTime) / 1000 : 1 / 60;
      previousTime = time;
      const shape = advanceFluid(state.current, target.current, dt);
      paint(shape);
      if (!shape.settled) frame.current = requestAnimationFrame(tick);
      else { state.current = createFluidState(target.current); paint(fluidShape(state.current, target.current)); frame.current = 0; }
    };
    const measure = () => {
      root.dataset.fluidRows = fluidMultiRow(fluidItems(root).filter(fluidItemEnabled).map(fluidItemBox)) ? "multi" : "single";
      selected = root.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"], [data-fluid-selected="true"]');
      if (!indicator) return;
      indicator.hidden = !selected;
      if (!selected) { highlight(); return; }
      target.current = { left: selected.offsetLeft, width: selected.offsetWidth, top: selected.offsetTop, height: selected.offsetHeight };
      cancelAnimationFrame(frame.current);
      previousTime = 0;
      if (!state.current || reduced) {
        state.current = createFluidState(target.current);
        paint(fluidShape(state.current, target.current));
        highlight();
      } else frame.current = requestAnimationFrame(tick);
    };
    measure();
    const drag = installFluidDrag(root, {
      current: () => state.current && target.current ? fluidShape(state.current, target.current) : target.current,
      start: () => { cancelAnimationFrame(frame.current); frame.current = 0; previousTime = 0; },
      move: (box, item) => {
        selected = item;
        const previous = state.current;
        const next = createFluidState(box);
        const rowChange = !reduced && !!previous && (Math.abs(previous.top.value - box.top) > 1 || Math.abs(previous.top.velocity) > 3);
        if (rowChange && previous) { next.top = previous.top; next.height = previous.height; }
        state.current = next;
        target.current = box;
        if (rowChange) {
          if (!frame.current) { previousTime = 0; frame.current = requestAnimationFrame(tick); }
        } else paint(fluidShape(next, box));
        highlight();
      },
      commit: (item) => {
        selected = item;
        target.current = fluidItemBox(item);
        cancelAnimationFrame(frame.current);
        previousTime = 0;
        if (reduced) { state.current = createFluidState(target.current); paint(fluidShape(state.current, target.current)); }
        else frame.current = requestAnimationFrame(tick);
        item.click();
      },
      cancel: measure,
    }, suppressedClick);
    const observer = new ResizeObserver(() => { drag.cancel(); measure(); });
    observer.observe(root);
    root.querySelectorAll<HTMLElement>("[data-fluid-item], [role=tab]").forEach(item => observer.observe(item));
    document.fonts?.ready.then(() => { if (!disposed) measure(); });
    return () => { disposed = true; drag.dispose(); cancelAnimationFrame(frame.current); observer.disconnect(); };
  }, [active, reduced, ref]);
}

export function FluidIndicator() {
  return <span aria-hidden="true" className="fluid-indicator" hidden><span className="fluid-leading-edge" /></span>;
}

export function FluidTabs({ children, active, className, label, style }: { children: ReactNode; active: string; className: string; label: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useFluidIndicator(ref, active);
  return <div ref={ref} className={`${className} fluid-tabs`} role="tablist" aria-label={label} style={style} onKeyDown={(e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const items = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled):not([aria-disabled="true"])'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || !items.length) return;
    let index: number;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      index = fluidVerticalNeighbor(items.map(fluidItemBox), current, e.key === "ArrowDown" ? 1 : -1);
      if (index < 0) return;
    } else index = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (current + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    e.preventDefault();
    items[index].focus(); items[index].click();
  }}>{children}<FluidIndicator /></div>;
}
