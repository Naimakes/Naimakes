import { createRollingClock } from "./ui/rolling-clock";
import { InspectionOverlay } from "./detail/inspection-overlay";
import { DocumentDecryption } from "./detail/document-decryption";
import "./detail/document-decryption.css";
import "./detail/decryption.css";
import { escapeHtml } from "./ui/escape-html";
import "@kitlangton/rolling-number/styles.css";
import "../typography/typography.css";
import "../interaction/button-focus.css";
import "./styles/landing.css";
import "./styles/responsive.css";
import { viewportLayout, openingLayout } from "./ui/viewport-layout";
import { createRollingNumber, createRollingText } from "@kitlangton/rolling-number";
import { ArchiveScene } from "./array/array-scene";
import { ContentTransition, SurfaceTransition } from "./ui/ui-transitions";
import { BootSequence } from "./opening/opening-sequence";
import { wrap, type ArchiveNavigation } from "./array/array-loop";
import {
  records,
  archiveColumns,
  columnFiles,
  fileLocation,
  boards,
  boardOf,
} from "./data/archive-data";
import { TerminalAudio } from "./audio/background-music";
import { StartupGate, type EntryChoice } from "./entry-gate/entry-gate";
import { bootIdentity, setBootIdentity } from "./data/visitor-identity";
import { recordView } from "./data/load-forum-posts";
import "./entry-gate/entry-gate.css";
import "./styles/glass-theme.css";
import type { Dossier } from "./dossier/dossier";
import type { Convergence } from "./enter-forum/enter-forum";
import type { CardView } from "./dossier/reel-scene";
import { SearchPalette } from "./search/search-palette";
import { SearchSequence, preloadCardFace } from "./search/search-sequence";
import { searchPosts } from "./search/post-matching";
import { lineIcon } from "./ui/line-icons";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const shortcutMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
import { logo, brandHeading } from "./ui/brand-marks";

$("#stage").innerHTML = `
  <div id="three-scene" class="three-scene"></div>
  <div class="scene-atmosphere archive-atmosphere"></div>
  <div id="boot-background" class="boot-background"><svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3"><path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/><path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/><circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/></g></svg></div>
  <header class="brand">${brandHeading}</header>
  <nav class="system-nav" aria-label="系统导航">
    <button class="nav-search" data-action="search" aria-haspopup="dialog" aria-label="搜索帖子，快捷键 ${shortcutMac ? "Command" : "Ctrl"} K" aria-keyshortcuts="${shortcutMac ? "Meta+K" : "Control+K"} /">${lineIcon("search", 16)}<span>搜索</span><kbd aria-hidden="true">${shortcutMac ? "⌘K" : "Ctrl K"}</kbd></button>
    <button class="explore-site" data-action="explore">进入论坛 <span aria-hidden="true">→</span></button>
  </nav>
  <button id="skip" class="skip" data-action="skip">跳过开场 <span aria-hidden="true">⇥</span></button>
  <section id="boot" class="boot" aria-label="系统启动">
    <div class="access-text">ACCESS</div>
    <div class="boot-logo">${logo}</div>
    <div class="auth-status"><span>▪</span> <span id="auth-message"></span><i></i></div>
    <div class="scan"><svg viewBox="0 0 1920 1080" aria-hidden="true"><g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round"><path/><path stroke="#fff"/><path/><path/><path/><path/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="scan-core" cx="960" cy="540" r="5" fill="#080a08" stroke="none"/></g></svg><span>PERMISSION AUTHORIZED</span></div>
    <div class="welcome"><div class="welcome-panel"></div><div class="welcome-heading">WELCOME TO</div><div class="welcome-company"><strong>NAIMAKES</strong><strong class="welcome-highlight" aria-hidden="true">NAIMAKES</strong></div><div class="welcome-database">思想，先于未来</div><div class="welcome-logo">${logo}</div></div>
  </section>
  <svg id="inspection-marks" viewBox="0 0 1920 1080" aria-hidden="true"><path id="inspection-lines"/><g id="inspection-corners"></g><circle id="inspection-point" r="1.8"/></svg>
  <div id="inspection-text" aria-hidden="true">ACCESS LEVEL:<strong>PUBLIC DISCUSSION</strong></div>
  <div id="boot-caption" class="cinema-caption" aria-hidden="true"></div>
  <section id="archive-ui" class="archive-ui" aria-label="帖子选择">
    <div class="archive-callout"><div class="eyebrow">NAIMAKES 论坛 <span>／</span> <span id="archive-category">板块</span></div><button class="file-title" data-action="open">帖子 <span id="selected-id">N-<span id="selected-code">001</span></span><span class="file-open">↗</span></button><div class="callout-rule"><i></i></div><div class="file-summary"><span id="selected-title">正在载入</span><span id="selected-clearance">NAIMAKES</span></div><button class="read-file" data-action="open">阅读帖子 <span>→</span></button></div>
    <div id="hover-label" class="hover-label" hidden>N-<span id="hover-code">001</span> / <span id="hover-title"></span></div>
    <div class="archive-counter"><span class="tiny-label">帖子 / 选择</span><div><span id="selected-number">01</span><i>/</i><span class="count-total">12</span></div></div>
    <div class="archive-navigation"><button data-action="prev" aria-label="上一篇帖子">↑</button><div id="file-ticks" class="file-ticks"></div><button data-action="next" aria-label="下一篇帖子">↓</button></div>
    <div class="column-navigation"><button data-action="column-prev" aria-label="上一个板块">←</button><div><span id="column-number">板块 <span id="column-index">01</span> / <span id="column-total">01</span></span><strong id="column-name">板块</strong></div><button data-action="column-next" aria-label="下一个板块">→</button></div>
    <div class="archive-hint"><kbd>←</kbd> <kbd>→</kbd> 切换板块 <span>／</span> <kbd>↑</kbd> <kbd>↓</kbd> 前后帖子 <span>／</span> <kbd>ENTER</kbd> 阅读</div>
  </section>
  <section id="detail-ui" class="detail-ui" aria-label="帖子内容" hidden>
    <button class="back-button" data-action="back">← <span>返回阵列</span><small>ESC</small></button>
    <div class="object-caption"><span id="object-id">NO.001</span><div>NAIMAKES 论坛</div></div>
    <article id="detail-content" class="detail-content"></article>
  </section>
  <div class="powered">POWERED BY <b>NAIMAKES</b><i></i></div>
  <footer class="system-footer"><span><i class="status-light"></i> 思想，先于未来</span><span>NAIMAKES <i>／</i> <span id="clock">00:00:00</span></span><button data-action="replay" title="重播开场">重播开场 ↗</button></footer>
  <div id="toast" class="toast" role="status"></div>
  <div id="loading" class="loading"><div class="loading-mark">${logo}</div><span>正在连接 NAIMAKES 论坛</span><i></i></div>
`;

