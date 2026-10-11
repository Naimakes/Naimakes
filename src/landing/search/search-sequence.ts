import { createRollingNumber } from "@kitlangton/rolling-number";
import type { ArchiveScene } from "../array/array-scene";
import design from "../array/card-design.json";
import { CARD_CENTER_Y, CARD_FACE_Z, CARD_WIDTH, LABEL_CANVAS, drawCardLabel } from "../array/card-spec";
import type { ArchiveRecord, BoardInfo } from "../data/archive-data";
import { typed } from "../dossier/cinema-helpers";
import type { CardView } from "../dossier/reel-scene";
import cardFaceUrl from "../models/archive-card-face.webp?url";
import reelDeviceUrl from "../models/reel-device.glb?url";
import { labelMarkSvg } from "../ui/brand-marks";
import { escapeHtml } from "../ui/escape-html";
import { lineIcon } from "../ui/line-icons";
import type { ExtractionFrame } from "./extraction-layout";
import {
  EXTRACT,
  WIPE,
  WIPE_TOTAL,
  bouncy,
  clamp01,
  dockRect,
  easeOut,
  extractStart,
  flightProgress,
  flightStart,
  handoffTime,
  landTime,
  lerp,
  smooth,
  span,
  spring,
} from "./search-timeline";
import "./search-sequence.css";

type Point = [number, number];
type Quad = [Point, Point, Point, Point];
type Rect = { x: number; y: number; w: number; h: number };
type Wipe = { el: HTMLElement; block: HTMLElement; at: number; state: number; w: number; h: number };
type Slide = { el: HTMLElement; at: number; dx: number; state: number };
type Card = {
  index: number;
  order: number;
  el: HTMLElement;
  quad: Quad | null;
  released: boolean;
  well: Rect;
  big: Rect;
  slot: Rect;
  move: number;
  slide: boolean;
  cues: { item: { at: number }; offset: number }[];
  state: string;
};

type SequenceOptions = {
  stage: HTMLElement;
  scene?: ArchiveScene;
  records: ArchiveRecord[];
  boardOf: (record: ArchiveRecord) => BoardInfo;
  query: string;
  results: number[];
  total: number;
  reduced: boolean;
  onRead: (index: number, view: CardView) => void;
  onSearch: (query: string) => void;
  onLeave: () => void;
};

const ENLARGE = 1.9;
const PLACE_DELAY = 1.25;
const PLACE_GAP = 0.26;
const PLACE = 1.0;
const PLACE_CLEAR = 1;
const PLACE_ORDERS = 120;
const INFO_DELAY = 0.5;
const LEAVE = 0.8;
const READ_HFOV = 12;
const FACE_RATIO = 1554 / 1036;
const grown = (u: number) => bouncy(u, 0.74, 0.7);

const [BOX_X, BOX_Y, BOX_W, BOX_H] = design.box;
const [LX, LY, LW, LH] = design.label;

let mark: Promise<HTMLImageElement | null> | null = null;
function labelMark() {
  mark ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
  });
  return mark;
}

let face: Promise<CanvasImageSource | null> | null = null;
export function preloadCardFace() {
  face ??= fetch(cardFaceUrl)
    .then((response) => response.blob())
    .then((blob) => createImageBitmap(blob, { resizeWidth: 2048, resizeHeight: Math.round((2048 * BOX_H) / BOX_W), resizeQuality: "high" }))
    .catch(() => null);
  void labelMark();
  return face;
}

function quadMatrix(w: number, h: number, q: Quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g = 0, k = 0;
  if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
    a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + k * x3;
    d = y1 - y0 + g * y1; e = y3 - y0 + k * y3;
  }
  const n = (value: number) => (Math.abs(value) < 1e-12 ? "0" : value.toPrecision(9));
  return `matrix3d(${n(a / w)},${n(d / w)},0,${n(g / w)},${n(b / h)},${n(e / h)},0,${n(k / h)},0,0,1,0,${n(x0)},${n(y0)},0,1)`;
}

const rectQuad = (r: Rect): Quad => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
function quadRect(q: Quad): Rect {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });
function lerpQuad(a: Quad, b: Quad, k: number, arc: number): Quad {
  const ca = a.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  const cb = b.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
  const length = Math.hypot(dx, dy) || 1;
  let nx = dy / length, ny = -dx / length;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const bow = Math.sin(Math.PI * clamp01(k)) * arc * length;
  return a.map((p, i) => [lerp(p[0], b[i][0], k) + nx * bow, lerp(p[1], b[i][1], k) + ny * bow]) as Quad;
}

