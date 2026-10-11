import { LiquidButton } from "../motion/LiquidButton";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  MessageCircleOff,
  MessagesSquare,
  ListChecks,
  Gavel,
  Pin,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { openShare } from "../share/share-api";
import { ShareCardView } from "../share/ShareCard";
import { boardIcon } from "../boards/Boards";
import { noticeVisual } from "./notice-visual";
import { transitions } from "../motion/motion-tokens";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { GlassActions, GlassSegments, type GlassAction } from "../ui/GlassSegments";
import Avatar from "../ui/Avatar";
import Confirm from "../ui/Confirm";
import ContextMenu, { useContextMenu } from "../ui/ContextMenu";
import { AttachmentList, AttachmentPicker } from "../posts/Attachments";
import { RichText, stripImages } from "../posts/InlineImages";
import { QuoteButton, QuoteList, QuotePicker } from "../posts/Quotes";
import { openGovernance } from "../governance/governance-api";
import {
  api,
  mutedLabel,
  post as requestPost,
  timeAgo,
  type Attachment,
  type Category,
  type LiveNotice,
  type Message,
  type MessageThread,
  type Notification,
  type NotificationGroup,
  type NoticeTopic,
  type Quote,
  type AdminChannels,
  type Post,
  isShareUnavailable,
} from "../api";

type Tab = "notifications" | "messages" | "saved" | "admin";
type Bulk = "notes" | "threads" | "saved";
const governanceKinds = ["moderation", "appeal", "admin_request", "admin_action", "system_event"];
type Channel = "all" | "requests" | "appeals" | "actions" | "system" | "handled";
const channels: [Channel, string][] = [
  ["all", "全部"],
  ["requests", "待处理申请"],
  ["appeals", "待处理申诉"],
  ["actions", "管理员操作"],
  ["system", "系统事件"],
  ["handled", "已处理"],
];
const inChannel = (item: Notification, channel: Channel) =>
  channel === "all"
    ? item.kind !== "moderation" || !!item.ref_id
    : channel === "requests"
      ? item.kind === "admin_request" && item.state === "pending"
      : channel === "appeals"
        ? item.kind === "appeal" && item.state === "pending"
        : channel === "actions"
          ? item.kind === "admin_action"
          : channel === "system"
            ? item.kind === "system_event"
            : item.state === "handled" && ["admin_request", "appeal"].includes(item.kind);
