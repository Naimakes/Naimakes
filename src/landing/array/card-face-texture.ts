import * as THREE from "three";
import design from "./card-design.json";
import cardFaceUrl from "../models/archive-card-face.webp?url";
import { LABEL_CANVAS, LABEL_INK, LABEL_NUMBER, drawCardLabel, labelNumberLayout } from "./card-spec";

const [BOX_X, BOX_Y, BOX_W, BOX_H] = design.box;
const [LX, LY, LW, LH] = design.label;

const CARD_FACE_BASE = new THREE.Color("#e1dad5");

export type CardFaceUniforms = ReturnType<typeof createCardFaceUniforms>;
export function createCardFaceUniforms() {
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  return {
    archiveFaceMap: { value: blank as THREE.Texture },
    archiveDigitMap: { value: blank as THREE.Texture },
    archiveFaceBase: { value: CARD_FACE_BASE.clone() },
    archiveFaceReady: { value: 0 },
    archiveNumberBox: { value: new THREE.Vector4() },
  };
}

async function loadFonts() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load("700 21px 'Newsreader Variable'", "NAIMAKES FORUM"),
    document.fonts.load("700 17.5px 'Newsreader Variable'", "INFO"),
    document.fonts.load(LABEL_NUMBER.font, "NO.0123456789"),
    document.fonts.load("600 8.5px 'Newsreader Variable'", "INTERNAL DATABASE"),
  ]).catch(() => {});
}

async function loadImage(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const blob = await response.blob();
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  URL.revokeObjectURL(image.src);
  return image;
}

export async function loadCardFace(
  uniforms: CardFaceUniforms,
  renderer: THREE.WebGLRenderer,
  mark: CanvasImageSource | null,
) {
  const [image] = await Promise.all([loadImage(cardFaceUrl), loadFonts()]);
  const fit = Math.min(1, renderer.capabilities.maxTextureSize / Math.max(image.width, image.height));
  const width = Math.floor(image.width * fit), height = Math.floor(image.height * fit);
  const scale = width / BOX_W;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.imageSmoothingQuality = "high";
  c.drawImage(image, 0, 0, width, height);
  if ("close" in image) image.close();
  c.save();
  c.scale(scale, scale);
  c.save();
  c.translate(LX - BOX_X, LY - BOX_Y);
  c.scale(LW / LABEL_CANVAS.width, LH / LABEL_CANVAS.height);
  drawCardLabel(c, null, mark);
  c.restore();
  c.strokeStyle = "rgba(120,108,98,.22)";
  c.lineWidth = 1;
  c.strokeRect(LX - BOX_X + 0.5, LY - BOX_Y + 0.5, LW - 1, LH - 1);
  c.restore();

  const layout = labelNumberLayout(c);
  const cell = { width: layout.digit, top: LABEL_NUMBER.size * 0.95, height: LABEL_NUMBER.size * 1.2 };
  const digits = document.createElement("canvas");
  digits.width = Math.ceil(cell.width * scale * 2) * 10;
  digits.height = Math.ceil(cell.height * scale * 2);
  const d = digits.getContext("2d")!;
  d.scale(digits.width / 10 / cell.width, digits.height / cell.height);
  d.font = LABEL_NUMBER.font;
  d.textBaseline = "alphabetic";
  d.fillStyle = d.strokeStyle = LABEL_INK;
  d.lineWidth = 0.45 / layout.squeeze;
  d.lineJoin = "round";
  for (let n = 0; n < 10; n++) {
    d.save();
    d.translate(n * cell.width, cell.top);
    d.scale(layout.squeeze, 1);
    d.fillText(String(n), 0, 0);
    d.strokeText(String(n), 0, 0);
    d.restore();
  }

  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const face = new THREE.CanvasTexture(canvas);
  face.colorSpace = THREE.SRGBColorSpace;
  face.anisotropy = anisotropy;
  face.name = "Archive.cardFace";
  const atlas = new THREE.CanvasTexture(digits);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = anisotropy;
  atlas.name = "Archive.cardDigits";
  uniforms.archiveFaceMap.value.dispose();
  uniforms.archiveFaceMap.value = face;
  uniforms.archiveDigitMap.value = atlas;
  uniforms.archiveNumberBox.value.set(
    LX + LABEL_NUMBER.x + layout.prefix,
    LY + LABEL_NUMBER.baseline - cell.top,
    cell.width,
    cell.height,
  );
  uniforms.archiveFaceReady.value = 1;
}

export function injectCardFace(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: CardFaceUniforms,
  options: { weight?: string; number?: { value: number } } = {},
) {
  Object.assign(shader.uniforms, uniforms);
  const instanced = !options.number;
  if (instanced) {
    shader.vertexShader =
      "attribute float archiveNumber;\nvarying float vArchiveNumber;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvArchiveNumber = archiveNumber;");
  } else shader.uniforms.archiveModelNumber = options.number!;
  const K = BOX_W / 5;
  shader.fragmentShader =
    `uniform sampler2D archiveFaceMap;
uniform sampler2D archiveDigitMap;
uniform vec3 archiveFaceBase;
uniform float archiveFaceReady;
uniform vec4 archiveNumberBox;
${instanced ? "varying float vArchiveNumber;" : "uniform float archiveModelNumber;\n#define vArchiveNumber archiveModelNumber"}
` +
    shader.fragmentShader.replace(
      "#include <lights_physical_fragment>",
      `if (archiveFaceReady > 0.5) {
        vec2 designPx = vec2(vArchiveLocal.x * ${K.toFixed(4)} + ${(BOX_X + BOX_W / 2).toFixed(1)}, ${(BOX_Y + BOX_H).toFixed(1)} - vArchiveLocal.y * ${K.toFixed(4)});
        vec2 faceUv = vec2((designPx.x - ${BOX_X.toFixed(1)}) / ${BOX_W.toFixed(1)}, 1.0 - (designPx.y - ${BOX_Y.toFixed(1)}) / ${BOX_H.toFixed(1)});
        vec3 face = texture2D(archiveFaceMap, faceUv).rgb;
        vec2 cellPos = (designPx - archiveNumberBox.xy) / archiveNumberBox.zw;
        if (vArchiveNumber > 0.5 && cellPos.x >= 0.0 && cellPos.x < 3.0 && cellPos.y >= 0.0 && cellPos.y < 1.0) {
          float slot = floor(cellPos.x);
          float number = floor(vArchiveNumber + 0.5);
          float digit = mod(floor(number / pow(10.0, 2.0 - slot)), 10.0);
          vec2 atlasUv = vec2((digit + fract(cellPos.x)) / 10.0, 1.0 - cellPos.y);
          vec2 atlasDx = dFdx(cellPos) * vec2(0.1, -1.0), atlasDy = dFdy(cellPos) * vec2(0.1, -1.0);
          float ink = textureGrad(archiveDigitMap, atlasUv, atlasDx, atlasDy).a;
          face = mix(face, vec3(0.0060, 0.0056, 0.0052), ink);
        }
        vec3 faceNormal = inverseTransformDirection(normal, viewMatrix);
        float onFace = smoothstep(0.55, 0.8, faceNormal.z) * step(0.15, vArchiveLocal.z) * (${options.weight ?? "1.0"});
        vec3 faceTint = mix(vec3(1.0), face / archiveFaceBase, onFace);
        diffuseColor.rgb *= faceTint;
        totalEmissiveRadiance *= faceTint;
      }
      #include <lights_physical_fragment>`,
    );
}