function placementPlan(big: Rect[], slot: Rect[]) {
  const n = big.length;
  const orders: number[][] = [];
  const permute = (rest: number[], head: number[]) => {
    if (!rest.length) orders.push(head);
    rest.forEach((value, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...head, value]));
  };
  permute([...big.keys()], []);
  const disorder = (order: number[]) => order.reduce((sum, value, i) => sum + order.slice(i + 1).filter((next) => next < value).length, 0);
  orders.sort((a, b) => disorder(a) - disorder(b));
  const at = (i: number, t: number, start: number[], slide: boolean[]) => {
    const u = (t - start[i]) / PLACE;
    if (u <= 0) return big[i];
    if (u >= 1) return slot[i];
    return slide[i] ? dockRect(slot[i], big[i], 1 - bouncy(u)) : quadRect(lerpQuad(rectQuad(big[i]), rectQuad(slot[i]), bouncy(u), 0.08));
  };
  const touch = (a: Rect, b: Rect) =>
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > -PLACE_CLEAR && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > -PLACE_CLEAR;
  const clash = (start: number[], slide: boolean[], from: number, to: number, only = -1) => {
    for (let t = from; t <= to; t += 1 / 120) {
      const rects = big.map((_, i) => at(i, t, start, slide));
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if ((only < 0 || a === only || b === only) && touch(rects[a], rects[b])) return true;
    }
    return false;
  };
  for (const order of orders.slice(0, PLACE_ORDERS)) {
    const start: number[] = [];
    order.forEach((i, step) => (start[i] = step * PLACE_GAP));
    const slide = big.map(() => false);
    let fits = true;
    for (const i of order) {
      if (!clash(start, slide, start[i], start[i] + PLACE, i)) continue;
      slide[i] = true;
      if (!clash(start, slide, start[i], start[i] + PLACE, i)) continue;
      fits = false;
      break;
    }
    if (fits && !clash(start, slide, 0, (n - 1) * PLACE_GAP + PLACE)) return { order, slide };
  }
  return { order: [...big.keys()], slide: big.map(() => false) };
}

function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let x = 0, y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

export function frontalCardView(rect: Rect, width: number, height: number): CardView {
  const tanH = Math.tan((READ_HFOV * Math.PI) / 360);
  const tanV = tanH / (width / height);
  const distance = (CARD_WIDTH * width) / (2 * tanH * rect.w);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const ox = ((cx - width / 2) / (width / 2)) * distance * tanH;
  const oy = -((cy - height / 2) / (height / 2)) * distance * tanV;
  return {
    card: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    camera: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -ox, CARD_CENTER_Y - oy, CARD_FACE_Z + distance, 1],
    fov: (2 * Math.atan(tanV) * 180) / Math.PI,
    face: { width: CARD_WIDTH, height: CARD_WIDTH / FACE_RATIO, center: [0, CARD_CENTER_Y, CARD_FACE_Z] },
  };
}

export class SearchSequence {
  readonly root: HTMLElement;
  private cards: Card[] = [];
  private wipes: Wipe[] = [];
  private slides: Slide[] = [];
  private start = -1;
  private now = 0;
  private phase: "play" | "ready" | "reading" | "leaving" = "play";
  private readonly extraction: boolean;
  private readonly enlarge: number;
  private readonly place: number;
  private readonly end: number;
  private leaveStart = -1;
  private leaveThen?: () => void;
  private tray: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private area: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private stageSize = { w: 1920, h: 1080 };
  private panel: HTMLElement;
  private glass: HTMLElement;
  private paper: HTMLElement;
  private head: HTMLElement;
  private wells: HTMLElement[] = [];
  private caption: HTMLElement;
  private counter: ReturnType<typeof createRollingNumber>;
  private landed = -1;
  private captionText = "";
  private resize: ResizeObserver;
  private abort = new AbortController();
  private reading: Card | null = null;
  private restoreTimer = 0;
  private arrayDone = false;
  private layoutDirty = true;
  private pageHeight = 1080;
  private faces: { image: CanvasImageSource | null; logo: HTMLImageElement | null } | null = null;
  private drawn = 0;