const governanceNames: Record<string, string> = {
  moderation: "站务通知",
  appeal: "禁言申诉",
  admin_request: "删除申请",
  admin_action: "管理员操作",
  system_event: "系统事件",
};
function NoticeDetail({ item }: { item: Notification }) {
  if (!item.detail) return null;
  return (
    <dl className="centre-detail">
      {item.detail.lines.map((line) => (
        <div key={line.label}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
      {(item.result || item.detail.result) && (
        <div>
          <dt>当前结果</dt>
          <dd>{item.result || item.detail.result}</dd>
        </div>
      )}
      {item.detail.next && <p>{item.detail.next}</p>}
    </dl>
  );
}

const threadPreview = (t: MessageThread) => {
  if (!t.last) return "开始一段对话";
  const text = stripImages(t.last.content);
  const share = t.last.share;
  const body =
    text ||
    (t.last.quotes?.length
      ? `［分享了「${t.last.quotes[0].title}」］`
      : share
        ? isShareUnavailable(share)
          ? `［分享了一个${share.type === "board" ? "版块" : share.type === "assistant" ? "对话" : "收藏夹"}］`
          : share.type === "assistant"
            ? `［分享了对话「${share.title || "未命名对话"}」］`
            : share.type === "collection" || share.type === "board"
            ? `［分享了${share.type === "board" ? "版块" : "收藏夹"}「${share.name}」］`
            : `［转发了一条${share.type === "message" ? "私信" : "通知"}］`
        : `［${t.last.attachments.length} 个附件］`);
  return (t.last.mine ? "你：" : "") + body;
};

const groupTags: Record<string, string> = {
  author_post: "新帖",
  board_post: "版块新帖",
  topic_post: "话题更新",
  mention: "提到了你",
  quote: "引用",
  like: "赞同",
  vote: "评论反馈",
};
function GroupRow({
  group,
  onOpenItem,
  onAct,
  busy,
  managing = false,
  checked = false,
  focusedId = "",
  fresh = false,
  onToggle,
  onMenu,
  onShare,
}: {
  group: NotificationGroup;
  onOpenItem: (group: NotificationGroup, item: Notification) => void;
  onAct: (group: NotificationGroup, action: string) => void;
  onShare?: (group: NotificationGroup, item: Notification) => void;
  busy: boolean;
  managing?: boolean;
  checked?: boolean;
  focusedId?: string;
  fresh?: boolean;
  onToggle?: () => void;
  onMenu?: (event: React.MouseEvent) => void;
}) {
  const focusedIndex = focusedId ? group.items.findIndex((i) => i.id === focusedId) : -1;
  const [open, setOpen] = useState(focusedIndex > 0);
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusedIndex < 0) return;
    if (focusedIndex > 0) setOpen(true);
    const frame = requestAnimationFrame(() => row.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [focusedIndex]);
  const announcement = group.kind === "announcement";
  const moderation = governanceKinds.includes(group.kind);
  const latest = group.items[0];
  const [details, setDetails] = useState(focusedIndex === 0 && !!latest.detail);
  const pending = latest.state === "pending";
  const urgent = moderation && !!latest.important && (!latest.seen || pending);
  const openable = moderation && !!latest.ref_id && ["appeal", "delete_request", "complaint_case"].includes(latest.ref_type || "");
  const { Icon } = noticeVisual(group.kind, latest.text);
  const BoardIcon = boardIcon(group.board?.icon);
  const glyph =
    announcement || moderation ? (
      <Icon size={15} />
    ) : group.kind === "board_post" && group.board ? (
      <BoardIcon size={15} />
    ) : group.kind === "topic_post" ? (
      <Icon size={15} />
    ) : null;
  const name = announcement
    ? "站主公告"
    : moderation
      ? group.kind === "moderation"
        ? group.actor_id
          ? group.actor_name + " · 站务处理"
          : "系统 · 站务处理"
        : governanceNames[group.kind] + (group.actor_id ? " · " + group.actor_name : "")
      : group.kind === "board_post" && group.board
        ? group.board.name
        : group.kind === "topic_post" && group.topic
          ? "#" + group.topic.label
          : group.actor_name;
  const navigable = (item: Notification) =>
    !!item.post_id || (item.kind === "follow" && !!group.actor_id) || (item.kind === "topic_post" && !!item.topic);
  const tag = groupTags[group.kind];
  return (
    <article
      ref={row}
      className={`centre-row ${announcement || moderation || glyph ? "is-announcement" : ""} ${moderation ? "is-governance" : ""} ${urgent ? "is-urgent is-moderation" : ""} ${latest.seen ? "is-read" : ""} ${group.pinned ? "is-pinned" : ""} ${checked ? "is-checked" : ""} ${focusedIndex >= 0 ? "is-focused" : ""} ${fresh ? "is-fresh" : ""}`}
      onContextMenu={onMenu}
    >
      {managing && (
        <label className="centre-check">
          <input
            type="checkbox"
            aria-label={"选择来自 " + name + " 的消息"}
            checked={checked}
            onChange={() => onToggle?.()}
          />
        </label>
      )}
      {glyph ? (
        <span className="avatar">{glyph}</span>
      ) : (
        <Avatar
          name={group.actor_name}
          initials={group.actor_initials}
          avatar={group.actor_avatar}
          userId={group.actor_id || undefined}
        />
      )}
      <div className="centre-body">
        <div className="centre-meta">
          <strong>{name}</strong>
          {announcement && <span className="centre-tag">公告</span>}
          {moderation && <span className="centre-tag">{group.kind === "moderation" ? "站务" : governanceNames[group.kind]}</span>}
          {pending && <span className="centre-tag centre-state">待处理</span>}
          {latest.state === "handled" && <span className="centre-tag centre-state">已处理</span>}
          {tag && <span className="centre-tag">{tag}</span>}
          {group.pinned > 0 && <span className="centre-tag">已置顶</span>}
          {group.saved > 0 && <span className="centre-tag">已收藏</span>}
          <span>{timeAgo(group.latest_at)}</span>
          {group.unread > 0 && <span className="centre-unread">{group.unread}</span>}
          {fresh && <span className="centre-fresh">新</span>}
        </div>
        <LiquidButton
          type="button"
          className={`centre-text ${focusedIndex === 0 ? "is-focused" : ""}`}
          onClick={() => navigable(latest) && onOpenItem(group, latest)}
        >
          {latest.text}
          {navigable(latest) && <ArrowUpRight size={13} />}
        </LiquidButton>
        {latest.preview && group.kind !== "announcement" && (
          <p className="centre-preview-line">{latest.preview}</p>
        )}
        {moderation && details && <NoticeDetail item={latest} />}
        {group.items.length > 1 && (
          <>
            <LiquidButton
              type="button"
              className="comment-toggle"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <ChevronDown size={14} className={open ? "flipped" : ""} />
              {open
                ? "收起消息"
                : `展开其他 ${group.items.length - 1} 条消息`}
            </LiquidButton>
            {open && (
              <div className="centre-items">
                {group.items.slice(1).map((item) => (
                  <LiquidButton
                    key={item.id}
                    type="button"
                    className={`centre-text ${item.id === focusedId ? "is-focused" : ""}`}
                    onClick={() => navigable(item) && onOpenItem(group, item)}
                  >
                    {item.text}
                    <small>{timeAgo(item.created_at)}</small>
                  </LiquidButton>
                ))}
              </div>
            )}
          </>
        )}
        <GlassActions
          className="centre-actions"
          label="消息操作"
          items={[
            ...(openable
              ? [{
                  id: "open",
                  icon: <Gavel size={14} />,
                  label: pending ? "去处理" : "查看结果",
                  on: pending,
                  onClick: () => openGovernance(latest.ref_type === "appeal" ? { kind: "appeal", id: latest.ref_id! } : latest.ref_type === "delete_request" ? { kind: "request", id: latest.ref_id! } : { kind: "case", id: latest.ref_id! }),
                }]
              : []),
            ...(moderation && latest.detail
              ? [{
                  id: "details",
                  icon: <ChevronDown size={14} className={details ? "flipped" : ""} />,
                  label: details ? "收起详情" : "查看详情",
                  expanded: details,
                  onClick: () => setDetails(!details),
                }]
              : []),
            ...(onShare
              ? [{
                  id: "share",
                  icon: <Share2 size={14} />,
                  label: "分享",
                  onClick: () => onShare(group, latest),
                }]
              : []),
            {
              id: "pin",
              icon: <Pin size={14} fill={group.pinned ? "currentColor" : "none"} />,
              label: group.pinned ? "取消置顶" : "置顶",
              on: !!group.pinned,
              disabled: busy,
              onClick: () => onAct(group, group.pinned ? "unpin" : "pin"),
            },
            {
              id: "save",
              icon: <Bookmark size={14} fill={group.saved ? "currentColor" : "none"} />,
              label: group.saved ? "取消收藏" : "收藏",
              on: !!group.saved,
              disabled: busy,
              onClick: () => onAct(group, group.saved ? "unsave" : "save"),
            },
            {
              id: "delete",
              icon: <Trash2 size={14} />,
              label: "删除",
              danger: true,
              disabled: busy || pending,
              title: pending ? "待处理的申请与申诉处理完成后才能删除" : undefined,
              onClick: () => onAct(group, "delete"),
            },
          ]}
        />
      </div>
    </article>
  );
}

function ManageBar({
  hint,
  managing,
  onManage,
  clearLabel = "一键清空",
  clearDisabled,
  onClear,
}: {
  hint: string;
  managing: boolean;
  onManage: () => void;
  clearLabel?: string;
  clearDisabled: boolean;
  onClear: () => void;
}) {
  return (
    <div className="centre-manage">
      <span>{hint}</span>
      <GlassActions
        className="centre-manage-actions"
        label="批量管理"
        items={[
          {
            id: "manage",
            icon: managing ? <MessageCircle size={14} /> : <ListChecks size={14} />,
            label: managing ? "退出管理" : "批量管理",
            on: managing,
            disabled: clearDisabled && !managing,
            onClick: onManage,
          },
          { id: "clear", icon: <Trash2 size={14} />, label: clearLabel, danger: true, disabled: clearDisabled, onClick: onClear },
        ]}
      />
    </div>
  );
}

function BatchBar({
  total,
  picked,
  onPickAll,
  actions,
}: {
  total: number;
  picked: number;
  onPickAll: (all: boolean) => void;
  actions: GlassAction[];
}) {
  return (
    <div className="centre-batch">
      <label className="centre-batch-all">
        <input type="checkbox" checked={total > 0 && picked === total} onChange={(e) => onPickAll(e.target.checked)} />
        <span>全选</span>
      </label>
      <span className="centre-batch-count">已选 {picked}</span>
      <GlassActions className="centre-batch-actions" label="批量操作" items={actions} />
    </div>
  );
}

function Conversation({
  peerId,
  liveKey = 0,
  muted = false,
  categories,
  categoryName,
  onBack,
  onError,
  onChanged,
  onOpenPost,
  onOpenCollection,
  onOpenBoard,
}: {
  peerId: string;
  liveKey?: number;
  muted?: boolean;
  categories: Category[];
  categoryName: (id: string) => string;
  onBack: () => void;
  onError: (message: string) => void;
  onChanged: () => void;
  onOpenPost: (id: string) => void;
  onOpenCollection: (id: string) => void;
  onOpenBoard: (id: string) => void;
}) {
  const [thread, setThread] = useState<{
    peer: { id: string; name: string; initials: string; avatar?: string };
    pinned: number;
    saved: number;
    messages: Message[];
  } | null>(null);
  const [draft, setDraft] = useState(""),
    [files, setFiles] = useState<Attachment[]>([]),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [inlineImages, setInlineImages] = useState(true),
    [quoting, setQuoting] = useState(false),
    [busy, setBusy] = useState(""),
    [confirmClear, setConfirmClear] = useState(false),
    [confirmMessage, setConfirmMessage] = useState<Message | null>(null),
    [managing, setManaging] = useState(false),
    [picked, setPicked] = useState<string[]>([]),
    [confirmPicked, setConfirmPicked] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const bubbleMenu = useContextMenu<Message>();
  const handlers = useRef({ onChanged, onError });
  handlers.current = { onChanged, onError };
  useEffect(() => {
    let active = true;
    api("/messages/" + peerId)
      .then((r) => {
        if (!active) return;
        setThread(r);
        handlers.current.onChanged();
      })
      .catch((e) => active && handlers.current.onError((e as Error).message));
    return () => {
      active = false;
    };
  }, [peerId]);
  useEffect(() => {
    if (!liveKey) return;
    let active = true;
    api("/messages/" + peerId)
      .then((r) => {
        if (!active) return;
        setThread((t) => (t ? { ...t, messages: r.messages } : r));
        handlers.current.onChanged();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [liveKey, peerId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() && !files.length && !quotes.length) return;
    setBusy("send");
    try {
      const r = await api(
        "/messages/" + peerId,
        requestPost({
          content: draft.trim(),
          attachments: files,
          quotes: quotes.map((q) => q.id),
          inline_images: inlineImages,
        }),
      );
      setThread((t) => (t ? { ...t, messages: [...t.messages, r.message] } : t));
      setDraft("");
      setFiles([]);
      setQuotes([]);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function setState(next: { pinned?: boolean; saved?: boolean }) {
    setBusy("state");
    try {
      await api("/messages/" + peerId + "/state", requestPost(next));
      setThread((t) =>
        t
          ? {
              ...t,
              pinned: next.pinned === undefined ? t.pinned : next.pinned ? 1 : 0,
              saved: next.saved === undefined ? t.saved : next.saved ? 1 : 0,
            }
          : t,
      );
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function removeMessage(message: Message) {
    setBusy("delete");
    try {
      await api("/messages/item/" + message.id, { method: "DELETE" });
      setThread((t) =>
        t ? { ...t, messages: t.messages.filter((m) => m.id !== message.id) } : t,
      );
      setConfirmMessage(null);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function removePicked() {
    setBusy("delete");
    try {
      for (const id of picked) await api("/messages/item/" + id, { method: "DELETE" });
      setThread((t) => (t ? { ...t, messages: t.messages.filter((m) => !picked.includes(m.id)) } : t));
      setPicked([]);
      setManaging(false);
      setConfirmPicked(false);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function clearThread() {
    setBusy("clear");
    try {
      await api("/messages/" + peerId, { method: "DELETE" });
      onChanged();
      onBack();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function forward(m: Message) {
    const card = m.share;
    try {
      if (card && !isShareUnavailable(card) && card.type === "collection")
        return openShare({ type: "collection", collection: (await api("/collections/" + encodeURIComponent(card.id))).collection });
      if (card && !isShareUnavailable(card) && card.type === "board") {
        const board = categories.find((c) => c.id === card.id);
        if (board) return openShare({ type: "board", board });
      }
    } catch (e) {
      return onError((e as Error).message);
    }
    const text = stripImages(m.content).trim();
    if (!text && m.quotes.length === 1) return openShare({ type: "post", post: m.quotes[0] });
    openShare({ type: "message", message: m });
  }
  if (!thread)
    return (
      <div className="centre-loading">
        <LoaderCircle size={20} className="spin" />
      </div>
    );
  const mine = thread.messages.filter((m) => m.mine);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <>
      <div className="chat-head">
        <LiquidButton type="button" className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          全部私信
        </LiquidButton>
        <strong>{thread.peer.name}</strong>
        <GlassActions
          className="chat-head-actions"
          label="对话操作"
          items={[
            {
              id: "pin",
              icon: <Pin size={14} fill={thread.pinned ? "currentColor" : "none"} />,
              label: thread.pinned ? "取消置顶" : "置顶",
              on: !!thread.pinned,
              disabled: !!busy,
              onClick: () => setState({ pinned: !thread.pinned }),
            },
            {
              id: "save",
              icon: <Bookmark size={14} fill={thread.saved ? "currentColor" : "none"} />,
              label: thread.saved ? "取消收藏" : "收藏",
              on: !!thread.saved,
              disabled: !!busy,
              onClick: () => setState({ saved: !thread.saved }),
            },
            {
              id: "manage",
              icon: managing ? <MessageCircle size={14} /> : <ListChecks size={14} />,
              label: managing ? "退出管理" : "批量管理",
              on: managing,
              disabled: !mine.length,
              onClick: () => {
                setManaging(!managing);
                setPicked([]);
              },
            },
            {
              id: "clear",
              icon: <Trash2 size={14} />,
              label: "一键清空",
              danger: true,
              disabled: !!busy,
              onClick: () => setConfirmClear(true),
            },
          ]}
        />
      </div>
      {managing && (
        <BatchBar
          total={mine.length}
          picked={picked.length}
          onPickAll={(all) => setPicked(all ? mine.map((m) => m.id) : [])}
          actions={[
            {
              id: "delete",
              icon: <Trash2 size={14} />,
              label: "删除所选",
              danger: true,
              disabled: !picked.length || !!busy,
              onClick: () => setConfirmPicked(true),
            },
          ]}
        />
      )}
      <div className="chat-stream">
        {thread.messages.length === 0 && (
          <p className="no-comments">还没有消息，说点什么吧。</p>
        )}
        {thread.messages.map((m) => (
          <div
            key={m.id}
            className={`chat-bubble ${m.mine ? "mine" : ""} ${managing && m.mine ? "is-selectable" : ""} ${picked.includes(m.id) ? "is-checked" : ""}`}
            onContextMenu={(e) => bubbleMenu.open(e, m)}
          >
            {managing && m.mine && (
              <label className="centre-check chat-check">
                <input
                  type="checkbox"
                  aria-label="选择这条私信"
                  checked={picked.includes(m.id)}
                  onChange={() => toggle(m.id)}
                />
              </label>
            )}
            <div className="chat-bubble-body">
              {m.content && <RichText text={m.content} />}
              <AttachmentList files={m.attachments} />
              <QuoteList
                quotes={m.quotes}
                categoryName={categoryName}
                onOpen={onOpenPost}
                mark="讨论"
              />
              {m.share && (
                <ShareCardView card={m.share} onOpenCollection={onOpenCollection} onOpenBoard={onOpenBoard} />
              )}
            </div>
            <div className="chat-bubble-meta">
              <span>{timeAgo(m.created_at)}</span>
              {!managing && (
                <LiquidButton type="button" onClick={() => forward(m)} aria-label="转发这条私信">
                  <Share2 size={12} />
                  转发
                </LiquidButton>
              )}
              {m.mine && !managing && (
                <LiquidButton type="button" onClick={() => setConfirmMessage(m)}>
                  删除
                </LiquidButton>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {muted ? (
        <p className="comments-closed" role="status">
          <MessageCircleOff size={15} />
          {mutedLabel}
        </p>
      ) : (
      <form className="reply-form chat-form" onSubmit={send}>
        <textarea
          aria-label={`发送给 ${thread.peer.name}`}
          placeholder={`发消息给 ${thread.peer.name}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={5000}
          rows={2}
        />
        <QuoteList
          quotes={quotes}
          onRemove={(id) => setQuotes((list) => list.filter((q) => q.id !== id))}
        />
        <div className="reply-form-tools">
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            onError={onError}
            inline={inlineImages}
            onInline={setInlineImages}
            compact
            toolbarExtra={
              <QuoteButton onClick={() => setQuoting(true)} count={quotes.length} />
            }
            toolbarEnd={
              <LiquidButton
                className="button primary"
                disabled={
                  busy === "send" ||
                  (!draft.trim() && !files.length && !quotes.length)
                }
              >
                {busy === "send" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <>
                    发送
                    <Send size={15} />
                  </>
                )}
              </LiquidButton>
            }
          />
        </div>
      </form>
      )}
      {bubbleMenu.menu && (
        <ContextMenu
          x={bubbleMenu.menu.x}
          y={bubbleMenu.menu.y}
          onClose={bubbleMenu.close} open={bubbleMenu.isOpen} onExited={bubbleMenu.finish} triggerRef={bubbleMenu.triggerRef}
          items={[
            {
              label: "转发这条私信",
              icon: <Share2 size={14} />,
              onSelect: () => forward(bubbleMenu.menu!.item),
            },
            ...(bubbleMenu.menu.item.mine
              ? [{
                  label: "删除这条私信",
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: () => setConfirmMessage(bubbleMenu.menu!.item),
                }]
              : []),
          ]}
        />
      )}
      {quoting && (
        <QuotePicker
          categories={categories}
          chosen={quotes}
          onError={onError}
          onClose={() => setQuoting(false)}
          onPick={(q) => {
            setQuotes((list) =>
              list.some((x) => x.id === q.id) ? list : [...list, q],
            );
            setQuoting(false);
          }}
        />
      )}
      {confirmClear && (
        <Confirm
          title="清空对话"
          heading="清空这个对话？"
          description={`这只会清空你这边与 ${thread.peer.name} 的记录，对方仍然保留。对方再发来消息时，对话会重新出现。`}
          confirmLabel="全部清空"
          busy={busy === "clear"}
          onConfirm={clearThread}
          onClose={() => setConfirmClear(false)}
        />
      )}
      {confirmPicked && (
        <Confirm
          title="删除所选"
          heading={`删除选中的 ${picked.length} 条私信？`}
          description="这些消息及其附件会对双方永久删除，此操作无法撤销。"
          confirmLabel="删除所选"
          busy={busy === "delete"}
          onConfirm={removePicked}
          onClose={() => setConfirmPicked(false)}
        />
      )}
      {confirmMessage && (
        <Confirm
          title="删除私信"
          heading="删除这条私信？"
          description="这条消息及其附件会对双方永久删除，此操作无法撤销。"
          confirmLabel="删除私信"
          busy={busy === "delete"}
          onConfirm={() => removeMessage(confirmMessage)}
          onClose={() => setConfirmMessage(null)}
        />
      )}
    </>
  );
}

export default function MessageCenter({
  onClose,
  onOpenPost,
  onOpenProfile,
  onOpenTopic,
  onOpenSettings,
  onOpenCollection,
  onOpenBoard,
  onError,
  onUnreadChange,
  categories,
  initialPeer = "",
  peerRequest = 0,
  focusId = "",
  live = [],
  muted = false,
  staff = false,
}: {
  onClose: () => void;
  onOpenPost: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onOpenTopic: (topic: NoticeTopic) => void;
  onOpenSettings: () => void;
  onOpenCollection: (id: string) => void;
  onOpenBoard: (id: string) => void;
  onError: (message: string) => void;
  onUnreadChange: () => void;
  categories: Category[];
  initialPeer?: string;
  peerRequest?: number;
  focusId?: string;
  live?: LiveNotice[];
  muted?: boolean;
  staff?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialPeer ? "messages" : "notifications"),
    [groups, setGroups] = useState<NotificationGroup[]>([]),
    [threads, setThreads] = useState<MessageThread[]>([]),
    [peer, setPeer] = useState(initialPeer),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [confirmGroup, setConfirmGroup] = useState<NotificationGroup | null>(null),
    [adminCounts, setAdminCounts] = useState<AdminChannels | null>(null),
    [channel, setChannel] = useState<Channel>("all");
  const [managing, setManaging] = useState(false),
    [picked, setPicked] = useState<string[]>([]),
    [confirmPicked, setConfirmPicked] = useState<Bulk | null>(null),
    [confirmBulk, setConfirmBulk] = useState<Bulk | null>(null),
    [confirmThread, setConfirmThread] = useState<MessageThread | null>(null);
  const firstRequest = useRef(peerRequest);
  useEffect(() => {
    if (peerRequest === firstRequest.current || !initialPeer) return;
    setTab("messages");
    setManaging(false);
    setPicked([]);
    setPeer(initialPeer);
  }, [peerRequest, initialPeer]);
  const noteMenu = useContextMenu<NotificationGroup>();
  const threadMenu = useContextMenu<MessageThread>();
  const savedMenu = useContextMenu<string>();
  const handlers = useRef({ onError, onUnreadChange });
  handlers.current = { onError, onUnreadChange };
  const refresh = useCallback(async () => {
    try {
      const [inbox, chat] = await Promise.all([
        api("/notifications"),
        api("/messages"),
      ]);
      setGroups(inbox.groups);
      setAdminCounts(inbox.channels || null);
      setThreads(chat.threads);
    } catch (e) {
      handlers.current.onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const again = () => refresh();
    window.addEventListener("nmk-governance-changed", again);
    return () => window.removeEventListener("nmk-governance-changed", again);
  }, [refresh]);
  useEffect(() => {
    refresh();
    api("/notifications", { method: "PATCH" })
      .then(() => handlers.current.onUnreadChange())
      .catch(() => {});
  }, [refresh]);
  const handled = useRef(new Set<string>());
  const [fresh, setFresh] = useState<string[]>([]),
    [banner, setBanner] = useState<{ count: number; tab: Tab; key: number } | null>(null);
  useEffect(() => {
    const incoming = live.filter((n) => !handled.current.has(n.id));
    if (!incoming.length) return;
    incoming.forEach((n) => handled.current.add(n.id));
    const keys = incoming.map((n) => (n.kind === "message" ? "peer:" + (n.peer_id || n.actor?.id) : n.id));
    setFresh((prev) => [...new Set([...prev, ...keys])]);
    setBanner((prev) => ({
      count: (prev?.count || 0) + incoming.length,
      tab: incoming.at(-1)!.kind === "message" ? "messages" : "notifications",
      key: Date.now(),
    }));
    refresh().then(() => {
      if (incoming.some((n) => n.kind !== "message"))
        api("/notifications", { method: "PATCH" })
          .then(() => handlers.current.onUnreadChange())
          .catch(() => {});
      else handlers.current.onUnreadChange();
    });
  }, [live, refresh]);
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);
  useEffect(() => {
    if (!fresh.length) return;
    const timer = setTimeout(() => setFresh([]), 9000);
    return () => clearTimeout(timer);
  }, [fresh]);
  const liveKeyFor = (peerId: string) =>
    live.filter((n) => n.kind === "message" && (n.peer_id || n.actor?.id) === peerId).length;
  async function act(group: NotificationGroup, action: string) {
    if (action === "delete") return setConfirmGroup(group);
    return apply(group, action);
  }
  async function apply(group: NotificationGroup, action: string) {
    return runNotes({ ids: group.items.map((i) => i.id), action });
  }
  async function runNotes(body: {
    ids?: string[];
    all?: boolean;
    action: string;
  }) {
    setBusy(true);
    try {
      const r = await api("/notifications/batch", requestPost(body));
      setGroups(r.groups);
      if (r.channels) setAdminCounts(r.channels);
      setConfirmGroup(null);
      setConfirmBulk(null);
      setPicked([]);
      if (body.all) setManaging(false);
      onUnreadChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const deleteNotes = (keys: string[]) =>
    runNotes({
      action: "delete",
      ids: groups
        .filter((g) => keys.includes(g.key))
        .flatMap((g) => g.items.map((i) => i.id)),
    });
  async function clearThreads(peers?: string[]) {
    setBusy(true);
    try {
      await api("/messages", {
        method: "DELETE",
        body: JSON.stringify(peers ? { peers } : { all: true }),
      });
      setConfirmBulk(null);
      setConfirmThread(null);
      setPicked([]);
      if (!peers) setManaging(false);
      await refresh();
      onUnreadChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const switchTab = (next: Tab) => {
    setTab(next);
    setManaging(false);
    setPicked([]);
  };
  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name || "站内讨论";
  const inbox = groups.filter((g) => g.kind !== "admin_action" && g.kind !== "system_event");
  const savedGroups = groups.filter((g) => g.saved);
  const adminGroups = groups.filter((g) => ["appeal", "admin_request", "admin_action", "system_event"].includes(g.kind) && g.items.some((i) => inChannel(i, channel)));
  const adminPending = (adminCounts?.requests.total || 0) + (adminCounts?.appeals.total || 0);
  const channelCount = (id: Channel) =>
    id === "all" || !adminCounts ? 0 : id === "requests" || id === "appeals" ? adminCounts[id].total : adminCounts[id].unread;
  const savedThreads = threads.filter((t) => t.saved);
  const unreadMessages = threads.reduce((n, t) => n + t.unread, 0);
  const openPost = (id: string) => {
    onClose();
    onOpenPost(id);
  };
  const openItem = (group: NotificationGroup, item: Notification) => {
    if (item.post_id) return openPost(item.post_id);
    if (item.kind === "follow" && group.actor_id) {
      onClose();
      return onOpenProfile(group.actor_id);
    }
    if (item.topic) {
      onClose();
      onOpenTopic(item.topic);
    }
  };
  async function shareNotice(group: NotificationGroup, item: Notification) {
    if (item.post_id) {
      try {
        const r = await api<{ post: Post }>("/posts/" + encodeURIComponent(item.post_id));
        return openShare({ type: "post", post: r.post });
      } catch {
      }
    }
    const board = !item.post_id && group.board ? categories.find((c) => c.id === group.board!.id) : null;
    if (board) return openShare({ type: "board", board });
    openShare({ type: "notice", notice: item });
  }
  const freshNotes = fresh.filter((k) => !k.startsWith("peer:"));
  const freshPeers = fresh.filter((k) => k.startsWith("peer:"));
  const toggleManaging = () => {
    setManaging(!managing);
    setPicked([]);
  };
  const togglePick = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const manageBar = (kind: Bulk, all: string[], hint: string) => (
    <>
      <ManageBar
        hint={hint}
        managing={managing}
        onManage={toggleManaging}
        clearLabel={kind === "saved" ? "清空收藏" : "一键清空"}
        clearDisabled={!all.length || busy}
        onClear={() => setConfirmBulk(kind)}
      />
      {managing && (
        <BatchBar
          total={all.length}
          picked={picked.length}
          onPickAll={(on) => setPicked(on ? all : [])}
          actions={[
            {
              id: "remove",
              icon: kind === "saved" ? <Bookmark size={14} /> : <Trash2 size={14} />,
              label: kind === "saved" ? "移出收藏" : "删除所选",
              danger: true,
              disabled: !picked.length || busy,
              onClick: () => setConfirmPicked(kind),
            },
          ]}
        />
      )}
    </>
  );
  async function unsave(keys?: string[]) {
    const pickedGroups = keys ? savedGroups.filter((g) => keys.includes(g.key)) : savedGroups;
    const peers = savedThreads.filter((t) => !keys || keys.includes("peer:" + t.peer.id)).map((t) => t.peer.id);
    setBusy(true);
    try {
      if (pickedGroups.length)
        await api(
          "/notifications/batch",
          requestPost({ action: "unsave", ids: pickedGroups.flatMap((g) => g.items.map((i) => i.id)) }),
        );
      for (const id of peers) await api("/messages/" + id + "/state", requestPost({ saved: false }));
      setConfirmBulk(null);
      setConfirmPicked(null);
      setPicked([]);
      if (!keys) setManaging(false);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="消息中心" onClose={onClose} wide className="centre-modal">
      <div className="centre-heading">
        <h2>消息中心</h2>
        <LiquidButton type="button" className="text-button centre-settings" onClick={onOpenSettings}>
          <Settings2 size={14} />
          通知设置
        </LiquidButton>
      </div>
      <GlassSegments<Tab>
        className="centre-tabs"
        label="消息中心分类"
        value={tab}
        onChange={(next) => {
          switchTab(next);
          if (next === "messages") setPeer("");
        }}
        items={[
          {
            id: "notifications",
            icon: <Bell size={14} />,
            label: "通知与公告",
            extra: tab !== "notifications" && freshNotes.length > 0 && <span className="centre-live-dot" aria-label="有新通知" />,
          },
          {
            id: "messages",
            icon: <MessagesSquare size={14} />,
            label: "私信",
            extra: (
              <>
                {unreadMessages > 0 && <span className="centre-unread">{unreadMessages}</span>}
                {tab !== "messages" && freshPeers.length > 0 && <span className="centre-live-dot" aria-label="有新私信" />}
              </>
            ),
          },
          { id: "saved", icon: <Bookmark size={14} />, label: "收藏" },
          ...(staff
            ? [
                {
                  id: "admin" as const,
                  icon: <Gavel size={14} />,
                  label: "管理",
                  extra: adminPending > 0 && <span className="centre-unread">{adminPending}</span>,
                },
              ]
            : []),
        ]}
      />
      <AnimatePresence>
        {banner && (
          <motion.div
            key="live-banner"
            className="centre-live-banner-wrap"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={transitions.surface}
          >
            <LiquidButton
              type="button"
              className="centre-live-banner"
              role="status"
              aria-live="polite"
              onClick={() => {
                if (banner.tab !== tab) switchTab(banner.tab);
                if (banner.tab === "messages") setPeer("");
                setBanner(null);
                document.querySelector(".centre-modal .centre-list")?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <Sparkles size={14} />
              收到 {banner.count} 条新消息
              <span>查看</span>
            </LiquidButton>
          </motion.div>
        )}
      </AnimatePresence>
      {loading ? (
        <div className="centre-loading">
          <LoaderCircle size={20} className="spin" />
        </div>
      ) : tab === "messages" ? (
        peer ? (
          <Conversation
            peerId={peer}
            liveKey={liveKeyFor(peer)}
            muted={muted}
            categories={categories}
            categoryName={categoryName}
            onBack={() => setPeer("")}
            onError={onError}
            onOpenPost={openPost}
            onOpenCollection={(id) => {
              onClose();
              onOpenCollection(id);
            }}
            onOpenBoard={(id) => {
              onClose();
              onOpenBoard(id);
            }}
            onChanged={() => {
              refresh();
              onUnreadChange();
            }}
          />
        ) : (
          <>
          {manageBar(
            "threads",
            threads.map((t) => t.peer.id),
            `共 ${threads.length} 个对话`,
          )}
          {threads.length === 0 ? (
          <div className="empty-state compact">
            <MessagesSquare size={34} strokeWidth={1} />
            <h3>还没有私信。</h3>
            <p>在讨论或回复里点击某位成员的「私信」，就能开始一段对话。</p>
          </div>
          ) : (
          <div className="centre-list thread-list">
            {threads.map((t) => (
              <div key={t.peer.id} className="centre-plate">
              <LiquidButton
                type="button"
                className={`centre-thread ${t.pinned ? "is-pinned" : ""} ${t.unread > 0 ? "is-unread" : ""} ${picked.includes(t.peer.id) ? "is-checked" : ""} ${freshPeers.includes("peer:" + t.peer.id) ? "is-fresh" : ""}`}
                onContextMenu={(e) => threadMenu.open(e, t)}
                onClick={() => (managing ? togglePick(t.peer.id) : setPeer(t.peer.id))}
              >
                {managing && (
                  <span className="thread-check" aria-hidden="true">
                    {picked.includes(t.peer.id) && <Check size={12} />}
                  </span>
                )}
                <Avatar
                  name={t.peer.name}
                  initials={t.peer.initials}
                  avatar={t.peer.avatar}
                />
                <span className="thread-name">{t.peer.name}</span>
                {t.pinned > 0 && <Pin size={12} className="thread-flag" />}
                {t.saved > 0 && <Bookmark size={12} className="thread-flag" />}
                <span className="thread-preview">{threadPreview(t)}</span>
                <span className="thread-time">
                  {t.last ? timeAgo(t.last.created_at) : "暂无消息"}
                </span>
                {t.unread > 0 && (
                  <span className="centre-unread">{t.unread}</span>
                )}
                <ArrowUpRight size={15} />
              </LiquidButton>
              </div>
            ))}
          </div>
          )}
          </>
        )
      ) : tab === "admin" ? (
        <>
          <GlassSegments<Channel>
            className="centre-channels"
            label="管理消息分类"
            value={channel}
            onChange={setChannel}
            columns={6}
            items={channels.map(([id, label]) => ({
              id,
              label,
              extra: channelCount(id) > 0 ? <span className="centre-unread">{channelCount(id)}</span> : undefined,
            }))}
          />
          {adminGroups.length === 0 ? (
            <div className="empty-state compact">
              <Gavel size={34} strokeWidth={1} />
              <h3>暂无结果</h3>
            </div>
          ) : (
            <div className="centre-list">
              {adminGroups.map((g) => (
                <GroupRow
                  key={g.key}
                  group={g}
                  onOpenItem={openItem}
                  onAct={act}
                  onShare={shareNotice}
                  busy={busy}
                  focusedId={focusId}
                  fresh={g.items.some((i) => freshNotes.includes(i.id))}
                />
              ))}
            </div>
          )}
        </>
      ) : tab === "saved" ? (
          <>
          {manageBar(
            "saved",
            [...savedGroups.map((g) => g.key), ...savedThreads.map((t) => "peer:" + t.peer.id)],
            `共 ${savedGroups.length + savedThreads.length} 条收藏`,
          )}
          {savedGroups.length === 0 && savedThreads.length === 0 ? (
          <div className="empty-state compact">
            <Bookmark size={34} strokeWidth={1} />
            <h3>还没有收藏的消息。</h3>
            <p>在通知或对话上点击「收藏」，之后就能在这里找回。</p>
          </div>
          ) : (
          <div className="centre-list">
            {savedGroups.map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                onOpenItem={openItem}
                onAct={act}
                onShare={shareNotice}
                busy={busy}
                managing={managing}
                checked={picked.includes(g.key)}
                onToggle={() => togglePick(g.key)}
                onMenu={(e) => savedMenu.open(e, g.key)}
              />
            ))}
            {savedThreads.map((t) => (
              <div key={t.peer.id} className="centre-plate">
              <LiquidButton
                type="button"
                className={`centre-thread ${picked.includes("peer:" + t.peer.id) ? "is-checked" : ""}`}
                onContextMenu={(e) => savedMenu.open(e, "peer:" + t.peer.id)}
                onClick={() => {
                  if (managing) return togglePick("peer:" + t.peer.id);
                  switchTab("messages");
                  setPeer(t.peer.id);
                }}
              >
                {managing && (
                  <span className="thread-check" aria-hidden="true">
                    {picked.includes("peer:" + t.peer.id) && <Check size={12} />}
                  </span>
                )}
                <Avatar
                  name={t.peer.name}
                  initials={t.peer.initials}
                  avatar={t.peer.avatar}
                />
                <span className="thread-name">{t.peer.name}</span>
                <Bookmark size={12} className="thread-flag" />
                <span className="thread-preview">{threadPreview(t)}</span>
                <span className="thread-time">
                  {t.last ? timeAgo(t.last.created_at) : "暂无消息"}
                </span>
                <ArrowUpRight size={15} />
              </LiquidButton>
              </div>
            ))}
          </div>
          )}
          </>
      ) : (
        <>
          {manageBar(
            "notes",
            inbox.map((g) => g.key),
            `共 ${inbox.length} 条消息`,
          )}
          {inbox.length === 0 ? (
          <div className="empty-state compact">
            <Bell size={34} strokeWidth={1} />
            <h3>暂无消息</h3>
          </div>
          ) : (
          <div className="centre-list">
            {inbox.map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                onOpenItem={openItem}
                onAct={act}
                onShare={shareNotice}
                busy={busy}
                focusedId={focusId}
                fresh={g.items.some((i) => freshNotes.includes(i.id))}
                managing={managing}
                checked={picked.includes(g.key)}
                onToggle={() => togglePick(g.key)}
                onMenu={(e) => noteMenu.open(e, g)}
              />
            ))}
          </div>
          )}
        </>
      )}
      {noteMenu.menu && (
        <ContextMenu
          x={noteMenu.menu.x}
          y={noteMenu.menu.y}
          onClose={noteMenu.close} open={noteMenu.isOpen} onExited={noteMenu.finish} triggerRef={noteMenu.triggerRef}
          items={[
            { label: "选择这条消息", icon: <Check size={14} />, onSelect: () => { setManaging(true); setPicked([noteMenu.menu!.item.key]); } },
            {
              label: "删除这条消息",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setConfirmGroup(noteMenu.menu!.item),
            },
            {
              label: noteMenu.menu.item.pinned ? "取消置顶" : "置顶",
              icon: <Pin size={14} />,
              onSelect: () =>
                apply(
                  noteMenu.menu!.item,
                  noteMenu.menu!.item.pinned ? "unpin" : "pin",
                ),
            },
            {
              label: "清空全部消息",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setConfirmBulk("notes"),
            },
          ]}
        />
      )}
      {threadMenu.menu && (
        <ContextMenu
          x={threadMenu.menu.x}
          y={threadMenu.menu.y}
          onClose={threadMenu.close} open={threadMenu.isOpen} onExited={threadMenu.finish} triggerRef={threadMenu.triggerRef}
          items={[
            { label: "选择这个对话", icon: <Check size={14} />, onSelect: () => { setManaging(true); setPicked([threadMenu.menu!.item.peer.id]); } },
            {
              label: "删除这个对话",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setConfirmThread(threadMenu.menu!.item),
            },
            {
              label: "清空全部对话",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setConfirmBulk("threads"),
            },
          ]}
        />
      )}
      {savedMenu.menu && (
        <ContextMenu
          x={savedMenu.menu.x}
          y={savedMenu.menu.y}
          onClose={savedMenu.close} open={savedMenu.isOpen} onExited={savedMenu.finish} triggerRef={savedMenu.triggerRef}
          items={[
            { label: "选择这条收藏", icon: <Check size={14} />, onSelect: () => { setManaging(true); setPicked([savedMenu.menu!.item]); } },
            { label: "移出收藏", icon: <Bookmark size={14} />, onSelect: () => unsave([savedMenu.menu!.item]) },
            { label: "清空全部收藏", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmBulk("saved") },
          ]}
        />
      )}
      {confirmPicked && (
        <Confirm
          title={confirmPicked === "saved" ? "移出收藏" : "删除所选"}
          heading={
            confirmPicked === "saved"
              ? `将选中的 ${picked.length} 条内容移出收藏？`
              : `删除选中的 ${picked.length} ${confirmPicked === "notes" ? "条消息" : "个对话"}？`
          }
          description={
            confirmPicked === "saved"
              ? "只会取消收藏，消息和对话本身仍然保留在对应的列表里。"
              : "只会清除你这边的记录，不会删除社区讨论或对方保存的内容。"
          }
          confirmLabel={confirmPicked === "saved" ? "移出收藏" : "删除所选"}
          busy={busy}
          onClose={() => setConfirmPicked(null)}
          onConfirm={async () => {
            if (confirmPicked === "notes") await deleteNotes(picked);
            else if (confirmPicked === "threads") await clearThreads(picked);
            else await unsave(picked);
            setConfirmPicked(null);
          }}
        />
      )}
      {confirmThread && (
        <Confirm
          title="删除对话"
          heading={`删除与 ${confirmThread.peer.name} 的对话？`}
          description="这只会清空你这边的记录，对方仍然保留。对方再发来消息时对话会重新出现。"
          confirmLabel="删除对话"
          busy={busy}
          onConfirm={() => clearThreads([confirmThread.peer.id])}
          onClose={() => setConfirmThread(null)}
        />
      )}
      {confirmBulk && (
        <Confirm
          title={{ notes: "清空消息", threads: "清空对话", saved: "清空收藏" }[confirmBulk]}
          heading={
            { notes: "清空全部通知与公告？", threads: "清空全部私信对话？", saved: "清空全部收藏？" }[confirmBulk]
          }
          description={
            {
              notes: "消息只会从你的消息中心移除，不影响讨论内容本身。",
              threads: "只会清空你这边的全部对话记录，对方仍然保留；对方再发来消息时，对话会重新出现。",
              saved: "只会取消收藏，消息和对话本身仍然保留在对应的列表里。",
            }[confirmBulk]
          }
          confirmLabel="全部清空"
          busy={busy}
          onConfirm={() =>
            confirmBulk === "notes"
              ? runNotes({ action: "delete", all: true })
              : confirmBulk === "threads"
                ? clearThreads()
                : unsave()
          }
          onClose={() => setConfirmBulk(null)}
        />
      )}
      {confirmGroup && (
        <Confirm
          title="删除消息"
          heading={
            confirmGroup.items.length > 1
              ? `删除来自 ${confirmGroup.actor_name} 的 ${confirmGroup.items.length} 条消息？`
              : "删除这条消息？"
          }
          description="消息只会从你的消息中心移除，不影响讨论内容本身。"
          confirmLabel="删除"
          busy={busy}
          onConfirm={() => apply(confirmGroup, "delete")}
          onClose={() => setConfirmGroup(null)}
        />
      )}
    </Modal>
  );
}
