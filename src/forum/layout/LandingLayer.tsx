import { useCallback, useEffect, useRef, useState } from "react";
import "./landing-layer.css";

const SEEN_KEY = "naimakes-landing-seen";
const WELCOME_KEY = "naimakes-welcome";
const READY_TIMEOUT = 12000;

function shouldOpen() {
  if (typeof window === "undefined") return false;
  if (window.location.pathname !== "/") return false;
  try {
    if (sessionStorage.getItem(SEEN_KEY)) return false;
  } catch {
  }
  return true;
}

export function takeWelcome() {
  try {
    const welcome = sessionStorage.getItem(WELCOME_KEY) === "1";
    sessionStorage.removeItem(WELCOME_KEY);
    return welcome;
  } catch {
    return false;
  }
}

export default function LandingLayer({ onSignIn, onEnter }: { onSignIn?: () => void; onEnter?: () => void }) {
  const [open, setOpen] = useState(shouldOpen);
  const [leaving, setLeaving] = useState(false);
  const ready = useRef(false);
  const signedIn = useRef(onSignIn);
  const entered = useRef(onEnter);
  useEffect(() => {
    signedIn.current = onSignIn;
    entered.current = onEnter;
  }, [onSignIn, onEnter]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const dismiss = useCallback(() => {
    setLeaving(true);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
    }
    timers.current.push(setTimeout(() => setOpen(false), 1250));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const type = (event.data as { type?: string } | null)?.type;
      if (type === "naimakes-landing-ready") ready.current = true;
      else if (type === "naimakes-landing-exit") {
        if ((event.data as { welcome?: boolean }).welcome) entered.current?.();
        dismiss();
      }
      else if (type === "naimakes-landing-auth") signedIn.current?.();
    };
    window.addEventListener("message", onMessage);
    timers.current.push(
      setTimeout(() => {
        if (!ready.current) dismiss();
      }, READY_TIMEOUT),
    );
    return () => window.removeEventListener("message", onMessage);
  }, [open, dismiss]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("landing-open");
    return () => document.documentElement.classList.remove("landing-open");
  }, [open]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  if (!open) return null;
  return (
    <div
      className={`landing-layer ${leaving ? "is-leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Naimakes 帖子阵列"
    >
      <iframe src="/landing.html" title="Naimakes 帖子阵列" allow="autoplay" />
    </div>
  );
}
