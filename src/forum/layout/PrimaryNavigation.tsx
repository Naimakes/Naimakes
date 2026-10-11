import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useSpring } from "motion/react";
import { Compass, House, Orbit } from "lucide-react";
import { FluidIndicator, useFluidIndicator } from "../motion/FluidTabs";
import { useMotionPreferences } from "../motion/motion-preferences";
import { clamp, motionTokens } from "../motion/motion-tokens";
import "../styles/navigation.css";

const routes = [
  { path: "/", label: "首页", Icon: House },
  { path: "/discover", label: "发现", Icon: Compass },
  { path: "/topics", label: "话题", Icon: Orbit },
];
const mobileQuery = "(max-width: 900px)";
const navigationIdleDelay = 300;

function NavigationLink({ href, current, navigate, children }: { href: string; current: boolean; navigate: (path: string) => void; children: ReactNode }) {
  const { reduced, tactile } = useMotionPreferences();
  const x = useSpring(0, motionTokens.spring.tactile);
  const y = useSpring(0, motionTokens.spring.tactile);
  const bounds = useRef<DOMRect | null>(null);
  const [pressed, setPressed] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = () => { setPressed(false); setReleasing(false); x.set(0); y.set(0); };
  const release = () => {
    setPressed(false);
    if (reduced) return;
    setReleasing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setReleasing(false), 400);
  };
  useEffect(() => {
    const cancel = () => { reset(); };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", visibility); if (timer.current) clearTimeout(timer.current); };
  }, [x, y]);
  return <motion.a href={href} aria-current={current ? "page" : undefined} data-fluid-item="" data-pressed={pressed || undefined}
    className={`site-primary-link${releasing ? " is-releasing" : ""}`} style={{ x, y }}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      event.preventDefault(); navigate(href);
    }}
    onPointerEnter={event => { bounds.current = event.currentTarget.getBoundingClientRect(); }}
    onPointerMove={event => {
      if (!tactile || reduced || event.pointerType !== "mouse" || !bounds.current) return;
      const rect = bounds.current;
      x.set((clamp((event.clientX - rect.left) / rect.width) - .5) * motionTokens.distance.magnet * 2);
      y.set((clamp((event.clientY - rect.top) / rect.height) - .5) * motionTokens.distance.magnet);
    }}
    onPointerDown={event => { if (event.button === 0) { setReleasing(false); setPressed(true); } }}
    onPointerUp={release} onPointerLeave={reset} onPointerCancel={reset}
    onKeyDown={event => { if (event.key === "Enter" && !event.repeat) setPressed(true); }}
    onKeyUp={event => { if (event.key === "Enter") release(); }} onBlur={reset}
  >{children}</motion.a>;
}

export function PrimaryNavigation({ page, navigate }: { page: string; navigate: (path: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => matchMedia(mobileQuery).matches);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [scrollHidden, setScrollHidden] = useState(false);
  useFluidIndicator(ref, `${page}:${mobile}`);
  useEffect(() => {
    const media = matchMedia(mobileQuery);
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    let maxHeight = window.innerHeight;
    let width = window.innerWidth;
    const update = () => {
      if (window.innerWidth !== width) { width = window.innerWidth; maxHeight = window.innerHeight; }
      maxHeight = Math.max(maxHeight, window.innerHeight, viewport?.height ?? 0);
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && active.matches('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]');
      const visibleHeight = viewport?.height ?? window.innerHeight;
      setKeyboardOpen(mobile && editing && maxHeight - visibleHeight > 120);
    };
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update); document.removeEventListener("focusin", update); document.removeEventListener("focusout", update);
    };
  }, [mobile]);
  useEffect(() => {
    setScrollHidden(false);
    if (!mobile) return;
    const node = ref.current;
    let hidden = false;
    let last = window.scrollY;
    let touching = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const set = (value: boolean) => { if (hidden !== value) { hidden = value; setScrollHidden(value); } };
    const clearIdle = () => { if (idle) { clearTimeout(idle); idle = null; } };
    const settle = () => {
      clearIdle();
      if (touching) return;
      idle = setTimeout(() => { idle = null; set(false); }, navigationIdleDelay);
    };
    const activity = () => { set(true); settle(); };
    const scroll = () => {
      const y = window.scrollY;
      if (y === last) return;
      last = y;
      activity();
    };
    const touchStart = (event: TouchEvent) => {
      touching = true;
      last = window.scrollY;
      clearIdle();
      if (node && event.target instanceof Node && node.contains(event.target)) touching = false;
    };
    const touchMove = (event: TouchEvent) => {
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      if (touching) activity();
    };
    const touchEnd = (event: TouchEvent) => {
      touching = event.touches.length > 0;
      if (hidden) settle();
    };
    const reveal = () => { clearIdle(); set(false); };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("wheel", activity, { passive: true });
    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", touchMove, { passive: true });
    document.addEventListener("touchend", touchEnd, { passive: true });
    document.addEventListener("touchcancel", touchEnd, { passive: true });
    node?.addEventListener("focusin", reveal);
    return () => {
      clearIdle();
      window.removeEventListener("scroll", scroll); window.removeEventListener("wheel", activity);
      document.removeEventListener("touchstart", touchStart); document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("touchend", touchEnd); document.removeEventListener("touchcancel", touchEnd);
      node?.removeEventListener("focusin", reveal);
    };
  }, [mobile, page]);
  const nav = <nav ref={ref} className="site-primary-nav fluid-tabs" aria-label="主导航" aria-hidden={keyboardOpen || undefined} data-keyboard-open={keyboardOpen || undefined} data-scroll-hidden={scrollHidden || undefined}>
    {routes.map(({ path, label, Icon }) => <NavigationLink key={path} href={path} current={page === path} navigate={navigate}><Icon size={20} strokeWidth={1.7} /><span>{label}</span></NavigationLink>)}
    <FluidIndicator />
  </nav>;
  return mobile ? createPortal(nav, document.body) : nav;
}
