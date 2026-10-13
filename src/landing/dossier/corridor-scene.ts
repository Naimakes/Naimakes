import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { createGL, createComposer, studioEnvironment, disposeTree, canvasTexture, type GLStage } from "./webgl-helpers";
import { nmkExtrudedGeometry } from "../ui/nmk-logo";
import { GlowLines } from "./glow-lines";
import { injectSpecularAntialias } from "../array/specular-antialias";
import { easeInOutCubic, easeInCubic, lerp, clamp, seeded } from "./cinema-helpers";

const HALF = 2.05;
const FLOOR_HALF = 1.75;
const SKIRT = 0.3;
const WALL_TOP = 3.2;
const CEIL = 3.62;
const CEIL_HALF = 1.7;
const BAY = 3.2;
const BAYS = 11;
const START = 6.4;
const PORTAL_Z = START - BAYS * BAY;
const LENGTH = START - PORTAL_Z;
const MID = (START + PORTAL_Z) / 2;
const ROOM = 1.8;
const PLATE_Y = 3.4;
const OPEN_W = 2.7;
const OPEN_H = 2.72;
const TUNNEL = 1.3;

const EYE = 1.28;
const CAM_X = 0.12;
const Z_START = 1.4;
const Z_SETTLE = -2.4;
const RUSH = 18.6;
const VANISH_X = 0.384;
const VANISH_Y = -0.142;

const ORANGE = new THREE.Color("#ff6a00");
const YELLOW = new THREE.Color("#ffb000");
const AMBER = new THREE.Color("#ff9d2e");
const WARM_WHITE = new THREE.Color("#fff3e4");

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const FLOOR_SHADER = {
  name: "CorridorFloor",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uBase: { value: new THREE.Color() },
    uOrange: { value: new THREE.Color() },
    uYellow: { value: new THREE.Color() },
    uFog: { value: new THREE.Color() },
    uFogRange: { value: new THREE.Vector2(40, 140) },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uHalf: { value: FLOOR_HALF },
    uBay: { value: BAY },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec3 uBase;
    uniform vec3 uOrange;
    uniform vec3 uYellow;
    uniform vec3 uFog;
    uniform vec2 uFogRange;
    uniform vec2 uTexel;
    uniform float uHalf;
    uniform float uBay;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>

    const vec2 TAPS[8] = vec2[8](
      vec2(-0.613, 0.354), vec2(0.271, 0.822), vec2(0.845, 0.192), vec2(0.462, -0.577),
      vec2(-0.218, -0.874), vec2(-0.906, -0.297), vec2(0.061, 0.105), vec2(-0.353, 0.765)
    );

    float seamAt(float d, float fw, float halfWidth) {
      fw = max(fw, 1e-5);
      float w = max(halfWidth, 0.5 * fw);
      return (1.0 - smoothstep(w - 0.5 * fw, w + 0.5 * fw, d)) * (halfWidth / w);
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      #include <logdepthbuf_fragment>
      vec3 toEye = cameraPosition - vWorld;
      float dist = length(toEye);
      float cosT = clamp(toEye.y / dist, 0.0, 1.0);
      float grazing = pow(1.0 - cosT, 2.0);

      vec2 uv = vUv.xy / vUv.w;
      vec3 sharp = texture2D(tDiffuse, uv).rgb;
      vec3 soft = vec3(0.0);
      float radius = 4.0 + 7.0 * cosT;
      for (int i = 0; i < 8; i++) soft += textureLod(tDiffuse, uv + TAPS[i] * radius * uTexel, 1.5).rgb;
      soft *= 0.125;
      vec3 reflection = mix(soft, sharp, 0.3);

      float dz = abs(fract(vWorld.z / (0.5 * uBay) + 0.5) - 0.5) * 0.5 * uBay;
      float dx = min(abs(vWorld.x - 0.58), abs(vWorld.x + 0.58));
      float seam = max(seamAt(dz, fwidth(vWorld.z), 0.0022), seamAt(dx, fwidth(vWorld.x), 0.0022));

      vec3 base = uBase * (0.965 + 0.06 * noise(vWorld.xz * vec2(0.8, 0.35)));
      float pool = mod(vWorld.z, uBay) - 0.5 * uBay;
      base *= 1.0 + 0.06 * exp(-pool * pool * 1.2);
      float left = vWorld.x + uHalf;
      float right = uHalf - vWorld.x;
      vec3 spill = uOrange * exp(-left * 6.0) * 0.3 + uYellow * exp(-right * 6.5) * 0.2;

      float k = mix(0.26, 0.88, grazing);
      vec3 col = mix(base, reflection, k) * (1.0 - 0.3 * seam) + spill;
      col = mix(col, uFog, smoothstep(uFogRange.x, uFogRange.y, dist) * 0.85);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(material: THREE.Material, geometry: THREE.BufferGeometry) {
    const list = this.parts.get(material) ?? [];
    list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
    this.parts.set(material, list);
  }
  box(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    this.add(material, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  }
  flush(parent: THREE.Object3D) {
    for (const [material, list] of this.parts) {
      for (const geometry of list) {
        geometry.deleteAttribute("uv1");
        if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((geometry.getAttribute("position").count) * 2), 2));
      }
      const merged = mergeGeometries(list, false);
      list.forEach((geometry) => geometry.dispose());
      if (merged) parent.add(new THREE.Mesh(merged, material));
    }
    this.parts.clear();
  }
}

