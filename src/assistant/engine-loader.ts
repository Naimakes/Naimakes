import { useEffect, useState } from "react";

type Engine = typeof import("./engine/grok-bot-mark.js");

let promise: Promise<Engine> | null = null;
let loaded: Engine | null = null;

export const loadEngine = () =>
  (promise ||= import("./engine/grok-bot-mark.js").then((engine) => {
    loaded = engine;
    return engine;
  }));

export function useEngine() {
  const [engine, setEngine] = useState<Engine | null>(loaded);
  useEffect(() => {
    if (loaded) return setEngine(loaded);
    let live = true;
    loadEngine().then((value) => live && setEngine(value));
    return () => {
      live = false;
    };
  }, []);
  return engine;
}
