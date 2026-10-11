import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useSpring, useMotionTemplate, useTransform, type HTMLMotionProps } from "motion/react";
import { useMotionPreferences } from "./motion-preferences";
import { clamp, motionTokens, transitions } from "./motion-tokens";
import "./liquid-button-light.css";

type Press = {
  pointerId: number | null; key?: string; pointerType?: string; x: number; y: number;
  rect?: DOMRect; compression?: number; reach?: number; outside?: boolean;
};

const RELEASE_SLOP: Record<string, number> = { mouse: 4, pen: 12, touch: 20 };
const DRAG_HANDLES = ".attachment-drag-handle, .profile-grip, [data-drag-handle]";
const follow = (distance: number, reach: number) => reach * Math.tanh(distance / (reach * 3));

export const LiquidButton = forwardRef<HTMLButtonElement, Omit<HTMLMotionProps<"button">, "children"> & { children?: ReactNode }>(function LiquidButton({
  children, className, style, onPointerEnter, onPointerMove, onPointerLeave, onPointerDown, onPointerUp, onPointerCancel, onKeyDown, onKeyUp, onBlur, ...props
}, forwardedRef) {
  const { reduced, tactile } = useMotionPreferences();
  const button = useRef<HTMLButtonElement>(null);
  useImperativeHandle(forwardedRef, () => button.current!, []);
  useLayoutEffect(() => {
    const element = button.current;
    if (element) {
      const icon = !element.textContent?.trim() && !!element.querySelector("svg");
      element.dataset.iconOnly = String(icon);
      const tile = !icon && !!element.querySelector("small, h2, h3, p")
        && !element.matches(".featured-story,.profile-stat,.footer-text-link");
      element.dataset.glassShape = tile ? "tile" : icon ? "circle" : "capsule";
    }
  });
  const bounds = useRef<DOMRect | null>(null);
  const lightSurface = useRef<HTMLElement | null>(null);
  const clearHoverListeners = useRef<(() => void) | null>(null);
  const lightExpiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef<Press | null>(null);
  const clearListeners = useRef<(() => void) | null>(null);
  const animation = useRef<{ stop: () => void } | null>(null);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressScale = useMotionValue(1);
  const lift = useSpring(0, motionTokens.spring.responsive);
  const x = useSpring(0, motionTokens.spring.tactile), y = useSpring(0, motionTokens.spring.tactile);
  const px = useMotionValue(50), py = useMotionValue(50);
  const lightX = useMotionValue(50), lightY = useMotionValue(50);
  const light = useSpring(0, motionTokens.spring.surface);
  const reflection = useMotionTemplate`radial-gradient(ellipse var(--button-light-radius-x, 120px) var(--button-light-radius-y, 80px) at ${lightX}% ${lightY}%, rgb(255 255 255 / calc(${light} * var(--button-light-core, .52))) 0%, rgb(var(--button-light-rim, 180 180 180) / calc(${light} * var(--button-light-edge, .12))) 38%, transparent 76%)`;
  const scale = useTransform(() => pressScale.get() * (1 + lift.get() * .006));
  const origin = useMotionTemplate`${px}% ${py}%`;
  const disabled = props.disabled || props["aria-disabled"] === true || props["aria-disabled"] === "true";

  const point = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = bounds.current;
    if (!r || !r.width || !r.height) return { u: .5, v: .5 };
    return { u: clamp((e.clientX - r.left) / r.width), v: clamp((e.clientY - r.top) / r.height) };
  };
  const magnet = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!tactile || e.pointerType !== "mouse" || pressed.current) return;
    const { u, v } = point(e);
    x.set((u - .5) * motionTokens.distance.magnet * 2);
    y.set((v - .5) * motionTokens.distance.magnet);
  };
  const releaseSurface = () => {
    const surface = lightSurface.current;
    surface?.removeAttribute("data-button-light-surface");
    surface?.style.removeProperty("--button-light-base-image");
    lightSurface.current = null;
    if (lightExpiry.current) clearTimeout(lightExpiry.current);
    lightExpiry.current = null;
  };
  const endLight = (immediate = false) => {
    light.set(0);
    clearHoverListeners.current?.();
    clearHoverListeners.current = null;
    if (lightExpiry.current) clearTimeout(lightExpiry.current);
    if (immediate) releaseSurface();
    else lightExpiry.current = setTimeout(releaseSurface, 260);
  };
  const refreshLightSurface = () => {
    const surface = lightSurface.current;
    if (!surface?.isConnected) return;
    surface.removeAttribute("data-button-light-surface");
    const background = getComputedStyle(surface).backgroundImage;
    surface.style.setProperty("--button-light-base-image", background);
    surface.setAttribute("data-button-light-surface", "");
  };
  const trackLight = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!lightSurface.current || !clearHoverListeners.current) return;
    const { u, v } = point(e);
    lightX.set(u * 100); lightY.set(v * 100);
  };
  const beginLight = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!tactile || e.pointerType !== "mouse" || matchMedia("(forced-colors: active)").matches) return;
    const element = e.currentTarget, rect = bounds.current;
    if (!rect || !((rect.width >= 140 && rect.height >= 38) || (rect.width >= 96 && rect.height >= 64))) return;
    if (element.matches(".image-zoom-trigger,.avatar,.avatar-button,.text-button,.inline-link,.tag-button,.post-title,.post-author,.profile-bio-edit")) return;
    if (lightExpiry.current) clearTimeout(lightExpiry.current);
    lightExpiry.current = null;
    clearHoverListeners.current?.();
    const surface = element.querySelector<HTMLElement>(".featured-story-art > i") || element;
    if (lightSurface.current !== surface) releaseSurface();
    lightSurface.current = surface;
    element.style.setProperty("--button-light-radius-x", `${Math.min(240, Math.max(84, rect.width * .55))}px`);
    element.style.setProperty("--button-light-radius-y", `${Math.min(210, Math.max(64, rect.height * 1.35))}px`);
    refreshLightSurface();
    const observer = new MutationObserver(refreshLightSurface);
    observer.observe(element, { attributes: true, attributeFilter: ["class", "aria-selected", "aria-pressed"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const interrupt = () => { endLight(); bounds.current = null; };
    const hidden = () => { if (document.hidden) interrupt(); };
    window.addEventListener("blur", interrupt);
    window.addEventListener("resize", interrupt, { passive: true });
    window.addEventListener("scroll", interrupt, { capture: true, passive: true });
    document.addEventListener("visibilitychange", hidden);
    clearHoverListeners.current = () => {
      observer.disconnect();
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("resize", interrupt);
      window.removeEventListener("scroll", interrupt, true);
      document.removeEventListener("visibilitychange", hidden);
    };
    trackLight(e); light.set(1);
  };
  useLayoutEffect(() => { if (lightSurface.current) refreshLightSurface(); });
  const stopAnimation = () => {
    animation.current?.stop();
    animation.current = null;
    if (settling.current) clearTimeout(settling.current);
    settling.current = null;
  };
  const finish = (cancelled = false) => {
    const wasPressed = pressed.current !== null;
    pressed.current = null;
    x.set(0); y.set(0);
    clearListeners.current?.();
    clearListeners.current = null;
    if (button.current) { delete button.current.dataset.glassPressed; delete button.current.dataset.glassCancel; }
    if (!wasPressed && !cancelled) return;
    stopAnimation();
    if (cancelled || reduced) {
      pressScale.set(1);
      if (button.current) delete button.current.dataset.glassActive;
    } else {
      animation.current = animate(pressScale, [pressScale.get(), 1.02, 1], {
        duration: .32, times: [0, .52, 1], ease: [.22, .9, .25, 1],
      });
      settling.current = setTimeout(() => {
        if (button.current) delete button.current.dataset.glassActive;
        settling.current = null;
      }, 340);
    }
  };
  const reset = () => {
    finish(true);
    endLight();
    lift.set(0); x.set(0); y.set(0);
    bounds.current = null;
  };
  const release = () => {
    const element = button.current;
    pressed.current = null;
    clearListeners.current?.();
    clearListeners.current = null;
    if (!element) return;
    delete element.dataset.glassPressed;
    delete element.dataset.glassCancel;
    const swallow = (event: MouseEvent) => { if (event.target instanceof Node && element.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); } };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 48);
    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => { delete element.dataset.glassActive; settling.current = null; }, 340);
  };
  const begin = (press: Press) => {
    if (disabled || pressed.current || !button.current) return;
    stopAnimation();
    pressed.current = press;
    button.current.dataset.glassPressed = "true";
    button.current.dataset.glassActive = "true";
    lift.set(0);
    const rect = button.current.getBoundingClientRect();
    const large = rect.width > 240 || rect.height > 80;
    press.rect = rect;
    press.compression = large ? .99 : .965;
    press.reach = large ? 4 : Math.min(7, Math.max(3, Math.min(rect.width, rect.height) * .16));
    if (!reduced) animation.current = animate(pressScale, press.compression, { duration: .1, ease: "easeOut" });
    const up = (event: PointerEvent) => {
      const active = pressed.current;
      if (active?.pointerId !== event.pointerId) return;
      if (active.outside) release(); else finish();
    };
    const cancelPointer = (event: PointerEvent) => { if (pressed.current?.pointerId === event.pointerId) reset(); };
    const drag = (event: PointerEvent) => {
      const active = pressed.current, element = button.current;
      if (active?.pointerId !== event.pointerId || !active.rect || !element || element.matches(DRAG_HANDLES)) return;
      const r = active.rect, slop = RELEASE_SLOP[active.pointerType || "mouse"] ?? 12;
      const inside = event.clientX >= r.left - slop && event.clientX <= r.right + slop
        && event.clientY >= r.top - slop && event.clientY <= r.bottom + slop;
      if (inside) {
        if (!reduced) { x.set(follow(event.clientX - active.x, active.reach!)); y.set(follow(event.clientY - active.y, active.reach!)); }
        if (!active.outside) return;
        active.outside = false;
        element.dataset.glassPressed = "true";
        delete element.dataset.glassCancel;
        stopAnimation();
        if (!reduced) animation.current = animate(pressScale, active.compression!, { duration: .12, ease: "easeOut" });
      } else if (!active.outside) {
        active.outside = true;
        delete element.dataset.glassPressed;
        element.dataset.glassCancel = "true";
        x.set(0); y.set(0);
        stopAnimation();
        if (!reduced) animation.current = animate(pressScale, 1, transitions.responsive);
      }
    };
    const hidden = () => { if (document.hidden) reset(); };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("pointermove", drag, { passive: true });
    window.addEventListener("blur", reset);
    window.addEventListener("scroll", reset, { capture: true, passive: true });
    window.addEventListener("resize", reset, { passive: true });
    document.addEventListener("visibilitychange", hidden);
    clearListeners.current = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("blur", reset);
      window.removeEventListener("scroll", reset, true);
      window.removeEventListener("resize", reset);
      document.removeEventListener("visibilitychange", hidden);
    };
  };
  useEffect(() => {
    if (disabled || reduced || !tactile) { reset(); endLight(true); }
    return () => { reset(); endLight(true); };
  }, [disabled, reduced, tactile]);

  return <motion.button {...props} ref={button} className={["glass-btn", className].filter(Boolean).join(" ")}
    data-liquid-button="" style={{ x, y, scale, transformOrigin: origin, ...({ "--button-pointer-light": reflection } as HTMLMotionProps<"button">["style"]), ...style }}
    onPointerEnter={(e) => {
      if (!disabled) {
        bounds.current = e.currentTarget.getBoundingClientRect();
        if (tactile && e.pointerType === "mouse" && !pressed.current) lift.set(1);
        magnet(e);
        beginLight(e);
      }
      onPointerEnter?.(e);
    }}
    onPointerMove={(e) => {
      if (!disabled) {
        if (tactile && e.pointerType === "mouse" && !bounds.current) {
          bounds.current = e.currentTarget.getBoundingClientRect();
          beginLight(e);
        }
        magnet(e); trackLight(e);
      }
      onPointerMove?.(e);
    }}
    onPointerLeave={(e) => {
      if (pressed.current?.pointerId === e.pointerId) { endLight(); lift.set(0); bounds.current = null; }
      else reset();
      onPointerLeave?.(e);
    }}
    onPointerDown={(e) => {
      if (!disabled && e.button === 0 && e.isPrimary !== false) {
        bounds.current = e.currentTarget.getBoundingClientRect();
        const { u, v } = point(e);
        px.set(u * 100); py.set(v * 100);
        begin({ pointerId: e.pointerId, pointerType: e.pointerType, x: e.clientX, y: e.clientY });
      }
      onPointerDown?.(e);
    }}
    onPointerUp={(e) => { const active = pressed.current; if (active?.pointerId === e.pointerId) { if (active.outside) release(); else finish(); } onPointerUp?.(e); }}
    onPointerCancel={(e) => { reset(); onPointerCancel?.(e); }}
    onKeyDown={(e) => {
      if ((e.key === " " || e.key === "Enter") && !disabled && !e.repeat) {
        px.set(50); py.set(50);
        begin({ pointerId: null, key: e.key, x: 0, y: 0 });
      }
      onKeyDown?.(e);
    }}
    onKeyUp={(e) => { if (pressed.current?.key === e.key) finish(); onKeyUp?.(e); }}
    onBlur={(e) => { reset(); onBlur?.(e); }}>
    {children}
  </motion.button>;
});
