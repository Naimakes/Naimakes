export async function rotateQuarterTurn(
  image: HTMLImageElement,
): Promise<{ url: string; width: number; height: number }> {
  const { naturalWidth: w, naturalHeight: h } = image;
  const canvas = document.createElement("canvas");
  canvas.width = h;
  canvas.height = w;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("旋转失败，请重试。");
  context.translate(h / 2, w / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(image, -w / 2, -h / 2, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("旋转失败，请重试。");
  return { url: URL.createObjectURL(blob), width: h, height: w };
}