$("#boot-background").insertAdjacentHTML(
  "beforeend",
  '<div class="boot-white"></div>',
);
$("#column-total").textContent = String(archiveColumns.length).padStart(2, "0");
const bootSequence = new BootSequence($("#stage"));
$("#viewport").insertAdjacentHTML("beforeend", '<button class="mobile-entry" data-action="skip">跳过开场 <span aria-hidden="true">⇥</span></button>');

type Mode = "boot" | "archive" | "detail";
let mode: Mode = "boot",
  selected = 0,
  bootStart = 0,
  lastStep = "",
  ready = false;
let activeTab = "overview";
let toastTimer: ReturnType<typeof setTimeout>;
const detailTransition = new SurfaceTransition($("#detail-ui"), undefined, 180, 180);
const tabTransition = new ContentTransition();
let pendingDetailFocus = false;
let signedIn = false;
let pickQuery: string | null = null;
let searchRun: SearchSequence | undefined;
let dossierHold = false;
let searchHandoff = false;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
$("#stage").classList.toggle("reduce-motion", reduced);
$("#stage").classList.toggle("reduce-surfaces", reduced);
const rollingMotion = {
  duration: 460,
  motionBlur: true,
  animated: !reduced,
};
const updateFooterClock = createRollingClock($("#clock"));
const numberOptions = {
  ...rollingMotion,
  locales: "en-US",
  format: { minimumIntegerDigits: 2, useGrouping: false },
};
const fileCounter = createRollingNumber($("#selected-number"), {
  ...numberOptions,
  value: 1,
});
const columnCounter = createRollingNumber($("#column-index"), {
  ...numberOptions,
  value: 3,
});
const codeOptions = {
  ...numberOptions,
  format: { minimumIntegerDigits: 3, useGrouping: false },
  value: 1,
};
const textOptions = {
  ...rollingMotion,
  animated: !reduced,
  transition: "direct" as const,
  stagger: "none" as const,
};
const selectionTitle = createRollingText($("#selected-title"), {
  ...textOptions,
  text: $("#selected-title").textContent ?? "",
});
const columnTitle = createRollingText($("#column-name"), {
  ...textOptions,
  text: $("#column-name").textContent ?? "",
});
const hoverTitle = createRollingText($("#hover-title"), { ...textOptions, text: "" });
const categoryTitle = createRollingText($("#archive-category"), {
  ...textOptions,
  text: $("#archive-category").textContent ?? "",
});
const clearanceTitle = createRollingText($("#selected-clearance"), {
  ...textOptions,
  text: $("#selected-clearance").textContent ?? "",
});
const rollingTitles = [selectionTitle, columnTitle, hoverTitle, categoryTitle, clearanceTitle];
const selectedCode = createRollingNumber($("#selected-code"), codeOptions);
const hoverCode = createRollingNumber($("#hover-code"), codeOptions);
const audio = new TerminalAudio();
let started = false;
const loading = $("#loading");
$("#viewport").append(loading);
$("#stage").inert = true;
$(".mobile-entry").inert = true;
const entry = new StartupGate({
  root: loading,
  logo,
  prime: () => audio.prime(),
  unlock: () => audio.unlock(),
  signedIn: () => {
    if (window.parent !== window)
      window.parent.postMessage({ type: "naimakes-landing-auth" }, location.origin);
  },
  start: choice => completeStartup(choice),
});
audio.holdForEntry();
void audio.prepareMusic().catch(() => {});
let scene: ArchiveScene | undefined;
const accessLog: { id: string; time: string }[] = [];
const columnMemory = archiveColumns.map((_, lane) => columnFiles(lane)[0]);
function recordAccess() {
  accessLog.unshift({
    id: records[selected].id,
    time: new Date().toLocaleTimeString("en-GB"),
  });
}
let previousLayout = "";
function fit() {
  const stage = $("#stage");
  const viewport = $("#viewport");
  const coarse = matchMedia("(pointer: coarse)").matches;
  const { width, height, scale, kind } = mode === "boot"
    ? openingLayout(viewport.clientWidth, viewport.clientHeight)
    : viewportLayout(viewport.clientWidth, viewport.clientHeight, coarse);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.dataset.layout = kind;
  stage.dataset.touch = String(coarse);
  viewport.dataset.mobileBoot = String(mode === "boot" && (coarse || viewport.clientWidth < 1100));
  stage.style.setProperty("--stage-scale", String(scale));
  stage.style.setProperty("--opening-width", `${width}px`);
  stage.style.setProperty("--opening-height", `${height}px`);
  stage.style.setProperty("--opening-scan-scale", String(Math.min(1, width / 1920)));
  stage.dataset.openingPortrait = String(width < height);
  $("#viewport").style.setProperty("--scale", String(scale));
  const marks = document.querySelector("#inspection-marks");
  marks?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layoutKey = JSON.stringify([width, height, scale, kind, devicePixelRatio]);
  if (layoutKey !== previousLayout) {
    previousLayout = layoutKey;
    scene?.resize();
  }
  requestAnimationFrame(() => {
    documentDecryption.refresh();
    const tab = document.querySelector<HTMLElement>(".detail-tabs button.active");
    const indicator = document.querySelector<HTMLElement>(".tab-indicator");
    if (tab && indicator) indicator.style.transform = `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth})`;
  });
}
window.addEventListener("resize", fit);
window.visualViewport?.addEventListener("resize", fit);
window.visualViewport?.addEventListener("scroll", fit);
matchMedia("(pointer: coarse)").addEventListener("change", fit);
fit();
const fileTicks: HTMLButtonElement[] = [];

