import { useLayoutEffect, useRef } from "react";
import { useMotionPreferences } from "./motion-preferences";
export function usePageTransition<T extends HTMLElement = HTMLElement>(route: string) {
  const ref = useRef<T>(null);
  const previous = useRef(route);
  const animation = useRef<Animation | null>(null);
  const { reduced } = useMotionPreferences();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const changed = previous.current !== route;
    previous.current = route;

    if (reduced || !element.animate) {
      animation.current?.cancel();
      animation.current = null;
      delete element.dataset.transitioning;
      return;
    }
    if (!changed) return;

    const interrupted = animation.current?.playState === "running"
      || animation.current?.playState === "paused";
    const current = getComputedStyle(element);
    const opacity = interrupted || Number(current.opacity) < 1 ? current.opacity : ".65";
    const transform = interrupted ? current.transform : "translateY(10px)";
    animation.current?.cancel();

    element.dataset.transitioning = "true";
    const transformOrigin = "50% 0%";
    const next = element.animate([
      { opacity, transform, transformOrigin, offset: 0, easing: "cubic-bezier(.2,.72,.24,1)" },
      { opacity: 1, transform: "none", transformOrigin, offset: 1 },
    ], { duration: interrupted ? 240 : 340 });
    animation.current = next;
    const finish = () => {
      if (animation.current !== next) return;
      animation.current = null;
      delete element.dataset.transitioning;
    };
    next.onfinish = finish;
    next.oncancel = finish;
  }, [route, reduced]);

  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      animation.current?.cancel();
      animation.current = null;
      if (element) delete element.dataset.transitioning;
    };
  }, []);
  return ref;
}
