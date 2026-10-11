import { letterforms } from "../ui/brand-marks";
import design from "../array/card-design.json";
import { escapeText as esc, pad } from "./cinema-helpers";

const [BOX_X, BOX_Y, BOX_W, BOX_H] = design.box;
export const CARD_BOX = { x: BOX_X, y: BOX_Y, width: BOX_W, height: BOX_H };

function groove(d: string, strength = 1) {
  return `<path d="${d}" class="dv-groove-lo" style="opacity:${strength}"/><path d="${d}" class="dv-groove" style="opacity:${strength}"/>`;
}

function screw(cx: number, cy: number, id: string) {
  const { seat, head } = design.screw;
  return `<g class="dv-screw" transform="translate(${cx} ${cy})">
  <circle r="${seat}" fill="url(#dv-seat)"/>
  <circle r="${seat}" fill="none" stroke="rgba(96,86,78,.42)" stroke-width="1.6"/>
  <circle r="${seat - 1.6}" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1" transform="translate(.8 .8)"/>
  <circle r="${head}" fill="url(#dv-head-${id})"/>
  <circle r="${head}" fill="none" stroke="rgba(70,64,82,.55)" stroke-width="1.1"/>
  <circle r="${head - 2.3}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>
  <path d="M-6.2 -3.6 L0 -7.2 L6.2 -3.6 L6.2 3.6 L0 7.2 L-6.2 3.6 Z" fill="#3f3b49" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>
  <path d="M-3 -1.7 L0 -3.5 L3 -1.7 L3 1.7 L0 3.5 L-3 1.7 Z" fill="#5d5869"/>
</g>`;
}

function headGradient(id: string, light: string, mid: string, dark: string) {
  return `<radialGradient id="dv-head-${id}" cx="38%" cy="32%" r="75%">
  <stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/>
</radialGradient>`;
}

function mark(x: number, y: number, width: number) {
  const s = width / 280;
  return `<g transform="translate(${x - 15 * s} ${y - 35.7 * s}) scale(${s})" fill="#121110"><path d="${letterforms.join("")}"/></g>`;
}

function deviceCardSvg(number: number) {
  const no = `NO.${pad(number, 3)}`;
  const s = design.stripes;
  const stripes = Array.from({ length: s.count }, (_, i) => {
    const x = s.x + i * s.step;
    return `<path d="M${x} ${s.bottom} L${x + s.rise} ${s.top} H${x + s.rise + s.cap}"/><circle cx="${x + s.dot[0]}" cy="${s.dot[1]}" r="${s.dot[2]}"/>`;
  }).join("");
  const [bx, by, bw, bh] = design.beige;
  const [lx, ly, lw, lh] = design.label;
  const L = design.lettering;
  const dial = design.dial;
  return `<svg class="dv-card-svg" viewBox="${BOX_X} ${BOX_Y} ${BOX_W} ${BOX_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
  <linearGradient id="dv-matte" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#e5dfda"/><stop offset=".55" stop-color="#e1dad5"/><stop offset="1" stop-color="#dcd4ce"/>
  </linearGradient>
  <radialGradient id="dv-seat" cx="50%" cy="50%" r="50%">
    <stop offset=".55" stop-color="#d6cec8"/><stop offset=".86" stop-color="#cbc2bb"/><stop offset="1" stop-color="#e2dbd5"/>
  </radialGradient>
  ${headGradient("tr", "#f3f2f8", "#a8a3b6", "#6d687d")}
  ${headGradient("bl", "#f6f6fb", "#b9b6c9", "#7a7690")}
  <linearGradient id="dv-beige" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d0bcad"/><stop offset="1" stop-color="#c8b2a2"/>
  </linearGradient>
  <linearGradient id="dv-label" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ebe7e3"/><stop offset="1" stop-color="#e5e0dc"/>
  </linearGradient>
</defs>

<!-- 卡面：米白哑光，外沿一圈倒角 -->
<rect x="${BOX_X}" y="${BOX_Y}" width="${BOX_W}" height="${BOX_H}" fill="url(#dv-matte)"/>
<path class="dv-bevel-hi" d="${design.bevelHi}"/>
<path class="dv-bevel-lo" d="${design.bevelLo}"/>
${groove(design.rim, 0.9)}

<!-- 左上：米色小方块 -->
<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="url(#dv-beige)"/>
<path d="M${bx} ${by + bh} H${bx + bw} V${by}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.2"/>

<!-- 小耳朵、胶囊槽、导轨（两只提手）、螺丝座外面那道弧、显示窗的内板、底边的小错台 -->
${design.grooves.map((g) => groove(g.d, g.strength)).join("\n")}

<!-- 内板上的刻线（平面图的用地红线） -->
<g class="dv-site">${design.site.map((g) => groove(g.d, g.strength)).join("")}</g>

<!-- 左下：两道小刻痕 -->
${design.ticks.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="#8d857d"/>`).join("")}

