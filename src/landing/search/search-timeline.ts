const SPRING_POINTS: [number, number][] = [
  [0, 0], [0.016, 0.1063], [0.029, 0.198], [0.043, 0.2819], [0.056, 0.358], [0.069, 0.4267], [0.081, 0.4909],
  [0.093, 0.5505], [0.106, 0.6056], [0.119, 0.6581], [0.132, 0.7059], [0.145, 0.7508], [0.159, 0.7911],
  [0.173, 0.8282], [0.188, 0.8621], [0.203, 0.8935], [0.219, 0.9211], [0.236, 0.9457], [0.254, 0.967],
  [0.274, 0.9853], [0.295, 1.0006], [0.319, 1.0127], [0.346, 1.0213], [0.379, 1.0263], [0.42, 1.0272],
  [0.486, 1.0222], [0.626, 1.0082], [0.735, 1.0022], [0.893, 0.9997], [1, 1],
];

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const span = (t: number, start: number, duration: number) => (duration <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / duration));

export function spring(u: number) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let i = 1;
  while (SPRING_POINTS[i][0] < u) i++;
  const [x0, y0] = SPRING_POINTS[i - 1];
  const [x1, y1] = SPRING_POINTS[i];
  return y0 + ((y1 - y0) * (u - x0)) / (x1 - x0);
}

export function bouncy(u: number, zeta = 0.66, velocity = 2) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const omega = 7 / zeta;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 + Math.exp(-zeta * omega * u) * (-Math.cos(damped * u) + ((velocity - zeta * omega) / damped) * Math.sin(damped * u));
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) break;
      const d = slope(t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lo = 0, hi = 1;
    if (Math.abs(sampleX(t) - x) > 1e-5) {
      t = x;
      for (let i = 0; i < 24; i++) {
        if (sampleX(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sampleY(t);
  };
}

export const easeOut = cubicBezier(0.16, 1, 0.3, 1);
export const easeInOut = cubicBezier(0.65, 0, 0.35, 1);
export const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const EXTRACT = {
  camera: 1.45,
  wave: 0.3,
  first: 1.65,
  gap: 2,
  lift: 0.95,
  turnDelay: 0.3,
  turn: 0.78,
  clarityDelay: 0.2,
  clarity: 0.75,
  handoff: 1.12,
  crossfade: 0.12,
  flight: 0.9,
  height: 3.9,
  toward: 1.1,
  tray: [0.75, 0.95] as const,
};

export const extractStart = (i: number) => EXTRACT.first + i * EXTRACT.gap;
export const handoffTime = (i: number) => extractStart(i) + EXTRACT.handoff;
export const flightStart = (i: number) => handoffTime(i) + EXTRACT.crossfade;
export const landTime = (i: number) => flightStart(i) + EXTRACT.flight;
export const flightProgress = (u: number) => bouncy(u, 0.72, 1.8);

type Rect = { x: number; y: number; w: number; h: number };
const DOCK = { gap: 18, floor: 0.35 };
export function dockRect(from: Rect, to: Rect, p: number): Rect {
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  const tx = to.x + to.w / 2, ty = to.y + to.h / 2;
  const reach = tx - fx;
  const entry = reach > 0 ? Math.min(1, Math.max(DOCK.floor, 1 - (to.w + DOCK.gap) / reach)) : 1;
  const settle = smooth(p / entry);
  const w = lerp(from.w, to.w, settle), h = lerp(from.h, to.h, settle);
  return { x: lerp(fx, tx, p) - w / 2, y: lerp(fy, ty, settle) - h / 2, w, h };
}

const bell = (x: number, width: number) => Math.exp(-0.5 * (x / width) ** 2);
export function searchWave(row: number, lane: number, t: number) {
  const phase = row + lane * 1.1;
  const front = -18 + (t - EXTRACT.wave) * 24;
  const envelope = smooth((t - EXTRACT.wave) / 0.28) * (1 - smooth((t - 1.55) / 0.6));
  const packet = 1.35 * bell(phase - front, 3.1) - 0.38 * bell(phase - front + 5.5, 3);
  return envelope * packet;
}

export const WIPE = { line: 0.3, spread: 0.38, cover: 0.06, clear: 0.42, stagger: 0.09 };
export const WIPE_TOTAL = WIPE.line + WIPE.spread + WIPE.cover + WIPE.clear;
