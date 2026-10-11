import { useEffect, useState, type CSSProperties } from "react";

type Tone = { bg: string; edge: string; text: string; hover: string };

function sample(src: string): Promise<[number, number, number]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 8;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, img.naturalHeight / 2, img.naturalWidth, img.naturalHeight / 2, 0, 0, 24, 8);
        const data = ctx.getImageData(0, 0, 24, 8).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        const n = data.length / 4;
        resolve([r / n, g / n, b / n]);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = src;
  });
}

function toHsl([r, g, b]: [number, number, number]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function toneFor(rgb: [number, number, number]): Tone {
  const { h, s, l } = toHsl(rgb);
  const sat = Math.round(Math.min(s, 0.6) * 100);
  if (l < 0.3) {
    return {
      bg: `hsl(${h} ${sat}% 92% / .9)`,
      hover: `hsl(${h} ${sat}% 97% / .95)`,
      edge: `hsl(${h} ${sat}% 98% / .95)`,
      text: `hsl(${h} ${Math.min(sat, 40)}% 14%)`,
    };
  }
  return {
    bg: `hsl(${h} ${sat}% 15% / .86)`,
    hover: `hsl(${h} ${sat}% 21% / .9)`,
    edge: `hsl(${h} ${sat}% 70% / .45)`,
    text: "#fff",
  };
}

export function useBannerTone(src?: string | null): CSSProperties {
  const [tone, setTone] = useState<Tone | null>(null);
  useEffect(() => {
    setTone(null);
    if (!src) return;
    let live = true;
    sample(src)
      .then((rgb) => live && setTone(toneFor(rgb)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [src]);
  if (!tone) return {};
  return {
    "--banner-action-bg": tone.bg,
    "--banner-action-hover": tone.hover,
    "--banner-action-edge": tone.edge,
    "--banner-action-text": tone.text,
  } as CSSProperties;
}
