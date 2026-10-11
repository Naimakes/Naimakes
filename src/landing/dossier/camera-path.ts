import * as THREE from "three";

export type CameraKey = {
  t: number;
  target: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  dist: number;
  tanHalf: number;
  rest?: boolean;
};

function monotoneCubic(times: number[], values: number[], rests: boolean[] = []) {
  const n = times.length;
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) secant.push((values[i + 1] - values[i]) / (times[i + 1] - times[i]));
  const slope = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = secant[i - 1], b = secant[i];
    if (a * b <= 0 || rests[i]) continue;
    const h0 = times[i] - times[i - 1], h1 = times[i + 1] - times[i];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    slope[i] = (w1 + w2) / (w1 / a + w2 / b);
  }
  slope[n - 1] = n > 1 ? secant[n - 2] : 0;
  return (t: number) => {
    if (t <= times[0]) return values[0];
    if (t >= times[n - 1]) return values[n - 1] + slope[n - 1] * (t - times[n - 1]);
    let i = 0;
    while (t > times[i + 1]) i++;
    const h = times[i + 1] - times[i];
    const s = (t - times[i]) / h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * values[i] + (s3 - 2 * s2 + s) * h * slope[i]
      + (-2 * s3 + 3 * s2) * values[i + 1] + (s3 - s2) * h * slope[i + 1];
  };
}

export class CameraPath {
  private channels: ((t: number) => number)[];
  readonly end: number;

  constructor(keys: CameraKey[]) {
    const times = keys.map((k) => k.t);
    const columns: number[][] = [];
    const push = (index: number, value: number) => (columns[index] ??= []).push(value);
    for (const k of keys) {
      const forward = k.forward.clone().normalize();
      const up = k.up.clone().normalize();
      [k.target.x, k.target.y, k.target.z, forward.x, forward.y, forward.z, up.x, up.y, up.z, Math.log(k.dist), Math.log(k.tanHalf)]
        .forEach((value, index) => push(index, value));
    }
    const rests = keys.map((k) => Boolean(k.rest));
    this.channels = columns.map((values) => monotoneCubic(times, values, rests));
    this.end = times[times.length - 1];
  }

  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  apply(camera: THREE.PerspectiveCamera, t: number, push = 0, widen = 0) {
    const c = this.channels.map((channel) => channel(Math.min(t, this.end)));
    const forward = this.forward.set(c[3], c[4], c[5]).normalize();
    const up = this.up.set(c[6], c[7], c[8]);
    up.addScaledVector(forward, -up.dot(forward)).normalize();
    const right = this.right.crossVectors(forward, up).normalize();
    this.basis.makeBasis(right, up, forward.clone().negate());
    camera.quaternion.setFromRotationMatrix(this.basis);
    const dist = Math.exp(c[9]) * (1 - push);
    camera.position.set(c[0], c[1], c[2]).addScaledVector(forward, -dist);
    const tanHalf = Math.exp(c[10]) * (1 + widen);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf));
    camera.near = Math.max(0.02, dist * 0.02);
    camera.far = dist * 6 + 40;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return dist;
  }
}

export function orbitDirections(azimuthDeg: number, elevationDeg: number) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const forward = new THREE.Vector3(Math.cos(el) * Math.cos(az), -Math.sin(el), -Math.cos(el) * Math.sin(az));
  const up = new THREE.Vector3(Math.sin(el) * Math.cos(az), Math.cos(el), -Math.sin(el) * Math.sin(az));
  return { forward, up };
}
