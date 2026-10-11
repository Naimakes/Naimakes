import { useMemo } from "react";
import { useEngine } from "./engine-loader";
import { swatchOf } from "./prefs";

export function ShapeThumb({ shape, color, size = 40 }: { shape: string; color: string; size?: number }) {
  const engine = useEngine();
  const src = useMemo(
    () => (engine ? engine.GrokBotMark.stillDataURI({ shape, size: 64, ink: swatchOf(color) }) : ""),
    [engine, shape, color],
  );
  return src ? (
    <img className="assistant-thumb" src={src} width={size} height={size} alt="" draggable={false} />
  ) : (
    <span className="assistant-thumb is-blank" style={{ width: size, height: size }} aria-hidden="true" />
  );
}