  constructor(private o: SequenceOptions) {
    const n = o.results.length;
    this.extraction = Boolean(o.scene) && !o.reduced;
    this.enlarge = this.extraction ? landTime(n - 1) + 0.3 : 0.45;
    this.place = this.enlarge + PLACE_DELAY;
    const lastInfo = this.place + (n - 1) * PLACE_GAP + INFO_DELAY;
    this.end = lastInfo + 4 * WIPE.stagger + WIPE_TOTAL + 0.05;
    this.root = document.createElement("section");
    this.root.className = "sq";
    this.root.dataset.phase = "play";
    this.root.setAttribute("aria-label", `搜索结果：${o.query}`);
    this.root.innerHTML = this.markup();
    o.stage.append(this.root);
    o.stage.dataset.search = "play";
    this.panel = this.q(".sq-panel");
    this.glass = this.q(".sq-panel-glass");
    this.paper = this.q(".sq-panel-paper");
    this.head = this.q(".sq-tray-head");
    this.caption = this.q(".sq-caption span");
    this.wells = [...this.root.querySelectorAll<HTMLElement>(".sq-well")];
    this.counter = createRollingNumber(this.q(".sq-count"), {
      value: 0,
      duration: 420,
      motionBlur: true,
      animated: !o.reduced,
      locales: "en-US",
      format: { minimumIntegerDigits: 2, useGrouping: false },
    });
    const faces = this.root.querySelectorAll<HTMLElement>(".sq-card");
    o.results.forEach((index, order) => {
      const el = faces[order];
      this.cards.push({ index, order, el, quad: null, released: false, well: { x: 0, y: 0, w: 0, h: 0 }, big: { x: 0, y: 0, w: 0, h: 0 }, slot: { x: 0, y: 0, w: 0, h: 0 }, move: this.place + order * PLACE_GAP, slide: false, cues: [], state: "" });
    });
    void Promise.all([preloadCardFace(), labelMark()]).then(([image, logo]) => {
      if (!this.abort.signal.aborted) this.faces = { image, logo };
    });
    this.root.addEventListener("click", (event) => this.onClick(event), { signal: this.abort.signal });
    this.root.addEventListener("pointerover", (event) => this.hover(event, true), { signal: this.abort.signal });
    this.root.addEventListener("pointerout", (event) => this.hover(event, false), { signal: this.abort.signal });
    this.resize = new ResizeObserver(() => {
      this.layoutDirty = true;
    });
    this.resize.observe(o.stage);
    void document.fonts?.ready.then(() => {
      this.layoutDirty = true;
    });
    this.layout();
    this.buildWipes();
    if (this.extraction) o.scene!.beginSearch(o.results, this.frame());
    else o.scene?.setSearchFade(1);
    requestAnimationFrame(() => this.q<HTMLButtonElement>(".sq-skip").focus({ preventScroll: true }));
  }

  private frame(): ExtractionFrame {
    return { width: this.stageSize.w, height: this.stageSize.h, area: this.area, wells: this.cards.map((card) => card.well) };
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.root.querySelector<T>(selector)!;
  }

  private markup() {
    const { records, results, query, total, boardOf } = this.o;
    const n = results.length;
    const wells = results.map((_, i) => `<div class="sq-well" aria-hidden="true"><span>${String(i + 1).padStart(2, "0")}</span></div>`).join("");
    const items = results
      .map((index, order) => {
        const r = records[index];
        const board = boardOf(r);
        return `<li class="sq-item" data-order="${order}">
  <div class="sq-slot" aria-hidden="true"></div>
  <div class="sq-tag" data-wipe>${escapeHtml(board.name)}</div>
  <div class="sq-info">
    <p class="sq-meta" data-wipe><i></i>${escapeHtml(r.id)} · ${escapeHtml(r.date)} · ${r.views || 0} 人阅读</p>
    <h3 class="sq-title" data-wipe title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</h3>
    <p class="sq-abstract" data-wipe>${escapeHtml(r.abstract)}</p>
    <div class="sq-foot-row">
      <dl class="sq-fields" data-wipe><div><dt>版块</dt><dd>${escapeHtml(board.name)}</dd></div><div><dt>作者</dt><dd>${escapeHtml(r.lead)}</dd></div></dl>
      <button type="button" class="sq-read" data-sq-read="${order}" aria-label="阅读详情：${escapeHtml(r.title)}">阅读详情 <span aria-hidden="true">→</span></button>
    </div>
  </div>
</li>`;
      })
      .join("");
    const cards = results
      .map(
        (_, order) =>
          `<div class="sq-card" data-sq-card="${order}"><div class="sq-card-face"><canvas></canvas></div></div>`,
      )
      .join("");
    return `
<div class="sq-panel" aria-hidden="true"><div class="sq-panel-glass"></div><div class="sq-panel-paper"></div></div>
<div class="sq-tray-head" aria-hidden="true"><div><small>RESULTS</small><b>检索结果</b></div><div class="sq-tray-count"><span class="sq-count">00</span><i>/ ${String(n).padStart(2, "0")}</i></div></div>
${wells}
<header class="sq-head">
  <p class="sq-eyebrow" data-wipe><i></i>SEARCH RESULTS / 检索结果</p>
  <h2 class="sq-query" data-wipe>「${escapeHtml(query)}」</h2>
  <p class="sq-summary" data-wipe>共找到 <b>${total}</b> 篇相关帖子，按符合程度抽取了 <b>${n}</b> 篇</p>
</header>
<nav class="sq-actions" aria-label="检索结果操作">
  <button type="button" class="nm-glass" data-sq="again">${lineIcon("search", 16)}重新搜索</button>
  <button type="button" class="nm-glass" data-sq="back">返回阵列 <kbd>ESC</kbd></button>
</nav>
<ol class="sq-grid" aria-label="检索到的帖子">${items}</ol>
<div class="sq-cards" aria-hidden="true">${cards}</div>
<p class="sq-foot" aria-hidden="true"><i></i>NAIMAKES FORUM · INDEX</p>
<div class="sq-caption" aria-live="polite"><span></span></div>
<button type="button" class="nm-glass sq-skip" data-sq="skip">跳过动画 <span aria-hidden="true">⇥</span></button>`;
  }

