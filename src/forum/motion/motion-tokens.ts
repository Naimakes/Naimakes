export const motionTokens = {
  duration: { feedback: 0.15, interface: 0.28, overlay: 0.44, page: 0.58 },
  spring: {
    tactile: { stiffness: 580, damping: 32, mass: 0.55 },
    responsive: { stiffness: 480, damping: 36, mass: 0.8 },
    surface: { stiffness: 390, damping: 29, mass: 1 },
    spatial: { stiffness: 300, damping: 26, mass: 1 },
  },
  stagger: 0.022,
  distance: { magnet: 1.8, lift: 2, parallax: 1.2 },
} as const;
export const transitions = {
  tactile: { type: "spring", ...motionTokens.spring.tactile },
  responsive: { type: "spring", ...motionTokens.spring.responsive },
  surface: { type: "spring", ...motionTokens.spring.surface },
  spatial: { type: "spring", ...motionTokens.spring.spatial },
} as const;
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const ramp = (n: number, from: number, to: number) => clamp((n - from) / (to - from));
