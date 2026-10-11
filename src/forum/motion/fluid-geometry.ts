import { stepSpring, type SpringState } from "./spring-physics.ts";

export type FluidTarget = { left: number; width: number; height: number; top: number };
type FluidChoice = FluidTarget & { disabled?: boolean };

function validFluidChoices(choices: readonly FluidChoice[]) {
  return choices.flatMap((choice, index) => {
    const { left, width, top, height } = choice;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    return !choice.disabled && width > 0 && height > 0 &&
      [left, width, top, height, centerX, centerY].every(Number.isFinite)
      ? [{ choice, index, centerX, centerY }] : [];
  });
}

export function closestFluidTarget(choices: readonly FluidChoice[], centerX: number, centerY: number): number {
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return -1;
  let nearest = -1;
  let distance = Infinity;
  for (const item of validFluidChoices(choices)) {
    const candidate = Math.hypot(item.centerX - centerX, item.centerY - centerY);
    if (candidate < distance) {
      nearest = item.index;
      distance = candidate;
    }
  }
  return nearest;
}

export function interpolateFluidDrag(choices: readonly FluidChoice[], centerX: number, centerY: number): FluidTarget | null {
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
  const items = validFluidChoices(choices);
  if (!items.length) return null;

  const verticalDistance = (item: typeof items[number]) =>
    Math.max(0, Math.abs(item.centerY - centerY) - item.choice.height / 2);
  const anchor = items.reduce((nearest, item) => {
    const delta = verticalDistance(item) - verticalDistance(nearest);
    return delta < 0 || (delta === 0 && Math.abs(item.centerY - centerY) < Math.abs(nearest.centerY - centerY)) ? item : nearest;
  });
  const row = items.filter(item => {
    const overlap = Math.min(item.choice.top + item.choice.height, anchor.choice.top + anchor.choice.height) -
      Math.max(item.choice.top, anchor.choice.top);
    return overlap >= Math.min(item.choice.height, anchor.choice.height) / 2;
  }).sort((a, b) => a.centerX - b.centerX);
  const x = Math.max(row[0].centerX, Math.min(row[row.length - 1].centerX, centerX));
  const rightIndex = row.findIndex(item => item.centerX >= x);
  const right = row[rightIndex];
  const left = row[Math.max(0, rightIndex - 1)];
  const span = right.centerX - left.centerX;
  const progress = span > 0 ? (x - left.centerX) / span : 0;
  const width = left.choice.width + (right.choice.width - left.choice.width) * progress;
  return {
    left: x - width / 2,
    width,
    top: left.choice.top + (right.choice.top - left.choice.top) * progress,
    height: left.choice.height + (right.choice.height - left.choice.height) * progress,
  };
}

export function fluidMultiRow(boxes: readonly FluidTarget[]) {
  return boxes.some(box => boxes.some(other => other.top >= box.top + box.height / 2));
}

export function fluidVerticalNeighbor(boxes: readonly FluidTarget[], from: number, direction: 1 | -1) {
  const origin = boxes[from];
  if (!origin) return -1;
  const center = origin.top + origin.height / 2;
  const rows = boxes
    .map((box, index) => ({ index, box, middle: box.top + box.height / 2 }))
    .filter(item => direction > 0 ? item.middle > center + origin.height / 2 : item.middle < center - origin.height / 2);
  if (!rows.length) return -1;
  const nextRow = direction > 0 ? Math.min(...rows.map(r => r.middle)) : Math.max(...rows.map(r => r.middle));
  const x = origin.left + origin.width / 2;
  return rows
    .filter(r => Math.abs(r.middle - nextRow) < origin.height / 2)
    .reduce((best, r) => Math.abs(r.box.left + r.box.width / 2 - x) < Math.abs(best.box.left + best.box.width / 2 - x) ? r : best).index;
}

export type FluidState = {
  left: SpringState;
  right: SpringState;
  top: SpringState;
  height: SpringState;
  direction: -1 | 1;
};

export function createFluidState(target: FluidTarget): FluidState {
  return {
    left: { value: target.left, velocity: 0 },
    right: { value: target.left + target.width, velocity: 0 },
    top: { value: target.top, velocity: 0 },
    height: { value: target.height, velocity: 0 },
    direction: 1,
  };
}

export function advanceFluid(state: FluidState, target: FluidTarget, seconds: number) {
  const center = (state.left.value + state.right.value) / 2;
  const delta = target.left + target.width / 2 - center;
  if (Math.abs(delta) > 1) state.direction = delta > 0 ? 1 : -1;
  const rightLeads = state.direction > 0;
  stepSpring(state.left, target.left, seconds, rightLeads ? 390 : 720, rightLeads ? 31 : 40);
  stepSpring(state.right, target.left + target.width, seconds, rightLeads ? 720 : 390, rightLeads ? 40 : 31);
  stepSpring(state.top, target.top, seconds, 500, 36);
  stepSpring(state.height, target.height, seconds, 500, 36);
  return fluidShape(state, target);
}

export function fluidShape(state: FluidState, target: FluidTarget) {
  const center = (state.left.value + state.right.value) / 2;
  const width = Math.max(target.width * .82, Math.min(target.width * 1.65, state.right.value - state.left.value));
  const stretch = Math.max(0, width / Math.max(1, target.width) - 1);
  const speed = Math.abs(state.left.velocity + state.right.velocity) / 2;
  const refraction = Math.min(.58, stretch * .72 + Math.min(.16, speed / 7000));
  const settled = Math.abs(state.left.value - target.left) < .2 && Math.abs(state.right.value - target.left - target.width) < .2 && Math.abs(state.top.value - target.top) < .2 && Math.abs(state.height.value - target.height) < .2 && Math.abs(state.left.velocity) + Math.abs(state.right.velocity) < 3;
  return {
    left: center - width / 2,
    width,
    top: state.top.value,
    height: Math.max(1, state.height.value),
    scaleY: 1 - Math.min(.1, stretch * .17),
    direction: state.direction,
    refraction: settled ? 0 : refraction,
    settled,
    arrived: Math.abs(center - target.left - target.width / 2) < Math.max(3, target.width * .09),
  };
}
