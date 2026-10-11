import type { ArchiveRecord, BoardInfo } from "../data/archive-data";
import { paragraphsFromContent } from "../data/load-forum-posts";
import { boardIconNodes } from "./board-icons";
import { nmkMarkSvg } from "../ui/nmk-logo";
import { Corridor } from "./corridor-scene";
import { DeviceScene, REEL_DURATION, type CardView } from "./reel-scene";
import { APPROACH } from "./dossier-approach";
import { TileChain } from "./tile-chain";
import { clamp, span, typed, escapeText as esc, pad } from "./cinema-helpers";
import "./dossier.css";

type DossierOptions = {
  stage: HTMLElement;
  record: ArchiveRecord;
  board: BoardInfo;
  boards: BoardInfo[];
  number: number;
  total: number;
  array?: { at(t: number): void; view(): CardView | undefined; restore(immediate: boolean): void };
  view?: CardView;
  reduced: boolean;
  onExit: () => void;
};

const R = APPROACH.end + REEL_DURATION;
const T = {
  reelOut: R,
  corridorIn: R + 0.22,
  corridorPush: R + 5.45,
  corridorOut: R + 6.0,
  cloudIn: R + 6.0,
  cloudMatch: R + 12.3,
  cloudOut: R + 14.1,
  boardIn: R + 14.45,
  boardOut: R + 24.4,
  panelIn: R + 24.75,
  boardGone: R + 25.3,
};

const PAGES = [
  { key: "overview", label: "概览", en: "OVERVIEW" },
  { key: "body", label: "正文", en: "CONTENT" },
  { key: "author", label: "作者", en: "AUTHOR" },
  { key: "talk", label: "讨论", en: "DISCUSSION" },
] as const;
const ENTER = {
  tileIn: 0.85,
  tileHold: 0.6,
  tileMove: 1.0,
  slabAfterTile: 0.1,
  slab: 1.05,
  slabSettle: 0.75,
  wait: 0.3,
  flipSlab: 0.12,
  slide: 0.95,
  slideStagger: 0.07,
  line: 0.3,
  spread: 0.38,
  cover: 0.06,
  clear: 0.42,
  wipeStagger: 0.09,
};
const WIPE_LINE = 30;
const GHOSTS = ".dz-blurword, .dz-watername, .dz-infoword";

type Slot = { dx: number; dy: number; w: number; h: number; variant: "white" | "black" | "band" | "text" | "accent"; rot: number };
const SLOTS: Slot[] = [
  { dx: -370, dy: 38, w: 190, h: 104, variant: "accent", rot: 0 },
  { dx: 403, dy: -129, w: 200, h: 198, variant: "band", rot: 2 },
  { dx: -723, dy: -118, w: 200, h: 192, variant: "white", rot: -1 },
  { dx: 457, dy: 129, w: 196, h: 192, variant: "white", rot: 0 },
  { dx: -604, dy: 182, w: 205, h: 202, variant: "black", rot: -4 },
  { dx: 603, dy: 20, w: 236, h: 100, variant: "text", rot: 0 },
  { dx: 796, dy: -122, w: 240, h: 152, variant: "white", rot: 0 },
  { dx: -469, dy: -80, w: 164, h: 158, variant: "white", rot: 1 },
  { dx: 698, dy: 227, w: 170, h: 170, variant: "black", rot: 0 },
];
const SITE_SECTIONS: [string, string][] = [
  ["讨论", "DISCUSSIONS"], ["话题", "TOPICS"], ["收藏", "COLLECTIONS"], ["作者", "CREATORS"],
  ["消息", "MESSAGES"], ["治理", "GOVERNANCE"], ["精选", "FEATURED"], ["检索", "SEARCH"], ["草稿", "DRAFTS"],
];

type Comment = {
  id: string;
  parent_id: string | null;
  author_name?: string;
  author_initials?: string;
  author_avatar?: string;
  content?: string;
  created_at?: number;
  likes?: number;
  deleted?: boolean;
};

type Typer = { el: HTMLElement; text: string; start: number; duration: number };

function iconMarkup(name: string) {
  const nodes = boardIconNodes[name] ?? boardIconNodes.Hash;
  return nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${esc(value)}"`).join(" ")}/>`)
    .join("");
}

