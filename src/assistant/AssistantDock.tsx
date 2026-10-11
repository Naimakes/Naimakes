import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, ArrowUpRight, Ban, Check, ChevronRight, Clock, FileText, LoaderCircle, Minus, Plus, RotateCcw, Square, SquarePen, X } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { useMotionPreferences } from "../forum/motion/motion-preferences";
import AssistantDetails from "./AssistantDetails";
import { BotFigure, type BotLook } from "./BotFigure";
import { accept, MAX_FILES, readAttachment, type Attachment } from "./attachments";
import { ask, cancelAction, clearChat, confirmAction, markRead, retryLast, stopReply, switchOwner, useChat, type AgentAction, type ChatMessage } from "./chat";
import { isPostRequest, pickMood, taskDifficulty } from "./mood";
import { go, recentlyViewed } from "./nav";
import { connectAccount, readPosition, savePosition, useNotify, usePrefs } from "./prefs";
import "./assistant.css";

type Vec = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number; origin: string; sheet: boolean };
type Press = {
  id: number;
  type: string;
  start: Vec;
  offset: Vec;
  dragging: boolean;
  cancelled: boolean;
  timer: number;
  samples: { x: number; y: number; t: number }[];
};

const MARGIN = 14;
const SETTLE_MS = 8000;
const between = (min: number, max: number) => min + Math.random() * (max - min);
const suggestions = ["最近有什么值得读的讨论？", "本站有哪些版块？", "怎么发布一篇讨论？", "怎么修改 Naimakes 的样子？"];

function insets() {
  const probe = document.createElement("div");
  probe.className = "assistant-safe-probe";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const value = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return value;
}

function viewportBounds(size: number) {
  const safe = insets();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const header = document.querySelector<HTMLElement>(".site-header");
  const headerBottom = header && getComputedStyle(header).position !== "static" ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const nav = width <= 900 ? document.querySelector<HTMLElement>(".site-primary-nav") : null;
  const navTop = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : height;
  const half = size / 2;
  return {
    minX: safe.left + MARGIN + half,
    maxX: width - safe.right - MARGIN - half,
    minY: Math.max(safe.top + MARGIN, headerBottom + 10) + half,
    maxY: Math.min(height - safe.bottom - MARGIN, navTop - 12) - half,
  };
}

const clampTo = (value: number, min: number, max: number) => (max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value)));

function sourceLabel(type: string) {
  return type === "board" ? "版块" : type === "announcement" ? "公告" : "讨论";
}

const actionIcons = { pending: Clock, running: LoaderCircle, done: Check, failed: X, cancelled: Ban, expired: Clock };

function actionNote(action: AgentAction) {
  if (action.status === "pending") return "点「确认」后才会执行";
  if (action.status === "running") return "正在执行…";
  if (action.status === "done") return action.summary || "已完成";
  if (action.status === "cancelled") return "已取消";
  return action.error || (action.status === "expired" ? "确认已超时" : "没有成功");
}