function setMode(next: Mode) {
  const previousMode = mode;
  rollingTitles.forEach(title => title.update({ animated: !reduced && next === "archive" }));
  if (next !== "archive") {
    rollingTitles.forEach(title => title.finish());
    hoverCode.finish();
    $("#hover-label").hidden = true;
  }
  if (next === "detail" && mode !== "detail") recordAccess();
  mode = next;
  audio.setScene(next);
  $("#stage").dataset.mode = next;
  if (previousMode !== next) fit();
  $("#boot").inert = next !== "boot";
  $("#boot").setAttribute("aria-hidden", String(next !== "boot"));
  if (next !== "boot") endPick();
  $("#archive-ui").inert = next !== "archive" || Boolean(searchRun);
  $("#archive-ui").setAttribute("aria-hidden", String(next !== "archive"));
  $(".system-nav").inert = next === "boot" || Boolean(searchRun);
  $(".system-footer").inert = next === "boot" || Boolean(searchRun);
  if (next === "detail") {
    if (previousMode !== "detail") detailTransition.show(reduced);
  } else if (previousMode === "detail" || (next === "boot" && !$("#detail-ui").hidden)) {
    pendingDetailFocus = false;
    tabTransition.cancel();
    detailTransition.hide(reduced || next === "boot");
    if (!palette.isActive && next === "archive") $(".read-file").focus({ preventScroll: true });
  }
  $("#detail-ui").inert = next !== "detail" || Boolean(searchRun);
  scene?.setMode(next === "boot" ? "hidden" : next);
  if (next !== "boot") {
    updateBootCaption(null);
    bootSequence.reset();
    $(".file-title").firstChild!.textContent = "帖子 ";
    $("#stage").dataset.boot = "done";
  }
  if (next === "detail" && previousMode !== "detail") {
    renderDetail();
    pendingDetailFocus = true;
    if (!scene) {
      $("#detail-content").style.opacity = "1";
      $("#detail-content").style.translate = "0 0";
      $("#detail-content").inert = false;
    }
  }
}
function select(index: number, navigation?: ArchiveNavigation) {
  selected = (index + records.length) % records.length;
  columnMemory[fileLocation(selected).lane] = selected;
  if (mode === "detail") setMode("archive");
  activeTab = "overview";
  scene?.select(selected, navigation);
  updateSelection(navigation);
}
function stepFile(direction: number) {
  const files = columnFiles(fileLocation(selected).lane);
  if (files.length < 2) return;
  select(
    files[(files.indexOf(selected) + direction + files.length) % files.length],
    { axis: "row", direction },
  );
}
function stepColumn(direction: number) {
  const lane = fileLocation(selected).lane;
  const next = wrap(lane + direction, archiveColumns.length);
  select(columnMemory[next], { axis: "lane", direction });
}
function updateSelection(navigation?: ArchiveNavigation) {
  const r = records[selected];
  const { lane } = fileLocation(selected);
  const files = columnFiles(lane);
  selectionTitle.update({ text: r.title, animated: !reduced && mode === "archive" });
  clearanceTitle.update({ text: r.clearance, animated: !reduced && mode === "archive" });
  categoryTitle.update({ text: r.category, animated: !reduced && mode === "archive" });
  const direction =
    navigation && "axis" in navigation
      ? navigation.direction > 0
        ? "up"
        : "down"
      : "auto";
  selectedCode.update({
    value: Number(r.id.slice(2)),
    animated: !reduced && mode === "archive",
    direction,
  });
  fileCounter.update({
    value: files.indexOf(selected) + 1,
    animated: !reduced && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "row"
        ? direction
        : "auto",
  });
  $(".count-total").textContent = String(files.length).padStart(2, "0");
  columnCounter.update({
    value: lane + 1,
    animated: !reduced && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "lane"
        ? direction
        : "auto",
  });
  columnTitle.update({ text: archiveColumns[lane], animated: !reduced && mode === "archive" });
  $<HTMLButtonElement>('[data-action="column-prev"]').disabled = false;
  $<HTMLButtonElement>('[data-action="column-next"]').disabled = false;
  const droppedTicks = fileTicks.splice(files.length);
  const tickFocusDropped = droppedTicks.some((button) => button === document.activeElement);
  droppedTicks.forEach((button) => button.remove());
  while (fileTicks.length < files.length)
    fileTicks.push($("#file-ticks").appendChild(document.createElement("button")));
  fileTicks.forEach((button, slot) => {
    const index = files[slot], record = records[index];
    button.dataset.select = String(index);
    button.setAttribute("aria-label", `选择帖子 ${record.id} ${record.title}`);
    button.title = `${record.id} · ${record.title}`;
    button.classList.toggle("selected", index === selected);
    button.setAttribute("aria-pressed", String(index === selected));
  });
  if (tickFocusDropped) fileTicks[files.indexOf(selected)]?.focus({ preventScroll: true });
}
function replayBoot() {
  if (!ready) return;
  closePalette(() => {
    bootStart = performance.now() / 1000 - 1.76;
    lastStep = "";
    setMode(reduced ? "archive" : "boot");
    audio.restartBoot();
    scene?.select(0);
    selected = 0;
    updateSelection();
  });
}
function openFile() {
  if (!ready) return;
  closePalette(() => setMode("detail"));
}
let dossier: Dossier | undefined;
let convergence: Convergence | undefined;
let cinemaLoading = false;
async function openDossier() {
  if (!ready || dossier || convergence || cinemaLoading || mode !== "detail") return;
  cinemaLoading = true;
  try {
    const { Dossier } = await import("./dossier/dossier");
    const record = records[selected];
    recordView(record.postId);
    closePalette(() => {
      if (dossier || convergence) return;
      const archive = reduced ? undefined : scene;
      archive?.beginApproach();
      dossier = new Dossier({
        stage: $("#stage"),
        record,
        board: boardOf(record),
        boards,
        number: selected + 1,
        total: records.length,
        array: archive && {
          at: (t) => archive.setApproachTime(t),
          view: () => archive.cardView(),
          restore: (immediate) => archive.endApproach(immediate),
        },
        reduced,
        onExit: () => {
          dossier = undefined;
          document.querySelector<HTMLElement>('[data-action="dossier"]')?.focus({ preventScroll: true });
        },
      });
    });
  } catch (error) {
    console.error(error);
    notify("阅读详情暂时无法打开，请稍后再试");
  } finally {
    cinemaLoading = false;
  }
}
function exitLanding() {
  if (window.parent !== window)
    window.parent.postMessage({ type: "naimakes-landing-exit", welcome: true }, location.origin);
  else {
    try {
      sessionStorage.setItem("naimakes-landing-seen", "1");
      sessionStorage.setItem("naimakes-welcome", "1");
    } catch {
    }
    window.location.href = "/";
  }
}
async function enterForum() {
  if (convergence || cinemaLoading) return;
  if (!ready || reduced) {
    exitLanding();
    return;
  }
  cinemaLoading = true;
  try {
    const { Convergence } = await import("./enter-forum/enter-forum");
    closePalette(() => {
      if (convergence) return;
      convergence = new Convergence({
        host: $("#viewport"),
        stage: $("#stage"),
        reduced,
        onDone: exitLanding,
      });
    });
  } catch (error) {
    console.error(error);
    exitLanding();
  } finally {
    cinemaLoading = false;
  }
}
function renderDetail() {
  tabTransition.cancel();
  const r = records[selected];
  $("#object-id").textContent = "NO." + String(selected + 1).padStart(3, "0");
  $("#detail-content").innerHTML = `
  <div class="detail-kicker"><span>帖子 ${r.id}</span><span>${escapeHtml(r.clearance)}</span></div>
  <h2>${escapeHtml(r.title)}</h2><div class="detail-title-cn">${escapeHtml(r.en)}<span>${escapeHtml(r.category)}</span></div>
  <div class="detail-rule"></div>
  <dl class="metadata"><div><dt>BOARD / 板块</dt><dd>${escapeHtml(r.department)}</dd></div><div><dt>POSTED / 发布时间</dt><dd>${escapeHtml(r.date)}</dd></div><div><dt>AUTHOR / 作者</dt><dd>${escapeHtml(r.lead)}</dd></div><div><dt>STATUS / 状态</dt><dd><i></i>可以阅读</dd></div></dl>
  <div class="detail-tabs" role="tablist"><button id="tab-overview" class="active" role="tab" aria-controls="tab-panel" aria-selected="true" data-tab="overview">01 <span>摘要</span></button><button id="tab-notes" role="tab" aria-controls="tab-panel" aria-selected="false" data-tab="notes">02 <span>要点</span></button><button id="tab-history" role="tab" aria-controls="tab-panel" aria-selected="false" data-tab="history">03 <span>浏览记录</span></button><i class="tab-indicator" aria-hidden="true"></i></div>
  <div id="tab-panel" class="tab-panel" role="tabpanel">${overview()}</div>
  <div class="detail-actions"><button class="read-details" data-action="dossier">阅读详情 <span aria-hidden="true">→</span></button><a class="export-button" href="${escapeHtml(r.source)}" target="_top" aria-label="在论坛里打开 ${escapeHtml(r.title)}">打开原帖 <span>↗</span></a></div>
  <div class="detail-footnote"><a href="${escapeHtml(r.source)}" target="_top">在论坛里打开 ↗</a><span>${String(selected + 1).padStart(3, "0")} / ${String(records.length).padStart(3, "0")}</span></div>`;
  $("#detail-content").setAttribute("tabindex", "-1");
  documentDecryption.reset($("#detail-content"), reduced || !scene || scene.decryptionFrame.phase === "clear");
  setTab(activeTab, false);
}
function overview() {
  return `<div class="panel-label">ABSTRACT / 摘要</div><p>${escapeHtml(records[selected].abstract)}</p>`;
}
function setTab(tab: string, animate = true) {
  if (animate && tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const active = (b as HTMLElement).dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
    b.setAttribute("tabindex", active ? "0" : "-1");
  });
  const r = records[selected];
  const tabButton = $<HTMLButtonElement>(`[data-tab="${tab}"]`);
  const indicator = $(".tab-indicator");
  indicator.style.transition = animate && !reduced ? "" : "none";
  indicator.style.transform = `translateX(${tabButton.offsetLeft}px) scaleX(${tabButton.offsetWidth})`;
  $("#tab-panel").setAttribute("aria-labelledby", tabButton.id);
  $("#tab-panel").innerHTML =
    tab === "overview"
      ? overview()
      : tab === "notes"
        ? `<div class="panel-label">HIGHLIGHTS / 要点</div><ol class="research-notes">${r.findings.map((f, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${escapeHtml(f)}</li>`).join("")}</ol>`
        : `<div class="panel-label">HISTORY / 本次浏览</div>${accessLog
            .filter((entry) => entry.id === r.id)
            .slice(0, 4)
            .map(
              (entry) =>
                `<div class="log-row"><span>${entry.time}</span><span>本次会话</span><b>已打开</b></div>`,
            )
            .join(
              "",
            )}<p class="log-note">这里只显示帖子的摘要。打开原帖可以读到全文，并参与讨论。</p>`;
  $("#tab-panel").scrollTop = 0;
  documentDecryption.refresh();
  if (animate) tabTransition.reveal($("#tab-panel"), reduced);
}
function notify(message: string) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}

const palette = new SearchPalette({
  host: $("#viewport"),
  records,
  reduced,
  signedIn: () => signedIn,
  onPick: (index, query) => {
    palette.close();
    playPick(index, query);
  },
  onSubmit: (query) => {
    const found = searchPosts(records, query);
    if (!found.indices.length) return false;
    palette.remember(query);
    palette.close();
    startSearch(query, found.indices, found.total);
    return true;
  },
  onShare: (index) => void sharePost(index),
  onClosed: () => {
    if (started) {
      $("#stage").inert = false;
      $(".mobile-entry").inert = false;
    }
  },
});
function openPalette(trigger: HTMLElement | null, query = "") {
  if (!ready || dossier || convergence || cinemaLoading || searchRun?.playing) return;
  $("#stage").inert = true;
  $(".mobile-entry").inert = true;
  void preloadCardFace();
  palette.open(trigger, query);
}
function closePalette(afterClose?: () => void) {
  palette.close(afterClose);
}
async function sharePost(index: number) {
  const record = records[index];
  const url = new URL(record.source, location.origin).href;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: record.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    palette.flash("链接已复制，可以分享给朋友了");
  } catch (error) {
    if ((error as Error).name !== "AbortError") palette.flash("暂时无法复制链接，请稍后再试");
  }
}
function endPick() {
  if (pickQuery === null) return;
  pickQuery = null;
  $("#skip").firstChild!.textContent = "跳过开场 ";
  $(".mobile-entry").firstChild!.textContent = "跳过开场 ";
}
function playPick(index: number, query: string) {
  if (!ready) return;
  if (searchRun) {
    searchRun.dispose();
    searchRun = undefined;
    scene?.endSearch(true);
    scene?.setSearchFade(0);
    delete $("#stage").dataset.search;
  }
  if (reduced || !scene) {
    select(index);
    setMode("detail");
    return;
  }
  bootStart = performance.now() / 1000 - 21.9;
  lastStep = "";
  setMode("boot");
  pickQuery = query;
  $("#skip").firstChild!.textContent = "跳过动画 ";
  $(".mobile-entry").firstChild!.textContent = "跳过动画 ";
  audio.restartBoot();
  select(index);
}
function startSearch(query: string, indices: number[], total: number) {
  if (searchRun) {
    const leaving = searchRun;
    leaving.leave(() => beginSearch(query, indices, total));
    return;
  }
  beginSearch(query, indices, total);
}
function beginSearch(query: string, indices: number[], total: number) {
  if (!ready || dossier || convergence) return;
  if (mode === "boot") setMode("archive");
  if (mode === "detail") setMode("archive");
  searchRun = new SearchSequence({
    stage: $("#stage"),
    scene,
    records,
    boardOf,
    query,
    results: indices,
    total,
    reduced,
    onRead: (index, view) => void openSearchDossier(index, view),
    onSearch: (value) => openPalette(null, value),
    onLeave: () => {
      searchRun = undefined;
      setMode(mode);
      $(".nav-search").focus({ preventScroll: true });
    },
  });
  setMode(mode);
}
async function openSearchDossier(index: number, view: CardView) {
  if (dossier || convergence || cinemaLoading) {
    searchRun?.returned();
    return;
  }
  cinemaLoading = true;
  try {
    const { Dossier } = await import("./dossier/dossier");
    const record = records[index];
    recordView(record.postId);
    dossierHold = true;
    const opened = new Dossier({
      stage: $("#stage"),
      record,
      board: boardOf(record),
      boards,
      number: index + 1,
      total: records.length,
      view,
      reduced,
      onExit: () => {
        dossier = undefined;
        dossierHold = false;
        searchHandoff = false;
        searchRun?.returned();
      },
    });
    dossier = opened;
    void opened.ready.then(() => {
      if (dossier !== opened) return;
      dossierHold = false;
      searchHandoff = true;
    });
  } catch (error) {
    console.error(error);
    dossierHold = false;
    searchRun?.returned();
    notify("阅读详情暂时无法打开，请稍后再试");
  } finally {
    cinemaLoading = false;
  }
}
document.addEventListener("click", (e) => {
  if (!started || palette.isActive) return;
  const el = (e.target as Element).closest<HTMLElement>("button");
  if (!el || el.closest(".sq")) return;
  if (el.dataset.select) {
    select(Number(el.dataset.select));
    return;
  }
  if (el.dataset.tab) {
    setTab(el.dataset.tab);
    return;
  }
  const action = el.dataset.action;
  if (action === "explore") {
    void enterForum();
    return;
  }
  if (action === "dossier") {
    el.focus({ preventScroll: true });
    void openDossier();
    return;
  }
  if (action === "skip") setMode(pickQuery !== null ? "detail" : "archive");
  if (action === "prev") stepFile(1);
  if (action === "next") stepFile(-1);
  if (action === "column-prev") stepColumn(-1);
  if (action === "column-next") stepColumn(1);
  if (action === "open") openFile();
  if (action === "back") setMode("archive");
  if (action === "search") {
    el.focus({ preventScroll: true });
    openPalette(el);
  }
  if (action === "replay") replayBoot();
});
document.addEventListener("keydown", (e) => {
  if (!started) return;
  if (palette.isActive) {
    palette.key(e);
    return;
  }
  if (convergence) {
    convergence.key(e);
    return;
  }
  if (dossier) {
    dossier.key(e);
    return;
  }
  const typing = e.target instanceof HTMLInputElement;
  const searchKey =
    !e.altKey &&
    (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey));
  if (searchRun) {
    if (searchKey && !searchRun.playing) {
      e.preventDefault();
      openPalette(null);
      return;
    }
    searchRun.key(e);
    return;
  }
  if (e.key === "Escape") {
    if (mode === "detail" || (mode === "boot" && ready)) setMode(mode === "boot" && pickQuery !== null ? "detail" : "archive");
    return;
  }
  if (searchKey && ready && !cinemaLoading) {
    e.preventDefault();
    if (mode === "boot") setMode(pickQuery !== null ? "detail" : "archive");
    openPalette($(".nav-search"));
    return;
  }
  if (typing || !ready) return;
  if (
    (e.target as HTMLElement).dataset.tab &&
    ["ArrowLeft", "ArrowRight"].includes(e.key)
  ) {
    e.preventDefault();
    const tabs = ["overview", "notes", "history"];
    setTab(
      tabs[(tabs.indexOf(activeTab) + (e.key === "ArrowRight" ? 1 : 2)) % 3],
    );
    $<HTMLButtonElement>(`[data-tab="${activeTab}"]`).focus();
    return;
  }
  if (e.key === "ArrowLeft" && mode !== "boot") {
    e.preventDefault();
    stepColumn(-1);
  }
  if (e.key === "ArrowRight" && mode !== "boot") {
    e.preventDefault();
    stepColumn(1);
  }
  if (["ArrowUp", "ArrowDown"].includes(e.key) && mode !== "boot") {
    e.preventDefault();
    stepFile(e.key === "ArrowUp" ? 1 : -1);
  }
  if (
    e.key === "Enter" &&
    (document.activeElement === document.body ||
      document.activeElement?.id === "detail-content" ||
      ["prev", "next", "column-prev", "column-next"].includes(
        (document.activeElement as HTMLElement)?.dataset.action ?? "",
      ) ||
      (document.activeElement as HTMLElement)?.dataset.select)
  ) {
    e.preventDefault();
    if (mode === "boot") setMode("archive");
    else if (mode === "archive") openFile();
  }
});

const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const bootCaptions: [number, number, () => string][] = [
  [1.9, 4.1, () => "需要访问权限"],
  [6.3, 9.5, () => `身份信息已确认 · ${bootIdentity()}`],
  [9.7, 11.85, () => "请求已接收"],
  [11.95, 14.45, () => "开始处理"],
  [14.6, 17.7, () => "权限验证通过"],
  [17.9, 21.8, () => "欢迎访问 Naimakes 论坛"],
  [22.1, 25.6, () => {
    if (pickQuery === null) return "正在选取帖子";
    const letters = Array.from(pickQuery);
    return `正在检索「${letters.length > 14 ? `${letters.slice(0, 13).join("")}…` : pickQuery}」`;
  }],
  [25.8, 28.2, () => `帖子编号：${records[selected].id} · ${records[selected].category}`],
  [28.4, 34.8, () => "访问级别：公开讨论"],
];
let bootCaptionText = "";
function updateBootCaption(t: number | null) {
  let text = "";
  if (t !== null)
    for (const [start, end, make] of bootCaptions)
      if (t >= start && t < end) {
        const full = Array.from(make());
        text = full.slice(0, Math.ceil(full.length * Math.min(1, (t - start) / 0.45))).join("");
        break;
      }
  if (text === bootCaptionText) return;
  bootCaptionText = text;
  $("#boot-caption").textContent = text;
}
function bootFrame(t: number) {
  audio.updateBoot(t);
  updateBootCaption(t);
  const motion = bootSequence.update(t);
  let step: string = motion.step;
  if (t >= 22 || (pickQuery !== null && t >= 21.8)) {
    step = "array";
  }
  if (t >= 25.68) {
    step = "select";
  }
  if (t >= 28.3) {
    step = "inspect";
  }
  if (step !== lastStep) {
    $("#stage").dataset.boot = step;
    lastStep = step;
  }
  $(".file-title").firstChild!.textContent =
    step === "array"
      ? "正在选取帖子…".slice(0, Math.max(0, Math.floor((t - 21.94) * 18)))
      : "帖子 ";
  $("#stage").style.setProperty(
    "--entry-opacity",
    String(ease((t - 21.9) / 0.13)),
  );
  $(".callout-rule").style.transform = `scaleX(${ease((t - 22.08) / 0.9)})`;
  const reveal = ease((t - 22) / 0.4),
    lift = ease((t - 26) / 1.8),
    zoom = 0.55 * ease((t - 27.3) / 1.65) + 0.45 * ease((t - 29.0) / 5.0);
  if (t >= 35) {
    setMode("detail");
    return undefined;
  }
  return { reveal, lift, zoom, time: t };
}

const inspectionOverlay = new InspectionOverlay();
const documentDecryption = new DocumentDecryption();
document.fonts.addEventListener("loadingdone", () => documentDecryption.refresh());

let lastTime = 0;
function frame(ms: number) {
  if (document.hidden) { requestAnimationFrame(frame); return; }
  const cinemaTime = ms / 1000;
  if (convergence || dossier) {
    if (convergence || !dossierHold) {
      (convergence ?? dossier)!.tick(cinemaTime);
      if (searchHandoff) {
        searchHandoff = false;
        searchRun?.handedOff();
      }
    }
    if (!convergence && dossier?.arrayLive) scene?.update(cinemaTime);
    if (Math.floor(cinemaTime) !== lastTime) {
      lastTime = Math.floor(cinemaTime);
      updateFooterClock(new Date(), !reduced);
    }
    requestAnimationFrame(frame);
    return;
  }
  if (searchRun) {
    searchRun.tick(cinemaTime);
    requestAnimationFrame(frame);
    return;
  }
  const time = ms / 1000;
  const cinema =
    mode === "boot" && ready
      ? bootFrame(time - bootStart)
      : undefined;
  if (!cinema || cinema.time >= 21.9) scene?.update(time, cinema);
  if (scene && mode === "detail") {
    documentDecryption.update(time, scene.decryptionFrame, reduced);
    $("#detail-content").style.opacity = String(scene.detailVisibility);
    $("#detail-content").style.translate =
      `0 ${(1 - scene.detailVisibility) * 18}px`;
    $("#detail-content").inert = scene.detailVisibility < 0.1;
    if (pendingDetailFocus && scene.detailVisibility >= 0.1 && !palette.isActive) {
      $("#detail-content").focus({ preventScroll: true });
      pendingDetailFocus = false;
    }
  }
  $("#stage").style.setProperty("--detail-shade", String(mode === "boot" ? 0 : scene?.detailVisibility ?? 0));
  const currentScene = scene;
  if (currentScene) inspectionOverlay.render(currentScene.decryptionFrame,
    (x, y) => currentScene.projectCard(x, y), Boolean(cinema), !reduced);
  if (Math.floor(time) !== lastTime) {
    lastTime = Math.floor(time);
    updateFooterClock(new Date(), !reduced);
  }
  requestAnimationFrame(frame);
}
function bindScene(scene: ArchiveScene, cell?: { lane: number; row: number }) {
    scene.select(selected, cell ? { cell } : undefined);
    scene.onSelect = (i, cell) => {
      if (mode !== "archive" || palette.isActive || searchRun) return;
      select(i, cell ? { cell } : undefined);
    };
    scene.onNavigate = (axis, direction) => {
      if (mode !== "archive" || palette.isActive || searchRun) return;
      if (axis === "lane") stepColumn(direction);
      else stepFile(direction);
    };
    scene.onHover = (i) => {
      const label = $("#hover-label");
      if (i === null) {
        label.hidden = true;
        hoverCode.finish();
        hoverTitle.finish();
        return;
      }
      const animated = !reduced && mode === "archive";
      const numbersAnimated = !reduced && mode === "archive";
      hoverCode.update({
        value: Number(records[i].id.slice(2)),
        animated: !label.hidden && numbersAnimated,
      });
      hoverTitle.update({ text: records[i].title, animated: !label.hidden && animated });
      label.hidden = false;
      hoverCode.update({ animated: numbersAnimated });
      hoverTitle.update({ animated });
    };
}
async function start() {
  try {
    scene = new ArchiveScene($("#three-scene"), reduced);
    await Promise.all([
      scene.load(),
      document.fonts.load('300 20px "Newsreader Variable"', "ACCESS WELCOME TO INTERNAL DATABASE"),
      document.fonts.load('400 20px "Newsreader Variable"', "0123456789 NAIMAKES"),
      document.fonts.load('600 20px "Newsreader Variable"', "SYNTHESIZE INFORMATION ANALYSIS OS"),
      document.fonts.load('700 20px "Newsreader Variable"', "NAIMAKES WELCOME TO"),
    ]);
    bindScene(scene);
    ready = true;
    select(0);
    entry.ready();
  } catch (error) {
    console.error(error);
    $("#loading").innerHTML =
      '<div class="error-state"><strong>CONNECTION INTERRUPTED</strong><p>三维场景未能载入。请确认浏览器已启用硬件加速，然后重新连接。</p><button onclick="location.reload()">RECONNECT →</button></div>';
  }
}
function completeStartup(choice: EntryChoice) {
  if (started || !ready) return;
  started = true;
  signedIn = Boolean(choice.user);
  setBootIdentity(choice.user?.name ?? "访客");
  audio.releaseEntry();
  audio.restartBoot();
  const fade = reduced ? 0 : 600;
  bootStart = performance.now() / 1000 - 1.76 + fade / 1000;
  setMode("boot");
  if (choice.skipOpening || reduced) setMode("archive");
  $("#stage").inert = false;
  $(".mobile-entry").inert = false;
  loading.classList.add("loaded");
  loading.inert = true;
  setTimeout(() => {
    const restoreFocus = loading.contains(document.activeElement) || document.activeElement === document.body;
    loading.remove();
    if (restoreFocus) {
      const skip = $("#skip");
      const target = mode === "boot" ? skip.getClientRects().length ? skip : $(".mobile-entry") : $(".read-file");
      target.focus({ preventScroll: true });
    }
  }, fade);
  requestAnimationFrame(frame);
}
updateSelection();
void start();
