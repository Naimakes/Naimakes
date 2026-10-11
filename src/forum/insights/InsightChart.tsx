import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMotionPreferences } from "../motion/motion-preferences";
import { countLabel } from "../api";

export type ChartSeries = { id: string; label: string; color: string; values: number[] };

const HEIGHT = 248;
const PAD = { top: 18, right: 18, bottom: 34, left: 46 };
const TWEEN = 620;

const ease = (t: number) => 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.35);

function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(value)));
  for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * step >= value) return k * step;
  return 10 * step;
}

function timeLabel(time: number, span: number) {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (span <= 2 * 86400000) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (span <= 400 * 86400000) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}`;
}

function fullTime(time: number) {
  return new Date(time).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function useTween(target: number[][], reduced: boolean) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  const key = JSON.stringify(target);
  useEffect(() => {
    const start = current.current;
    const same = start.length === target.length && start.every((row, i) => row.length === target[i].length);
    if (reduced || !same) {
      current.current = target;
      setShown(target);
      return;
    }
    from.current = start;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / TWEEN);
      const k = ease(t);
      const next = target.map((row, i) => row.map((v, j) => from.current[i][j] + (v - from.current[i][j]) * k));
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, reduced]);
  return shown;
}

export function InsightChart({
  times,
  series,
  indexed = false,
  label,
}: {
  times: number[];
  series: ChartSeries[];
  indexed?: boolean;
  label: string;
}) {
  const { reduced } = useMotionPreferences();
  const gradient = useId().replace(/:/g, "");
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotted = useMemo(
    () =>
      series.map((s) => {
        if (!indexed) return s.values;
        const top = s.values[s.values.length - 1] || 0;
        return s.values.map((v) => (top ? (v / top) * 100 : 0));
      }),
    [series, indexed],
  );
  const peak = indexed ? 100 : niceMax(Math.max(0, ...plotted.flat()));
  const shown = useTween([...plotted, [peak]], reduced);
  const lines = shown.slice(0, -1);
  const max = shown[shown.length - 1]?.[0] || peak;
  const w = width, h = HEIGHT;
  const iw = w - PAD.left - PAD.right, ih = h - PAD.top - PAD.bottom;
  const n = Math.max(1, times.length - 1);
  const x = (i: number) => PAD.left + (i / n) * iw;
  const y = (v: number) => PAD.top + ih - (Math.max(0, v) / (max || 1)) * ih;
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join("");
  const span = times.length ? times[times.length - 1] - times[0] : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = w < 420 ? [0, n / 2, n] : [0, n / 4, n / 2, (3 * n) / 4, n];
  const single = series.length === 1;
  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * w;
    setHover(Math.round(Math.min(n, Math.max(0, ((px - PAD.left) / iw) * n))));
  };
  const tipLeft = hover === null ? 0 : x(hover);
  const tipFlip = tipLeft > w - 190;
  return (
    <figure className="insight-chart" ref={wrapRef} aria-label={label}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={label}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={series[0]?.color} stopOpacity={0.2} />
            <stop offset="1" stopColor={series[0]?.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t} className="insight-grid">
            <line x1={PAD.left} x2={w - PAD.right} y1={PAD.top + ih * (1 - t)} y2={PAD.top + ih * (1 - t)} />
            <text x={PAD.left - 10} y={PAD.top + ih * (1 - t)} dy="0.35em" textAnchor="end">
              {indexed ? `${Math.round(t * 100)}%` : countLabel(Math.round(peak * t))}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={i}
            className="insight-axis"
            x={x(t)}
            y={h - 10}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          >
            {times.length ? timeLabel(times[Math.round(t)], span) : ""}
          </text>
        ))}
        {single && lines[0] && (
          <path
            className="insight-area"
            d={`${path(lines[0])}L${x(n)},${PAD.top + ih}L${x(0)},${PAD.top + ih}Z`}
            fill={`url(#${gradient})`}
          />
        )}
        {lines.map((values, i) => (
          <path key={series[i].id} className="insight-line" d={path(values)} stroke={series[i].color} />
        ))}
        {lines.map((values, i) => (
          <circle
            key={series[i].id + "-end"}
            className="insight-end"
            cx={x(n)}
            cy={y(values[values.length - 1] ?? 0)}
            r={4}
            fill={series[i].color}
          />
        ))}
        {hover !== null && (
          <g className="insight-cursor">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} />
            {lines.map((values, i) => (
              <circle key={series[i].id} cx={x(hover)} cy={y(values[hover] ?? 0)} r={5} fill={series[i].color} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && times[hover] !== undefined && (
        <div
          className="insight-tip"
          style={{ left: tipLeft, transform: `translateX(${tipFlip ? "calc(-100% - 14px)" : "14px"})` }}
          role="status"
        >
          <time>{fullTime(times[hover])}</time>
          {series.map((s) => (
            <span key={s.id}>
              <i style={{ background: s.color }} />
              {s.label}
              <b>{countLabel(s.values[hover] ?? 0)}</b>
            </span>
          ))}
        </div>
      )}
      {!single && (
        <figcaption className="insight-legend">
          {series.map((s) => (
            <span key={s.id}>
              <i style={{ background: s.color }} />
              {s.label}
              <b>{countLabel(s.values[s.values.length - 1] ?? 0)}</b>
            </span>
          ))}
          <small>各项按当前总量的百分比绘制，悬停查看实际数值</small>
        </figcaption>
      )}
    </figure>
  );
}