function ActionCard({ action, onLink }: { action: AgentAction; onLink: (href: string) => void }) {
  const Icon = actionIcons[action.status] || Clock;
  const preview = action.preview;
  const deciding = !!preview && (action.status === "pending" || action.status === "running");
  return (
    <div className={"assistant-action is-" + action.status} role="group" aria-label={preview?.heading || action.title}>
      <div className="assistant-action-head">
        <span className="assistant-action-icon">
          <Icon size={14} aria-hidden="true" />
        </span>
        <span className="assistant-action-body">
          <strong>{preview?.heading || action.title}</strong>
          <small>{actionNote(action)}</small>
        </span>
        {action.status === "done" && action.url && (
          <LiquidButton type="button" className="assistant-action-open" aria-label="查看" onClick={() => onLink(action.url!)}>
            <ArrowUpRight size={14} />
          </LiquidButton>
        )}
      </div>
      {deciding && (
        <>
          {preview.fields.length > 0 && (
            <dl className="assistant-action-fields">
              {preview.fields.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {preview.body && <p className="assistant-action-text">{preview.body}</p>}
          {action.error && (
            <p className="assistant-action-error" role="alert">
              {action.error}
            </p>
          )}
          <div className="assistant-action-buttons">
            <LiquidButton type="button" className="assistant-chip is-compact" disabled={action.status === "running"} onClick={() => cancelAction(action)}>
              取消
            </LiquidButton>
            <LiquidButton type="button" className="assistant-chip is-compact is-primary" disabled={action.status === "running"} onClick={() => confirmAction(action)}>
              {action.status === "running" ? "执行中…" : "确认"}
            </LiquidButton>
          </div>
        </>
      )}
    </div>
  );
}

function Message({ message, onLink, onRetry, last }: { message: ChatMessage; onLink: (href: string) => void; onRetry: () => void; last: boolean }) {
  if (message.role === "user")
    return (
      <div className="assistant-msg is-user">
        {message.files && message.files.length > 0 && (
          <div className="assistant-files">
            {message.files.map((file, index) =>
              file.preview ? (
                <img key={index} className="assistant-file-thumb" src={file.preview} alt={file.name} title={file.name} />
              ) : (
                <span key={index} className="assistant-file-tag" title={file.name}>
                  <FileText size={14} aria-hidden="true" />
                  <span>{file.name}</span>
                </span>
              ),
            )}
          </div>
        )}
        <p>{message.content}</p>
      </div>
    );
  const sources = (message.sources || []).slice(0, 4);
  const actions = message.actions || [];
  const empty = !message.content && !message.error && !actions.length;
  if (empty) return null;
  return (
    <div className="assistant-msg is-bot">
      {message.content && (
        <div className="assistant-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            disallowedElements={["img"]}
            components={{
              a: ({ href = "", children }) => {
                const internal = href.startsWith("/") && !href.startsWith("//");
                return internal ? (
                  <a href={href} onClick={(event) => { event.preventDefault(); onLink(href); }}>{children}</a>
                ) : (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}
      {message.error && (
        <div className="assistant-error" role="alert">
          <span>{message.error}</span>
          {last && (
            <LiquidButton type="button" className="assistant-chip is-compact" onClick={onRetry}>
              <RotateCcw size={13} />
              重试
            </LiquidButton>
          )}
        </div>
      )}
      {actions.length > 0 && (
        <div className="assistant-actions">
          {actions.map((action) => (
            <ActionCard key={action.id} action={action} onLink={onLink} />
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <div className="assistant-sources">
          <span className="assistant-sources-title">本站参考 · {sources.length}</span>
          {sources.map((source) => (
            <LiquidButton key={source.type + source.id} type="button" className="assistant-source" onClick={() => onLink(source.url)}>
              <span className="assistant-source-kind">{sourceLabel(source.type)}</span>
              <span className="assistant-source-body">
                <strong>{source.title}</strong>
                {(source.board || source.excerpt) && <small>{[source.board, source.excerpt].filter(Boolean).join(" · ")}</small>}
              </span>
              <ArrowUpRight size={14} />
            </LiquidButton>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkingRow({ look, state, status }: { look: BotLook; state: string; status: string }) {
  const [emphasis, setEmphasis] = useState(false);
  return (
    <div
      className="assistant-working"
      role="status"
      onPointerEnter={(event) => event.pointerType === "mouse" && setEmphasis(true)}
      onPointerLeave={() => setEmphasis(false)}
    >
      <span className="assistant-working-avatar">
        <BotFigure look={look} state={state} emphasis={emphasis} follow={false} fps={30} clickPoke />
      </span>
      <span className="assistant-working-text">{status}</span>
    </div>
  );
}

function useTopLayerHost() {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "assistant-host";
    element.setAttribute("popover", "manual");
    return element;
  });
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const modals = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).filter((d) => d.matches(":modal"));
      const parent: HTMLElement = modals[modals.length - 1] || document.body;
      const moved = host.parentElement !== parent;
      if (moved) parent.appendChild(host);
      if (typeof host.showPopover !== "function") return;
      const shown = host.matches(":popover-open");
      if (moved || !shown) {
        if (shown) host.hidePopover();
        host.showPopover();
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" || record.removedNodes.length || record.addedNodes.length) return schedule();
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      host.remove();
    };
  }, [host]);
  return host;
}

export default function AssistantDock({ userId }: { userId: string | null }) {
  const host = useTopLayerHost();
  const prefs = usePrefs();
  const chat = useChat();
  const { reduced } = useMotionPreferences();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "details">("chat");
  const [settled, setSettled] = useState<"success" | "error" | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [mood, setMood] = useState("idle");
  const [asleep, setAsleep] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState("");
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const errorTimer = useRef(0);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const ball = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pos = useRef<Vec>({ x: -999, y: -999 });
  const vel = useRef<Vec>({ x: 0, y: 0 });
  const target = useRef<Vec | null>(null);
  const press = useRef<Press | null>(null);
  const frame = useRef(0);
  const last = useRef(0);
  const settleTo = useRef<Vec | null>(null);
  const suppressClick = useRef(false);
  const openRef = useRef(open);
  const viewRef = useRef(view);
  const moodTimer = useRef(0);
  const settleTimer = useRef(0);
  const size = 60;

  useEffect(() => {
    connectAccount(userId);
    switchOwner(userId);
  }, [userId]);

  useEffect(() => {
    openRef.current = open;
    if (open) markRead();
  }, [open]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const paint = useCallback(() => {
    const el = dock.current;
    if (!el) return;
    el.style.transform = `translate3d(${(pos.current.x - size / 2).toFixed(2)}px, ${(pos.current.y - size / 2).toFixed(2)}px, 0)`;
    const tilt = Math.max(-14, Math.min(14, vel.current.x * 0.012));
    el.style.setProperty("--assistant-tilt", tilt.toFixed(2) + "deg");
  }, [size]);

  const remember = useCallback(() => {
    savePosition({ x: pos.current.x / window.innerWidth, y: pos.current.y / window.innerHeight });
  }, []);

  const place = useCallback(() => {
    const bounds = viewportBounds(size);
    const saved = readPosition();
    const x = saved ? saved.x * window.innerWidth : bounds.maxX;
    const y = saved ? saved.y * window.innerHeight : bounds.maxY - 8;
    pos.current = { x: clampTo(x, bounds.minX, bounds.maxX), y: clampTo(y, bounds.minY, bounds.maxY) };
    vel.current = { x: 0, y: 0 };
    paint();
  }, [size, paint]);

  const tick = useCallback((now: number) => {
    const dt = Math.min(0.032, (now - (last.current || now)) / 1000) || 1 / 60;
    last.current = now;
    const goal = target.current || settleTo.current;
    if (!goal) {
      frame.current = 0;
      return;
    }
    const stiffness = target.current ? 900 : 190;
    const damping = 2 * Math.sqrt(stiffness) * (target.current ? 0.92 : 0.74);
    for (const axis of ["x", "y"] as const) {
      const force = stiffness * (goal[axis] - pos.current[axis]) - damping * vel.current[axis];
      vel.current[axis] += force * dt;
      pos.current[axis] += vel.current[axis] * dt;
    }
    paint();
    const resting =
      !target.current &&
      Math.hypot(goal.x - pos.current.x, goal.y - pos.current.y) < 0.4 &&
      Math.hypot(vel.current.x, vel.current.y) < 6;
    if (resting) {
      pos.current = { ...goal };
      vel.current = { x: 0, y: 0 };
      settleTo.current = null;
      paint();
      remember();
      frame.current = 0;
      last.current = 0;
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }, [paint, remember]);

  const animate = useCallback(() => {
    if (!frame.current) {
      last.current = 0;
      frame.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useLayoutEffect(() => {
    place();
    const resize = () => {
      if (press.current?.dragging) return;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      settleTo.current = null;
      place();
    };
    window.addEventListener("resize", resize);
    window.addEventListener("nmk-assistant-position", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("nmk-assistant-position", resize);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [place]);

  const flash = useCallback((state: string, ms: number) => {
    clearTimeout(moodTimer.current);
    setMood(state);
    moodTimer.current = window.setTimeout(() => setMood("idle"), ms);
  }, []);

  useEffect(() => () => clearTimeout(moodTimer.current), []);

  useEffect(() => {
    if (open) {
      setAsleep(false);
      return;
    }
    let timer = 0;
    const wake = () => {
      clearTimeout(timer);
      setAsleep((was) => {
        if (was) flash("waking", 1400);
        return false;
      });
      timer = window.setTimeout(() => setAsleep(true), 150000);
    };
    wake();
    const events = ["pointerdown", "keydown", "scroll", "wheel"] as const;
    events.forEach((name) => window.addEventListener(name, wake, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, wake));
    };
  }, [open, flash]);

  const calm = !dragging && chat.phase === "idle" && mood === "idle" && !settled && !asleep;
  useEffect(() => {
    if (!calm || reduced) return;
    const timer = window.setTimeout(
      () => flash(pickMood(new Date(), taskDifficulty(chat.messages)), between(3200, 5400)),
      between(8000, 20000),
    );
    return () => clearTimeout(timer);
  }, [calm, reduced, chat.messages, flash]);

  const previousPhase = useRef(chat.phase);
  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = chat.phase;
    if (chat.phase !== "idle") {
      clearTimeout(settleTimer.current);
      setSettled(null);
    } else if (before !== "idle") {
      const reply = chat.messages[chat.messages.length - 1];
      const outcome = reply?.error ? (reply.error === "已停止回答。" ? null : "error") : reply?.content ? "success" : null;
      setSettled(outcome);
      clearTimeout(settleTimer.current);
      if (outcome) settleTimer.current = window.setTimeout(() => setSettled(null), SETTLE_MS);
    }
  }, [chat.phase, chat.messages]);

  useEffect(() => {
    if (!chat.messages.length) setSettled(null);
  }, [chat.messages.length]);

  useEffect(() => () => {
    clearTimeout(settleTimer.current);
    clearTimeout(errorTimer.current);
  }, []);

  const layoutPanel = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const safe = insets();
    const center = pos.current;
    if (vw < 640) {
      const viewport = window.visualViewport;
      const visible = viewport ? viewport.height : vh;
      const keyboard = viewport ? Math.max(0, vh - viewport.height - viewport.offsetTop) : 0;
      const width = vw - 20 - safe.left - safe.right;
      const bottom = 10 + Math.max(safe.bottom, 0) + keyboard;
      const height = Math.min(Math.round(vh * 0.76), 660, visible - 20 - safe.top - (keyboard ? 0 : safe.bottom));
      const left = 10 + safe.left;
      const top = vh - bottom - height;
      setBox({ left, top, width, height, origin: `${center.x - left}px ${center.y - top}px`, sheet: true });
      return;
    }
    const width = Math.min(400, vw - 2 * MARGIN);
    const bounds = viewportBounds(0);
    const room = bounds.maxY - bounds.minY;
    const height = Math.max(360, Math.min(620, room));
    const right = center.x > vw / 2;
    const half = size / 2;
    let left = right ? center.x + half - width : center.x - half;
    left = clampTo(left, MARGIN + safe.left, vw - MARGIN - safe.right - width);
    let top = center.y > vh / 2 ? center.y + half - height : center.y - half;
    top = clampTo(top, bounds.minY, bounds.maxY - height);
    setBox({ left, top, width, height, origin: `${center.x - left}px ${center.y - top}px`, sheet: false });
  }, [size]);

  const openPanel = useCallback(() => {
    layoutPanel();
    setOpen(true);
    fetch("/api/assistant/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((r) => setAiReady(!!r.ai))
      .catch(() => setAiReady(null));
  }, [layoutPanel]);

  const closePanel = useCallback(() => {
    setOpen(false);
    setView("chat");
    requestAnimationFrame(() => ball.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!open) return;
    const relayout = () => layoutPanel();
    window.addEventListener("resize", relayout);
    window.visualViewport?.addEventListener("resize", relayout);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (viewRef.current === "details") setView("chat");
      else closePanel();
    };
    document.addEventListener("keydown", escape);
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const focus = fine ? window.setTimeout(() => input.current?.focus({ preventScroll: true }), 180) : 0;
    return () => {
      clearTimeout(focus);
      window.removeEventListener("resize", relayout);
      window.visualViewport?.removeEventListener("resize", relayout);
      document.removeEventListener("keydown", escape);
    };
  }, [open, layoutPanel, closePanel]);

  useEffect(() => {
    const el = list.current;
    if (!el || !open) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (near) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [chat.messages, open, reduced]);

  const pending = chat.messages.reduce((n, m) => n + (m.actions?.filter((a) => a.status === "pending").length || 0), 0);
  const seenPending = useRef(pending);
  useEffect(() => {
    const el = list.current;
    if (open && el && pending > seenPending.current) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
    seenPending.current = pending;
  }, [pending, open, reduced]);

  useLayoutEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open]);

  const beginDrag = () => {
    const p = press.current;
    if (!p || p.dragging) return;
    p.dragging = true;
    suppressClick.current = true;
    setPressing(false);
    setDragging(true);
    settleTo.current = null;
    target.current = { ...pos.current };
    if (p.type !== "mouse") navigator.vibrate?.(8);
    animate();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    const p: Press = {
      id: event.pointerId,
      type: event.pointerType,
      start: { x: event.clientX, y: event.clientY },
      offset: { x: event.clientX - pos.current.x, y: event.clientY - pos.current.y },
      dragging: false,
      cancelled: false,
      timer: 0,
      samples: [{ x: event.clientX, y: event.clientY, t: performance.now() }],
    };
    press.current = p;
    setPressing(true);
    if (event.pointerType !== "mouse") p.timer = window.setTimeout(beginDrag, 260);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== event.pointerId || p.cancelled) return;
    const moved = Math.hypot(event.clientX - p.start.x, event.clientY - p.start.y);
    if (!p.dragging) {
      if (p.type === "mouse" && moved > 4) beginDrag();
      else if (p.type !== "mouse" && moved > 10) {
        clearTimeout(p.timer);
        p.cancelled = true;
        setPressing(false);
        return;
      }
      if (!p.dragging) return;
    }
    const bounds = viewportBounds(size);
    const rawX = event.clientX - p.offset.x;
    const rawY = event.clientY - p.offset.y;
    const soft = (value: number, min: number, max: number) =>
      value < min ? min - Math.sqrt(min - value) * 3 : value > max ? max + Math.sqrt(value - max) * 3 : value;
    target.current = { x: soft(rawX, bounds.minX, bounds.maxX), y: soft(rawY, bounds.minY, bounds.maxY) };
    const now = performance.now();
    p.samples.push({ x: event.clientX, y: event.clientY, t: now });
    while (p.samples.length > 2 && now - p.samples[0].t > 90) p.samples.shift();
    if (reduced) {
      pos.current = { ...target.current };
      paint();
    }
  };

  const finish = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const p = press.current;
    if (!p || p.id !== event.pointerId) return;
    clearTimeout(p.timer);
    press.current = null;
    setPressing(false);
    if (!p.dragging) {
      if (!cancelled && !p.cancelled && event.pointerType !== "mouse") {
        suppressClick.current = true;
        open ? closePanel() : openPanel();
      }
      return;
    }
    setDragging(false);
    const first = p.samples[0];
    const end = p.samples[p.samples.length - 1];
    const span = Math.max(16, end.t - first.t) / 1000;
    const still = performance.now() - end.t > 70;
    const throwV = still ? { x: 0, y: 0 } : { x: (end.x - first.x) / span, y: (end.y - first.y) / span };
    const bounds = viewportBounds(size);
    const base = target.current || pos.current;
    const projected = {
      x: base.x + Math.max(-420, Math.min(420, throwV.x * 0.2)),
      y: base.y + Math.max(-420, Math.min(420, throwV.y * 0.2)),
    };
    let x = clampTo(projected.x, bounds.minX, bounds.maxX);
    const y = clampTo(projected.y, bounds.minY, bounds.maxY);
    if (x - bounds.minX < 56) x = bounds.minX;
    else if (bounds.maxX - x < 56) x = bounds.maxX;
    target.current = null;
    vel.current = { x: throwV.x * 0.6, y: throwV.y * 0.6 };
    if (reduced) {
      pos.current = { x, y };
      vel.current = { x: 0, y: 0 };
      paint();
      remember();
    } else {
      settleTo.current = { x, y };
      animate();
    }
    flash("bouncing", 900);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 72 : 24;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const bounds = viewportBounds(size);
    const goal = { x: clampTo(pos.current.x + delta[0], bounds.minX, bounds.maxX), y: clampTo(pos.current.y + delta[1], bounds.minY, bounds.maxY) };
    if (reduced) {
      pos.current = goal;
      paint();
      remember();
    } else {
      settleTo.current = goal;
      animate();
    }
  };

  const page = () => {
    const recent = recentlyViewed();
    return { path: location.pathname, title: document.title, recent: recent ? "/discussion/" + encodeURIComponent(recent.id) : "" };
  };
  const recent = open ? recentlyViewed() : null;
  const visible = () => openRef.current && !document.hidden;
  const complain = (message: string) => {
    clearTimeout(errorTimer.current);
    setFileError(message);
    errorTimer.current = window.setTimeout(() => setFileError(""), 5000);
  };
  const addFiles = async (incoming: File[]) => {
    const room = MAX_FILES - files.length;
    if (!incoming.length) return;
    if (room <= 0) return complain(`一次最多附上 ${MAX_FILES} 个文件。`);
    if (incoming.length > room) complain(`一次最多附上 ${MAX_FILES} 个文件，多出的没有添加。`);
    const added: Attachment[] = [];
    for (const file of incoming.slice(0, room)) {
      try {
        added.push(await readAttachment(file));
      } catch (error) {
        complain((error as Error).message);
      }
    }
    if (added.length) setFiles((list) => [...list, ...added].slice(0, MAX_FILES));
  };
  const send = (text = draft) => {
    if ((!text.trim() && !files.length) || chat.phase !== "idle") return;
    const attached = files;
    setDraft("");
    setFiles([]);
    setFileError("");
    if (input.current) input.current.style.height = "";
    ask(text, page(), { visible }, attached);
  };
  const follow = (href: string) => {
    if (!href) return;
    closePanel();
    go(href);
  };

  const look = useMemo(() => ({ shape: prefs.shape, color: prefs.color }), [prefs.shape, prefs.color]);

  const unread = chat.unread && notify;
  const lastAsk = [...chat.messages].reverse().find((m) => m.role === "user");
  const hasFiles = !!lastAsk?.files?.length;
  const drafting = isPostRequest(lastAsk?.content || "");
  const agentState = dragging
    ? "dragging"
    : chat.phase === "searching"
      ? hasFiles
        ? "reading"
        : "searching"
      : chat.phase === "writing"
        ? drafting
          ? "writing"
          : "streaming"
        : mood !== "idle"
          ? mood
          : settled === "error"
            ? "failed"
            : unread && !open
              ? "notifying"
              : settled === "success"
                ? "finished"
                : asleep
                  ? "sleeping"
                  : "idle";
  const headState = agentState === "idle" && draft.trim() ? "listening" : agentState;
  const status =
    chat.phase !== "idle" && chat.activity
      ? chat.activity
      : chat.phase === "searching"
        ? hasFiles
          ? "正在查看附件…"
          : "正在检索本站…"
        : chat.phase === "writing"
          ? drafting
            ? "正在起草帖子…"
            : "正在整理回答…"
          : aiReady === false
            ? "站内搜索模式"
            : "已连接本站知识库";

  const panelStyle = box
    ? ({ left: box.left, top: box.top, width: box.width, height: box.height, transformOrigin: box.origin } as CSSProperties)
    : undefined;
  const lastIndex = chat.messages.length - 1;
  const shift = reduced ? 0 : 28;
  const newChat = () => {
    clearChat();
    setDraft("");
    setFiles([]);
    setView("chat");
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };

  return createPortal(
    <div className="assistant-root" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        if (view === "details") setView("chat");
        else closePanel();
      }
    }}>
      <div
        ref={dock}
        className={"assistant-dock" + (open ? " is-hidden" : "") + (dragging ? " is-dragging" : "") + (pressing ? " is-pressing" : "")}
        style={{ "--assistant-size": size + "px" } as CSSProperties}
      >
        <button
          ref={ball}
          type="button"
          className="assistant-ball"
          aria-label={open ? "收起 Naimakes" : "打开 Naimakes（可拖动，方向键也能移动位置）"}
          aria-expanded={open}
          aria-haspopup="dialog"
          tabIndex={open ? -1 : 0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => finish(event, true)}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={onKeyDown}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            open ? closePanel() : openPanel();
          }}
        >
          <span className="assistant-ball-sheen" aria-hidden="true" />
          <BotFigure look={look} state={agentState} paused={open} follow={false} fps={30} className="assistant-ball-bot" />
          {unread && !open && <span className="assistant-ball-badge" aria-hidden="true" />}
        </button>
      </div>

      <AnimatePresence>
        {open && box && (
          <motion.section
            key="panel"
            role="dialog"
            aria-label="Naimakes"
            className={"assistant-panel" + (box.sheet ? " is-sheet" : "")}
            style={panelStyle}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.18, filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.18, filter: "blur(8px)" }}
            transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}
          >
            <motion.div
              className="assistant-view assistant-chat"
              initial={false}
              animate={{ opacity: view === "chat" ? 1 : 0, x: view === "chat" ? 0 : -shift }}
              transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 380, damping: 36 }}
              style={{ pointerEvents: view === "chat" ? "auto" : "none" }}
              aria-hidden={view !== "chat"}
              inert={view !== "chat"}
            >
              <header className="assistant-head">
                <LiquidButton
                  type="button"
                  className="assistant-identity"
                  aria-label="查看 Naimakes 详情"
                  title="详情"
                  onClick={() => setView("details")}
                >
                  <span className="assistant-identity-avatar">
                    <BotFigure look={look} state={headState} fps={30} follow={false} />
                  </span>
                  <span className="assistant-identity-text">
                    <strong>Naimakes</strong>
                    <small aria-live="polite">{status}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </LiquidButton>
                <div className="assistant-head-actions">
                  <LiquidButton type="button" className="icon-button assistant-icon" aria-label="开始新对话" title="新对话" disabled={!chat.messages.length} onClick={newChat}>
                    <SquarePen size={16} />
                  </LiquidButton>
                  <LiquidButton type="button" className="icon-button assistant-icon" aria-label="最小化" title="最小化" onClick={closePanel}>
                    <Minus size={16} />
                  </LiquidButton>
                  <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={() => { stopReply(); closePanel(); markRead(); }}>
                    <X size={16} />
                  </LiquidButton>
                </div>
              </header>

              <div className="assistant-body" ref={list}>
                {chat.messages.length === 0 ? (
                  <div className="assistant-welcome">
                    <h3>你好，我是 Naimakes。</h3>
                    <p>可以帮你查找本站文章、推荐感兴趣的讨论，也能讲讲网站怎么用。登录后，还能替你关注、收藏、发帖、评论和发私信。</p>
                    <div className="assistant-chips">
                      {(recent ? [`「${recent.title.length > 14 ? recent.title.slice(0, 14) + "…" : recent.title}」讲了什么？`, ...suggestions.slice(0, 3)] : suggestions).map((text) => (
                        <LiquidButton key={text} type="button" className="assistant-chip" onClick={() => send(text)}>
                          {text}
                        </LiquidButton>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.messages.map((message, index) => (
                    <Message key={message.id} message={message} last={index === lastIndex} onLink={follow} onRetry={() => retryLast(page(), { visible })} />
                  ))
                )}
                {chat.phase !== "idle" && <WorkingRow look={look} state={agentState} status={status} />}
              </div>

              <form
                className={"assistant-compose" + (dropping ? " is-dropping" : "")}
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes("Files")) return;
                  event.preventDefault();
                  setDropping(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
                }}
                onDrop={(event) => {
                  if (!event.dataTransfer.files.length) return;
                  event.preventDefault();
                  setDropping(false);
                  addFiles(Array.from(event.dataTransfer.files));
                }}
              >
                {(files.length > 0 || fileError) && (
                  <div className="assistant-attach-list">
                    {files.map((file) => (
                      <span className="assistant-attach" key={file.id}>
                        {file.preview ? <img src={file.preview} alt="" /> : <FileText size={15} aria-hidden="true" />}
                        <span className="assistant-attach-name">{file.name}</span>
                        <button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles((list) => list.filter((item) => item.id !== file.id))}>
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                    {fileError && <span className="assistant-attach-error" role="alert">{fileError}</span>}
                  </div>
                )}
                <div className="assistant-compose-row">
                  <input
                    ref={picker}
                    type="file"
                    hidden
                    multiple
                    accept={accept}
                    onChange={(event) => {
                      addFiles(Array.from(event.target.files || []));
                      event.target.value = "";
                    }}
                  />
                  <LiquidButton
                    type="button"
                    className="icon-button assistant-add"
                    aria-label="添加附件（图片、PDF 或文本文件）"
                    title="添加附件"
                    disabled={chat.phase !== "idle" || files.length >= MAX_FILES}
                    onClick={() => picker.current?.click()}
                  >
                    <Plus size={18} />
                  </LiquidButton>
                  <textarea
                    ref={input}
                    value={draft}
                    rows={1}
                    maxLength={2000}
                    placeholder={files.length ? "说说想让我看什么…" : "问问本站的内容或功能…"}
                    aria-label="输入问题"
                    enterKeyHint="send"
                    onChange={(event) => {
                      setDraft(event.target.value);
                      const el = event.target;
                      el.style.height = "auto";
                      el.style.height = Math.min(el.scrollHeight, 128) + "px";
                    }}
                    onPaste={(event) => {
                      const pasted = Array.from(event.clipboardData.files);
                      if (!pasted.length) return;
                      event.preventDefault();
                      addFiles(pasted);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                  {chat.phase === "idle" ? (
                    <LiquidButton type="submit" className="icon-button assistant-send" aria-label="发送" disabled={!draft.trim() && !files.length}>
                      <ArrowUp size={17} />
                    </LiquidButton>
                  ) : (
                    <LiquidButton type="button" className="icon-button assistant-send is-stop" aria-label="停止回答" onClick={stopReply}>
                      <Square size={13} fill="currentColor" />
                    </LiquidButton>
                  )}
                </div>
              </form>
            </motion.div>

            <AnimatePresence>
              {view === "details" && (
                <motion.div
                  key="details"
                  className="assistant-layer"
                  initial={{ opacity: 0, x: shift }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: shift }}
                  transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 380, damping: 36 }}
                >
                  <AssistantDetails
                    state={headState}
                    status={status}
                    messageCount={chat.messages.length}
                    onBack={() => setView("chat")}
                    onClose={() => { stopReply(); closePanel(); markRead(); }}
                    onNewChat={newChat}
                    onSettings={() => follow("/settings#assistant")}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
    </div>,
    host,
  );
}
