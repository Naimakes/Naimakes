import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { MarkInstance, PokeKind } from "./engine/grok-bot-mark";
import { loadEngine } from "./engine-loader";
import type { AssistantPrefs } from "./prefs";
import "./bot-motion.css";

export type BotLook = Pick<AssistantPrefs, "shape" | "color">;
export type BotHandle = { poke: (kind?: PokeKind) => void; blink: () => void };

const between = (min: number, max: number) => min + Math.random() * (max - min);
const pokeCycle: PokeKind[] = ["spin", "bounce", "nod"];
const IDLE_PAUSE_MS = 1400;
// 时不时冒出来的小动作：前几个是外层的身体动作（bot-motion.css），后三个是引擎自带的戳一下。
const fidgets = ["hop", "wiggle", "peek-left", "peek-right", "pop", "stretch", "shrink", "spin", "bounce", "nod"] as const;
const FIDGET_MS = 1400;
const quiet = new Set(["sleeping", "dragging", "powering-down", "blocked"]);

type Props = {
  look: BotLook;
  state?: string;
  paused?: boolean;
  emphasis?: boolean;
  follow?: boolean;
  fps?: number;
  idle?: "pause" | "alive";
  clickPoke?: boolean;
  fidget?: boolean;
  className?: string;
  label?: string;
};

export const BotFigure = forwardRef<BotHandle, Props>(function BotFigure(
  { look, state = "idle", paused = false, emphasis = false, follow = true, fps = 60, idle = "pause", clickPoke = false, fidget = true, className = "", label },
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

  // 隔几秒随机做一个小动作，跳一下、扭一扭、探个头，免得一直站着不动。
  const hush = quiet.has(state);
  const restingRef = useRef(resting);
  restingRef.current = resting;
  useEffect(() => {
    if (!fidget || paused || hush) return;
    let timer = 0;
    let clear = 0;
    const plan = () => {
      timer = window.setTimeout(() => {
        const element = host.current;
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
        if (element && !still && !document.hidden) {
          // 引擎休息时（闲着的头像会暂停省电）只用外层动作，不去叫醒它。
          const pool = restingRef.current ? fidgets.slice(0, 7) : fidgets;
          const move = pool[Math.floor(Math.random() * pool.length)];
          if (move === "spin" || move === "bounce" || move === "nod") poke(move);
          else {
            element.dataset.fidget = move;
            clear = window.setTimeout(() => delete element.dataset.fidget, FIDGET_MS);
          }
        }
        plan();
      }, between(5000, 12000));
    };
    plan();
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
      if (host.current) delete host.current.dataset.fidget;
    };
  }, [fidget, paused, hush]);

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (clickPoke && event.button === 0) poke();
  };

  return (
    <span
      ref={host}
      className={"bot-figure " + className}
      data-state={state}
      data-still={paused || undefined}
      data-poke={clickPoke || undefined}
      onPointerUp={clickPoke ? onPointerUp : undefined}
    />
  );
});