function band(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, inward: THREE.Vector2) {
  const normal = new THREE.Vector2(-(y1 - y0), x1 - x0).normalize();
  if (normal.dot(inward) < 0) normal.negate();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([x0, y0, z0, x1, y1, z0, x0, y0, z1, x1, y1, z1], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(Array(4).fill([normal.x, normal.y, 0]).flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  const facing = (y1 - y0) * (z1 - z0) * normal.x - (x1 - x0) * (z1 - z0) * normal.y;
  geometry.setIndex(facing > 0 ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3]);
  return geometry;
}

function roomTexture(kind: "lab" | "gallery") {
  const W = 1024;
  const H = 290;
  return canvasTexture(W / 2, H / 2, (ctx) => {
    ctx.scale(0.5, 0.5);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, kind === "lab" ? "#ebe3d9" : "#ede7df");
    g.addColorStop(0.45, kind === "lab" ? "#cbc1b5" : "#d6cdc2");
    g.addColorStop(1, kind === "lab" ? "#a0958a" : "#ada295");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rect = (x: number, y: number, w: number, h: number, color: string, r = 0) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    };
    rect(0, 7, W, 7, "#ffffff");
    rect(0, 24, W, 4, "#fbf8f4");
    if (kind === "lab") {
      rect(660, 60, 364, 210, "#b8ada0");
      rect(672, 262, 340, 12, "#7a6f64");
      rect(684, 196, 316, 70, "#fbf8f3", 12);
      rect(912, 196, 88, 70, "#d6ccc0", 12);
      rect(726, 138, 234, 62, "#fdfbf8", 14);
      rect(890, 138, 70, 62, "#dcd3c7", 14);
      rect(774, 118, 140, 22, "#f6f2ec", 9);
      for (let i = 0; i < 4; i++) rect(738, 150 + i * 9, 104, 4, "#c9502c");
      rect(696, 230, 60, 5, "#c9502c");
      rect(300, 172, 300, 16, "#f6f2ec");
      rect(312, 188, 276, 80, "#b9aea1");
      for (const x of [400, 498]) rect(x, 192, 3, 72, "#8a7f73");
      rect(340, 132, 58, 40, "#4f4943", 3);
      rect(442, 122, 70, 50, "#5a534c", 3);
      rect(60, 48, 150, 222, "#efe9e1", 8);
      for (let i = 0; i < 6; i++) rect(78, 76 + i * 30, 96, 6, "#857a6e");
      rect(82, 250, 20, 10, "#ef7b34", 2);
      for (const x of [240, 640]) rect(x, 30, 4, 240, "#958b80");
      rect(0, 268, W, 22, "#9a8f83");
    } else {
      for (const x of [8, 264, 520, 776]) rect(x, 30, 3, 238, "#b9b0a5");
      for (const [x, w, h] of [[110, 110, 90], [470, 140, 110], [840, 90, 75]] as const) {
        rect(x, 265 - h, w, h, "#f8f5f0", 6);
        rect(x + w * 0.72, 265 - h, w * 0.28, h, "#d8d0c6", 6);
        rect(x - 4, 263, w + 8, 6, "#8f8479");
      }
      rect(290, 40, 120, 226, "#e6e0d8", 8);
      rect(300, 52, 16, 200, "#ffffff", 4);
      for (let i = 0; i < 3; i++) rect(300, 100 + i * 52, 100, 4, "#aca397");
      rect(690, 22, 5, 244, "#ffc34d");
      rect(620, 110, 150, 6, "#bdb4a9");
    }
    const image = ctx.getImageData(0, 0, W / 2, H / 2);
    blurImage(image.data, W / 2, H / 2, 3);
    ctx.putImageData(image, 0, 0);
  });
}

