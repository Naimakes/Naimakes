import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { renderDimensions, supersampleBudget, type RenderQuality } from "./render-quality";

const resolveShader = {
  uniforms: {
    tSource: { value: null as THREE.Texture | null },
    sourceSize: { value: new THREE.Vector2(1, 1) },
    footprint: { value: 1 },
  },
  vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: `
uniform sampler2D tSource;
uniform vec2 sourceSize;
uniform float footprint;
varying vec2 vUv;
void main() {
  vec2 center = vUv * sourceSize;
  vec2 lo = center - 0.5 * footprint;
  vec2 hi = center + 0.5 * footprint;
  ivec2 first = ivec2(floor(lo));
  ivec2 last = ivec2(sourceSize) - 1;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int j = 0; j < 4; j++) {
    float y = float(first.y + j);
    float wy = min(hi.y, y + 1.0) - max(lo.y, y);
    if (wy <= 0.0) continue;
    for (int i = 0; i < 4; i++) {
      float x = float(first.x + i);
      float wx = min(hi.x, x + 1.0) - max(lo.x, x);
      if (wx <= 0.0) continue;
      vec4 c = texelFetch(tSource, clamp(ivec2(int(x), int(y)), ivec2(0), last), 0);
      float w = wx * wy / (1.0 + max(max(c.r, c.g), c.b));
      sum += c * w;
      total += w;
    }
  }
  gl_FragColor = sum / max(total, 1e-6);
}`,
};

export class SupersampleRenderPass extends Pass {
  supersample = 1;
  private width = 1;
  private height = 1;
  private target?: THREE.WebGLRenderTarget;
  private material = new THREE.ShaderMaterial({
    name: "SupersampleResolve",
    uniforms: THREE.UniformsUtils.clone(resolveShader.uniforms),
    vertexShader: resolveShader.vertexShader,
    fragmentShader: resolveShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.material);
  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    super();
    this.needsSwap = false;
  }
  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
  }
  setSupersample(value: number) {
    this.supersample = Math.max(1, value);
  }
  private sized(type: THREE.TextureDataType) {
    if (this.supersample <= 1.0001) {
      this.target?.dispose();
      this.target = undefined;
      return undefined;
    }
    const width = Math.round(this.width * this.supersample);
    const height = Math.round(this.height * this.supersample);
    if (!this.target || this.target.texture.type !== type) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(width, height, {
        type,
        depthBuffer: true,
        generateMipmaps: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      this.target.texture.name = "Supersample.color";
    } else if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
    }
    return this.target;
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const output = this.renderToScreen ? null : read;
    const target = this.sized(read.texture.type);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.setRenderTarget(target ?? output);
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      renderer.render(this.scene, this.camera);
      if (!target) return;
      const uniforms = this.material.uniforms;
      uniforms.tSource.value = target.texture;
      uniforms.sourceSize.value.set(target.width, target.height);
      uniforms.footprint.value = target.width / (output ? output.width : this.width);
      renderer.setRenderTarget(output);
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
  dispose() {
    this.target?.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

export class SupersampleGovernor {
  cap = Infinity;
  private last = 0;
  private frames = 0;
  private slow = 0;
  private quietUntil = 0;
  settle(now = performance.now(), duration = 2500) {
    this.quietUntil = Math.max(this.quietUntil, now + duration);
    this.frames = this.slow = 0;
  }
  frame(current: number, now = performance.now()) {
    const dt = now - this.last;
    this.last = now;
    if (current <= 1 || now < this.quietUntil || dt <= 0 || dt > 100) return false;
    this.frames++;
    if (dt > 21) this.slow++;
    if (this.frames < 90) return false;
    const dropping = this.slow >= 60;
    this.frames = this.slow = 0;
    if (!dropping) return false;
    this.cap = Math.max(1, Math.ceil(current * 4 - 1.0001) / 4);
    this.settle(now);
    return true;
  }
}

export function applyTextureQuality(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  quality: RenderQuality,
) {
  const maximum = Math.min(
    quality.anisotropy,
    renderer.capabilities.getMaxAnisotropy(),
  );
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.isRenderTargetTexture)
          textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    if (texture.anisotropy === maximum) continue;
    texture.anisotropy = maximum;
    texture.needsUpdate = true;
  }
}

export function resizeQuality(
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  host: HTMLElement,
  quality: RenderQuality,
  supersample?: SupersampleRenderPass,
  supersampleCap = Infinity,
) {
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const dimensions = renderDimensions(
    quality,
    width,
    height,
    host.getBoundingClientRect().width / width,
    devicePixelRatio,
    renderer.capabilities.maxTextureSize,
    8_294_400,
    supersampleBudget(quality),
    supersample ? supersampleCap : 1,
  );
  renderer.setPixelRatio(dimensions.ratio);
  renderer.setSize(width, height);
  composer.setPixelRatio(dimensions.ratio);
  composer.setSize(width, height);
  supersample?.setSupersample(dimensions.supersample);
  renderer.transmissionResolutionScale = quality.transmission / dimensions.supersample;
  return dimensions;
}
