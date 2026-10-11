import type * as THREE from "three";

const specularAntialiasGLSL = `
{
  vec3 aaNormalWidth = fwidth(normal);
  float aaVariance = min(0.2, 0.6 * dot(aaNormalWidth, aaNormalWidth));
  material.roughness = min(1.0, sqrt(material.roughness * material.roughness + aaVariance));
  #ifdef USE_CLEARCOAT
    material.clearcoatRoughness = min(1.0, sqrt(material.clearcoatRoughness * material.clearcoatRoughness + aaVariance));
  #endif
}`;

export function injectSpecularAntialias(shader: THREE.WebGLProgramParametersWithUniforms) {
  if (shader.fragmentShader.includes("aaNormalWidth")) return;
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <lights_physical_fragment>",
    `#include <lights_physical_fragment>\n${specularAntialiasGLSL}`,
  );
}
