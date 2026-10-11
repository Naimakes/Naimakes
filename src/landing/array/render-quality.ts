export type RenderQuality = {
  scale: number;
  pixelRatio: number;
  antialias: "off" | "smaa";
  shadows: number;
  aoSamples: number;
  aoResolution: number;
  depthOfField: number;
  transmission: number;
  anisotropy: number;
};

export const QUALITY: RenderQuality = {
  scale: 150,
  pixelRatio: 2,
  antialias: "smaa",
  shadows: 2048,
  aoSamples: 32,
  aoResolution: 1,
  depthOfField: 100,
  transmission: 1,
  anisotropy: 16,
};

const SUPERSAMPLE_BUDGET = 8_294_400;
export const supersampleBudget = (quality: RenderQuality) =>
  SUPERSAMPLE_BUDGET * Math.max(1, (quality.scale / 150) ** 2);

export function renderDimensions(
  quality: RenderQuality,
  width: number,
  height: number,
  stageScale: number,
  deviceRatio: number,
  maxTextureSize: number,
  pixelBudget = 8_294_400,
  supersamplePixels = supersampleBudget(quality),
  supersampleCap = Infinity,
) {
  const scale = quality.scale / 100;
  const requested =
    Math.min(deviceRatio, quality.pixelRatio) * stageScale * Math.min(1, scale);
  const ratio = Math.min(
    requested,
    Math.sqrt(pixelBudget / Math.max(1, width * height)),
    maxTextureSize / Math.max(1, width, height),
  );
  const canvasWidth = Math.max(1, Math.floor(width * ratio));
  const canvasHeight = Math.max(1, Math.floor(height * ratio));
  const wanted = Math.min(Math.max(1, scale), Math.max(1, supersampleCap));
  const supersample = Math.max(
    1,
    Math.min(
      wanted,
      Math.sqrt(supersamplePixels / (canvasWidth * canvasHeight)),
      maxTextureSize / Math.max(canvasWidth, canvasHeight),
    ),
  );
  return {
    ratio,
    width: canvasWidth,
    height: canvasHeight,
    supersample,
    renderWidth: Math.max(1, Math.round(canvasWidth * supersample)),
    renderHeight: Math.max(1, Math.round(canvasHeight * supersample)),
    limited: ratio < requested - 0.0001 || supersample < Math.max(1, scale) - 0.0001,
  };
}
