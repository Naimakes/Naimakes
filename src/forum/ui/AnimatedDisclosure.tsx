import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useMotionPreferences } from "../motion/motion-preferences";
import "./animated-disclosure.css";

const scripted =
  typeof Element !== "undefined" && typeof Element.prototype.animate === "function";

export function AnimatedDisclosure({ summary, children, defaultOpen = false, className = "" }: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const { reduced } = useMotionPreferences();
  const details = useRef<HTMLDetailsElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);

  const settle = () => {
    running.current?.cancel();
    running.current = null;
    const element = details.current;
    if (element) {
      delete element.dataset.disclosureAnimating;
      delete element.dataset.disclosureTarget;
    }
  };
  useEffect(() => settle, []);

  const toggle = (event: MouseEvent<HTMLElement>) => {
    const element = details.current, box = inner.current;
    if (!element || !box || reduced || !scripted) return;
    event.preventDefault();
    const opening = !element.open;
    const from = running.current
      ? parseFloat(getComputedStyle(box).height) || 0
      : element.open ? box.getBoundingClientRect().height : 0;
    running.current?.cancel();
    element.open = true;
    element.dataset.disclosureTarget = opening ? "open" : "closed";
    element.dataset.disclosureAnimating = "true";
    const to = opening ? box.getBoundingClientRect().height : 0;
    const duration = Math.min(320, Math.max(180, Math.abs(to - from) * 0.55 + 140));
    const animation = box.animate(
      { height: [`${from}px`, `${to}px`] },
      { duration, easing: "cubic-bezier(.16, 1, .3, 1)" },
    );
    running.current = animation;
    animation.finished
      .then(() => {
        if (running.current !== animation) return;
        running.current = null;
        element.open = opening;
        delete element.dataset.disclosureAnimating;
        delete element.dataset.disclosureTarget;
      })
      .catch(() => {});
  };

  return (
    <details ref={details} className={`nm-animated-disclosure ${className}`} open={defaultOpen}
      data-disclosure-scripted={(scripted && !reduced) || undefined}
      data-disclosure-reduced={reduced || undefined}>
      <summary onClick={toggle}>
        <span className="nm-disclosure-label">{summary}</span>
        <ChevronDown className="nm-disclosure-chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="nm-disclosure-inner" ref={inner}>{children}</div>
    </details>
  );
}
