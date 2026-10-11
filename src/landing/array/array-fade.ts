import type * as THREE from "three";

const patched = new WeakSet<THREE.Material>();

export function fadeMaterial(material: THREE.Material, whole?: { value: number }) {
  if (patched.has(material)) return;
  patched.add(material);
  const before = material.onBeforeCompile;
  const cache = material.customProgramCacheKey.bind(material)();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    if (whole) {
      shader.uniforms.archiveFadeAll = whole;
      shader.fragmentShader = "uniform float archiveFadeAll;\n" + shader.fragmentShader;
    } else {
      shader.vertexShader = "attribute float archiveFade;\nvarying float vArchiveFade;\n" +
        shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvArchiveFade = archiveFade;");
      shader.fragmentShader = "varying float vArchiveFade;\n" + shader.fragmentShader;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      `#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, max(smoothstep(fogNear, fogFar, vFogDepth), ${whole ? "archiveFadeAll" : "vArchiveFade"}));
#endif`,
    );
  };
  material.customProgramCacheKey = () => `${cache}-archive-fade-${whole ? "whole" : "instanced"}`;
}
