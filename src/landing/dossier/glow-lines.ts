import * as THREE from "three";

const vertexShader = `
uniform vec2 uResolution;
uniform float uMinPixels;
uniform float uNear;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aCorner;
attribute float aWidth;
varying vec4 vLine;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec4 s = modelViewMatrix * vec4(aStart, 1.0);
  vec4 e = modelViewMatrix * vec4(aEnd, 1.0);
  float zn = -uNear;
  if (s.z > zn && e.z > zn) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLine = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (s.z > zn) s.xyz = mix(s.xyz, e.xyz, (zn - s.z) / (e.z - s.z));
  else if (e.z > zn) e.xyz = mix(e.xyz, s.xyz, (zn - e.z) / (s.z - e.z));

  vec4 cs = projectionMatrix * s;
  vec4 ce = projectionMatrix * e;
  vec2 ps = cs.xy / cs.w * 0.5 * uResolution;
  vec2 pe = ce.xy / ce.w * 0.5 * uResolution;
  vec2 dir = pe - ps;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  vec2 across = vec2(-dir.y, dir.x);

  bool atStart = aCorner.x < 0.5;
  vec4 clip = atStart ? cs : ce;
  float depth = atStart ? -s.z : -e.z;
  float focal = projectionMatrix[1][1] * 0.5 * uResolution.y;
  float truePx = aWidth * focal / max(depth, 1e-4);
  float drawPx = max(truePx, uMinPixels);
  float halfPx = 0.5 * drawPx;
  float reach = halfPx + 1.0;
  clip.xy += across * aCorner.y * reach * 2.0 / uResolution * clip.w;
  gl_Position = clip;
  vLine = vec4(aCorner.y * reach, halfPx, truePx / drawPx, 1.0) * clip.w;
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSoft;
varying vec4 vLine;

#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>
  float w = vLine.w;
  float offset = abs(vLine.x / w);
  float halfPx = vLine.y / w;
  float energy = vLine.z / w;
  float cover = clamp(halfPx + 0.5 - offset, 0.0, 1.0);
  float t = clamp(offset / max(halfPx, 1e-3), 0.0, 1.0);
  float profile = mix(1.0, (1.0 - t) * (1.0 - t), uSoft);
  float alpha = cover * profile * energy * uOpacity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, alpha);
}`;

type GlowLineOptions = {
  color: THREE.ColorRepresentation;
  intensity?: number;
  opacity?: number;
  minPixels?: number;
  additive?: boolean;
  segment?: number;
  soft?: number;
};

type Segment = { a: THREE.Vector3; b: THREE.Vector3; width: number };

export class GlowLines {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private segments: Segment[] = [];
  private resolution = new THREE.Vector2(1, 1);
  private options: Required<GlowLineOptions>;

  constructor(options: GlowLineOptions) {
    this.options = { intensity: 1, opacity: 1, minPixels: 1.4, additive: true, segment: 2.5, soft: 0, ...options };
    const color = new THREE.Color(this.options.color).multiplyScalar(this.options.intensity);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: color },
        uOpacity: { value: this.options.opacity },
        uSoft: { value: this.options.soft },
        uResolution: { value: this.resolution },
        uMinPixels: { value: this.options.minPixels },
        uNear: { value: 0.06 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: this.options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    const size = new THREE.Vector2();
    this.mesh.onBeforeRender = (renderer) => {
      const target = renderer.getRenderTarget();
      if (target) this.resolution.set(target.width, target.height);
      else this.resolution.copy(renderer.getDrawingBufferSize(size));
    };
  }

  add(a: THREE.Vector3, b: THREE.Vector3, width: number) {
    const length = a.distanceTo(b);
    const pieces = Math.max(1, Math.ceil(length / this.options.segment));
    for (let i = 0; i < pieces; i++)
      this.segments.push({ a: a.clone().lerp(b, i / pieces), b: a.clone().lerp(b, (i + 1) / pieces), width });
    return this;
  }

  polyline(points: THREE.Vector3[], width: number, closed = false) {
    for (let i = 0; i < points.length - 1; i++) this.add(points[i], points[i + 1], width);
    if (closed && points.length > 2) this.add(points[points.length - 1], points[0], width);
    return this;
  }

  build() {
    const count = this.segments.length;
    const start = new Float32Array(count * 4 * 3);
    const end = new Float32Array(count * 4 * 3);
    const corner = new Float32Array(count * 4 * 2);
    const width = new Float32Array(count * 4);
    const position = new Float32Array(count * 4 * 3);
    const index: number[] = [];
    const corners = [
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
    ];
    this.segments.forEach((segment, i) => {
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        segment.a.toArray(start, v * 3);
        segment.b.toArray(end, v * 3);
        (corners[k][0] ? segment.b : segment.a).toArray(position, v * 3);
        corner[v * 2] = corners[k][0];
        corner[v * 2 + 1] = corners[k][1];
        width[v] = segment.width;
      }
      const o = i * 4;
      index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    });
    const geometry = this.mesh.geometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aStart", new THREE.BufferAttribute(start, 3));
    geometry.setAttribute("aEnd", new THREE.BufferAttribute(end, 3));
    geometry.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    geometry.setAttribute("aWidth", new THREE.BufferAttribute(width, 1));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    this.segments = [];
    return this.mesh;
  }
}
