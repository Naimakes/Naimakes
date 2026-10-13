import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { thinkingModes, updatePrefs, usePrefs } from "./prefs";

// 仪表盘图标：弧线填充的长度和指针的角度都跟随当前档位。
function GaugeIcon({ level }: { level: number }) {
  const start = 150;
  const sweep = 240;
  const point = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [12 + r * Math.cos(a), 12 + r * Math.sin(a)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from, 9);
    const [x2, y2] = point(to, 9);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)}A9 9 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const filled = start + (sweep * (level + 0.5)) / thinkingModes.length;
  const [nx, ny] = point(filled, 5.2);
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d={arc(start, start + sweep)} stroke="currentColor" strokeOpacity=".22" strokeWidth="2.2" strokeLinecap="round" />
      <path d={arc(start, filled)} stroke="var(--assistant-accent, #4169e8)" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="12" y1="12" x2={nx} y2={ny} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.2" fill="var(--assistant-bg, #fff)" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

// 滑杆两端留出的距离（px），等于滑块半宽，这样滑块停在两端时不会超出滑杆。
const PAD = 18;

// 思考强度：输入框里的仪表盘按钮，点开后是一条悬浮的滑杆，可以拖动、点选或用方向键调整。
export function ThinkingGauge({ disabled = false }: { disabled?: boolean }) {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const last = thinkingModes.length - 1;
  const level = Math.max(0, thinkingModes.findIndex((m) => m.id === prefs.thinking));
  const mode = thinkingModes[level];

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (index: number) => {
    const next = thinkingModes[Math.max(0, Math.min(last, index))];
    if (next.id !== prefs.thinking) updatePrefs({ thinking: next.id });
  };
  const pick = (event: ReactPointerEvent) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = (event.clientX - box.left - PAD) / Math.max(1, box.width - PAD * 2);
    choose(Math.round(Math.max(0, Math.min(1, ratio)) * last));
  };
  const onKey = (event: ReactKeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    choose(level + step);
  };

  return (
    <div className="assistant-gauge" ref={root}>
      <button
        type="button"
        className={"assistant-gauge-button" + (open ? " is-open" : "")}
        aria-label={`思考强度：${mode.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        title={`思考强度：${mode.label}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <GaugeIcon level={level} />
      </button>
      {open && (
        <div className="assistant-gauge-pop" id={id} role="dialog" aria-label="思考强度">
          <strong className="assistant-gauge-title">{mode.label}</strong>
          <div
            ref={track}
            className={"assistant-gauge-track" + (dragging ? " is-dragging" : "")}
            style={{ "--gauge-pad": `${PAD}px`, "--gauge-at": level / last } as CSSProperties}
            role="slider"
            tabIndex={0}
            aria-label="思考强度"
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={level}
            aria-valuetext={mode.label}
            onKeyDown={onKey}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
              pick(event);
            }}
            onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && pick(event)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onLostPointerCapture={() => setDragging(false)}
          >
            <span className="assistant-gauge-fill" />
            {thinkingModes.map((m, index) => (
              <span key={m.id} className={"assistant-gauge-stop" + (index <= level ? " is-passed" : "")} style={{ left: `calc(var(--gauge-pad) + (100% - 2 * var(--gauge-pad)) * ${index / last})` }} />
            ))}
            <span className="assistant-gauge-knob" />
          </div>
          <p className="assistant-gauge-hint">{mode.hint}</p>
        </div>
      )}
    </div>
  );
}
