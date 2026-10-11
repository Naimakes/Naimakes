import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cinematicField, extraction } from "../../src/landing/array/array-motion.ts";

const shot = Number(process.argv[2] ?? 27.1);
const out = process.argv[3] ?? fileURLToPath(new URL("./array-state.json", import.meta.url));

const COLUMN_SPACING = 5.2;
const ROW_SPACING = 0.62;
const LOOP_COLUMNS = 9;
const LOOP_ROWS = 32;

const ease = (t) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = THREE.MathUtils.lerp;
const rad = THREE.MathUtils.degToRad;

const zoom = 0.55 * ease((shot - 27.3) / 1.65) + 0.45 * ease((shot - 29.0) / 5.0);
const detail = zoom;
const selected = { lane: 2, row: 12 };
const cellPosition = ({ lane, row }) =>
  new THREE.Vector3((lane - 2) * COLUMN_SPACING, -4.6, (row - 15.5) * ROW_SPACING);
const field = (row, lane) => cinematicField(row, lane, shot, selected.row, selected.lane);

const entranceTime = THREE.MathUtils.clamp((shot - 21.92) / 0.75, 0, 1);
const entryZ = -23 * (1 - entranceTime) ** 2;
const lift = extraction(shot);
const chosen = cellPosition(selected);
const modelPosition = new THREE.Vector3(
  chosen.x,
  chosen.y + field(selected.row, selected.lane) + lift,
  chosen.z + entryZ,
);
const modelRotationX =
  (field(selected.row + 0.5, selected.lane) - field(selected.row - 0.5, selected.lane)) *
  0.024 * (1 - detail) * (1 - ease(lift / 0.4));

const orbit = ease((shot - 22.6) / 1.6);
const settle = ease((shot - 24.25) / 2.25);
const yaw = rad(89 - 22 * orbit - 8 * settle);
const elevation = rad(3 + 40 * ease((shot - 21.96) / 0.22) - 8 * orbit - 16 * settle);
const span = lerp(lerp(10.8, 10.3, orbit), 7.33, settle);
const distance = lerp(lerp(28 + 7 * orbit, 140, settle), 72, detail);
const cameraAim = new THREE.Vector3(
  -1.091,
  lerp(-2.55 + 0.4 * orbit, -0.045, settle),
  lerp(2.48, 0.481, settle),
);
const earlyTurn = ease((shot - 27.3) / 1.3);
const finalTurn = ease((shot - 28.6) / 5.4);
const shotYaw = yaw - rad(9 * earlyTurn + 32 * finalTurn);
const shotElevation = elevation - rad(1.5 * earlyTurn + 3.7 * finalTurn);
const viewDirection = new THREE.Vector3(
  -Math.sin(shotYaw) * Math.cos(shotElevation),
  Math.sin(shotElevation),
  Math.cos(shotYaw) * Math.cos(shotElevation),
);
const basis = () => {
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirection).normalize();
  const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
  return { right, up };
};
{
  const pan = ease((shot - 25.4) / 0.95);
  cameraAim.addScaledVector(basis().right, -2.05 * (1 - pan) * ease((shot - 24.2) / 0.8));
}
if (shot >= 25.05 && shot <= 27.3) {
  const pan = ease((shot - 25.4) / 1.05);
  const { right, up } = basis();
  const pixelScale = 1080 / span;
  const anchorAim = modelPosition.clone().add(new THREE.Vector3(-2.5, 3.7, 0));
  anchorAim.addScaledVector(right, -(lerp(840, 518, pan) - 960) / pixelScale);
  anchorAim.addScaledVector(up, -(540 - lerp(340, 288, pan)) / pixelScale);
  cameraAim.lerp(anchorAim, ease((shot - 25.05) / 0.35));
}
if (shot > 27.3) {
  const close = ease((shot - 27.3) / 6.7);
  const extractionCamera = ease((shot - 27.3) / 1.25);
  const screenX = lerp(518 - 98 * extractionCamera, 618, close);
  const screenY = lerp(296 + 34 * extractionCamera, 287, close);
  const pixelScale = 1080 / lerp(span, 5.9, detail);
  const { right, up } = basis();
  const anchorAim = modelPosition.clone().add(new THREE.Vector3(-2.5, 3.7, 0));
  anchorAim.addScaledVector(right, -(screenX - 960) / pixelScale);
  anchorAim.addScaledVector(up, -(540 - screenY) / pixelScale);
  cameraAim.lerp(anchorAim, ease((shot - 27.3) / 0.5));
}
const cameraPosition = cameraAim.clone().addScaledVector(viewDirection, distance);
const fov = THREE.MathUtils.radToDeg(2 * Math.atan(lerp(span, 5.9, detail) / (2 * distance)));

const fogNear = distance + lerp(5, -1, detail);
const fogFar = distance + lerp(25, 12, detail);
const forward = new THREE.Vector3().subVectors(cameraAim, cameraPosition);
forward.y = 0;
forward.normalize();
const flatRight = new THREE.Vector3(-forward.z, 0, forward.x);
const floodDirection = forward.clone().multiplyScalar(0.72)
  .add(new THREE.Vector3(0, 0.66, 0)).addScaledVector(flatRight, -0.2).normalize();

const wrapNear = (value, center, period) =>
  value + Math.floor((center - value + period / 2) / period) * period;
const cells = [];
for (let l = 0; l < LOOP_COLUMNS; l++) {
  for (let r = 0; r < LOOP_ROWS; r++) {
    const lane = wrapNear(l, selected.lane, LOOP_COLUMNS);
    const row = wrapNear(r, selected.row, LOOP_ROWS);
    if (lane === selected.lane && row === selected.row) continue;
    const p = cellPosition({ lane, row });
    const y = p.y + field(row, lane);
    const z = p.z + entryZ;
    const slope = field(row + 0.5, lane) - field(row - 0.5, lane);
    cells.push({ lane, row, position: [p.x, y, z], rotationX: slope * 0.024 * (1 - detail) });
  }
}
cells.sort((a, b) => a.lane - b.lane || a.row - b.row);

const state = {
  shot,
  videoTime: +(shot - 1.1).toFixed(2),
  selected: { ...selected, position: modelPosition.toArray(), rotationX: modelRotationX, lift },
  camera: {
    position: cameraPosition.toArray(),
    aim: cameraAim.toArray(),
    verticalFovDeg: fov,
    aspect: 16 / 9,
    distance,
  },
  fog: { color: "#e9e5e1", near: fogNear, far: fogFar },
  floor: { y: -4.63 },
  floodLight: { direction: floodDirection.toArray(), distance: 36 },
  cells,
};
writeFileSync(out, JSON.stringify(state, null, 1));
console.log(
  `shot ${shot}: ${cells.length} cells, lift ${lift.toFixed(3)}, camera distance ${distance.toFixed(2)}, ` +
  `fov ${fov.toFixed(3)}°, fog ${fogNear.toFixed(1)}–${fogFar.toFixed(1)} → ${out}`,
);
