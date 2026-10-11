import { closestFluidTarget, fluidMultiRow, interpolateFluidDrag, type FluidTarget } from "./fluid-geometry";
export { fluidMultiRow, fluidVerticalNeighbor } from "./fluid-geometry";

const itemSelector = '[data-fluid-item], [role="tab"]';
type Point = { x: number; y: number };
type Choice = { element: HTMLElement; box: FluidTarget };
type Gesture = {
  id: number; source: HTMLElement; start: Point; offset: Point;
  dragging: boolean; center: Point; capture: boolean;
  vertical: boolean;
  sampleX: number; sampleTime: number; velocityX: number;
};
type DragCallbacks = {
  current: () => FluidTarget | null;
  start: () => void;
  move: (box: FluidTarget, closest: HTMLElement) => void;
  commit: (item: HTMLElement) => void;
  cancel: () => void;
};

export function fluidItems(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(itemSelector)).filter(item => item.closest(".fluid-tabs") === root);
}

export function fluidItemEnabled(item: HTMLElement) {
  return !item.matches(':disabled, [aria-disabled="true"]')
    && !item.closest('[hidden], [inert], [aria-hidden="true"]')
    && item.offsetWidth > 0 && item.offsetHeight > 0
    && getComputedStyle(item).visibility !== "hidden";
}

export function fluidItemBox(item: HTMLElement): FluidTarget {
  return { left: item.offsetLeft, width: item.offsetWidth, top: item.offsetTop, height: item.offsetHeight };
}