<!-- 右下：斜线纹 + 刻度盘 -->
<g class="dv-stripes-lo" transform="translate(1.2 1.2)">${stripes}</g>
<g class="dv-stripes">${stripes}</g>
<g class="dv-dial" transform="translate(${dial.center[0]} ${dial.center[1]})">
  ${dial.arcs.map((d) => groove(d, 1)).join("")}
  <circle r="${dial.ring}" class="dv-dial-ring"/>
  <circle r="${dial.dot}" class="dv-dial-dot"/>
</g>

<!-- 标签 -->
<g class="dv-label">
  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="url(#dv-label)" stroke="rgba(120,108,98,.22)" stroke-width="1"/>
  <rect x="${lx + 5}" y="${ly + 5.5}" width="${lw - 10}" height="3.6" fill="#121110"/>
  <text x="${lx + 8}" y="${ly + 37}" class="dv-label-name" textLength="176" lengthAdjust="spacingAndGlyphs">NAIMAKES FORUM</text>
  <rect x="${lx + 193}" y="${ly + 21}" width="75" height="15" fill="#121110"/>
  <path d="M${lx + 247} ${ly + 24} h3 v9 h-3z M${lx + 253} ${ly + 24} h2 v9 h-2z M${lx + 258} ${ly + 24} h4 v9 h-4z M${lx + 264} ${ly + 24} h1.6 v9 h-1.6z" fill="#e9e4e0"/>
  <text x="${lx + 10}" y="${ly + 55}" class="dv-label-db" textLength="122" lengthAdjust="spacingAndGlyphs">INTERNAL DATABASE</text>
  <text x="${lx + 268}" y="${ly + 58}" class="dv-label-info" text-anchor="end">INFO</text>
  <rect x="${lx + 5}" y="${ly + 61.5}" width="${lw - 10}" height="1.2" fill="rgba(29,27,25,.5)"/>
  <line x1="${lx + 203}" y1="${ly + 63}" x2="${lx + 203}" y2="${ly + 110}" stroke="rgba(29,27,25,.22)" stroke-width="1"/>
  <text x="${lx + 10}" y="${ly + 101}" class="dv-label-no" textLength="124" lengthAdjust="spacingAndGlyphs">${esc(no)}</text>
  ${mark(lx + 210, ly + 80, 57)}
  <rect x="${lx + 5}" y="${ly + 111.5}" width="${lw - 10}" height="1.2" fill="rgba(29,27,25,.28)"/>
</g>

<!-- 左侧竖排的模压字：NAIMAKES FORUM.（自上而下读，字顶朝里） -->
<g class="dv-letters" transform="translate(${L.x} ${L.y}) rotate(90)">
  <!-- 转了 90° 以后，文字坐标 (x, y) 落到屏幕上是 (−y, x)：暗边往屏幕右下、亮边往左上 -->
  <text class="dv-letters-lo" x="1.4" y="${-1.4 - (L.height - L.cap) / 2}" textLength="${L.length}" lengthAdjust="spacingAndGlyphs">NAIMAKES FORUM.</text>
  <text class="dv-letters-hi" x="-1.1" y="${1.1 - (L.height - L.cap) / 2}" textLength="${L.length}" lengthAdjust="spacingAndGlyphs">NAIMAKES FORUM.</text>
  <text class="dv-letters-face" y="${-(L.height - L.cap) / 2}" textLength="${L.length}" lengthAdjust="spacingAndGlyphs">NAIMAKES FORUM.</text>
</g>

${design.screws.map(([x, y], i) => screw(x, y, i === 0 ? "tr" : "bl")).join("")}
</svg>`;
}

export function createDeviceCard(number: number) {
  const root = document.createElement("div");
  root.className = "dv-card";
  root.innerHTML = `
<div class="dv-card-face">${deviceCardSvg(number)}</div>
<div class="dv-card-edge dv-card-edge-top"></div>
<div class="dv-card-edge dv-card-edge-bottom"></div>
<div class="dv-card-edge dv-card-edge-left"></div>
<div class="dv-card-edge dv-card-edge-right"></div>`;
  return root;
}
