import { forwardRef, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps, type PanInfo } from "motion/react";
import { Check, ChevronRight, CircleAlert, Info, Layers, X } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { MotionCount } from "../motion/MicroInteraction";
import { useMotionPreferences } from "../motion/motion-preferences";
import { transitions } from "../motion/motion-tokens";
import Avatar from "../ui/Avatar";
import { boardIcon } from "../boards/Boards";
import { noticeVisual } from "./notice-visual";
import { timeAgo, type LiveNotice } from "../api";
import "./toast-notice.css";

type Tone = "success" | "error" | "info";
type ToastItem =
  | { id: string; type: "feedback"; message: string; tone: Tone }
  | { id: string; type: "live"; notice: LiveNotice };

const maxVisible = 3;
type QueueState = { items: ToastItem[]; overflow: number; overflowId: number };
type QueueAction =
  | { type: "push"; item: ToastItem }
  | { type: "dismiss"; id: string }
  | { type: "clear-overflow" }
  | { type: "clear-live" };
function settle(state: QueueState): QueueState {
  const items = [...state.items];
  let { overflow, overflowId } = state;
  while (items.length > maxVisible - (overflow > 0 ? 1 : 0)) {
    const oldestLive = items.findIndex((item) => item.type === "live");
    const [removed] = items.splice(oldestLive >= 0 ? oldestLive : 0, 1);
    if (removed.type === "live") {
      overflow++;
      overflowId++;
    }
  }
  return { items, overflow, overflowId };
}
function queue(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "push": {
      const { item } = action;
      if (item.type === "live" && state.items.some((i) => i.type === "live" && i.notice.id === item.notice.id)) return state;
      const kept = item.type === "feedback" ? state.items.filter((i) => i.type !== "feedback") : state.items;
      return settle({ ...state, items: [...kept, item] });
    }
    case "dismiss":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "clear-overflow":
      return { ...state, overflow: 0 };
    case "clear-live":
      return { ...state, items: state.items.filter((i) => i.type !== "live"), overflow: 0 };
  }
}
export function useToastQueue() {
  const [state, dispatch] = useReducer(queue, { items: [], overflow: 0, overflowId: 0 });
  const sequence = useRef(0);
  const feedback = useCallback((message: string, tone: Tone = "info") => {
    if (message) dispatch({ type: "push", item: { id: "feedback-" + ++sequence.current, type: "feedback", message, tone } });
  }, []);
  const live = useCallback((notice: LiveNotice) => {
    dispatch({ type: "push", item: { id: "live-" + notice.id, type: "live", notice } });
  }, []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const clearOverflow = useCallback(() => dispatch({ type: "clear-overflow" }), []);
  const clearLive = useCallback(() => dispatch({ type: "clear-live" }), []);
  return { ...state, feedback, live, dismiss, clearOverflow, clearLive };
}

function useDismissTimer(duration: number, paused: boolean, done: () => void, restartKey: unknown = 0) {
  const remaining = useRef(duration);
  const finish = useRef(done);
  finish.current = done;
  useEffect(() => {
    remaining.current = duration;
  }, [restartKey, duration]);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => finish.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(1500, remaining.current - (Date.now() - started));
    };
  }, [paused, restartKey]);
}

