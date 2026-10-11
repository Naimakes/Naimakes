import * as THREE from "three";
import { letterforms } from "./brand-marks";

const NMK_BOUNDS = { x: 15, y: 35.7, width: 280, height: 71.6 };
const NMK_CENTER = { x: 155, y: 71.5 };
const NMK_VIEWBOX = `${NMK_BOUNDS.x} ${NMK_BOUNDS.y} ${NMK_BOUNDS.width} ${NMK_BOUNDS.height}`;
const NMK_PATH = letterforms.join("");

type MarkOptions = {
  fill?: string;
  className?: string;
  title?: string;
};

let glassId = 0;
export function nmkMarkSvg({ fill = "currentColor", className = "", title }: MarkOptions = {}) {
  const label = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
  if (fill !== "glass")
    return `<svg class="${className}" viewBox="${NMK_VIEWBOX}" ${label} focusable="false"><path d="${NMK_PATH}" fill="${fill}"/></svg>`;
  const id = `nmk-glass-${++glassId}`;
  return `<svg class="${className}" viewBox="${NMK_VIEWBOX}" ${label} focusable="false"><defs><linearGradient id="${id}-f" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".92"/><stop offset=".48" stop-color="#f4f1ed" stop-opacity=".58"/><stop offset="1" stop-color="#fff" stop-opacity=".82"/></linearGradient><linearGradient id="${id}-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#cfc6bd"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><path d="${NMK_PATH}" fill="url(#${id}-f)" stroke="url(#${id}-s)" stroke-width=".9" stroke-linejoin="round"/></svg>`;
}

type Point = { x: number; y: number };
function parsePolygons(d: string): Point[][] {
  const polygons: Point[][] = [];
  for (const chunk of d.split("M").map((part) => part.trim()).filter(Boolean)) {
    const numbers = chunk
      .replace(/[LZ]/g, " ")
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value));
    const polygon: Point[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) polygon.push({ x: numbers[i], y: numbers[i + 1] });
    if (polygon.length >= 3) polygons.push(polygon);
  }
  return polygons;
}

function nmkShapes(): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  for (const letter of letterforms)
    for (const polygon of parsePolygons(letter)) {
      const shape = new THREE.Shape();
      polygon.forEach((p, i) => {
        const x = p.x - NMK_CENTER.x;
        const y = -(p.y - NMK_CENTER.y);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
      shape.closePath();
      shapes.push(shape);
    }
  return shapes;
}

export function nmkExtrudedGeometry(width: number, depth: number, bevel = 0.18) {
  const unit = width / NMK_BOUNDS.width;
  const geometry = new THREE.ExtrudeGeometry(nmkShapes(), {
    depth: depth / unit,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel / unit,
    bevelSize: (bevel * 0.8) / unit,
    bevelSegments: 3,
    curveSegments: 1,
  });
  geometry.scale(unit, unit, unit);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(0, 0, -box.max.z);
  geometry.computeVertexNormals();
  return geometry;
}