  private drawFace(card: Card, image: CanvasImageSource | null, logo: HTMLImageElement | null) {
    const canvas = card.el.querySelector("canvas")!;
    const scale = this.o.stage.getBoundingClientRect().width / (this.o.stage.clientWidth || 1) || 1;
    const width = Math.round(Math.min(2048, Math.max(900, 460 * scale * Math.min(3, devicePixelRatio || 1))));
    const height = Math.round((width * BOX_H) / BOX_W);
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d")!;
    c.imageSmoothingQuality = "high";
    if (image) c.drawImage(image, 0, 0, width, height);
    else {
      c.fillStyle = "#e1dad5";
      c.fillRect(0, 0, width, height);
    }
    const k = width / BOX_W;
    c.save();
    c.translate((LX - BOX_X) * k, (LY - BOX_Y) * k);
    c.scale((LW * k) / LABEL_CANVAS.width, (LH * k) / LABEL_CANVAS.height);
    drawCardLabel(c, card.index + 1, logo);
    c.restore();
    c.strokeStyle = "rgba(120,108,98,.22)";
    c.lineWidth = Math.max(1, k);
    c.strokeRect((LX - BOX_X) * k + 0.5, (LY - BOX_Y) * k + 0.5, LW * k - 1, LH * k - 1);
  }

