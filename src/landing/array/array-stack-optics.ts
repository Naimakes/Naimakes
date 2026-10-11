import * as THREE from "three";
import { ROW_SPACING } from "./array-loop";
import { CARD_FACE_Z, CARD_HEIGHT, CARD_WIDTH } from "./card-spec";
import { injectSpecularAntialias } from "./specular-antialias";

export const STACK_DEPTH = 4;
const CARD_HALF_WIDTH = CARD_WIDTH / 2;
const FACE_Z = CARD_FACE_Z;

const linear = (hex: string) => new THREE.Color(hex);

export function createStackUniforms() {
  return {
    archiveLightDir: { value: new THREE.Vector3(-6, 14, -5).normalize() },
    archiveStackBright: { value: linear("#f0e8e1") },
    archiveStackDeep: { value: linear("#7c6d61") },
    archiveStackGlow: { value: linear("#fce6d2") },
    archiveStackSky: { value: linear("#e9e5e1") },
    archiveStackTune: { value: new THREE.Vector4(0.9, 0.42, 0.24, 0.35) },
  };
}
export type StackUniforms = ReturnType<typeof createStackUniforms>;

const stackParsGLSL = `
uniform vec3 archiveLightDir;
uniform vec3 archiveStackBright;
uniform vec3 archiveStackDeep;
uniform vec3 archiveStackGlow;
uniform vec3 archiveStackSky;
uniform vec4 archiveStackTune;
#define ARCHIVE_ROW ${ROW_SPACING.toFixed(4)}
#define ARCHIVE_TOP ${CARD_HEIGHT.toFixed(3)}
#define ARCHIVE_FACE ${FACE_Z.toFixed(3)}
float archiveRelief(vec4 reliefs, int n) {
  return n == 0 ? reliefs.x : n == 1 ? reliefs.y : n == 2 ? reliefs.z : reliefs.w;
}
float archiveLightAt(float y, int m, vec4 reliefs, float spread) {
  float base = m == 0 ? 0.0 : archiveRelief(reliefs, m - 1);
  float depth = 0.0;
  for (int n = 0; n < ${STACK_DEPTH}; n++) {
    if (n < m) continue;
    float travel = float(n - m + 1) * ARCHIVE_ROW / max(0.05, -archiveLightDir.z);
    float hy = y + archiveLightDir.y * travel;
    float relief = archiveRelief(reliefs, n);
    float w = spread + 0.12 * float(n - m);
    depth += smoothstep(-w, w, ARCHIVE_TOP + relief - hy) * smoothstep(-w, w, hy - relief);
  }
  float below = max(0.0, ARCHIVE_TOP + base - y);
  float fromTop = exp(-below * 2.1);
  return clamp(exp(-1.25 * depth) * (0.14 + 0.86 * fromTop) + 0.12 * exp(-below * 0.5), 0.0, 1.0);
}
float archiveLayers(float z) {
  float cover = smoothstep(0.15, 0.172, z) * (1.0 - smoothstep(0.2, 0.21, z));
  float back = 1.0 - smoothstep(-0.098, -0.086, z);
  float plateOffset = (z + 0.05) / 0.012;
  float plate = exp(-plateOffset * plateOffset);
  float detail = 1.0 - smoothstep(0.004, 0.02, fwidth(z));
  return mix(0.74, 0.62 + 0.38 * max(cover, back) + 0.18 * plate, detail);
}
float archiveRim(vec3 p) {
  float d = min(${CARD_HALF_WIDTH.toFixed(3)} - abs(p.x), ARCHIVE_TOP - p.y);
  return exp(-max(d, 0.0) / 0.09);
}
vec3 archiveStackSeen(vec3 p, vec3 dir, vec4 reliefs, out float lit, out float ghost) {
  float passing = archiveStackTune.w;
  const vec3 layerTint = vec3(0.97, 0.94, 0.905);
  lit = archiveLightAt(p.y, 0, reliefs, 0.8);
  vec3 color = (1.0 - passing) * mix(archiveStackDeep, archiveStackBright, lit);
  float through = passing;
  vec3 tint = layerTint;
  ghost = 0.0;
  if (dir.z < -0.015) {
    for (int n = 0; n < ${STACK_DEPTH}; n++) {
      float travel = (float(n + 1) * ARCHIVE_ROW + p.z - ARCHIVE_FACE) / -dir.z;
      vec2 hit = p.xy + dir.xy * travel;
      float relief = archiveRelief(reliefs, n);
      float w = 0.06 + 0.1 * float(n);
      float top = ARCHIVE_TOP + relief - hit.y;
      float inside = smoothstep(-w, w, top) * smoothstep(-w, w, hit.y - relief);
      float layerLit = archiveLightAt(hit.y, n + 1, reliefs, 0.8 + 0.2 * float(n));
      color += through * inside * (1.0 - passing) * tint * mix(archiveStackDeep, archiveStackBright, layerLit);
      float edge = top / (w * 1.4 + 0.015);
      ghost += through * exp(-edge * edge);
      through *= mix(1.0, passing, inside);
      tint *= mix(vec3(1.0), layerTint, inside);
    }
  }
  return color + through * tint * archiveStackSky;
}
`;

export function injectStack(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: StackUniforms,
  reliefs: string,
  weight: string,
  instanced: boolean,
) {
  Object.assign(shader.uniforms, uniforms);
  injectSpecularAntialias(shader);
  shader.vertexShader =
    `varying vec3 vArchiveLocal;\n${instanced ? "attribute vec4 archiveStack;\nvarying vec4 vArchiveStack;\n" : ""}` +
    shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\nvArchiveLocal = position;${instanced ? "\nvArchiveStack = archiveStack;" : ""}`,
    );
  shader.fragmentShader =
    `uniform mat3 normalMatrix;\nvarying vec3 vArchiveLocal;\n${instanced ? "varying vec4 vArchiveStack;\n" : ""}${stackParsGLSL}\n` +
    shader.fragmentShader
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat archiveStackWeight = ${weight};\ndiffuseColor.rgb *= mix(1.0, 0.14, archiveStackWeight);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 archiveNormalWorld = inverseTransformDirection(normal, viewMatrix);
          vec3 archiveViewWorld = inverseTransformDirection(-vViewPosition, viewMatrix);
          float archiveLit, archiveGhost;
          vec3 archiveSeen = archiveStackSeen(vArchiveLocal, archiveViewWorld, ${reliefs}, archiveLit, archiveGhost);
          float archiveFace = smoothstep(0.35, 0.8, abs(archiveNormalWorld.z));
          vec3 archiveGlow = archiveStackGlow * archiveLit * archiveLit;
          vec3 archiveEdge = mix(archiveStackDeep, archiveStackBright, archiveLit) * archiveStackTune.y * archiveLayers(vArchiveLocal.z) + archiveGlow * archiveStackTune.z * 2.0;
          float archiveRimBand = archiveRim(vArchiveLocal);
          vec3 archiveFront = archiveSeen * archiveStackTune.x * (1.0 + 0.45 * archiveRimBand) + archiveStackBright * archiveGhost * 0.06 + archiveGlow * archiveStackTune.z * (1.0 + archiveRimBand);
          totalEmissiveRadiance += archiveStackWeight * mix(archiveEdge, archiveFront, archiveFace);
        }`,
      );
}
