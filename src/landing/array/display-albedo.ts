import * as THREE from "three";

const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);

function aces(r: number, g: number, b: number, exposure: number): [number, number, number] {
  const k = exposure / 0.6;
  r *= k;
  g *= k;
  b *= k;
  const x = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const y = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
  const z = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(1.60475 * x - 0.53108 * y - 0.07367 * z),
    clamp(-0.10208 * x + 1.10813 * y - 0.00605 * z),
    clamp(-0.00327 * x - 0.07276 * y + 1.07602 * z),
  ];
}

const cache = new Map<string, [number, number, number]>();

export function displayAlbedo(target: THREE.Color, exposure: number, max = 1) {
  const key = `${target.r.toFixed(5)},${target.g.toFixed(5)},${target.b.toFixed(5)},${exposure.toFixed(3)},${max}`;
  let albedo = cache.get(key);
  if (!albedo) {
    const t = [target.r, target.g, target.b];
    const a = [...t];
    for (let i = 0; i < 60; i++) {
      const shown = aces(a[0], a[1], a[2], exposure);
      for (let j = 0; j < 3; j++) a[j] = Math.min(max, Math.max(0.0003, a[j] * Math.pow(t[j] / Math.max(1e-5, shown[j]), 0.8)));
    }
    albedo = [a[0], a[1], a[2]];
    cache.set(key, albedo);
  }
  return new THREE.Color(albedo[0], albedo[1], albedo[2]);
}

export function displayVertexColors(geometry: THREE.BufferGeometry, exposure: number) {
  const attribute = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!attribute) return;
  const color = new THREE.Color();
  for (let i = 0; i < attribute.count; i++) {
    color.setRGB(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    const albedo = displayAlbedo(color, exposure);
    attribute.setXYZ(i, albedo.r, albedo.g, albedo.b);
  }
  attribute.needsUpdate = true;
}
