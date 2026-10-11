import type { ArchiveRecord } from "../data/archive-data";
import { escapeHtml } from "../ui/escape-html";
import { lineIcon } from "../ui/line-icons";
import { normalizeQuery, suggestPosts } from "./post-matching";
import "./search-palette.css";

type Recent = { value: string; label?: string; pinned: boolean };

type PaletteOptions = {
  host: HTMLElement;
  records: ArchiveRecord[];
  reduced: boolean;
  signedIn: () => boolean;
  onPick: (index: number, query: string) => void;
  onSubmit: (query: string) => boolean;
  onShare: (index: number) => void;
  onClosed: () => void;
};

const TAGS = ["人工智能", "世界模型", "开源", "人类未来"];
const SPRING = { stiffness: 300, damping: 26, mass: 1 };
const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

async function recentsRequest(method: string, body?: unknown): Promise<Recent[]> {
  const response = await fetch("/api/recents/search", {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "暂时无法连接，请稍后重试。");
  return (data.items || []) as Recent[];
}

export class SearchPalette {
  private root?: HTMLElement;
  private dialog?: HTMLElement;
  private backdrop?: HTMLElement;
  private preview?: HTMLElement;
  private top?: HTMLElement;
  private content?: HTMLElement;
  private input?: HTMLInputElement;
  private list?: HTMLElement;
  private recentsHost?: HTMLElement;
  private pinButton?: HTMLButtonElement;
  private origin: { rect: DOMRect; radius: number } | null = null;
  private progress = 0;
  private velocity = 0;
  private target = 0;
  private frame = 0;
  private last = 0;
  private geometry = { x: 0, y: 8, sx: 0.85, sy: 0.85, radius: 24, width: 0, height: 0 };
  private recents: Recent[] = [];
  private query = "";
  private notice = "";
  private closing?: () => void;
  private resize?: ResizeObserver;
  private previousFocus: HTMLElement | null = null;
  private clearArmed = 0;

  constructor(private o: PaletteOptions) {}

  get isOpen() {
    return Boolean(this.root) && this.target === 1;
  }

  get isActive() {
    return Boolean(this.root);
  }

  open(trigger: HTMLElement | null, initial = "") {
    if (this.root && this.target === 1) {
      this.input?.focus();
      return;
    }
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.closing = undefined;
    if (!this.root) this.build(trigger);
    this.notice = "";
    this.setQuery(initial);
    if (this.input) this.input.value = initial;
    this.target = 1;
    this.root!.dataset.state = "open";
    this.measure();
    if (this.o.signedIn()) void this.loadRecents();
    requestAnimationFrame(() => this.input?.focus({ preventScroll: true }));
    this.animate();
  }

  close(then?: () => void) {
    if (!this.root) {
      then?.();
      return;
    }
    if (then) {
      const previous = this.closing;
      this.closing = () => {
        previous?.();
        then();
      };
    }
    this.target = 0;
    this.root.dataset.state = "closing";
    this.input?.blur();
    this.animate();
  }

  key(event: KeyboardEvent) {
    if (!this.root) return false;
    if (this.target === 0) {
      event.preventDefault();
      return true;
    }
    if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
      event.preventDefault();
      this.close();
      return true;
    }
    if (event.key === "Tab") {
      const focusables = [...this.dialog!.querySelectorAll<HTMLElement>("button:not(:disabled), input")].filter((el) => el.getClientRects().length);
      const first = focusables[0], last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return true;
    }
    return true;
  }

  private build(trigger: HTMLElement | null) {
    const rect = trigger?.getBoundingClientRect();
    this.origin = rect && rect.width ? { rect, radius: Math.min(rect.height / 2, parseFloat(getComputedStyle(trigger!).borderTopLeftRadius) || 22) } : null;
    const root = document.createElement("div");
    root.className = "sp";
    root.innerHTML = `
<div class="sp-backdrop" aria-hidden="true"></div>
<section class="sp-dialog" role="dialog" aria-modal="true" aria-label="发现新的想法">
  <span class="sp-refraction" aria-hidden="true"></span>
  <span class="sp-pointer-light" aria-hidden="true"></span>
  <div class="sp-preview" aria-hidden="true"><div><div class="sp-preview-button">${lineIcon("search", 16)}<span>搜索</span><kbd>⌘K</kbd></div></div></div>
  <div class="sp-top">
    <span>发现新的想法</span>
    <button type="button" class="sp-icon-button sp-close sp-liquid" data-sp="close" aria-label="关闭弹窗">${lineIcon("close", 19)}</button>
    <button type="button" class="sp-icon-button sp-back sp-liquid" data-sp="close" aria-label="返回">${lineIcon("arrowLeft", 18)}</button>
  </div>
  <div class="sp-content">
    <form class="sp-input sp-glass" role="search">
      ${lineIcon("search", 22)}
      <input type="search" autocomplete="off" enterkeyhint="search" maxlength="120" placeholder="搜索话题、想法、关键词…" aria-label="搜索讨论"/>
      <button type="button" class="sp-pin" data-sp="pin" aria-pressed="false" aria-label="收藏这个关键词" title="收藏这个关键词" hidden>${lineIcon("star", 17)}</button>
      <kbd>ESC</kbd>
    </form>
    <div class="sp-recents" hidden></div>
    <div class="sp-suggestions"></div>
  </div>
</section>`;
    this.o.host.append(root);
    this.root = root;
    this.dialog = root.querySelector(".sp-dialog")!;
    this.backdrop = root.querySelector(".sp-backdrop")!;
    this.preview = root.querySelector(".sp-preview")!;
    this.top = root.querySelector(".sp-top")!;
    this.content = root.querySelector(".sp-content")!;
    this.input = root.querySelector("input")!;
    this.list = root.querySelector(".sp-suggestions")!;
    this.recentsHost = root.querySelector(".sp-recents")!;
    this.pinButton = root.querySelector(".sp-pin")!;
    if (this.origin && !this.o.reduced) {
      const k = this.origin.rect.height / 44;
      this.preview.querySelector<HTMLElement>(".sp-preview-button")!.style.setProperty("--k", k.toFixed(3));
    }
    this.backdrop.addEventListener("click", () => this.close());
    root.addEventListener("click", (event) => this.onClick(event));
    root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit();
    });
    this.input.addEventListener("input", () => this.setQuery(this.input!.value));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
    });
    this.dialog.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const r = this.dialog!.getBoundingClientRect();
      this.dialog!.style.setProperty("--sp-lx", `${(((event.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      this.dialog!.style.setProperty("--sp-ly", `${(((event.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    });
    this.dialog.addEventListener("pointerleave", () => {
      this.dialog!.style.setProperty("--sp-lx", "25%");
      this.dialog!.style.setProperty("--sp-ly", "0%");
    });
    this.bindLiquid(root);
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(this.dialog);
    this.resize.observe(this.o.host);
  }

  private bindLiquid(root: HTMLElement) {
    const release = (button: HTMLElement) => {
      if (button.dataset.pressed !== "true") return;
      delete button.dataset.pressed;
      if (this.o.reduced) return;
      button.animate([{ scale: 0.965 }, { scale: 1.02, offset: 0.52 }, { scale: 1 }], { duration: 320, easing: "cubic-bezier(.22,.9,.25,1)" });
    };
    root.addEventListener("pointerdown", (event) => {
      const button = (event.target as Element).closest<HTMLElement>(".sp-liquid");
      if (!button || event.button > 0) return;
      button.dataset.pressed = "true";
      const up = () => {
        release(button);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
    root.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const button = (event.target as Element).closest<HTMLElement>(".sp-liquid");
      if (!button || button.dataset.pressed === "true") return;
      const r = button.getBoundingClientRect();
      const u = (event.clientX - r.left) / r.width, v = (event.clientY - r.top) / r.height;
      button.style.setProperty("--mx", `${((u - 0.5) * 3.6).toFixed(2)}px`);
      button.style.setProperty("--my", `${((v - 0.5) * 1.8).toFixed(2)}px`);
      if (button.classList.contains("sp-light") && ((r.width >= 140 && r.height >= 38) || (r.width >= 96 && r.height >= 64))) {
        const rx = Math.min(240, Math.max(84, r.width * 0.55)), ry = Math.min(210, Math.max(64, r.height * 1.35));
        button.style.setProperty("--sp-light", `radial-gradient(ellipse ${rx}px ${ry}px at ${(u * 100).toFixed(1)}% ${(v * 100).toFixed(1)}%, rgb(255 255 255 / .52) 0%, rgb(180 180 180 / .12) 38%, transparent 76%)`);
      }
    });
    root.addEventListener("pointerout", (event) => {
      const button = (event.target as Element).closest<HTMLElement>(".sp-liquid");
      if (!button || button.contains(event.relatedTarget as Node)) return;
      button.style.removeProperty("--mx");
      button.style.removeProperty("--my");
      button.style.removeProperty("--sp-light");
    });
  }

  private measure() {
    const dialog = this.dialog;
    if (!dialog || !this.root) return;
    const width = dialog.offsetWidth, height = dialog.offsetHeight;
    if (!width || !height) return;
    const host = this.o.host.getBoundingClientRect();
    const left = (host.width - width) / 2, top = (host.height - height) / 2;
    const r = this.origin?.rect;
    this.geometry = {
      x: r ? r.left - host.left + r.width / 2 - left - width / 2 : 0,
      y: r ? r.top - host.top + r.height / 2 - top - height / 2 : 8,
      sx: r ? Math.min(2, Math.max(0.06, r.width / width)) : 0.85,
      sy: r ? Math.min(2, Math.max(0.055, r.height / height)) : 0.85,
      radius: this.origin?.radius ?? 24,
      width,
      height,
    };
    if (this.preview && r) {
      const inner = this.preview.firstElementChild as HTMLElement;
      inner.style.width = `${r.width}px`;
      inner.style.height = `${r.height}px`;
      inner.style.transform = `scale(${width / r.width}, ${height / r.height})`;
    }
    this.paint();
  }

  private animate() {
    if (this.frame) return;
    this.last = performance.now();
    const step = (now: number) => {
      this.frame = 0;
      const dt = Math.min(0.064, Math.max(0.001, (now - this.last) / 1000));
      this.last = now;
      if (this.o.reduced) {
        this.progress = this.target;
        this.velocity = 0;
      } else {
        const steps = Math.ceil(dt / 0.004);
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          const force = -SPRING.stiffness * (this.progress - this.target) - SPRING.damping * this.velocity;
          this.velocity += (force / SPRING.mass) * h;
          this.progress += this.velocity * h;
        }
      }
      const resting = Math.abs(this.progress - this.target) < 0.002 && Math.abs(this.velocity) < 0.01;
      if (resting) {
        this.progress = this.target;
        this.velocity = 0;
      }
      this.paint();
      if (!resting) this.frame = requestAnimationFrame(step);
      else if (this.target === 0) this.finish();
    };
    this.frame = requestAnimationFrame(step);
  }

  private paint() {
    const dialog = this.dialog;
    if (!dialog) return;
    const p = this.progress;
    const g = this.geometry;
    const q = Math.min(1, Math.max(0, p));
    const reduced = this.o.reduced;
    const x = reduced ? 0 : g.x * (1 - p);
    const y = reduced ? 0 : g.y * (1 - p);
    const sx = reduced ? 1 : g.sx + (1 - g.sx) * p;
    const sy = reduced ? 1 : g.sy + (1 - g.sy) * p;
    const compact = matchMedia("(max-width: 760px)").matches;
    const rest = compact ? 0 : 26;
    const radius = g.radius * (1 - q) + rest * q;
    dialog.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    dialog.style.borderRadius = `${(radius / Math.max(0.05, sx)).toFixed(2)}px / ${(radius / Math.max(0.05, sy)).toFixed(2)}px`;
    dialog.style.opacity = String(reduced ? q : ramp(p, 0, 0.12));
    const contentOpacity = reduced ? q : ramp(p, 0.36, 0.94);
    const blur = reduced ? 0 : (1 - ramp(p, 0.3, 0.92)) * 3;
    for (const layer of [this.top!, this.content!]) {
      layer.style.opacity = contentOpacity.toFixed(3);
      layer.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "";
    }
    if (this.preview) this.preview.style.opacity = reduced || !this.origin ? "0" : String(1 - ramp(p, 0.06, 0.32));
    this.backdrop!.style.opacity = q.toFixed(3);
  }

  private finish() {
    if (!this.root || this.target !== 0) return;
    this.resize?.disconnect();
    this.root.remove();
    this.root = this.dialog = this.backdrop = this.preview = this.top = this.content = this.input = this.list = this.recentsHost = this.pinButton = undefined;
    this.progress = this.velocity = 0;
    const done = this.closing;
    this.closing = undefined;
    this.o.onClosed();
    if (done) done();
    else if (this.previousFocus?.isConnected && !this.previousFocus.closest("[inert]")) this.previousFocus.focus({ preventScroll: true });
  }

  private setQuery(value: string) {
    this.query = value;
    this.notice = "";
    this.renderSuggestions();
    this.renderPin();
  }

  private renderSuggestions() {
    const list = this.list;
    if (!list) return;
    const query = this.query;
    const trimmed = query.trim();
    const results = suggestPosts(this.o.records, query);
    const tags = trimmed
      ? ""
      : `<span class="sp-label">从一个关键词开始</span><div class="sp-tags">${TAGS.map((tag) => `<button type="button" class="sp-tag sp-glass sp-liquid sp-hover" data-sp-tag="${escapeHtml(tag)}">${lineIcon("hash", 12)}${escapeHtml(tag)}</button>`).join("")}</div>`;
    const rows = results
      .map((index) => {
        const r = this.o.records[index];
        return `<div class="sp-row">
  <button type="button" class="sp-result sp-glass sp-liquid sp-hover sp-light" data-sp-pick="${index}">${lineIcon("message", 18)}<span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.category)} · ${escapeHtml(r.lead)}</small></span>${lineIcon("arrowUpRight", 15)}</button>
  <button type="button" class="sp-share sp-glass sp-liquid" data-sp-share="${index}" aria-label="分享讨论：${escapeHtml(r.title)}" title="分享">${lineIcon("share", 15)}</button>
</div>`;
      })
      .join("");
    const empty = this.notice
      ? `<p class="sp-empty" role="status"><strong>${escapeHtml(this.notice)}</strong>换一个更简短的关键词再试试。</p>`
      : results.length
        ? ""
        : '<p class="sp-empty">还没有相关讨论，试试其他关键词。</p>';
    list.innerHTML = tags + rows + empty;
  }

  private renderPin() {
    const button = this.pinButton;
    if (!button) return;
    const value = normalizeQuery(this.query);
    const show = this.o.signedIn() && Boolean(value);
    button.hidden = !show;
    const pinned = this.recents.some((item) => item.pinned && item.value === value);
    button.setAttribute("aria-pressed", String(pinned));
    button.setAttribute("aria-label", pinned ? "取消收藏这个关键词" : "收藏这个关键词");
    button.title = pinned ? "取消收藏" : "收藏这个关键词";
  }

  private async loadRecents() {
    try {
      this.recents = await recentsRequest("GET");
    } catch {
      this.recents = [];
    }
    this.renderRecents();
    this.renderPin();
  }

  private renderRecents() {
    const host = this.recentsHost;
    if (!host) return;
    const pinned = this.recents.filter((item) => item.pinned);
    const history = this.recents.filter((item) => !item.pinned);
    host.hidden = !this.recents.length;
    const chip = (item: Recent) =>
      `<button type="button" class="sp-recent sp-glass sp-liquid sp-hover${item.pinned ? " is-pinned" : ""}" data-sp-recent="${escapeHtml(item.value)}" title="${escapeHtml(item.label || item.value)}">${item.pinned ? lineIcon("star", 12) : ""}<span>${escapeHtml(item.label || item.value)}</span></button>`;
    const group = (title: string, items: Recent[], star: boolean, clear: boolean) =>
      items.length
        ? `<div class="sp-recents-group"><div class="sp-recents-head"><span>${star ? lineIcon("star", 11) : ""}${title}</span>${clear ? `<button type="button" class="sp-text-button" data-sp="clear-recents">${lineIcon("trash", 13)}一键清空</button>` : ""}</div><div class="sp-recents-items">${items.map(chip).join("")}</div></div>`
        : "";
    host.innerHTML = group("收藏的关键词", pinned, true, false) + group("最近搜索", history, false, true);
  }

  private async togglePin() {
    const value = normalizeQuery(this.query);
    if (!value) return;
    const pinned = this.recents.some((item) => item.pinned && item.value === value);
    try {
      this.recents = await recentsRequest("PATCH", { values: [value], pinned: !pinned });
      this.renderRecents();
      this.renderPin();
    } catch (error) {
      this.notice = (error as Error).message;
      this.renderSuggestions();
    }
  }

  private async clearRecents(button: HTMLElement) {
    if (button.dataset.confirm !== "true") {
      button.dataset.confirm = "true";
      button.lastChild!.textContent = "确认清空";
      window.clearTimeout(this.clearArmed);
      this.clearArmed = window.setTimeout(() => {
        if (!button.isConnected) return;
        delete button.dataset.confirm;
        button.lastChild!.textContent = "一键清空";
      }, 2600);
      return;
    }
    try {
      this.recents = await recentsRequest("DELETE", { all: true });
      this.renderRecents();
      this.renderPin();
    } catch {
      delete button.dataset.confirm;
    }
  }

  flash(text: string) {
    const dialog = this.dialog;
    if (!dialog) return;
    dialog.querySelector(".sp-flash")?.remove();
    const note = document.createElement("div");
    note.className = "sp-flash";
    note.setAttribute("role", "status");
    note.textContent = text;
    dialog.append(note);
    const animation = note.animate(
      [
        { opacity: 0, transform: "translate(-50%, 10px) scale(.96)" },
        { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.12 },
        { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.86 },
        { opacity: 0, transform: "translate(-50%, 6px) scale(.98)" },
      ],
      { duration: this.o.reduced ? 1800 : 2400, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
    );
    animation.finished.then(() => note.remove(), () => note.remove());
  }

  remember(query: string) {
    if (!this.o.signedIn() || !query) return;
    void recentsRequest("POST", { value: query, label: "" }).then((items) => {
      this.recents = items;
      this.renderRecents();
    }, () => {});
  }

  private submit(value = this.query) {
    const query = normalizeQuery(value);
    if (!query) {
      this.input?.focus();
      return;
    }
    if (!this.o.onSubmit(query)) {
      this.notice = "没有找到相关讨论";
      this.renderSuggestions();
      this.input?.focus();
    }
  }

  private onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (!target || this.target !== 1) return;
    const action = target.dataset.sp;
    if (action === "close") this.close();
    else if (action === "pin") void this.togglePin();
    else if (action === "clear-recents") void this.clearRecents(target);
    else if (target.dataset.spTag) {
      this.input!.value = target.dataset.spTag;
      this.setQuery(target.dataset.spTag);
      this.input!.focus({ preventScroll: true });
    } else if (target.dataset.spRecent) {
      this.input!.value = target.dataset.spRecent;
      this.setQuery(target.dataset.spRecent);
      this.submit(target.dataset.spRecent);
    } else if (target.dataset.spShare) this.o.onShare(Number(target.dataset.spShare));
    else if (target.dataset.spPick) this.o.onPick(Number(target.dataset.spPick), normalizeQuery(this.query));
  }
}