type StackProps = {
  items: ToastItem[];
  overflow: number;
  overflowId: number;
  onDismiss: (id: string) => void;
  onOpen: (notice: LiveNotice, id: string) => void;
  onOverflow: () => void;
  onClearOverflow: () => void;
};
export function GlassToastStack({ items, overflow, overflowId, onDismiss, onOpen, onOverflow, onClearOverflow }: StackProps) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "glass-notice-portal";
    element.style.visibility = "hidden";
    if (typeof element.showPopover === "function") element.popover = "manual";
    else element.classList.add("is-fallback");
    return element;
  });
  const active = useRef(false);
  active.current = items.length > 0 || overflow > 0;

  const hide = () => {
    if (host.popover && host.matches(":popover-open")) host.hidePopover();
    host.style.visibility = "hidden";
  };
  const show = () => {
    if (!host.isConnected || !host.querySelector(".glass-notice-card")) return;
    host.style.visibility = "visible";
    if (host.popover && !host.matches(":popover-open")) host.showPopover();
  };

  useLayoutEffect(() => {
    const syncHost = () => {
      const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1);
      const parent = dialog || document.body;
      if (host.parentElement !== parent) {
        const visible = host.style.visibility === "visible";
        hide();
        parent.appendChild(host);
        host.dataset.inDialog = String(Boolean(dialog));
        if (visible || active.current) show();
      } else if (active.current) show();
    };
    const hasDialog = (node: Node) => node instanceof Element && (node.matches("dialog") || Boolean(node.querySelector("dialog")));
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === "attributes"
        ? record.target instanceof HTMLDialogElement
        : [...record.addedNodes, ...record.removedNodes].some(hasDialog))) syncHost();
    });
    syncHost();
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-state"] });
    return () => { observer.disconnect(); hide(); host.remove(); };
  }, [host]);

  useLayoutEffect(() => { if (active.current) show(); }, [items, overflow, host]);

  const ordered = [...items].reverse();
  return createPortal(
    <ol className="glass-notice-stack" aria-label="站内提醒">
      <AnimatePresence initial={false} mode="popLayout" onExitComplete={() => { if (!active.current) hide(); }}>
        {ordered.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={onDismiss} onOpen={onOpen} />
        ))}
        {overflow > 0 && (
          <OverflowCapsule key="overflow" count={overflow} restartKey={overflowId} onOpen={onOverflow} onClose={onClearOverflow} />
        )}
      </AnimatePresence>
    </ol>,
    host,
  );
}

