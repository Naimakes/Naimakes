import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { MarkInstance, PokeKind } from "./engine/grok-bot-mark";
import { loadEngine } from "./engine-loader";
import type { AssistantPrefs } from "./prefs";

export type BotLook = Pick<AssistantPrefs, "shape" | "color">;
export type BotHandle = { poke: (kind?: PokeKind) => void; blink: () => void };

const pokeCycle: PokeKind[] = ["spin", "bounce", "nod"];
const IDLE_PAUSE_MS = 1400;

type Props = {
  look: BotLook;
  state?: string;
  paused?: boolean;
  emphasis?: boolean;
  follow?: boolean;
  fps?: number;
  idle?: "pause" | "alive";
  clickPoke?: boolean;
  className?: string;
  label?: string;
};

export const BotFigure = forwardRef<BotHandle, Props>(function BotFigure(
  { look, state = "idle", paused = false, emphasis = false, follow = true, fps = 60, idle = "pause", clickPoke = false, className = "", label },
  handle,
) {
  const host = useRef<HTMLSpanElement>(null);
  const bot = useRef<MarkInstance | null>(null);
  const turn = useRef(0);
  const initial = useRef({ look, state, paused, emphasis, follow, fps, label });
  initial.current = { look, state, paused, emphasis, follow, fps, label };

  const poke = (kind?: PokeKind) => {
    const instance = bot.current;
    if (!instance || instance.reducedMotion) return false;
    const next = kind || pokeCycle[turn.current % pokeCycle.length];
    instance.poke(next);
    if (!kind) turn.current += 1;
    return true;
  };

  useImperativeHandle(handle, () => ({ poke: (kind) => void poke(kind), blink: () => void bot.current?.blink() }), []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    loadEngine().then(({ GrokBotMark }) => {
      if (cancelled) return;
      const now = initial.current;
      const instance = GrokBotMark.mount(element, {
        size: "100%",
        shape: now.look.shape,
        color: now.look.color,
        state: now.state,
        theme: "light",
        follow: now.follow,
        hover: true,
        clickPoke: false,
        autoBlink: false,
        maxFrameRate: now.fps,
        paused: now.paused,
        emphasis: now.emphasis,
        reducedMotion: "auto",
      });
      const root = instance.element;
      if (now.label) root.setAttribute("aria-label", now.label);
      else {
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.setAttribute("aria-hidden", "true");
      }
      bot.current = instance;
    });
    return () => {
      cancelled = true;
      bot.current?.destroy();
      bot.current = null;
    };
  }, []);

  useEffect(() => {
    bot.current?.setShape(look.shape).setColor(look.color);
    // the engine may still be loading; the initial values above cover that case
  }, [look.shape, look.color]);

  useEffect(() => {
    bot.current?.setEmphasis(emphasis);
  }, [emphasis]);

  useEffect(() => {
    bot.current?.setFollow(follow);
  }, [follow]);

  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (state !== "idle" || idle === "alive") return setResting(false);
    const timer = window.setTimeout(() => setResting(true), IDLE_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      setResting(false);
    };
  }, [state, idle]);

  useEffect(() => {
    if (paused || resting) bot.current?.pause();
    else bot.current?.play();
  }, [paused, resting]);

  useEffect(() => {
    let timer = 0;
    const apply = () => {
      const instance = bot.current;
      if (!instance) {
        timer = window.setTimeout(apply, 120);
        return;
      }
      instance.setState(state);
      instance.setEmphasis(initial.current.emphasis);
    };
    apply();
    return () => clearTimeout(timer);
  }, [state]);

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (clickPoke && event.button === 0) poke();
  };

  return (
    <span
      ref={host}
      className={"bot-figure " + className}
      data-poke={clickPoke || undefined}
      onPointerUp={clickPoke ? onPointerUp : undefined}
    />
  );
});
