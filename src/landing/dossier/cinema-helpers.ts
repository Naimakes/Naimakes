export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const span = (t: number, start: number, duration: number) =>
  duration <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / duration);

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const easeOutCubic = (k: number) => 1 - Math.pow(1 - clamp(k), 3);
export const easeInCubic = (k: number) => Math.pow(clamp(k), 3);
export const easeInOutCubic = (k: number) => {
  k = clamp(k);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};
export const smoothstep = (k: number) => {
  k = clamp(k);
  return k * k * (3 - 2 * k);
};

export function typed(text: string, progress: number) {
  const letters = Array.from(text);
  return letters.slice(0, Math.round(letters.length * clamp(progress))).join("");
}

export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export const escapeText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const pad = (value: number, digits = 2) => String(Math.max(0, Math.floor(value))).padStart(digits, "0");

export function canvasPixelRatio(host: HTMLElement, budget = 7_500_000) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  const stageScale = host.getBoundingClientRect().width / width || 1;
  const wanted = Math.min(window.devicePixelRatio || 1, 2) * stageScale;
  return Math.max(0.5, Math.min(wanted, Math.sqrt(budget / (width * height))));
}
