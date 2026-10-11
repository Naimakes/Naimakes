import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useMotionPreferences } from "../motion/motion-preferences";
import "./liquid-switch.css";
import "./liquid-switch-motion.css";

const trackRipples = new WeakMap<HTMLElement, Animation>();

function cancelRipple(track: HTMLElement | null) {
  if (!track) return;
  trackRipples.get(track)?.cancel();
  trackRipples.delete(track);
}

function rippleNeighbours(source: HTMLButtonElement) {
  const group = source.closest("[data-liquid-switch-group]");
  if (!group || typeof source.animate !== "function") return;
  const origin = source.getBoundingClientRect();
  const centre = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 };
  const column = Array.from(group.querySelectorAll<HTMLButtonElement>(".liquid-switch-motion"))
    .filter((button) => button !== source && !button.disabled && button.closest("[data-liquid-switch-group]") === group)
    .map((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        track: button.querySelector<HTMLElement>(".liquid-switch-track"),
        gap: bounds.y + bounds.height / 2 - centre.y,
        aligned: Math.abs(bounds.x + bounds.width / 2 - centre.x) <= origin.width / 2,
        visible: bounds.width > 0 && bounds.height > 0,
      };
    })
    .filter(({ track, aligned, visible, gap }) => track && aligned && visible && gap !== 0);
  const above = column.filter((n) => n.gap < 0).sort((a, b) => b.gap - a.gap)[0];
  const below = column.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap)[0];

  for (const neighbour of [above, below]) {
    const track = neighbour?.track;
    if (!track) continue;
    cancelRipple(track);
    const animation = track.animate([
      { transform: "scale(1)", offset: 0 },
      { transform: "scale(1.035, .94)", offset: .3 },
      { transform: "scale(.995, 1.012)", offset: .64 },
      { transform: "scale(1)", offset: 1 },
    ], { duration: 360, delay: 40, easing: "ease-out" });
    trackRipples.set(track, animation);
    const release = () => {
      if (trackRipples.get(track) === animation) trackRipples.delete(track);
    };
    animation.onfinish = release;
    animation.oncancel = release;
  }
}

export function LiquidSwitch({ checked, label, disabled, onChange }: {
  checked: boolean; label: string; disabled?: boolean; onChange: () => void;
}) {
  const { reduced } = useMotionPreferences();
  const [pressed, setPressed] = useState(false);
  const trackRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const track = trackRef.current;
    if (reduced) cancelRipple(track);
    return () => cancelRipple(track);
  }, [reduced]);
  return <button type="button" role="switch" aria-label={label} aria-checked={checked}
    disabled={disabled} className="liquid-switch liquid-switch-motion"
    onClick={(event) => {
      if (!reduced) rippleNeighbours(event.currentTarget);
      onChange();
    }}
    onPointerDown={(event) => { if (event.button === 0) setPressed(true); }} onPointerUp={() => setPressed(false)}
    onPointerCancel={() => setPressed(false)} onPointerLeave={() => setPressed(false)}
    onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") setPressed(true); }}
    onKeyUp={() => setPressed(false)} onBlur={() => setPressed(false)}>
    <span ref={trackRef} className="liquid-switch-track" aria-hidden="true">
      <motion.span className="liquid-switch-thumb" initial={false}
        animate={{ x: checked ? 28 : 2, scale: pressed && !disabled && !reduced ? 1.16 : 1 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 28, mass: .7 }} />
    </span>
  </button>;
}
