export type SpringState = { value: number; velocity: number };
export function stepSpring(state: SpringState, target: number, elapsed: number, stiffness = 105, damping = 21) {
  const dt = Math.min(Math.max(elapsed, 0), 0.05), steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    state.velocity += ((target - state.value) * stiffness - state.velocity * damping) * h;
    state.value += state.velocity * h;
  }
  return state.value;
}
export const nearestAngle = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