export function installFluidDrag(root: HTMLElement, callbacks: DragCallbacks, suppressedClick: { current: number }) {
  let gesture: Gesture | null = null;
  let removeGestureListeners: (() => void) | null = null;
  const choices = (): Choice[] => fluidItems(root).filter(fluidItemEnabled).map(element => ({ element, box: fluidItemBox(element) }));
  const localPoint = (event: PointerEvent): Point => {
    const rect = root.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * root.offsetWidth / Math.max(1, rect.width) - root.clientLeft + root.scrollLeft,
      y: (event.clientY - rect.top) * root.offsetHeight / Math.max(1, rect.height) - root.clientTop + root.scrollTop,
    };
  };
  const clearGesture = () => {
    const previous = gesture;
    gesture = null;
    removeGestureListeners?.();
    removeGestureListeners = null;
    delete root.dataset.fluidDragging;
    if (previous?.capture && previous.source.hasPointerCapture(previous.id)) previous.source.releasePointerCapture(previous.id);
    return previous;
  };
  const cancel = (suppress = true) => {
    if (!gesture) return;
    const previous = clearGesture();
    if (suppress) suppressedClick.current = performance.now() + 800;
    if (previous?.dragging) callbacks.cancel();
  };
  const showDrag = (event: PointerEvent) => {
    const current = gesture;
    if (!current) return false;
    const items = choices();
    if (!items.length || !fluidItemEnabled(current.source)) { cancel(); return false; }
    const point = localPoint(event);
    const now = performance.now();
    const elapsed = (now - current.sampleTime) / 1000;
    if (elapsed > .004) {
      const measured = (point.x - current.sampleX) / elapsed;
      current.velocityX = elapsed > .12 ? 0 : current.velocityX * .35 + measured * .65;
      current.sampleX = point.x;
      current.sampleTime = now;
    }
    const center = { x: point.x - current.offset.x, y: point.y - current.offset.y };
    const box = interpolateFluidDrag(items.map(item => item.box), center.x, center.y);
    if (!box) { cancel(); return false; }
    current.center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const index = closestFluidTarget(items.map(item => item.box), current.center.x, current.center.y);
    if (index < 0) { cancel(); return false; }
    callbacks.move(box, items[index].element);
    return true;
  };
  const move = (event: PointerEvent) => {
    const current = gesture;
    if (!current || event.pointerId !== current.id) return;
    if (event.pointerType === "mouse" && !(event.buttons & 1)) { cancel(); return; }
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    if (!current.dragging) {
      const threshold = event.pointerType === "mouse" ? 5 : 8;
      if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx) * .85) {
        if (!current.vertical) { cancel(); return; }
      } else if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      current.dragging = true;
      root.dataset.fluidDragging = "true";
      callbacks.start();
      try { current.source.setPointerCapture(current.id); current.capture = true; } catch { }
    }
    if (event.cancelable) event.preventDefault();
    showDrag(event);
  };
  const up = (event: PointerEvent) => {
    const current = gesture;
    if (!current || event.pointerId !== current.id) return;
    if (!current.dragging) { clearGesture(); return; }
    const point = localPoint(event);
    if (point.y < root.scrollTop - 28 || point.y > root.scrollTop + root.clientHeight + 28 || !showDrag(event)) { cancel(); return; }
    const items = choices();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fresh = performance.now() - current.sampleTime < 100;
    const lead = reduced || !fresh ? 0 : Math.max(-28, Math.min(28, current.velocityX * .055));
    const index = closestFluidTarget(items.map(item => item.box), current.center.x + lead, current.center.y);
    clearGesture();
    suppressedClick.current = performance.now() + 800;
    if (index >= 0) callbacks.commit(items[index].element);
    else callbacks.cancel();
  };
  const cancelledPointer = (event: PointerEvent) => { if (event.pointerId === gesture?.id) cancel(); };
  const anotherPointer = (event: PointerEvent) => { if (gesture && event.pointerId !== gesture.id) cancel(); };
  const interrupt = () => cancel();
  const hidden = () => { if (document.hidden) cancel(); };
  const key = (event: KeyboardEvent) => {
    if (!gesture) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
    cancel();
  };
  const down = (event: PointerEvent) => {
    if (gesture || event.button !== 0 || event.isPrimary === false || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const source = event.target instanceof Element ? event.target.closest<HTMLElement>(itemSelector) : null;
    if (!source || source.closest(".fluid-tabs") !== root || !fluidItemEnabled(source) || choices().length < 2) return;
    suppressedClick.current = 0;
    const point = localPoint(event), shape = callbacks.current();
    const grabbedLens = shape && point.x >= shape.left && point.x <= shape.left + shape.width
      && point.y >= shape.top && point.y <= shape.top + shape.height;
    const center = grabbedLens ? { x: shape.left + shape.width / 2, y: shape.top + shape.height / 2 } : point;
    const vertical = fluidMultiRow(choices().map(choice => choice.box)) && (event.pointerType === "mouse" || !!grabbedLens);
    gesture = { id: event.pointerId, source, start: { x: event.clientX, y: event.clientY },
      offset: { x: point.x - center.x, y: point.y - center.y }, center, dragging: false, capture: false, vertical,
      sampleX: point.x, sampleTime: performance.now(), velocityX: 0 };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelledPointer, true);
    window.addEventListener("pointerdown", anotherPointer, true);
    root.addEventListener("lostpointercapture", cancelledPointer, true);
    window.addEventListener("scroll", interrupt, { capture: true, passive: true });
    window.addEventListener("resize", interrupt, { passive: true });
    window.addEventListener("blur", interrupt);
    window.addEventListener("keydown", key, true);
    window.visualViewport?.addEventListener("resize", interrupt);
    document.addEventListener("visibilitychange", hidden);
    removeGestureListeners = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelledPointer, true);
      window.removeEventListener("pointerdown", anotherPointer, true);
      root.removeEventListener("lostpointercapture", cancelledPointer, true);
      window.removeEventListener("scroll", interrupt, true);
      window.removeEventListener("resize", interrupt);
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("keydown", key, true);
      window.visualViewport?.removeEventListener("resize", interrupt);
      document.removeEventListener("visibilitychange", hidden);
    };
  };
  const click = (event: MouseEvent) => {
    if (event.detail > 0 && performance.now() < suppressedClick.current) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressedClick.current = 0;
    }
  };
  const nativeDrag = (event: DragEvent) => { if (gesture) event.preventDefault(); };
  root.addEventListener("pointerdown", down, true);
  root.addEventListener("click", click, true);
  root.addEventListener("dragstart", nativeDrag);
  return {
    cancel: interrupt,
    dispose: () => {
      if (gesture?.dragging) suppressedClick.current = performance.now() + 800;
      clearGesture();
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("dragstart", nativeDrag);
    },
  };
}