const exitEase = [0.4, 0, 0.8, 0.3] as const;
const edgeQuery = "(min-width: 900px)";
function useEdgeLayout() {
  const [edge, setEdge] = useState(() => matchMedia(edgeQuery).matches);
  useEffect(() => {
    const media = matchMedia(edgeQuery);
    const update = () => setEdge(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return edge;
}
function useCardMotion(): { setExitX: (x: number) => void; props: HTMLMotionProps<"li"> } {
  const { reduced } = useMotionPreferences();
  const edge = useEdgeLayout();
  const [exitX, setExitX] = useState(0);
  return {
    setExitX,
    props: {
      layout: true,
      initial: reduced
        ? { opacity: 0 }
        : edge
          ? { opacity: 0, x: 44, scale: 0.94, filter: "blur(6px)" }
          : { opacity: 0, y: -22, scale: 0.92, filter: "blur(6px)" },
      animate: { opacity: 1, y: 0, x: 0, scale: 1, filter: "blur(0px)" },
      exit: reduced
        ? { opacity: 0, transition: { duration: 0.12 } }
        : exitX || edge
          ? { opacity: 0, x: exitX || 36, scale: 0.96, filter: "blur(4px)", transition: { duration: 0.22, ease: exitEase } }
          : { opacity: 0, y: -12, scale: 0.94, filter: "blur(4px)", transition: { duration: 0.22, ease: exitEase } },
      transition: reduced ? { duration: 0.12 } : { ...transitions.surface, opacity: { duration: 0.2 }, filter: { duration: 0.24 } },
    },
  };
}
function useSwipe(onDismiss: () => void, setExitX: (x: number) => void) {
  const { reduced } = useMotionPreferences();
  const dragged = useRef(false);
  if (reduced) return { dragged, props: {} };
  return {
    dragged,
    props: {
      drag: "x" as const,
      dragSnapToOrigin: true,
      dragElastic: 0.55,
      onDragStart: () => {
        dragged.current = true;
      },
      onDragEnd: (_: unknown, info: PanInfo) => {
        if (Math.abs(info.offset.x) > 96 || Math.abs(info.velocity.x) > 650) {
          const direction = Math.sign(info.offset.x || info.velocity.x) || 1;
          flushSync(() => setExitX(direction * 260));
          onDismiss();
        }
        setTimeout(() => (dragged.current = false), 0);
      },
    },
  };
}

const ToastCard = forwardRef<HTMLLIElement, { item: ToastItem; onDismiss: (id: string) => void; onOpen: StackProps["onOpen"] }>(
  function ToastCard({ item, onDismiss, onOpen }, ref) {
    const present = useIsPresent();
    const [paused, setPaused] = useState(false);
    const dismiss = () => onDismiss(item.id);
    const motionState = useCardMotion();
    const swipe = useSwipe(dismiss, motionState.setExitX);
    const notice = item.type === "live" ? item.notice : null;
    useDismissTimer(item.type === "feedback" ? 4200 : notice?.important ? 11000 : 7000, paused || !present, dismiss);
    const hold = {
      onPointerEnter: () => setPaused(true),
      onPointerLeave: () => setPaused(false),
      onFocus: () => setPaused(true),
      onBlur: (event: React.FocusEvent<HTMLLIElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setPaused(false);
      },
    };
    const close = (
      <LiquidButton className="glass-notice-close" type="button" aria-label="关闭提示" onClick={dismiss} disabled={!present}>
        <X size={17} strokeWidth={1.8} aria-hidden="true" />
      </LiquidButton>
    );
    if (item.type === "feedback") {
      const Icon = item.tone === "success" ? Check : item.tone === "error" ? CircleAlert : Info;
      return (
        <motion.li
          ref={ref}
          className="glass-notice-card is-feedback"
          data-tone={item.tone}
          role={item.tone === "error" ? "alert" : "status"}
          aria-live={item.tone === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          aria-hidden={!present}
          inert={!present}
          {...motionState.props}
          {...swipe.props}
          {...hold}
        >
          <span className="glass-notice-symbol" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
          <span className="glass-notice-message">{item.message}</span>
          {close}
        </motion.li>
      );
    }
    const content = liveContent(item.notice);
    const expanded = paused && !swipe.dragged.current;
    const full = item.notice.preview || content.line;
    return (
      <motion.li
        ref={ref}
        className="glass-notice-card is-live"
        data-expanded={expanded || undefined}
        data-kind={item.notice.kind}
        data-important={item.notice.important || undefined}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={!present}
        inert={!present}
        {...motionState.props}
        {...swipe.props}
        {...hold}
      >
        <button
          type="button"
          className="glass-notice-main"
          aria-label={`${content.title}，${content.tag}：${content.line.replace(/[。.！!？?]+$/, "")}。点击查看`}
          onClick={() => {
            if (swipe.dragged.current) return;
            onOpen(item.notice, item.id);
          }}
        >
          <span className="glass-notice-visual" aria-hidden="true">
            {content.visual}
            <span className="glass-notice-badge"><content.Icon size={11} strokeWidth={2.2} /></span>
          </span>
          <span className="glass-notice-copy">
            <span className="glass-notice-head">
              <strong>{content.title}</strong>
              <span className="glass-notice-tag">{content.tag}</span>
              <time dateTime={new Date(item.notice.created_at).toISOString()}>{timeAgo(item.notice.created_at)}</time>
            </span>
            <span className="glass-notice-line">{content.line}</span>
          </span>
          <ChevronRight className="glass-notice-go" size={16} aria-hidden="true" />
        </button>
        {close}
        <div className="glass-notice-more" inert={!expanded} aria-hidden={!expanded}>
          <div>
            <p className="glass-notice-full">{full}</p>
            <span className="glass-notice-actions">
              <LiquidButton type="button" className="button secondary" onClick={dismiss}>忽略</LiquidButton>
              <LiquidButton type="button" className="button primary" onClick={() => onOpen(item.notice, item.id)}>查看<ChevronRight size={15} aria-hidden="true" /></LiquidButton>
            </span>
          </div>
        </div>
      </motion.li>
    );
  },
);

const OverflowCapsule = forwardRef<HTMLLIElement, { count: number; restartKey: number; onOpen: () => void; onClose: () => void }>(
  function OverflowCapsule({ count, restartKey, onOpen, onClose }, ref) {
    const present = useIsPresent();
    const [paused, setPaused] = useState(false);
    const motionState = useCardMotion();
    useDismissTimer(10000, paused || !present, onClose, restartKey);
    return (
      <motion.li
        ref={ref}
        className="glass-notice-card is-overflow"
        role="status"
        aria-live="polite"
        aria-hidden={!present}
        inert={!present}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        {...motionState.props}
      >
        <button type="button" className="glass-notice-main" onClick={onOpen} aria-label={`还有 ${count} 条新消息，打开消息中心查看`}>
          <span className="glass-notice-symbol" aria-hidden="true"><Layers size={16} strokeWidth={1.9} /></span>
          <span className="glass-notice-message">
            还有 <MotionCount value={count} /> 条新消息
          </span>
          <span className="glass-notice-cta">查看<ChevronRight size={14} aria-hidden="true" /></span>
        </button>
        <LiquidButton className="glass-notice-close" type="button" aria-label="收起" onClick={onClose} disabled={!present}>
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </LiquidButton>
      </motion.li>
    );
  },
);

function liveContent(n: LiveNotice): { visual: ReactNode; Icon: ReturnType<typeof noticeVisual>["Icon"]; title: string; tag: string; line: string } {
  const { Icon, label } = noticeVisual(n.kind, n.text);
  const face = n.actor ? <Avatar name={n.actor.name} initials={n.actor.initials} avatar={n.actor.avatar} /> : null;
  const glyph = (Symbol: typeof Icon) => <span className="glass-notice-glyph"><Symbol size={19} strokeWidth={1.7} /></span>;
  const withoutActor = (text: string) => (n.actor && text.startsWith(n.actor.name + " ") ? text.slice(n.actor.name.length + 1) : text);
  const postTitle = n.post?.title || "";
  switch (n.kind) {
    case "message":
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || "私信", tag: label, line: n.preview || "发来一条私信" };
    case "reply":
      return {
        visual: face || glyph(Icon),
        Icon,
        title: n.actor?.name || "回复",
        tag: n.reasons.includes("mention") ? "回复并提到你" : label,
        line: n.preview ? `“${n.preview}”` : withoutActor(n.text),
      };
    case "follow":
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || "新粉丝", tag: label, line: "关注了你" };
    case "like":
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || label, tag: label, line: postTitle ? `你的讨论「${postTitle}」` : withoutActor(n.text) };
    case "vote":
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || label, tag: label, line: n.preview ? `“${n.preview}”` : withoutActor(n.text) };
    case "mention":
    case "quote":
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || label, tag: label, line: withoutActor(n.text) };
    case "author_post":
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || "作者", tag: label, line: postTitle || withoutActor(n.text) };
    case "board_post": {
      const BoardIcon = boardIcon(n.board?.icon);
      return {
        visual: glyph(BoardIcon),
        Icon,
        title: n.board?.name || "版块",
        tag: label,
        line: postTitle ? `${postTitle}${n.actor ? " · " + n.actor.name : ""}` : n.text,
      };
    }
    case "topic_post":
      return { visual: glyph(Icon), Icon, title: "#" + (n.topic?.label || "话题"), tag: label, line: postTitle || n.text };
    case "announcement":
      return { visual: glyph(Icon), Icon, title: "站主公告", tag: "重要", line: n.text };
    case "moderation":
      return { visual: glyph(Icon), Icon, title: "站务通知", tag: "重要", line: n.text };
    case "appeal":
    case "admin_request":
      return { visual: face || glyph(Icon), Icon, title: label, tag: n.state === "handled" ? "已处理" : "待处理", line: n.text };
    case "admin_action":
    case "system_event":
      return { visual: glyph(Icon), Icon, title: label, tag: "管理", line: n.text };
    default:
      return { visual: face || glyph(Icon), Icon, title: n.actor?.name || label, tag: label, line: n.text };
  }
}
