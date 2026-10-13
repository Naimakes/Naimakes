import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { MarkInstance, PokeKind } from "./engine/grok-bot-mark";
import { loadEngine } from "./engine-loader";
import type { AssistantPrefs } from "./prefs";

export type BotLook = Pick<AssistantPrefs, "shape" | "color">;
export type BotHandle = { poke: (kind?: PokeKind) => void; blink: () => void };

const pokeCycle: PokeKind[] = ["spin", "bounce", "nod"];
const IDLE_PAUSE_MS = 1400;
// 闲着的时候最常做的两件事：眨眼，和左右扭扭头、抬头看一看。身体大小不变，只是脸和头在动。
const calmStates = new Set(["idle", "listening", "humming"]);
const glances = ["left", "right", "left", "right", "up"] as const;
const between = (min: number, max: number) => min + Math.random() * (max - min);
const stillMotion = () => document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";

type Props = {
  look: BotLook;
  state?: string;
  paused?: boolean;
  emphasis?: boolean;
  follow?: boolean;
  fps?: number;
  idle?: "pause" | "alive";
  clickPoke?: boolean;
  life?: boolean;
  className?: string;
  label?: string;
};

export const BotFigure = forwardRef<BotHandle, Props>(function BotFigure(
  { look, state = "idle", paused = false, emphasis = false, follow = true, fps = 60, idle = "pause", clickPoke = false, life = true, className = "", label },
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

  const calm = calmStates.has(state);
  // 只对一直「活着」的头像（idle="alive"）做：暂停（休息）的引擎会忽略眨眼，脸也停在休息的姿势上。
  const lively = life && idle === "alive";
  useEffect(() => {
    if (!lively || paused || !calm) return;
    let blinkTimer = 0;
    let doubleTimer = 0;
    let glanceTimer = 0;
    let backTimer = 0;
    const blink = () => {
      blinkTimer = window.setTimeout(() => {
        if (!stillMotion()) {
          bot.current?.blink();
          if (Math.random() < 0.2) doubleTimer = window.setTimeout(() => bot.current?.blink(), 420);
        }
        blink();
      }, between(2600, 6200));
    };
    const glance = () => {
      glanceTimer = window.setTimeout(() => {
        if (!stillMotion() && bot.current) {
          bot.current.look(glances[Math.floor(Math.random() * glances.length)]);
          backTimer = window.setTimeout(() => bot.current?.look("center"), between(1100, 1900));
        }
        glance();
      }, between(7000, 15000));
    };
    blink();
    glance();
    return () => {
      clearTimeout(blinkTimer);
      clearTimeout(doubleTimer);
      clearTimeout(glanceTimer);
      clearTimeout(backTimer);
      bot.current?.look("center");
    };
  }, [lively, paused, calm]);

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
