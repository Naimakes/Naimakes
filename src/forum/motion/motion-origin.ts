export type Origin = {
  element: HTMLElement | null;
  fallback: HTMLElement | null;
  rect: { left: number; top: number; width: number; height: number };
  radius: number;
  snapshot: HTMLElement | null;
};
const sourceParents = new WeakMap<HTMLElement, HTMLElement>();
export function registerSourceParent(panel: HTMLElement, trigger: HTMLElement) { sourceParents.set(panel, trigger); return () => { sourceParents.delete(panel); }; }
function parentSource(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) { const source = sourceParents.get(current); if (source) return source; current = current.parentElement; }
  return element.closest("[data-popover-owner]")?.querySelector<HTMLElement>("[aria-expanded]") || null;
}
let latest: { origin: Origin; at: number } | null = null;
export function measureOrigin(element: HTMLElement | null): Origin | null {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const snapshot = element.cloneNode(true) as HTMLElement;
  snapshot.removeAttribute("id");
  snapshot.removeAttribute("tabindex");
  snapshot.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  snapshot.querySelectorAll("script, iframe, video, audio, canvas").forEach((node) => node.remove());
  snapshot.style.cssText += `;transform:none;translate:none;scale:none;margin:0;position:relative;left:auto;top:auto;width:${rect.width}px;height:${rect.height}px;max-height:none;`;
  return {
    element,
    fallback: parentSource(element),
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    radius: parseFloat(getComputedStyle(element).borderTopLeftRadius) || 16,
    snapshot,
  };
}
export function rememberOrigin(element: HTMLElement | null) {
  const origin = measureOrigin(element);
  if (origin) latest = { origin, at: performance.now() };
  return origin;
}
export function recentOrigin(): Origin | null {
  if (latest && performance.now() - latest.at < 900) return latest.origin;
  const active = document.activeElement;
  return active instanceof HTMLElement && active.matches("button, a, [role=button]") ? measureOrigin(active) : null;
}
export function returnOrigin(origin: Origin | null): Origin | null {
  if (!origin) return null;
  const measured = measureOrigin(origin.element);
  if (measured && measured.rect.top < innerHeight && measured.rect.top + measured.rect.height > 0) return { ...measured, snapshot: origin.snapshot };
  const fallback = measureOrigin(origin.fallback);
  return fallback ? { ...fallback, snapshot: origin.snapshot } : origin.rect.top < innerHeight && origin.rect.top + origin.rect.height > 0 ? { ...origin, element: null } : null;
}
export function rememberPostOrigin(id: string) {
  const clicked = latest?.origin.element;
  const card = clicked?.closest<HTMLElement>("[data-post-id]");
  if (card?.dataset.postId === id) return rememberOrigin(card);
  const candidate = Array.from(document.querySelectorAll<HTMLElement>("[data-post-id]")).find((el) => el.dataset.postId === id && el.getBoundingClientRect().bottom > 0);
  if (candidate) return rememberOrigin(candidate);
  return recentOrigin();
}
