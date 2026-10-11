import * as THREE from "three";
import { glassRevealGLSL, frostedTransmissionGLSL, FROSTED_ROUGHNESS } from "./card-glass-reveal.ts";
import { internalOpticsFragment } from "./card-internal-optics.ts";
import { injectStack, type StackUniforms } from "./array-stack-optics";
import { injectCardFace, type CardFaceUniforms } from "./card-face-texture";
import { injectSpecularAntialias } from "./specular-antialias";
import { CARD_HEIGHT } from "./card-spec";

type Surface = THREE.MeshPhysicalMaterial;
type Palette = { high: Surface; low?: Surface };

const GLASS = "Optical_Window";
export class CardAppearance {
  private palettes = new Map<string, Palette>();
  constructor(private stackUniforms?: StackUniforms, private cardFace?: CardFaceUniforms) {}
  register(name: string, high: Surface, low?: Surface) {
    this.palettes.set(name, { high, low });
  }

  prepare(group: THREE.Group) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const name = mesh.userData.surface as string;
      const palette = this.palettes.get(name);
      if (!palette) continue;
      const mat = palette.high.clone();
      const amount = { value: 0 };
      const clarity = { value: 0 };
      mesh.material = mat;
      if (mat.userData.opticalOrder)
        mesh.renderOrder = mat.userData.opticalOrder;
      mesh.userData.appearance = amount;
      mesh.userData.glassClarity = clarity;
      const glass = name === GLASS;
      const stacked = Boolean(this.stackUniforms && palette.low) && (name === "Frosted_Polymer" || name === "Ivory_Edges" || glass);
      const faced = Boolean(this.cardFace && palette.low) && (name === "Frosted_Polymer" || glass);
      const reliefs = { value: new THREE.Vector4(-40, -40, -40, -40) };
      const number = { value: 0 };
      if (stacked) mesh.userData.stackReliefs = reliefs;
      if (faced) mesh.userData.archiveNumber = number;
      mat.onBeforeCompile = (shader) => {
        injectSpecularAntialias(shader);
        if (stacked) {
          shader.uniforms.archiveStackReliefs = reliefs;
          shader.fragmentShader = "uniform vec4 archiveStackReliefs;\n" + shader.fragmentShader;
          injectStack(shader, this.stackUniforms!, "archiveStackReliefs", "(1.0 - archiveQuality)", false);
        }
        if (faced) injectCardFace(shader, this.cardFace!, { weight: "(1.0 - archiveQuality)", number });
        if (mat.userData.opticalOrder)
          shader.fragmentShader = internalOpticsFragment(shader.fragmentShader);
        shader.uniforms.archiveQuality = amount;
        shader.uniforms.archiveClarity = clarity;
        shader.fragmentShader =
          "uniform float archiveQuality;\nuniform float archiveClarity;\n" +
          shader.fragmentShader;
        if (glass) {
          shader.vertexShader =
            "varying float vArchiveHeight;\nvarying vec2 vArchiveProjectedAxis;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>\nvArchiveHeight = position.y / ${CARD_HEIGHT.toFixed(4)};`,
          );
          shader.fragmentShader =
            "varying float vArchiveHeight;\nvarying vec2 vArchiveProjectedAxis;\n" +
            glassRevealGLSL +
            shader.fragmentShader;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <project_vertex>",
            `#include <project_vertex>\nvArchiveProjectedAxis = ${(CARD_HEIGHT / 2).toFixed(4)} * vec2(projectionMatrix[0][0] * modelViewMatrix[1][0], projectionMatrix[1][1] * modelViewMatrix[1][1]) / max(0.0001, abs(mvPosition.z));`,
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <transmission_pars_fragment>",
            frostedTransmissionGLSL + "\n" + THREE.ShaderChunk.transmission_pars_fragment.replace(
              "float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );",
              "float lod = archiveTransmissionLod(roughness, ior, transmissionSamplerSize);",
            ),
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <roughnessmap_fragment>",
            `#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(0.34, ${FROSTED_ROUGHNESS}, archiveQuality), 0.025, glassRevealAtHeight(archiveClarity, vArchiveHeight));`,
          );
        } else if (!palette.low) {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            "#include <color_fragment>\nfloat coverage = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\nif (archiveQuality <= coverage) discard;",
          );
        }
      };
      mat.customProgramCacheKey = () =>
        `archive-surface-clarity-${name}-${Boolean(palette.low)}-${stacked}-${faced}`;
    }
  }

  setClarity(group: THREE.Group, value: number) {
    const clarity = THREE.MathUtils.clamp(value, 0, 1);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.userData.glassClarity)
        return;
      child.userData.glassClarity.value = clarity;
      if (child.userData.surface !== GLASS) return;
      this.showGlass(child);
      const mat = child.material as Surface;
      const palette = this.palettes.get(GLASS)!;
      const quality = child.userData.appearance.value as number;
      const baseline = (
        key: "thickness" | "transmission" | "attenuationDistance",
      ) => {
        const from = palette.low?.[key] ?? palette.high[key];
        return Number.isFinite(from) && Number.isFinite(palette.high[key])
          ? THREE.MathUtils.lerp(from, palette.high[key], quality)
          : palette.high[key];
      };
      mat.thickness = THREE.MathUtils.lerp(
        baseline("thickness"),
        0.018,
        clarity,
      );
      mat.transmission = THREE.MathUtils.lerp(
        baseline("transmission"),
        0.985,
        clarity,
      );
      mat.attenuationDistance = THREE.MathUtils.lerp(
        baseline("attenuationDistance"),
        8,
        clarity,
      );
    });
  }

  setStack(group: THREE.Group, reliefs: ArrayLike<number>) {
    group.traverse((child) => {
      const target = child.userData.stackReliefs?.value as THREE.Vector4 | undefined;
      target?.set(reliefs[0], reliefs[1], reliefs[2], reliefs[3]);
    });
  }

  setNumber(group: THREE.Group, value: number) {
    group.traverse((child) => {
      if (child.userData.archiveNumber) child.userData.archiveNumber.value = value;
    });
  }

  private showGlass(mesh: THREE.Mesh) {
    const clear = mesh.userData.glassClarity.value >= 0.999 && mesh.userData.appearance.value >= 0.999;
    mesh.visible = !clear;
  }

  apply(group: THREE.Group, value: number) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const palette = this.palettes.get(mesh.userData.surface);
      if (!palette) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = value;
        continue;
      }
      mesh.userData.appearance.value = value;
      if (mesh.userData.surface === GLASS) this.showGlass(mesh);
      const { high, low } = palette;
      if (!low) continue;
      const mat = mesh.material as Surface;
      mat.color.copy(low.color).lerp(high.color, value);
      if (
        mat.attenuationColor &&
        low.attenuationColor &&
        high.attenuationColor
      ) {
        mat.attenuationColor
          .copy(low.attenuationColor)
          .lerp(high.attenuationColor, value);
        mat.attenuationDistance =
          Number.isFinite(low.attenuationDistance) &&
          Number.isFinite(high.attenuationDistance)
            ? THREE.MathUtils.lerp(
                low.attenuationDistance,
                high.attenuationDistance,
                value,
              )
            : high.attenuationDistance;
      }
      for (const key of [
        "roughness",
        "metalness",
        "transmission",
        "thickness",
        "clearcoat",
        "clearcoatRoughness",
      ] as const) {
        mat[key] = THREE.MathUtils.lerp(low[key] ?? 0, high[key] ?? 0, value);
      }
      if (high.transmission > 0)
        mat.transmission = Math.max(0.000001, mat.transmission);
    }
  }

  dispose(group: THREE.Group) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (!mesh.userData.surface) mat.map?.dispose();
      mat.dispose();
    }
  }
}
