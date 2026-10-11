export const APPROACH = {
  turn: [0, 2.6] as const,
  others: [0.15, 1.85] as const,
  bloom: [0, 0.7] as const,
  pull: [2.35, 2.5] as const,
  column: [2.4, 2.1] as const,
  end: 4.85,
  elevation: 11,
  pullRatio: 1.45,
  lift: 0.05,
  extract: 10,
};

export const FRONT_VIEW = { width: 0.46, height: 0.62, hfov: 12 };

export function easeOutSpring(u: number, k = 5.5) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return (1 - (1 + k * u) * Math.exp(-k * u)) / (1 - (1 + k) * Math.exp(-k));
}