function blurImage(data: Uint8ClampedArray, w: number, h: number, r: number) {
  const a = Float32Array.from(data);
  const b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++)
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[(y * w + ((k + w) % w)) * 4 + c];
        for (let x = 0; x < w; x++) {
          b[(y * w + x) * 4 + c] = sum / n;
          sum += a[(y * w + ((x + r + 1) % w)) * 4 + c] - a[(y * w + ((x - r + w) % w)) * 4 + c];
        }
      }
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += b[(clamp(k, 0, h - 1) * w + x) * 4 + c];
        for (let y = 0; y < h; y++) {
          a[(y * w + x) * 4 + c] = sum / n;
          sum += b[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - b[(Math.max(0, y - r) * w + x) * 4 + c];
        }
      }
  }
  for (let i = 0; i < data.length; i++) data[i] = a[i];
}

export class Corridor {
  private gl: GLStage;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 140);
  private post: ReturnType<typeof createComposer>;
  private bloom: UnrealBloomPass;
  private bokeh: BokehPass;
  private mirror!: Reflector;
  private proxyFloor!: THREE.Mesh;
  private envTarget?: THREE.WebGLRenderTarget;
  private lines: GlowLines[] = [];
  private disposed = false;
  private yawTan = 0.235;
  private pitchTan = 0.049;
  private eye = new THREE.Vector3();
  private look = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private onPointer = (event: PointerEvent) => {
    const rect = this.host.getBoundingClientRect();
    this.pointerTarget.set(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
  };

  constructor(private host: HTMLElement) {
    this.gl = createGL(host);
    const { renderer } = this.gl;
    renderer.toneMappingExposure = 0.84;
    this.scene.background = new THREE.Color("#ded7cf");
    this.scene.fog = new THREE.Fog("#e2dbd3", 40, 140);
    this.scene.environment = studioEnvironment(renderer, 0.02);
    this.scene.environmentIntensity = 0.9;
    this.build();
    this.post = createComposer(renderer, this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.9);
    this.post.composer.addPass(this.bloom);
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 24, aperture: 0.00008, maxblur: 0.004 });
    this.post.composer.addPass(this.bokeh);
    this.post.finish();
    this.resize();
    window.addEventListener("pointermove", this.onPointer);
    this.warmPost();
    void this.prepare();
  }

  private warmPost() {
    this.scene.visible = false;
    this.bokeh.enabled = true;
    this.post.composer.render();
    this.bokeh.enabled = false;
    this.scene.visible = true;
  }

  private async prepare() {
    const { renderer } = this.gl;
    const probe = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(probe);
    const depth = new THREE.Mesh(new THREE.PlaneGeometry(), (this.bokeh as unknown as { _materialDepth: THREE.Material })._materialDepth);
    const pending = new Set([...renderer.compile(this.scene, this.camera), ...renderer.compile(depth, this.camera, this.scene)]);
    renderer.setRenderTarget(previous);
    try {
      while (pending.size && !this.disposed) {
        for (const material of pending) {
          const { currentProgram } = renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } };
          if (!currentProgram || currentProgram.isReady()) pending.delete(material);
        }
        if (pending.size) await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      if (!this.disposed) probe.dispose();
      depth.geometry.dispose();
    }
    if (this.disposed) return;
    await this.captureEnvironment();
  }

  private physical(parameters: THREE.MeshPhysicalMaterialParameters) {
    const material = new THREE.MeshPhysicalMaterial(parameters);
    material.onBeforeCompile = (shader) => injectSpecularAntialias(shader);
    return material;
  }

  private glow(color: THREE.Color, strength: number) {
    return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(strength), toneMapped: false });
  }

  private lineSet(options: ConstructorParameters<typeof GlowLines>[0]) {
    const set = new GlowLines(options);
    this.lines.push(set);
    return set;
  }

  private build() {
    const s = this.scene;
    const batch = new Batch();
    const m = {
      chrome: this.physical({ color: "#b1aaa2", metalness: 0.95, roughness: 0.18 }),
      plate: this.physical({ color: "#bfb8b0", metalness: 0.92, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.08 }),
      skirt: this.physical({ color: "#d3ccc4", metalness: 0.6, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
      slot: this.physical({ color: "#0b0c0d", metalness: 0.2, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: "#2f3033", roughness: 0.3, metalness: 0.7 }),
      white: this.physical({ color: "#efece8", roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.1 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: "#7d8180",
        roughness: 0.04,
        transparent: true,
        opacity: 0.22,
        envMapIntensity: 2.2,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        depthWrite: false,
      }),
    };

    const leds = this.lineSet({ color: WARM_WHITE, intensity: 2.6 });
    const faint = this.lineSet({ color: "#ffffff", intensity: 1.0, opacity: 0.8 });
    const seams = this.lineSet({ color: "#3b3834", additive: false, opacity: 0.45, minPixels: 1.2 });

    const mirror = new Reflector(new THREE.PlaneGeometry(FLOOR_HALF * 2, LENGTH + 1), {
      shader: FLOOR_SHADER,
      textureWidth: 1024,
      textureHeight: 1024,
      clipBias: 0.003,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.set(0, 0, MID - 0.5);
    const reflection = mirror.getRenderTarget().texture;
    reflection.generateMipmaps = true;
    reflection.minFilter = THREE.LinearMipmapLinearFilter;
    const uniforms = (mirror.material as THREE.ShaderMaterial).uniforms;
    uniforms.uBase.value.set("#f3eee8");
    uniforms.uOrange.value.copy(ORANGE);
    uniforms.uYellow.value.copy(YELLOW);
    uniforms.uFog.value.set("#e2dbd3");
    const updateMirror = mirror.onBeforeRender;
    mirror.onBeforeRender = function (renderer, scene, ...rest) {
      if (scene.overrideMaterial) return;
      updateMirror.call(this, renderer, scene, ...rest);
    };
    s.add(mirror);
    this.mirror = mirror;
    this.proxyFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_HALF * 2, LENGTH + 1).rotateX(-Math.PI / 2).translate(0, 0, MID - 0.5),
      new THREE.MeshStandardMaterial({ color: "#e6e1db", roughness: 0.25, metalness: 0.1 }),
    );
    this.proxyFloor.visible = false;
    s.add(this.proxyFloor);

    const marker = this.glow(AMBER, 1.5);
    for (let z = 0.8; z > PORTAL_Z + 1; z -= BAY / 2) {
      batch.box(marker, 0.13, 0.004, 0.042, -0.62, 0.002, z);
      if (z - 0.8 > PORTAL_Z + 1) batch.box(marker, 0.13, 0.004, 0.042, -0.36, 0.002, z - 0.8);
    }
    const inlay = this.lineSet({ color: ORANGE, intensity: 1.3, opacity: 0.85 });
    inlay.add(V(-1.42, 0.0015, START), V(-1.42, 0.0015, PORTAL_Z), 0.012);
    inlay.add(V(1.48, 0.0015, START), V(1.48, 0.0015, PORTAL_Z), 0.009);

    for (const side of [-1, 1]) {
      const inwardX = -side;
      batch.add(m.skirt, band(side * FLOOR_HALF, 0, side * HALF, SKIRT, START, PORTAL_Z, new THREE.Vector2(inwardX, 1)));
      batch.add(m.chrome, band(side * HALF, WALL_TOP, side * CEIL_HALF, CEIL, START, PORTAL_Z, new THREE.Vector2(inwardX, -1)));
      faint.add(V(side * (FLOOR_HALF - 0.0023), 0.0055, START), V(side * (FLOOR_HALF - 0.0023), 0.0055, PORTAL_Z), 0.006);
      faint.add(V(side * (CEIL_HALF + 0.004), CEIL - 0.009, START), V(side * (CEIL_HALF + 0.004), CEIL - 0.009, PORTAL_Z), 0.008);
      leds.add(V(side * (HALF - 0.019), WALL_TOP - 0.007, START), V(side * (HALF - 0.019), WALL_TOP - 0.007, PORTAL_Z), 0.024);
    }
    batch.add(m.chrome, band(-CEIL_HALF, CEIL, CEIL_HALF, CEIL, START, PORTAL_Z, new THREE.Vector2(0, -1)));

    const strips: [THREE.Color, number, number][] = [
      [ORANGE, -1, 2.0],
      [YELLOW, 1, 1.7],
    ];
    for (const [color, side, strength] of strips) {
      const x = side * (HALF - 0.023);
      const y = SKIRT + 0.0096;
      this.lineSet({ color, intensity: strength }).add(V(x, y, START), V(x, y, PORTAL_Z), 0.075);
      this.lineSet({ color, intensity: strength * 0.3, soft: 1 }).add(V(x, y + 0.004, START), V(x, y + 0.004, PORTAL_Z), 0.34);
    }

    const paneHeight = WALL_TOP - SKIRT;
    for (const side of [-1, 1]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(LENGTH, paneHeight), m.glass);
      pane.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      pane.position.set(side * HALF, SKIRT + paneHeight / 2, MID);
      pane.renderOrder = 1;
      s.add(pane);
      this.room(side, roomTexture(side < 0 ? "lab" : "gallery"));
      for (let k = 0; k < BAYS; k++) {
        const z = START - k * BAY;
        batch.box(m.dark, 0.022, paneHeight + 0.02, 0.014, side * (HALF - 0.011), SKIRT + paneHeight / 2, z);
      }
    }

    for (let k = 1; k < BAYS; k++) {
      const z = START - k * BAY;
      for (const side of [-1, 1]) {
        seams.add(V(side * (FLOOR_HALF - 0.004), 0.004, z), V(side * (HALF - 0.004), SKIRT, z), 0.005);
        seams.add(V(side * (HALF - 0.004), WALL_TOP + 0.004, z), V(side * (CEIL_HALF - 0.004), CEIL - 0.004, z), 0.005);
      }
      seams.add(V(-CEIL_HALF, CEIL - 0.004, z), V(CEIL_HALF, CEIL - 0.004, z), 0.005);
    }

    const hanger = new THREE.CylinderGeometry(0.007, 0.007, CEIL - PLATE_Y - 0.02, 10);
    for (let k = 0; k < BAYS; k++) {
      const zc = START - BAY / 2 - k * BAY;
      batch.add(m.plate, new RoundedBoxGeometry(2.72, 0.05, 1.06, 3, 0.018).translate(0, PLATE_Y, zc));
      for (const x of [-0.98, 0.98])
        for (const dz of [-0.34, 0.34]) batch.add(m.dark, hanger.clone().translate(x, (CEIL + PLATE_Y) / 2 + 0.005, zc + dz));
      // The tube runs down the middle of its shade and sits up inside it with only a thin lip showing,
      // so it never hides the far edge of the shade and the shade reads as reaching equally past it on both sides.
      const slotZ = zc;
      const slotH = 0.05;
      const slotY = PLATE_Y - 0.025 - 0.012 + slotH / 2;
      batch.box(m.slot, 2.36, slotH, 0.14, 0, slotY, slotZ);
      for (const side of [-1, 1])
        for (let i = 0; i < 3; i++) batch.box(m.chrome, 0.012, slotH + 0.004, 0.146, side * (1.13 - i * 0.075), slotY, slotZ);
      leds.add(V(-1.04, slotY - slotH / 2 - 0.001, slotZ), V(1.04, slotY - slotH / 2 - 0.001, slotZ), 0.03);
      faint.add(V(-1.34, PLATE_Y - 0.024, zc + 0.528), V(1.34, PLATE_Y - 0.024, zc + 0.528), 0.005);
    }
    hanger.dispose();

    const badge = new THREE.Group();
    const orange = this.physical({
      color: "#d9560a",
      metalness: 0.35,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      emissive: new THREE.Color("#ff6a10"),
      emissiveIntensity: 0.55,
    });
    badge.add(new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.036, 32, 256), orange));
    badge.add(new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.012, 24, 256), orange));
    const letters = new THREE.Mesh(nmkExtrudedGeometry(0.52, 0.03, 0.006), orange);
    letters.position.z = 0.03;
    badge.add(letters);
    badge.rotation.y = Math.PI / 2;
    badge.position.set(-HALF + 0.06, 1.78, -8.0);
    s.add(badge);

    const yellowLine = this.lineSet({ color: YELLOW, intensity: 1.9 });
    yellowLine.add(V(HALF - 0.035, SKIRT + 0.02, -6.33), V(HALF - 0.035, WALL_TOP - 0.02, -6.33), 0.024);
    const caseGlass = new THREE.MeshPhysicalMaterial({
      color: "#e6e8e8",
      roughness: 0.05,
      transparent: true,
      opacity: 0.3,
      envMapIntensity: 1.3,
      clearcoat: 1,
      depthWrite: false,
    });
    const caseEdges = this.lineSet({ color: "#ffffff", intensity: 1.15, opacity: 0.9 });
    const prism = new THREE.CylinderGeometry(0.3, 0.3, 1, 6, 1);
    for (const [z, h, y] of [[-4.6, 2.2, 1.55], [-5.5, 1.5, 1.2], [-11.2, 2.4, 1.6], [-17.6, 2.0, 1.4]] as const) {
      const matrix = new THREE.Matrix4().compose(V(HALF + 0.55, y, z), new THREE.Quaternion(), V(1, h, 0.62));
      const mesh = new THREE.Mesh(prism, caseGlass);
      mesh.applyMatrix4(matrix);
      mesh.renderOrder = 2;
      s.add(mesh);
      const edges = new THREE.EdgesGeometry(prism, 1);
      const p = edges.getAttribute("position");
      for (let i = 0; i < p.count; i += 2)
        caseEdges.add(V(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(matrix), V(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)).applyMatrix4(matrix), 0.005);
      edges.dispose();
    }

    this.portal(batch, m, faint);
    batch.flush(s);
    for (const set of this.lines) s.add(set.build());

    s.add(new THREE.HemisphereLight("#fffaf3", "#b9b1a7", 1.1));
    const key = new THREE.DirectionalLight("#fff5ea", 0.7);
    key.position.set(1.5, 8, 10);
    s.add(key);
  }

  private room(side: number, texture: THREE.Texture) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.set(LENGTH / 12.8, 1);
    const wallHeight = CEIL + 0.4;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(LENGTH, wallHeight), new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1.2, 1.2, 1.2) }));
    back.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    back.position.set(side * (HALF + ROOM), wallHeight / 2 - 0.2, MID);
    this.scene.add(back);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM, LENGTH).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#ddd6ce", roughness: 0.55 }),
    );
    floor.position.set(side * (HALF + ROOM / 2), 0, MID);
    this.scene.add(floor);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM, LENGTH).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#f3f0eb" }),
    );
    ceiling.position.set(side * (HALF + ROOM / 2), CEIL, MID);
    this.scene.add(ceiling);
  }

  private portal(batch: Batch, m: Record<string, THREE.Material>, faint: GlowLines) {
    const s = this.scene;
    const z0 = PORTAL_Z;
    const z1 = PORTAL_Z - TUNNEL;
    const mid = (z0 + z1) / 2;
    const sideWidth = HALF - OPEN_W / 2;
    for (const side of [-1, 1]) batch.box(m.chrome, sideWidth + 0.4, CEIL, TUNNEL, side * (OPEN_W / 2 + (sideWidth + 0.4) / 2), CEIL / 2, mid);
    batch.box(m.chrome, OPEN_W, CEIL - OPEN_H, TUNNEL, 0, OPEN_H + (CEIL - OPEN_H) / 2, mid);
    const frame = this.lineSet({ color: "#ffffff", intensity: 1.6 });
    for (const z of [z0 + 0.004, z1 - 0.004]) {
      const x = OPEN_W / 2 - 0.004;
      frame.polyline([V(-x, 0.003, z), V(-x, OPEN_H - 0.004, z), V(x, OPEN_H - 0.004, z), V(x, 0.003, z)], 0.012);
    }
    const random = seeded(4127);
    const shards: THREE.BufferGeometry[] = [];
    const place = (x: number, y: number, z: number, normal: THREE.Vector3, size: number) => {
      const geometry = new THREE.IcosahedronGeometry(1, 0);
      const p = geometry.getAttribute("position");
      const jitter = new Map<string, THREE.Vector3>();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!jitter.has(key)) jitter.set(key, V(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(0.55));
        const d = jitter.get(key)!;
        p.setXYZ(i, p.getX(i) + d.x, p.getY(i) + d.y, p.getZ(i) + d.z);
      }
      geometry.scale(size * (0.7 + random() * 0.6), size * (1.1 + random() * 0.9), size * 0.22);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal);
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - 0.5) * 0.9, (random() - 0.5) * 0.9, random() * Math.PI));
      geometry.applyQuaternion(tilt.premultiply(q));
      geometry.translate(x, y, z);
      shards.push(geometry);
    };
    for (let i = 0; i < 11; i++) {
      const y = 0.18 + i * 0.25;
      for (const side of [-1, 1])
        for (const depth of [0.25, 0.65, 1.05])
          if (random() > 0.18) place(side * (OPEN_W / 2 - 0.1 - random() * 0.08), y + random() * 0.1, z0 - depth, V(-side, 0, 0), 0.16 + random() * 0.08);
    }
    for (let i = 0; i < 10; i++) {
      const x = -OPEN_W / 2 + 0.2 + i * 0.26;
      for (const depth of [0.3, 0.8])
        if (random() > 0.15) place(x + random() * 0.08, OPEN_H - 0.09 - random() * 0.06, z0 - depth, V(0, -1, 0), 0.15 + random() * 0.08);
    }
    const crystalGeometry = mergeGeometries(shards, false)!;
    shards.forEach((g) => g.dispose());
    crystalGeometry.computeVertexNormals();
    const crystal = new THREE.Mesh(
      crystalGeometry,
      this.physical({
        color: "#e2e4e5",
        metalness: 0.45,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.5,
        flatShading: true,
        transparent: true,
        opacity: 0.88,
      }),
    );
    crystal.renderOrder = 2;
    s.add(crystal);
    const edges = new THREE.EdgesGeometry(crystalGeometry, 12);
    const shardLines = this.lineSet({ color: "#ffffff", intensity: 0.9, opacity: 0.4 });
    const p = edges.getAttribute("position");
    for (let i = 0; i < p.count; i += 2) shardLines.add(V(p.getX(i), p.getY(i), p.getZ(i)), V(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)), 0.003);
    edges.dispose();

    const riser = 0.16;
    const tread = 0.42;
    const stepWidth = 3.4;
    for (let i = 0; i < 8; i++) {
      const top = riser * (i + 1);
      const front = z1 - i * tread;
      batch.box(m.white, stepWidth, top, tread, 0, top / 2, front - tread / 2);
      faint.add(V(-stepWidth / 2, top + 0.002, front + 0.002), V(stepWidth / 2, top + 0.002, front + 0.002), 0.006);
    }
    const landing = 8 * riser;
    const hallZ = z1 - 8 * tread;
    const hallDepth = 5.5;
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#f6f3ee").multiplyScalar(1.28), toneMapped: false });
    batch.box(m.white, 6, 0.1, hallDepth, 0, landing - 0.05, hallZ - hallDepth / 2);
    batch.box(glow, 7, 4.2, 0.1, 0, landing + 2.1, hallZ - hallDepth);
    for (const side of [-1, 1]) batch.box(glow, 0.1, 4.2, hallDepth + TUNNEL + 8 * tread, side * 3, landing + 1.2, z1 - (hallDepth + 8 * tread) / 2);
    batch.box(glow, 6, 0.1, hallDepth + 8 * tread, 0, CEIL + 1.4, z1 - (hallDepth + 8 * tread) / 2);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.05), new THREE.MeshStandardMaterial({ color: "#e4e0da", roughness: 0.4 }));
    door.position.set(0.15, landing + 1.025, hallZ - hallDepth + 0.06);
    s.add(door);
    faint.polyline([V(-0.325, landing, hallZ - hallDepth + 0.065), V(-0.325, landing + 2.05, hallZ - hallDepth + 0.065), V(0.625, landing + 2.05, hallZ - hallDepth + 0.065), V(0.625, landing, hallZ - hallDepth + 0.065)], 0.008);
  }

  private async captureEnvironment() {
    const { renderer } = this.gl;
    const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(0.05, 120, cubeTarget);
    cube.position.set(0.1, 1.9, -11);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const steps: number[] = [];
    try {
      cube.updateMatrixWorld();
      if (cube.coordinateSystem !== renderer.coordinateSystem) {
        cube.coordinateSystem = renderer.coordinateSystem;
        cube.updateCoordinateSystem();
      }
      const faces = cube.children as THREE.PerspectiveCamera[];
      for (let pass = 0; pass < 2; pass++) {
        for (let face = 0; face < 6; face++) {
          const t = performance.now();
          this.mirror.visible = false;
          this.proxyFloor.visible = true;
          const current = renderer.getRenderTarget();
          renderer.setRenderTarget(cubeTarget, face);
          renderer.render(this.scene, faces[face]);
          renderer.setRenderTarget(current);
          this.mirror.visible = true;
          this.proxyFloor.visible = false;
          steps.push(performance.now() - t);
          if (pass === 0) {
            await nextFrame();
            if (this.disposed) return;
          }
        }
        cubeTarget.texture.needsPMREMUpdate = true;
        await nextFrame();
        if (this.disposed) return;
        const t = performance.now();
        const target = pmrem.fromCubemap(cubeTarget.texture);
        const previous = this.scene.environment;
        this.scene.environment = target.texture;
        if (this.envTarget) this.envTarget.dispose();
        else previous?.dispose();
        this.envTarget = target;
        steps.push(performance.now() - t);
        await nextFrame();
        if (this.disposed) return;
      }
    } finally {
      (window as unknown as { __envSteps: number[] }).__envSteps = steps;
      if (!this.disposed) {
        pmrem.dispose();
        cubeTarget.dispose();
      }
    }
  }

  resize() {
    const ratio = this.gl.resize();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const aspect = width / height;
    const halfV = clamp(0.36 / aspect, Math.tan(THREE.MathUtils.degToRad(19)), Math.tan(THREE.MathUtils.degToRad(31)));
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfV));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.yawTan = VANISH_X * clamp((aspect - 0.6) / 1.18, 0.25, 1) * halfV * aspect;
    this.pitchTan = -VANISH_Y * halfV;
    this.post.resize(width, height, ratio);
    this.bloom.resolution.set(width * ratio, height * ratio);
    const mirrorWidth = Math.round(width * ratio * 0.5);
    const mirrorHeight = Math.round(height * ratio * 0.5);
    this.mirror.getRenderTarget().setSize(mirrorWidth, mirrorHeight);
    (this.mirror.material as THREE.ShaderMaterial).uniforms.uTexel.value.set(1 / mirrorWidth, 1 / mirrorHeight);
  }

  render(progress: number, push = 0) {
    this.pointer.lerp(this.pointerTarget, 0.05);
    const k = easeInOutCubic(progress);
    const rush = easeInCubic(push);
    const z = lerp(Z_START, Z_SETTLE, k) - rush * RUSH;
    const straighten = 1 - 0.6 * easeInOutCubic(push);
    this.eye.set(CAM_X + this.pointer.x * 0.05, EYE - this.pointer.y * 0.035 + rush * 0.1, z);
    this.camera.position.copy(this.eye);
    this.look.set(
      this.eye.x - this.yawTan * straighten + this.pointer.x * 0.02,
      this.eye.y + this.pitchTan * straighten - this.pointer.y * 0.012,
      this.eye.z - 1,
    );
    this.camera.lookAt(this.look);
    const uniforms = this.bokeh.uniforms as Record<string, THREE.IUniform<number>>;
    this.bokeh.enabled = rush > 0.001;
    uniforms.focus.value = Math.max(4, z - PORTAL_Z);
    uniforms.aperture.value = rush * 0.001;
    uniforms.maxblur.value = rush * 0.018;
    this.post.composer.render();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("pointermove", this.onPointer);
    this.mirror.dispose();
    disposeTree(this.scene);
    this.envTarget?.dispose();
    this.post.dispose();
    this.gl.dispose();
  }
}