  private layout() {
    this.layoutDirty = false;
    const stage = this.o.stage;
    const W = stage.clientWidth || 1920, H = stage.clientHeight || 1080;
    this.stageSize = { w: W, h: H };
    const n = this.cards.length;
    const portrait = W / H < 1.05;
    const wide = !portrait && W >= 1280 && H >= 760;
    const side = !portrait && W >= 900;
    const root = this.root;
    root.dataset.layout = side ? "wide" : portrait ? "portrait" : "stacked";

    const trayRight = wide ? 60 : 14;
    const bandTop = wide ? 186 : portrait ? 70 : 66;
    const bandBottom = wide ? 72 : 20;
    const pad = wide ? 18 : 10;
    const narrowTray = !wide;
    const headH = wide ? 62 : narrowTray ? 50 : 46;
    const gap = wide ? 12 : 8;
    const maxWell = wide ? 196 : portrait ? Math.min(92, W * 0.2) : 132;
    const band = H - bandTop - bandBottom;
    const wellH = Math.max(28, Math.min((band - headH - 2 * pad - (n - 1) * gap) / n, maxWell / FACE_RATIO));
    const wellW = wellH * FACE_RATIO;
    const trayW = wellW + 2 * pad;
    const trayH = headH + 2 * pad + n * wellH + (n - 1) * gap;
    this.tray = { x: W - trayRight - trayW, y: bandTop + Math.max(0, (band - trayH) / 2), w: trayW, h: trayH };
    const edge = wide ? { left: 64, top: 104, bottom: 104, tray: 48 } : { left: 16, top: 60, bottom: 56, tray: 16 };
    this.area = { x: edge.left, y: edge.top, w: this.tray.x - edge.tray - edge.left, h: H - edge.top - edge.bottom };
    Object.assign(this.head.style, {
      left: `${this.tray.x + pad}px`,
      top: `${this.tray.y + pad}px`,
      width: `${wellW}px`,
      height: `${headH - 10}px`,
    });
    root.dataset.tray = narrowTray ? "narrow" : "wide";
    root.dataset.size = wide ? "full" : portrait ? "phone" : "compact";
    const grow = wide ? 1.14 : 1.08;
    const anchor = { x: this.tray.x + trayW, y: this.tray.y + trayH / 2 };
    this.cards.forEach((card, i) => {
      const well = { x: this.tray.x + pad, y: this.tray.y + pad + headH + i * (wellH + gap), w: wellW, h: wellH };
      card.well = well;
      card.big = {
        x: anchor.x - (anchor.x - well.x) * grow - (wide ? 26 : 6),
        y: anchor.y + (well.y - anchor.y) * grow,
        w: well.w * grow,
        h: well.h * grow,
      };
      const el = this.wells[i];
      Object.assign(el.style, { left: `${well.x}px`, top: `${well.y}px`, width: `${well.w}px`, height: `${well.h}px` });
    });

    const grid = this.q(".sq-grid");
    const head = this.q(".sq-head");
    const actions = this.q(".sq-actions");
    const foot = this.q(".sq-foot");
    const cols = portrait ? Math.min(2, n) : Math.min(3, n);
    const rows = Math.ceil(n / cols);
    const colGap = wide ? 64 : portrait ? 16 : 28;
    const rowGap = wide ? 56 : 44;
    root.style.setProperty("--cols", String(cols));
    root.style.setProperty("--col-gap", `${colGap}px`);
    root.style.setProperty("--row-gap", `${rowGap}px`);
    const probe = this.root.querySelector<HTMLElement>(".sq-info");
    const info = Math.max(150, probe?.offsetHeight || 180) + 6;
    const fit = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));
    if (side) {
      const left = fit(W * 0.05, 28, 140);
      const headW = fit(W * 0.21, 230, 440);
      const gridLeft = left + headW + fit(W * 0.025, 28, 48);
      const gridRight = W - fit(W * 0.04, 28, 72);
      const byWidth = (gridRight - gridLeft - (cols - 1) * colGap) / cols;
      const top = fit(H * 0.11, 48, 118), bottom = fit(H * 0.09, 40, 96);
      const byHeight = ((H - top - bottom - (rows - 1) * rowGap) / rows - info) * FACE_RATIO;
      const cardW = Math.floor(wide ? Math.max(220, Math.min(byWidth, byHeight, 380)) : Math.max(180, Math.min(byWidth, 320)));
      root.style.setProperty("--card-w", `${cardW}px`);
      const gridW = cols * cardW + (cols - 1) * colGap;
      const gridH = rows * (cardW / FACE_RATIO + info) + (rows - 1) * rowGap;
      const gx = Math.round(gridLeft + Math.max(0, (gridRight - gridLeft - gridW) / 2));
      const gy = Math.round(Math.max(top, (H - gridH) / 2 + 8));
      Object.assign(grid.style, { left: `${gx}px`, top: `${gy}px` });
      Object.assign(head.style, { left: `${left}px`, top: `${gy - 14}px`, width: `${headW}px`, maxWidth: "none" });
      Object.assign(actions.style, { left: `${left}px`, top: `${gy - 14 + head.offsetHeight + (wide ? 40 : 28)}px`, bottom: "", right: "", width: `${headW}px` });
      Object.assign(foot.style, { left: `${left}px`, top: "", bottom: `${Math.round(H - gy - gridH)}px` });
    } else {
      const left = portrait ? 18 : 28;
      const headTop = portrait ? 76 : 70;
      Object.assign(head.style, { left: `${left}px`, top: `${headTop}px`, width: `${W - left * 2}px`, maxWidth: "none" });
      const headBottom = headTop + head.offsetHeight + 22;
      Object.assign(actions.style, { left: `${left}px`, top: `${headBottom}px`, bottom: "", right: "", width: `${W - left * 2}px` });
      const gridTop = headBottom + actions.offsetHeight + 48;
      const byWidth = (W - 2 * left - (cols - 1) * colGap) / cols;
      const byHeight = ((H - gridTop - 24 - (rows - 1) * rowGap) / rows - info) * FACE_RATIO;
      const cardW = Math.floor(Math.max(portrait ? 120 : 150, Math.min(byWidth, portrait ? byWidth : Math.max(byHeight, 170), 380)));
      root.style.setProperty("--card-w", `${cardW}px`);
      const gridW = cols * cardW + (cols - 1) * colGap;
      Object.assign(grid.style, { left: `${Math.round((W - gridW) / 2)}px`, top: `${gridTop}px` });
    }
    root.dataset.narrow = String(parseFloat(root.style.getPropertyValue("--card-w")) < 250);
    this.pageHeight = Math.max(H, Math.ceil(grid.offsetTop + grid.offsetHeight + (wide ? 0 : 40)));
    const slots = this.root.querySelectorAll<HTMLElement>(".sq-slot");
    this.cards.forEach((card) => {
      const slot = slots[card.order];
      const at = offsetWithin(slot, root);
      card.slot = { x: at.x, y: at.y, w: slot.offsetWidth, h: slot.offsetHeight };
      card.el.style.width = `${card.slot.w}px`;
      card.el.style.height = `${card.slot.h}px`;
      card.state = "";
    });
    const placement = placementPlan(this.cards.map((card) => card.big), this.cards.map((card) => card.slot));
    placement.order.forEach((i, step) => {
      const card = this.cards[i];
      card.move = this.place + step * PLACE_GAP;
      card.slide = placement.slide[i];
      for (const cue of card.cues) cue.item.at = card.move + cue.offset;
    });
    for (const wipe of this.wipes) this.placeWipe(wipe);
  }

  private buildWipes() {
    const add = (el: HTMLElement, at: number) => {
      const block = document.createElement("i");
      block.className = "sq-wipe";
      block.setAttribute("aria-hidden", "true");
      (el.offsetParent ?? el.parentElement)!.append(block);
      const wipe = { el, block, at, state: -1, w: 0, h: 0 };
      this.placeWipe(wipe);
      this.wipes.push(wipe);
      return wipe;
    };
    this.root.querySelectorAll<HTMLElement>(".sq-head [data-wipe]").forEach((el, j) => add(el, this.enlarge + 0.62 + j * WIPE.stagger));
    this.cards.forEach((card) => {
      const item = this.root.querySelector<HTMLElement>(`.sq-item[data-order="${card.order}"]`)!;
      item.querySelectorAll<HTMLElement>("[data-wipe]").forEach((el, j) => {
        const offset = INFO_DELAY + j * WIPE.stagger;
        card.cues.push({ item: add(el, card.move + offset), offset });
      });
      const slide = { el: item.querySelector<HTMLElement>(".sq-read")!, at: card.move + INFO_DELAY + 0.36, dx: 46, state: -1 };
      this.slides.push(slide);
      card.cues.push({ item: slide, offset: INFO_DELAY + 0.36 });
    });
    this.root.querySelectorAll<HTMLElement>(".sq-actions button").forEach((el, j) => this.slides.push({ el, at: this.place + 0.3 + j * 0.08, dx: 70, state: -1 }));
    this.slides.push({ el: this.q(".sq-foot"), at: this.place + 0.5, dx: 30, state: -1 });
  }

  private placeWipe(wipe: Wipe) {
    const { el, block } = wipe;
    wipe.w = el.offsetWidth;
    wipe.h = el.offsetHeight;
    Object.assign(block.style, {
      left: `${el.offsetLeft}px`,
      top: `${el.offsetTop}px`,
      width: `${el.offsetWidth}px`,
      height: `${el.offsetHeight}px`,
    });
    wipe.state = -1;
  }

  private paintWipe(wipe: Wipe, t: number) {
    const local = t - wipe.at;
    if (local < 0) {
      if (wipe.state !== 0) {
        wipe.state = 0;
        wipe.el.style.opacity = "0";
        wipe.block.style.display = "none";
      }
      return;
    }
    if (local >= WIPE_TOTAL) {
      if (wipe.state !== 2) {
        wipe.state = 2;
        wipe.el.style.opacity = "";
        wipe.block.style.display = "none";
      }
      return;
    }
    wipe.state = 1;
    const { w, h } = wipe;
    const line = Math.min(24, Math.max(6, Math.round(h * 0.55)));
    let clip: string;
    let alpha = 0;
    if (local < WIPE.line) {
      const k = easeOut(local / WIPE.line);
      clip = `inset(0px ${(w - line).toFixed(2)}px ${((1 - k) * h).toFixed(2)}px 0px)`;
    } else if (local < WIPE.line + WIPE.spread) {
      const k = easeOut((local - WIPE.line) / WIPE.spread);
      clip = `inset(0px ${((w - line) * (1 - k)).toFixed(2)}px 0px 0px)`;
    } else if (local < WIPE.line + WIPE.spread + WIPE.cover) {
      clip = "inset(0px)";
    } else {
      const k = easeOut((local - WIPE.line - WIPE.spread - WIPE.cover) / WIPE.clear);
      clip = `inset(0px 0px 0px ${(k * w).toFixed(2)}px)`;
      alpha = k;
    }
    wipe.block.style.display = "block";
    wipe.block.style.clipPath = clip;
    wipe.el.style.opacity = alpha.toFixed(3);
  }

  private paintSlide(slide: Slide, t: number) {
    const u = (t - slide.at) / 0.95;
    if (u <= 0) {
      if (slide.state !== 0) {
        slide.state = 0;
        slide.el.style.opacity = "0";
        slide.el.style.transform = `translateX(${slide.dx}px)`;
      }
      return;
    }
    if (u >= 1) {
      if (slide.state !== 2) {
        slide.state = 2;
        slide.el.style.opacity = "";
        slide.el.style.transform = "";
      }
      return;
    }
    slide.state = 1;
    slide.el.style.opacity = clamp01(u / 0.32).toFixed(3);
    slide.el.style.transform = `translateX(${(slide.dx * (1 - spring(u))).toFixed(2)}px)`;
  }

  private setQuad(card: Card, quad: Quad, opacity = 1) {
    card.el.style.visibility = "visible";
    card.el.style.opacity = opacity >= 1 ? "" : opacity.toFixed(3);
    card.el.style.transform = quadMatrix(card.slot.w, card.slot.h, quad);
  }

  private paintCard(card: Card, t: number) {
    const i = card.order;
    const key = (state: string) => {
      if (card.state === state) return true;
      card.state = state;
      return false;
    };
    if (this.extraction && t < handoffTime(i)) {
      if (!key("hidden")) card.el.style.visibility = "hidden";
      return;
    }
    const wellQuad = rectQuad(card.well);
    if (this.extraction && t < flightStart(i)) {
      card.state = "handoff";
      this.setQuad(card, card.quad ?? wellQuad, clamp01((t - handoffTime(i)) / EXTRACT.crossfade));
      return;
    }
    if (t < this.enlarge) {
      if (!this.extraction) {
        card.state = "appear";
        this.setQuad(card, wellQuad, smooth(t / 0.35));
        return;
      }
      const u = (t - flightStart(i)) / EXTRACT.flight;
      if (u >= 1) {
        if (!key("well")) this.setQuad(card, wellQuad);
        return;
      }
      card.state = "flight";
      this.setQuad(card, rectQuad(dockRect(card.quad ? quadRect(card.quad) : card.well, card.well, flightProgress(u))));
      return;
    }
    if (t < card.move) {
      const k = grown((t - this.enlarge) / ENLARGE);
      if (t - this.enlarge >= ENLARGE) {
        if (!key("big")) this.setQuad(card, rectQuad(card.big));
        return;
      }
      card.state = "grow";
      this.setQuad(card, rectQuad(lerpRect(card.well, card.big, k)));
      return;
    }
    const u = (t - card.move) / PLACE;
    if (u >= 1) {
      if (!key("slot")) {
        card.el.style.visibility = "visible";
        card.el.style.opacity = "";
        card.el.style.transform = `translate(${card.slot.x}px, ${card.slot.y}px)`;
      }
      return;
    }
    card.state = "place";
    const k = bouncy(u);
    this.setQuad(card, card.slide ? rectQuad(dockRect(card.slot, card.big, 1 - k)) : lerpQuad(rectQuad(card.big), rectQuad(card.slot), k, 0.08));
  }

  private paint(t: number) {
    const W = this.stageSize.w;
    const trayIn = this.extraction ? spring(span(t, EXTRACT.tray[0], EXTRACT.tray[1])) : 1;
    const grow = grown(span(t, this.enlarge, ENLARGE));
    const r = lerpRect(this.tray, { x: 0, y: 0, w: W, h: this.pageHeight }, grow);
    const shift = (1 - trayIn) * (this.tray.w + 110);
    Object.assign(this.panel.style, {
      width: `${r.w.toFixed(2)}px`,
      height: `${r.h.toFixed(2)}px`,
      transform: `translate(${(r.x + shift).toFixed(2)}px, ${r.y.toFixed(2)}px)`,
      borderRadius: `${(24 * (1 - clamp01(grow))).toFixed(2)}px`,
      opacity: this.extraction ? clamp01(trayIn * 1.6).toFixed(3) : "1",
    });
    const paper = smooth(span(t, this.enlarge + 0.05, ENLARGE * 0.72));
    this.paper.style.opacity = paper.toFixed(3);
    this.glass.style.display = paper >= 1 ? "none" : "";
    const headFade = 1 - smooth(span(t, this.enlarge, 0.3));
    this.head.style.opacity = (clamp01(trayIn * 1.4) * headFade).toFixed(3);
    this.head.style.transform = `translateX(${shift.toFixed(2)}px)`;
    this.wells.forEach((well, i) => {
      const card = this.cards[i];
      const fade = 1 - smooth(span(t, card.move - 0.05, 0.35));
      const at = lerpRect(card.well, card.big, grow);
      well.style.opacity = (clamp01(trayIn * 1.4) * fade).toFixed(3);
      well.style.transform = `translate(${(at.x - card.well.x + shift).toFixed(2)}px, ${(at.y - card.well.y).toFixed(2)}px) scale(${(at.w / card.well.w).toFixed(4)})`;
      well.style.visibility = fade <= 0 ? "hidden" : "";
    });
    let landed = 0;
    for (const card of this.cards) {
      this.paintCard(card, t);
      if (t >= (this.extraction ? landTime(card.order) - 0.45 : 0.3)) landed++;
    }
    if (landed !== this.landed) {
      this.landed = landed;
      this.counter.update({ value: landed });
    }
    for (const wipe of this.wipes) this.paintWipe(wipe, t);
    for (const slide of this.slides) this.paintSlide(slide, t);
    this.paintCaption(t);
  }

  private paintCaption(t: number) {
    const q = Array.from(this.o.query);
    const short = q.length > 14 ? `${q.slice(0, 13).join("")}…` : this.o.query;
    const first = `正在检索「${short}」`;
    const second = `找到 ${this.o.total} 篇相关帖子 · 抽取 ${this.cards.length} 篇`;
    const at2 = this.extraction ? extractStart(0) - 0.05 : 0.1;
    let text = "";
    if (this.extraction && t >= 0.12 && t < at2) text = typed(first, span(t, 0.12, 0.2 + first.length * 0.04));
    else if (t >= at2 && t < this.enlarge) text = typed(second, span(t, at2, 0.2 + second.length * 0.035));
    if (text !== this.captionText) {
      this.captionText = text;
      this.caption.textContent = text;
    }
    this.caption.parentElement!.style.opacity = (1 - smooth(span(t, this.enlarge - 0.25, 0.3))).toFixed(3);
  }

  tick(now: number) {
    this.now = now;
    if (this.start < 0) this.start = this.o.reduced ? now - this.end : now;
    if (this.layoutDirty) this.layout();
    if (this.faces && this.drawn < this.cards.length) {
      const urgent = this.phase !== "play" || now - this.start >= handoffTime(0) - 0.2;
      do this.drawFace(this.cards[this.drawn++], this.faces.image, this.faces.logo);
      while (urgent && this.drawn < this.cards.length);
    }
    if (this.phase === "reading") return;
    if (this.phase === "leaving") {
      const k = clamp01((now - this.leaveStart) / LEAVE);
      const fade = smooth(k);
      this.root.style.opacity = (1 - fade).toFixed(3);
      this.root.style.transform = `scale(${(1 + 0.02 * fade).toFixed(4)})`;
      this.o.scene?.setSearchFade(1 - fade);
      this.o.scene?.update(now);
      if (k >= 1) {
        const then = this.leaveThen;
        this.dispose();
        this.o.onLeave();
        then?.();
      }
      return;
    }
    const t = Math.min(now - this.start, this.end);
    const scene = this.o.scene;
    if (scene && !this.arrayDone) {
      if (this.extraction) scene.setSearchTime(t);
      scene.setSearchFade(this.extraction ? smooth(span(t, this.enlarge + 0.08, 0.9)) : 1);
      scene.update(now);
      if (this.extraction)
        for (const card of this.cards) {
          if (!card.quad && t >= handoffTime(card.order) && t < this.enlarge) card.quad = scene.searchCardQuad(card.order) as Quad | null;
          if (!card.released && t >= flightStart(card.order)) {
            card.released = true;
            scene.releaseSearchCard(card.order);
          }
        }
      if (t >= this.enlarge + 1.05) this.arrayDone = true;
    }
    if (t >= this.enlarge - 0.1) this.o.stage.dataset.search = "page";
    this.paint(t);
    if (t >= this.end && this.phase === "play") this.ready();
  }

  private ready() {
    this.phase = "ready";
    this.root.dataset.phase = "ready";
    this.root.classList.toggle("is-scrollable", this.pageHeight > this.stageSize.h + 1);
    void fetch(reelDeviceUrl).catch(() => {});
    const first = this.root.querySelector<HTMLButtonElement>(".sq-read");
    if (!this.root.contains(document.activeElement) || document.activeElement === this.q(".sq-skip")) first?.focus({ preventScroll: true });
  }

  get playing() {
    return this.phase === "play";
  }

  skip() {
    if (this.phase !== "play") return;
    this.start = this.now - this.end;
  }

  leave(then?: () => void) {
    if (this.phase === "leaving") {
      if (then) this.leaveThen = then;
      return;
    }
    window.clearTimeout(this.restoreTimer);
    this.phase = "leaving";
    this.root.dataset.phase = "leaving";
    this.leaveThen = then;
    this.leaveStart = this.now;
    this.arrayDone = false;
    this.o.scene?.endSearch(false);
    delete this.o.stage.dataset.search;
    if (this.o.reduced) this.leaveStart = this.now - LEAVE;
  }

  key(event: KeyboardEvent) {
    if (this.phase === "leaving") {
      event.preventDefault();
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.phase === "play") this.skip();
      else if (this.phase === "ready") this.leave();
      return true;
    }
    if (this.phase === "play" && (event.key === "Enter" || event.key === " ") && !(event.target as HTMLElement)?.closest?.("button")) {
      event.preventDefault();
      this.skip();
      return true;
    }
    if (this.phase === "ready" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".sq-read")];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const cols = Number(this.root.style.getPropertyValue("--cols")) || 3;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[event.key]!;
      const next = current < 0 ? 0 : Math.min(buttons.length - 1, Math.max(0, current + step));
      buttons[next]?.focus();
      event.preventDefault();
      return true;
    }
    return false;
  }

  private hover(event: PointerEvent, on: boolean) {
    const item = (event.target as Element).closest<HTMLElement>(".sq-item, .sq-card");
    if (!item) return;
    const order = item.dataset.order ?? item.dataset.sqCard;
    const card = this.cards[Number(order)];
    if (!card) return;
    if (!on && item.contains(event.relatedTarget as Node)) return;
    if (on) card.el.dataset.hover = "true";
    else delete card.el.dataset.hover;
  }

  private onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>("[data-sq], [data-sq-read], [data-sq-card]");
    if (!target) return;
    const action = target.dataset.sq;
    if (action === "skip") this.skip();
    else if (this.phase !== "ready") return;
    else if (action === "back") this.leave();
    else if (action === "again") this.o.onSearch(this.o.query);
    else {
      const order = Number(target.dataset.sqRead ?? target.dataset.sqCard);
      if (Number.isFinite(order)) this.read(order);
    }
  }

  private read(order: number) {
    const card = this.cards[order];
    if (!card || this.phase !== "ready") return;
    this.phase = "reading";
    this.reading = card;
    const rect = { ...card.slot };
    this.o.onRead(card.index, frontalCardView(rect, this.stageSize.w, this.stageSize.h));
  }

  handedOff() {
    const card = this.reading;
    if (!card) return;
    card.el.style.visibility = "hidden";
    this.root.classList.add("is-reading");
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = window.setTimeout(() => {
      this.root.classList.remove("is-reading");
      card.el.style.visibility = "visible";
    }, 950);
  }

  returned() {
    const card = this.reading;
    this.reading = null;
    window.clearTimeout(this.restoreTimer);
    this.root.classList.remove("is-reading");
    if (card) card.el.style.visibility = "visible";
    if (this.phase === "reading") this.phase = "ready";
    if (card) this.root.querySelector<HTMLButtonElement>(`[data-sq-read="${card.order}"]`)?.focus({ preventScroll: true });
  }

  dispose() {
    window.clearTimeout(this.restoreTimer);
    this.abort.abort();
    this.resize.disconnect();
    this.root.remove();
    if (this.o.stage.dataset.search) delete this.o.stage.dataset.search;
  }
}