function shortDate(time: number) {
  if (!time) return "—";
  const date = new Date(time);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function relative(time?: number) {
  if (!time) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return shortDate(time);
}

function safeImage(url: string) {
  if (!url) return "";
  if (url.startsWith("/uploads/")) return url;
  try {
    const parsed = new URL(url, location.origin);
    return parsed.protocol === "https:" || parsed.origin === location.origin ? parsed.href : "";
  } catch {
    return "";
  }
}

export class Dossier {
  readonly root: HTMLElement;
  private start = -1;
  private started = false;
  private skipPending = false;
  private now = 0;
  private fired = new Set<string>();
  private typers: Typer[] = [];
  private reel?: DeviceScene;
  private corridor?: Corridor;
  private chain?: TileChain;
  private page = 0;
  private pageStart = 0;
  private autoplay = true;
  private closing = -1;
  private body: string[];
  private comments: Comment[] | null = null;
  private resizeObserver: ResizeObserver;
  private abort = new AbortController();
  private skipped = false;
  private handedOff = false;
  private restoring = false;

  constructor(private o: DossierOptions) {
    this.body = o.record.body?.length ? o.record.body : [o.record.abstract];
    this.root = document.createElement("section");
    this.root.className = "dz";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", `帖子详情：${o.record.title}`);
    this.root.innerHTML = this.markup();
    o.stage.append(this.root);
    o.stage.dataset.dossier = "open";
    if (o.reduced) this.root.classList.add("is-reduced");
    this.layout();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(o.stage);
    void document.fonts.ready.then(() => this.abort.signal.aborted || this.layout());
    if (!o.reduced) this.reel = new DeviceScene(this.q(".dz-reel"), o.number);
    this.corridor = new Corridor(this.q(".dz-corridor"));
    this.root.addEventListener("click", (event) => this.onClick(event), { signal: this.abort.signal });
    this.q(".dz-article").addEventListener("wheel", () => this.pauseAutoplay(), { passive: true, signal: this.abort.signal });
    void this.loadThread();
    if (o.reduced) this.skip();
    requestAnimationFrame(() => this.q<HTMLButtonElement>('[data-dz="close"]').focus({ preventScroll: true }));
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.root.querySelector<T>(selector)!;
  }

  private markup() {
    const { record: r, board } = this.o;
    const code = r.id;
    const boardName = esc(board.name);
    const boardEn = esc(board.en || "BOARD");
    return `
<div class="dz-layer dz-corridor" aria-hidden="true"></div>
<div class="dz-layer dz-reel" aria-hidden="true"></div>
<div class="dz-layer dz-chain" aria-hidden="true"></div>
<div class="dz-layer dz-light" aria-hidden="true"></div>
${this.cloudMarkup()}
<div class="dz-layer dz-rail" aria-hidden="true">
  <i class="dz-rail-marker"></i><i class="dz-rail-edge"></i>
  <i class="dz-rail-dash"></i>
  <span class="dz-rail-tag">NAIMAKES DATABASE</span>
  <span class="dz-rail-note">NAIMAKES FORUM · ${boardEn}<br/>PUBLIC ARCHIVE · ${esc(code)}</span>
  <span class="dz-rail-tag dz-rail-tag-2">READING ENTERED</span>
  <i class="dz-rail-dots"></i>
  <span class="dz-rail-note dz-rail-note-2">POST ${esc(code)} REQUESTED<br/>SOURCE · NAIMAKES FORUM</span>
  <i class="dz-rail-rule"></i>
  <div class="dz-rail-label"><i></i><span><b>${boardName}</b>${esc((board.en || "NAIMAKES").toUpperCase())} SECTION</span></div>
</div>
${this.boardMarkup()}
${this.panelMarkup()}
<div class="dz-caption" aria-live="polite"><span></span></div>
<div class="dz-flash" aria-hidden="true"></div>
${this.controlsMarkup()}`;
  }

  private cloudMarkup() {
    const { board, boards } = this.o;
    const others = boards.filter((b) => b.id !== board.id);
    const labels: { name: string; en: string; match: boolean }[] = [
      { name: board.name, en: board.en, match: true },
      ...others.map((b) => ({ name: b.name, en: b.en, match: false })),
    ];
    for (const [name, en] of SITE_SECTIONS) {
      if (labels.length >= SLOTS.length) break;
      if (!labels.some((label) => label.name === name)) labels.push({ name, en, match: false });
    }
    const tiles = SLOTS.map((slot, index) => {
      const label = labels[index];
      const long = Array.from(label.name).length;
      const size = slot.variant === "text" || slot.variant === "accent" ? (long > 4 ? 40 : 52) : long > 4 ? 28 : long > 2 ? 36 : 48;
      const from = index % 2 ? 1 : -1;
      return `<div class="dz-tile dz-tile-${slot.variant}${label.match ? " is-match" : ""}" style="--dx:${slot.dx};--dy:${slot.dy};--w:${slot.w}px;--h:${slot.h}px;--r:${slot.rot}deg;--r0:${from * (18 + index * 3)}deg;--fx:${from * (120 + index * 18)}px;--fy:${(index % 3 - 1) * 90}px;--delay:${(0.95 + index * 0.21).toFixed(2)}s;--label-delay:${(2.2 + index * 0.17).toFixed(2)}s;--float:${(7 + (index % 4) * 1.3).toFixed(1)}s;--fdx:${((index % 3) - 1) * 6}px;--fdy:${index % 2 ? -7 : 6}px">
  <div class="dz-tile-body">
    <div class="dz-tile-label" style="--size:${size}px"><strong>${esc(label.name)}</strong><small>${esc(label.en)}</small></div>
    ${slot.variant === "accent" ? '<i class="dz-accent"></i>' : ""}
    ${label.match ? '<span class="dz-match-tag">MATCHED</span>' : ""}
  </div>
</div>`;
    }).join("");
    const bits = [
      [282, -465, 52, 0.2], [-620, 359, 61, 0.6], [-919, 390, 50, 1], [-120, -380, 18, 1.4], [150, 330, 14, 1.7],
      [520, -300, 12, 2.1], [-300, 420, 16, 2.4], [880, 400, 20, 1.2], [-820, -340, 14, 2.8],
    ]
      .map(([x, y, s, d]) => `<i class="dz-bit" style="--dx:${x};--dy:${y};--s:${s}px;--delay:${d}s"></i>`)
      .join("");
    const glints = [[-560, -380], [-420, 460], [470, -60], [520, 420], [-140, -250]]
      .map(([x, y], i) => `<i class="dz-glint" style="--dx:${x};--dy:${y};--delay:${(1.2 + i * 0.7).toFixed(1)}s"></i>`)
      .join("");
    return `
<div class="dz-layer dz-cloud" aria-hidden="true">
  <div class="dz-grid"></div>
  <svg class="dz-x" preserveAspectRatio="none"><line/><line/><line/><line/></svg>
  <div class="dz-watermark"><i class="dz-ring"></i><span>N A I M A K E S</span></div>
  <div class="dz-searching"><i></i><span>SEARCHING</span></div>
  ${glints}
  ${bits}
  <div class="dz-tile dz-tile-center" style="--dx:3;--dy:23;--w:350px;--h:350px;--r:0deg;--r0:-24deg;--fx:-40px;--fy:60px;--delay:0s">
    <div class="dz-tile-body">
      <span class="dz-dot"></span>
      ${nmkMarkSvg({ fill: "#fff", className: "dz-center-mark" })}
      <small class="dz-center-name">NAIMAKES FORUM</small>
      <small class="dz-center-sub">思想，先于未来 · ${pad(this.o.boards.length)} 个版块</small>
    </div>
  </div>
  ${tiles}
</div>`;
  }

  private boardMarkup() {
    const { board } = this.o;
    const icon = iconMarkup(board.icon);
    return `
<div class="dz-layer dz-board" aria-label="版块简介">
  <div class="dz-emblem" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <defs>
        <linearGradient id="dz-emblem-ink" x1="0.1" y1="0" x2="0.55" y2="1">
          <stop offset="0" stop-color="#2b2b2b"/><stop offset=".45" stop-color="#101010"/><stop offset="1" stop-color="#040404"/>
        </linearGradient>
        <pattern id="dz-emblem-dots" width=".2" height=".2" patternUnits="userSpaceOnUse"><circle cx=".1" cy=".1" r=".034" fill="#fff"/></pattern>
      </defs>
      <g class="dz-emblem-base" stroke="url(#dz-emblem-ink)" stroke-width="2.1">${icon}</g>
      <g class="dz-emblem-grain" stroke="url(#dz-emblem-dots)" stroke-width="2.1" opacity=".09">${icon}</g>
    </svg>
  </div>
  <div class="dz-orange-dots" aria-hidden="true"><i></i><i></i><b></b><i></i><i></i></div>
  <div class="dz-section">
    <div class="dz-section-label">版块 <span>SECTION</span><i></i></div>
    <div class="dz-blacktile dz-section-tile">
      <span class="dz-dot"></span>
      <strong>${esc(board.name)}</strong>
      <small>${esc(board.en || "BOARD")}</small>
    </div>
  </div>
  <div class="dz-namecard">
    <div class="dz-namecard-mark">${nmkMarkSvg({ fill: "#fff" })}<small>NAIMAKES</small></div>
    <div class="dz-namecard-text">
      <small>BOARD PROFILE / 版块简介</small>
      <strong data-type="board-name"></strong>
    </div>
    <i class="dz-namecard-rule"></i>
    <p class="dz-namecard-sub"><b>${esc(board.en || "BOARD")}</b> · 版主 ${esc(board.lead)}</p>
    <p class="dz-namecard-desc" data-type="board-desc"></p>
    <dl class="dz-stats">
      <div><dt>帖子</dt><dd>${pad(board.posts)}</dd></div>
      <div><dt>成员</dt><dd>${pad(board.members)}</dd></div>
      <div><dt>关注</dt><dd>${pad(board.followers)}</dd></div>
    </dl>
  </div>
</div>`;
  }

  private panelMarkup() {
    const { record: r, board } = this.o;
    const avatar = safeImage(r.authorAvatar);
    const tags = r.tags.length ? r.tags : [board.name];
    const paragraphs = this.body.map((text, i) => `<p${i === 0 ? ' class="is-lead"' : ""}>${esc(text)}</p>`).join("");
    const chars = this.body.join("").length;
    const slab = '<div class="dz-slab" aria-hidden="true"><i class="dz-slab-back"></i><i class="dz-slab-edge"></i><i class="dz-hex"></i><i class="dz-slab-inner"></i><i class="dz-screw"></i><i class="dz-screw dz-screw-2"></i></div>';
    return `
<div class="dz-layer dz-stagepanel" aria-label="帖子档案">
  <div class="dz-blacktile dz-site-tile dz-board-tile" style="--logo-size:${Math.min(104, Math.round(340 / Math.max(2, Array.from(board.name).length)))}px">
    <span class="dz-dot"></span>
    <strong class="dz-board-logo">${esc(board.name)}</strong>
    <small class="dz-board-section">${esc((board.en || "NAIMAKES").toUpperCase())} SECTION</small>
    ${nmkMarkSvg({ fill: "#fff", className: "dz-board-mark", title: "Naimakes" })}
  </div>
  <div class="dz-panel-wrap">
    <div class="dz-panel">
      <div class="dz-pages">
        <section class="dz-page dz-page-overview" data-page="0" aria-label="概览">
          ${slab}
          <i class="dz-page-ring" aria-hidden="true"></i>
          <div class="dz-profile-label">POST PROFILE <span>帖子档案</span></div>
          <i class="dz-hatch" aria-hidden="true"></i>
          <div class="dz-blurword" aria-hidden="true">${esc((board.en || "NAIMAKES").split(" ")[0])}</div>
          <div class="dz-title-plate"><i></i><h2>${esc(r.title)}</h2></div>
          <div class="dz-infoword" aria-hidden="true">INFO</div>
          <div class="dz-kicker"><i></i>${esc(board.name)} · ${esc(r.id)}<span>${esc(board.en || "")}</span></div>
          <p class="dz-abstract">${esc(r.abstract)}</p>
          <div class="dz-access"><span>GENERAL ACCESS CONTENT</span><b>NAIMAKES FORUM</b></div>
          <ul class="dz-tags">${tags.map((tag) => `<li># ${esc(tag)}</li>`).join("")}</ul>
          <div class="dz-meters" aria-hidden="true"><i></i><i></i><span class="is-green">PUBLIC</span><i></i><span class="is-black">VISUALIZED</span></div>
        </section>
        <section class="dz-page dz-page-body" data-page="1" aria-label="正文">
          ${slab}
          <div class="dz-profile-label">CONTENT <span>正文</span></div>
          <div class="dz-body-meta">约 ${r.readingMinutes} 分钟读完 · ${pad(chars, 3)} 字 · ${esc(r.date)}</div>
          <div class="dz-blurword dz-blurword-2" aria-hidden="true">TEXT</div>
          <article class="dz-article" tabindex="0"><h2>${esc(r.title)}</h2>${paragraphs}</article>
          <div class="dz-body-side">
            <span>READING</span><i class="dz-progress"><b></b></i>
            <dl><div><dt>板块</dt><dd>${esc(board.name)}</dd></div><div><dt>作者</dt><dd>${esc(r.lead)}</dd></div><div><dt>发布</dt><dd>${esc(r.date)}</dd></div></dl>
          </div>
        </section>
        <section class="dz-page dz-page-author" data-page="2" aria-label="作者">
          ${slab}
          <div class="dz-watername" aria-hidden="true">${esc(r.lead)}</div>
          <div class="dz-portrait">${avatar ? `<img src="${esc(avatar)}" alt="" decoding="async"/>` : `<span>${esc(r.authorInitials)}</span>`}<i class="dz-portrait-sheen"></i></div>
          <div class="dz-author">
            <small class="dz-author-tag">作者 AUTHOR</small>
            <strong class="dz-author-name">${esc(r.lead)}</strong>
            <div class="dz-author-board"><b>${esc(board.name)}</b><span>作者信息已载入 <i></i></span>${nmkMarkSvg({ fill: "glass", className: "dz-author-mark" })}</div>
            <div class="dz-author-code"><i></i>${esc(r.id)}</div>
            <p class="dz-author-bio">${esc(r.authorBio || "这位作者还没有写简介。")}</p>
          </div>
          <div class="dz-info"><strong>INFO</strong><span><i></i><i></i><i></i></span></div>
          <div class="dz-profile-card">
            <b>PROFILE / 档案</b>
            <dl>
              <div><dt>发布</dt><dd>${esc(r.date)}</dd></div>
              <div><dt>回复</dt><dd>${pad(r.comments)} 条</dd></div>
              <div><dt>点赞</dt><dd>${pad(r.likes)}</dd></div>
              <div><dt>阅读</dt><dd>${pad(r.views || 0)} 人</dd></div>
            </dl>
            <small>NAIMAKES FORUM</small>
          </div>
          <i class="dz-blackbar" aria-hidden="true"></i>
        </section>
        <section class="dz-page dz-page-talk" data-page="3" aria-label="讨论">
          ${slab}
          <div class="dz-profile-label">DISCUSSION <span>讨论</span></div>
          <div class="dz-body-meta" data-talk-count>${pad(r.comments)} 条回复</div>
          <div class="dz-comments"><p class="dz-empty">正在载入讨论…</p></div>
          <div class="dz-cta">
            <small>JOIN THE DISCUSSION</small>
            <strong>让想法相遇</strong>
            <p>读完了？在论坛里回复这篇帖子，你的观点会出现在这里。</p>
            <a class="nm-glass dz-cta-button" href="${esc(r.source)}" target="_top">去论坛回复 <span aria-hidden="true">↗</span></a>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>`;
  }

  private controlsMarkup() {
    const r = this.o.record;
    return `
<div class="dz-layer dz-controls-plane">
<nav class="dz-controls" aria-label="阅读详情控制">
  <div class="dz-pager" role="group" aria-label="翻页">
    <button type="button" class="nm-glass dz-round" data-dz="prev" aria-label="上一页"><span aria-hidden="true">‹</span></button>
    <div class="dz-tabs nm-glass" role="tablist" aria-label="帖子档案">${PAGES.map((page, index) => `<button type="button" role="tab" data-dz-page="${index}" aria-selected="${index === 0}"><span>${pad(index + 1)}</span>${page.label}<i><b></b></i></button>`).join("")}</div>
    <button type="button" class="nm-glass dz-round" data-dz="next" aria-label="下一页"><span aria-hidden="true">›</span></button>
    <button type="button" class="nm-glass dz-round dz-auto" data-dz="auto" aria-label="暂停自动翻页" aria-pressed="true"><span aria-hidden="true"></span></button>
  </div>
  <button type="button" class="nm-glass dz-skip" data-dz="skip">跳过动画 <span aria-hidden="true">⇥</span></button>
  <a class="nm-glass dz-open" href="${esc(r.source)}" target="_top">在论坛中打开 <span aria-hidden="true">↗</span></a>
  <button type="button" class="nm-glass dz-close" data-dz="close">返回帖子 <kbd>ESC</kbd></button>
</nav>
</div>`;
  }

  private layout() {
    const stage = this.o.stage;
    const width = stage.clientWidth || 1920;
    const height = stage.clientHeight || 1080;
    this.root.style.setProperty("--spread", String(Math.min(1.18, Math.max(0.72, width / 1920))));
    this.root.style.setProperty("--stage-w", `${width}px`);
    const compact = width < 1300 || height < 700;
    const tileK = Math.min(0.82, Math.max(0.72, 0.72 + ((width - 1400) / 520) * 0.1));
    const note = this.q(".dz-rail-note");
    const tileLeft = Math.max(248, note.offsetLeft + note.offsetWidth + 30);
    const panelMin = tileLeft + 402 * tileK + 64;
    const room = compact ? width - 32 : width - 40 - panelMin;
    const panelScale = compact ? Math.min(1, room / 1140) : Math.max(0.5, Math.min(0.82, room / 1321));
    const panelLeft = Math.round(panelMin + Math.max(0, room - 1321 * panelScale) / 2);
    this.root.style.setProperty("--tile-k", tileK.toFixed(3));
    this.root.style.setProperty("--tile-left", `${tileLeft}px`);
    this.root.style.setProperty("--panel-left", `${panelLeft}px`);
    this.root.style.setProperty("--panel-scale", String(panelScale));
    this.root.dataset.compact = String(compact);
    const svg = this.q<SVGSVGElement & HTMLElement>(".dz-x");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const spread = Math.min(1.18, Math.max(0.72, width / 1920));
    const cx = width / 2 + 3 * spread, cy = height / 2 + 23;
    const half = 175;
    const corners: [number, number, number, number][] = [
      [cx - half, cy - half, -1, -1],
      [cx + half, cy - half, 1, -1],
      [cx - half, cy + half, -1, 1],
      [cx + half, cy + half, 1, 1],
    ];
    svg.querySelectorAll("line").forEach((line, i) => {
      const [x, y, sx, sy] = corners[i];
      const reach = Math.max(width, height);
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(x + sx * reach * 0.62));
      line.setAttribute("y2", String(y + sy * reach * 0.62));
    });
    this.reel?.resize();
    this.corridor?.resize();
    this.chain?.resize();
  }

  private onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>("[data-dz],[data-dz-page]");
    if (!target) return;
    const action = target.dataset.dz;
    if (target.dataset.dzPage !== undefined) {
      this.pauseAutoplay();
      this.goto(Number(target.dataset.dzPage));
      return;
    }
    if (action === "close") this.close();
    else if (action === "skip") this.skip();
    else if (action === "next") {
      this.pauseAutoplay();
      this.goto(this.page + 1);
    } else if (action === "prev") {
      this.pauseAutoplay();
      this.goto(this.page - 1);
    } else if (action === "auto") {
      this.autoplay = !this.autoplay;
      this.pageStart = this.now;
      this.syncAuto();
    }
  }

  key(event: KeyboardEvent) {
    if (this.closing >= 0) return true;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    const inPanel = this.root.dataset.stage === "panel";
    if (!inPanel) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") {
        if ((event.target as HTMLElement)?.closest?.("a,button") && event.key !== "ArrowRight") return false;
        event.preventDefault();
        this.skip();
        return true;
      }
      return false;
    }
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      this.pauseAutoplay();
      this.goto(this.page + 1);
      return true;
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      this.pauseAutoplay();
      this.goto(this.page - 1);
      return true;
    }
    return false;
  }

  private pauseAutoplay() {
    if (!this.autoplay) return;
    this.autoplay = false;
    this.syncAuto();
  }

  private syncAuto() {
    const button = this.q('[data-dz="auto"]');
    button.setAttribute("aria-pressed", String(this.autoplay));
    button.setAttribute("aria-label", this.autoplay ? "暂停自动翻页" : "继续自动翻页");
    this.root.classList.toggle("is-paused", !this.autoplay);
  }

  skip() {
    if (this.root.dataset.stage === "panel" || this.closing >= 0) return;
    this.skipped = true;
    this.skipPending = true;
    for (const key of ["reel-out", "corridor", "cloud", "match", "cloud-out", "board", "board-out", "board-gone", "c1", "c2", "c3"]) this.fired.add(key);
    this.typers = [];
    this.root.classList.add("is-skipping", "is-covered");
    this.root.classList.remove("show-reel", "show-corridor", "show-cloud", "cloud-matched", "cloud-leaving", "show-board", "board-leaving");
    this.setStage("panel");
    this.reel?.dispose();
    this.reel = undefined;
    this.corridor?.dispose();
    this.corridor = undefined;
    this.ensureChain();
    this.chain?.show(true);
  }

  close() {
    if (this.closing >= 0) return;
    this.closing = this.now;
    if (this.o.array) {
      this.o.array.restore(this.handedOff || this.skipped);
      this.restoring = true;
    }
    this.root.classList.add("is-closing");
    this.o.stage.dataset.dossier = "closing";
  }

  get ready() {
    return this.reel?.ready ?? Promise.resolve();
  }

  get arrayLive() {
    return Boolean(this.o.array) && (this.restoring || (Boolean(this.reel) && !this.handedOff && !this.skipped));
  }

  private handoff() {
    this.handedOff = true;
    this.reel?.handoff(this.o.array?.view() ?? this.o.view);
    this.setStage("reel");
    this.root.classList.add("show-reel", "is-covered");
  }

  private setStage(stage: "prelude" | "reel" | "corridor" | "cloud" | "board" | "panel") {
    this.root.dataset.stage = stage;
    this.o.stage.dataset.dossierStage = stage;
    this.root.querySelectorAll<HTMLElement>(".dz-board, .dz-cloud, .dz-stagepanel").forEach((layer) => {
      layer.inert = !layer.classList.contains(`dz-${stage === "panel" ? "stagepanel" : stage}`);
    });
  }

  private type(el: HTMLElement, text: string, start: number, duration: number) {
    el.textContent = "";
    this.typers.push({ el, text, start, duration });
  }

  private caption(text: string, at: number) {
    const el = this.q(".dz-caption span");
    this.type(el, text, at, Math.min(2.4, 0.3 + Array.from(text).length * 0.055));
  }

  private ensureChain() {
    if (this.chain) return;
    this.chain = new TileChain(this.q(".dz-chain"), this.o.number);
  }

  private goto(index: number) {
    const next = Math.max(0, Math.min(PAGES.length - 1, index));
    if (next === this.page) return;
    this.leavePage(this.pageEl(this.page));
    this.enterPage(this.pageEl(next), ENTER.flipSlab);
    this.showPage(next);
  }

  private pageEl(index: number) {
    return this.q(`.dz-page[data-page="${index}"]`);
  }

  private springEasing = "";
  private get spring() {
    return (this.springEasing ||= getComputedStyle(this.root).getPropertyValue("--dz-spring").trim() || "cubic-bezier(0.2, 1.08, 0.36, 1)");
  }
  private entrances = new Map<HTMLElement, { animations: Animation[]; wipes: HTMLElement[] }>();
  private exits = new Map<HTMLElement, Animation[]>();

  private enterPanel() {
    if (this.o.reduced) return;
    const tile = this.q(".dz-site-tile");
    const stageW = this.o.stage.clientWidth || 1920;
    const home = tile.offsetLeft;
    const hold = Math.max(0, stageW - tile.offsetWidth - 150 - home);
    const from = stageW + 60 - home;
    const s = 1000;
    tile.animate([{ translate: `${from - hold}px 0`, filter: "blur(8px)" }, { translate: "0 0", filter: "blur(0)" }], {
      duration: ENTER.tileIn * s,
      easing: this.spring,
      fill: "backwards",
    });
    tile.animate([{ transform: `translateX(${hold}px)` }, { transform: "none" }], {
      duration: ENTER.tileMove * s,
      delay: (ENTER.tileIn + ENTER.tileHold) * s,
      easing: this.spring,
      fill: "backwards",
    });
    this.enterPage(this.pageEl(0), ENTER.tileIn + ENTER.tileHold + ENTER.slabAfterTile);
  }

  private enterPage(page: HTMLElement, delay: number) {
    if (this.o.reduced) return;
    const exit = this.exits.get(page);
    if (exit) {
      const style = getComputedStyle(page);
      const at = { transform: style.transform, opacity: style.opacity, filter: style.filter };
      exit.forEach((animation) => animation.cancel());
      this.exits.delete(page);
      delete page.dataset.motion;
      page.animate([at, { transform: "none", opacity: 1, filter: "blur(0px)" }], { duration: 450, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      return;
    }
    this.clearEntrance(page);
    const s = 1000;
    const animations: Animation[] = [];
    const wipes: HTMLElement[] = [];
    const slab = page.querySelector<HTMLElement>(".dz-slab")!;
    const scale = Number(getComputedStyle(this.root).getPropertyValue("--panel-scale")) || 1;
    const off = ((this.o.stage.clientWidth || 1920) - 700) / scale;
    animations.push(
      slab.animate([{ translate: `${off}px 0`, filter: "blur(8px)" }, { translate: "0 0", filter: "blur(0)" }], {
        duration: ENTER.slab * s,
        delay: delay * s,
        easing: this.spring,
        fill: "backwards",
      }),
    );
    const start = delay + ENTER.slabSettle + ENTER.wait;
    const parts = Array.from(page.children as HTMLCollectionOf<HTMLElement>).filter(
      (el) => !el.classList.contains("dz-slab") && !el.classList.contains("dz-wipe") && el.offsetWidth > 0,
    );
    const half = page.clientWidth / 2;
    const byTop = (a: HTMLElement, b: HTMLElement) => a.offsetTop - b.offsetTop || a.offsetLeft - b.offsetLeft;
    const ghosts = parts.filter((el) => el.matches(GHOSTS));
    const solid = parts.filter((el) => !el.matches(GHOSTS));
    const right = solid.filter((el) => el.offsetLeft + el.offsetWidth / 2 >= half).sort(byTop);
    const left = solid.filter((el) => el.offsetLeft + el.offsetWidth / 2 < half).sort(byTop);
    right.forEach((el, i) => {
      const at = (start + i * ENTER.slideStagger) * s;
      animations.push(
        el.animate([{ translate: "380px 0" }, { translate: "0 0" }], { duration: ENTER.slide * s, delay: at, easing: this.spring, fill: "backwards" }),
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 0.3 * s, delay: at, easing: "linear", fill: "backwards" }),
      );
    });
    const wipe = ENTER.line + ENTER.spread + ENTER.cover + ENTER.clear;
    left.forEach((el, i) => {
      const at = (start + i * ENTER.wipeStagger) * s;
      const block = document.createElement("i");
      block.className = "dz-wipe";
      block.setAttribute("aria-hidden", "true");
      Object.assign(block.style, { left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` });
      page.append(block);
      wipes.push(block);
      const out = "cubic-bezier(0.16, 1, 0.3, 1)";
      const k1 = ENTER.line / wipe, k2 = (ENTER.line + ENTER.spread) / wipe, k3 = (ENTER.line + ENTER.spread + ENTER.cover) / wipe;
      const line = `calc(100% - ${WIPE_LINE}px)`;
      animations.push(
        block.animate(
          [
            { offset: 0, clipPath: `inset(0 ${line} 100% 0)`, easing: out },
            { offset: k1, clipPath: `inset(0 ${line} 0 0)`, easing: out },
            { offset: k2, clipPath: "inset(0 0 0 0)", easing: "linear" },
            { offset: k3, clipPath: "inset(0 0 0 0)", easing: out },
            { offset: 1, clipPath: "inset(0 0 0 100%)" },
          ],
          { duration: wipe * s, delay: at, fill: "both" },
        ),
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: ENTER.clear * s,
          delay: at + (ENTER.line + ENTER.spread + ENTER.cover) * s,
          easing: out,
          fill: "backwards",
        }),
      );
    });
    const last = start + Math.max(right.length * ENTER.slideStagger + ENTER.slide * 0.5, left.length * ENTER.wipeStagger + wipe);
    ghosts.forEach((el) => animations.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: (last - 0.4) * s, easing: "ease-out", fill: "backwards" })));
    this.entrances.set(page, { animations, wipes });
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (this.entrances.get(page)?.animations === animations) this.clearEntrance(page);
      },
      () => {},
    );
  }

  private clearEntrance(page: HTMLElement) {
    const entrance = this.entrances.get(page);
    if (!entrance) return;
    this.entrances.delete(page);
    entrance.animations.forEach((animation) => animation.cancel());
    entrance.wipes.forEach((wipe) => wipe.remove());
  }

  private leavePage(page: HTMLElement) {
    if (this.o.reduced || this.exits.has(page)) return;
    page.dataset.motion = "out";
    const animations = [
      page.animate([{ transform: "none", filter: "blur(0px)" }, { transform: "scale(1.3)", filter: "blur(12px)" }], {
        duration: 600,
        easing: "cubic-bezier(0.5, 0, 0.78, 0.3)",
        fill: "forwards",
      }),
      page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: "cubic-bezier(0.4, 0, 0.7, 0.6)", fill: "forwards" }),
    ];
    this.exits.set(page, animations);
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (this.exits.get(page) !== animations) return;
        this.exits.delete(page);
        delete page.dataset.motion;
        animations.forEach((animation) => animation.cancel());
        this.clearEntrance(page);
      },
      () => {},
    );
  }

  private showPage(index: number) {
    this.page = index;
    this.pageStart = this.now;
    this.root.querySelectorAll<HTMLElement>(".dz-page").forEach((section) => {
      const active = Number(section.dataset.page) === index;
      section.classList.toggle("is-active", active);
      section.inert = !active;
      section.setAttribute("aria-hidden", String(!active));
    });
    this.root.querySelectorAll<HTMLElement>("[data-dz-page]").forEach((tab) => {
      const active = Number(tab.dataset.dzPage) === index;
      tab.setAttribute("aria-selected", String(active));
      tab.classList.toggle("is-active", active);
      tab.classList.toggle("is-done", Number(tab.dataset.dzPage) < index);
    });
    this.q<HTMLButtonElement>('[data-dz="prev"]').disabled = index === 0;
    this.q<HTMLButtonElement>('[data-dz="next"]').disabled = index === PAGES.length - 1;
    this.root.dataset.page = PAGES[index].key;
    const r = this.o.record;
    const captions = [
      `${r.title}`,
      `${r.lead} 写于 ${r.date}，约 ${r.readingMinutes} 分钟读完。`,
      `作者 ${r.lead}${r.authorBio ? ` —— ${r.authorBio}` : ""}`,
      r.comments ? `这篇帖子已有 ${r.comments} 条回复。` : "还没有人回复，成为第一个参与讨论的人。",
    ];
    this.typers = this.typers.filter((typer) => typer.el !== this.q(".dz-caption span"));
    this.caption(captions[index], this.elapsed() + 0.15);
    if (index === 1) {
      const article = this.q(".dz-article");
      article.scrollTop = 0;
    }
  }

  private pageDuration(index: number) {
    if (index === 1) return Math.min(42, 12 + this.body.join("").length * 0.05);
    return [10, 0, 10, 12][index];
  }

  private async loadThread() {
    const id = this.o.record.postId;
    const list = this.q(".dz-comments");
    if (!id) {
      list.innerHTML = '<p class="dz-empty">这个版块还没有帖子，也就还没有讨论。</p>';
      return;
    }
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: this.abort.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { post?: { content?: string; title?: string }; comments?: Comment[] };
      const full = paragraphsFromContent(data.post?.content || "", data.post?.title || this.o.record.title);
      if (full.length && full.join("").length > this.body.join("").length) {
        this.body = full;
        const article = this.q(".dz-article");
        article.innerHTML = `<h2>${esc(this.o.record.title)}</h2>${full.map((text, i) => `<p${i === 0 ? ' class="is-lead"' : ""}>${esc(text)}</p>`).join("")}`;
      }
      this.comments = (data.comments || []).filter((comment) => !comment.deleted && comment.content);
      this.renderComments();
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      list.innerHTML = '<p class="dz-empty">讨论暂时没能载入，可以到论坛里查看。</p>';
    }
  }

  private renderComments() {
    const list = this.q(".dz-comments");
    const comments = (this.comments || [])
      .slice()
      .sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 3);
    this.q("[data-talk-count]").textContent = `${pad(this.comments?.length || 0)} 条回复`;
    if (!comments.length) {
      list.innerHTML = '<p class="dz-empty">还没有回复。<br/>成为第一个参与讨论的人。</p>';
      return;
    }
    list.innerHTML = comments
      .map((comment) => {
        const avatar = safeImage(comment.author_avatar || "");
        const text = paragraphsFromContent(comment.content || "").join(" ");
        return `<article class="dz-comment">
  <div class="dz-comment-head">${avatar ? `<img src="${esc(avatar)}" alt=""/>` : `<span>${esc(comment.author_initials || "NM")}</span>`}<b>${esc(comment.author_name || "匿名")}</b><time>${esc(relative(comment.created_at))}</time>${comment.likes ? `<em>♥ ${comment.likes}</em>` : ""}</div>
  <p>${esc(text)}</p>
</article>`;
      })
      .join("");
  }

  private elapsed() {
    return this.started ? this.now - this.start : 0;
  }

  private once(key: string, at: number, run: () => void) {
    if (this.fired.has(key) || this.elapsed() < at) return;
    this.fired.add(key);
    run();
  }

  tick(now: number) {
    this.now = now;
    if (!this.started) {
      this.started = true;
      this.start = now;
      this.root.classList.add("is-open");
      if (this.skipped || !this.reel) {
        this.setStage(this.skipped ? "panel" : "corridor");
        this.root.classList.add("is-covered");
      } else if (this.o.array) this.setStage("prelude");
      else {
        this.start = now - APPROACH.end;
        this.handoff();
      }
    }
    if (this.skipPending) {
      this.skipPending = false;
      this.start = now - T.panelIn + 0.05;
    }
    const t = this.elapsed();

    if (this.closing >= 0) {
      const k = clamp((now - this.closing) / 0.55);
      if (k >= 1) {
        this.dispose();
        this.o.onExit();
        return;
      }
    }

    if (this.reel && !this.handedOff && this.closing < 0) {
      if (t < APPROACH.end) this.o.array?.at(t);
      else this.handoff();
    }
    if (this.reel && this.handedOff) {
      if (t < T.reelOut + 0.45) this.reel.render(t - APPROACH.end);
      else {
        this.reel.dispose();
        this.reel = undefined;
      }
    }
    this.once("reel-out", T.reelOut - 0.12, () => {
      this.root.classList.remove("show-reel");
      this.setStage("corridor");
    });

    this.once("corridor", T.corridorIn, () => {
      this.root.classList.add("show-corridor");
      this.caption(`正在调取 ${this.o.record.id} · ${this.o.board.name} 版块档案`, T.corridorIn + 0.8);
    });
    if (this.corridor) {
      if (t < T.corridorOut + 0.6) {
        if (t >= T.corridorIn - 0.4) this.corridor.render(span(t, T.corridorIn, T.corridorPush - T.corridorIn), span(t, T.corridorPush, T.corridorOut - T.corridorPush));
      } else {
        this.corridor.dispose();
        this.corridor = undefined;
      }
    }

    this.once("cloud", T.cloudIn, () => {
      this.root.classList.remove("show-corridor");
      this.root.classList.add("show-cloud");
      this.setStage("cloud");
      this.caption(`Naimakes 由 ${this.o.boards.length} 个版块组成，每个版块都是一条独立的思考路径。`, T.cloudIn + 1.6);
    });
    this.once("match", T.cloudMatch, () => {
      this.root.classList.add("cloud-matched");
      this.q(".dz-searching span").textContent = `MATCHED · ${this.o.board.en || this.o.board.name}`;
    });
    this.once("cloud-out", T.cloudOut, () => {
      this.root.classList.add("cloud-leaving");
      this.ensureChain();
    });

    this.once("board", T.boardIn, () => {
      this.root.classList.remove("show-cloud", "cloud-leaving");
      this.root.classList.add("show-board", "show-rail");
      this.setStage("board");
      this.chain?.show(true);
      this.type(this.q('[data-type="board-name"]'), this.o.board.name, T.boardIn + 1.5, 0.6);
      this.type(this.q('[data-type="board-desc"]'), this.o.board.description, T.boardIn + 2.3, 1.6);
      this.caption(`${this.o.board.name} —— ${this.o.board.description}`, T.boardIn + 2.6);
    });
    this.once("board-out", T.boardOut, () => {
      this.root.classList.add("board-leaving");
    });

    this.once("panel", T.panelIn, () => {
      this.root.classList.add("show-panel", "show-rail");
      this.setStage("panel");
      this.showPage(0);
      this.enterPanel();
    });
    this.once("board-gone", T.boardGone, () => this.root.classList.remove("show-board", "board-leaving"));
    if (this.root.dataset.stage === "panel" && this.pageStart > 0) {
      const duration = this.pageDuration(this.page);
      const progress = clamp((now - this.pageStart) / duration);
      const bar = this.root.querySelector<HTMLElement>(`[data-dz-page="${this.page}"] i b`);
      if (bar) bar.style.transform = `scaleX(${this.autoplay ? progress : 0})`;
      if (this.autoplay && progress >= 1 && this.page < PAGES.length - 1) this.goto(this.page + 1);
      if (this.page === 1) {
        const article = this.q(".dz-article");
        const max = article.scrollHeight - article.clientHeight;
        if (this.autoplay && max > 0) article.scrollTop = max * clamp((progress - 0.12) / 0.8);
        const read = max > 0 ? article.scrollTop / max : 1;
        this.q(".dz-progress b").style.transform = `scaleY(${read})`;
      }
    }

    for (const typer of this.typers) {
      const k = span(t, typer.start, typer.duration);
      if (k <= 0) continue;
      const text = typed(typer.text, k);
      if (typer.el.textContent !== text) typer.el.textContent = text;
    }
    this.typers = this.typers.filter((typer) => span(t, typer.start, typer.duration) < 1 || typer.el.textContent !== typer.text);

    if (this.chain && (this.root.classList.contains("show-board") || this.root.classList.contains("show-panel") || this.root.classList.contains("cloud-leaving")))
      this.chain.render(now);
    if (this.skipped) this.root.classList.remove("is-skipping");
  }

  dispose() {
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.reel?.dispose();
    this.reel = undefined;
    this.corridor?.dispose();
    this.chain?.dispose();
    this.corridor = this.chain = undefined;
    this.root.remove();
    delete this.o.stage.dataset.dossier;
    delete this.o.stage.dataset.dossierStage;
  }
}
