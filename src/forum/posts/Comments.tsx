import { LiquidButton } from "../motion/LiquidButton";
import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Flag,
  CornerDownRight,
  LoaderCircle,
  MessageCircle,
  MessageCircleOff,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import Avatar from "../ui/Avatar";
import { AttachmentList, AttachmentPicker } from "./Attachments";
import { RichText } from "./InlineImages";
import { QuoteButton, QuoteList, QuotePicker } from "./Quotes";
import {
  timeAgo,
  type Attachment,
  type Category,
  type Comment,
  type Quote,
  type User,
} from "../api";

const MAX_INDENT = 4;

type ReplyInput = {
  content: string;
  parent_id: string | null;
  attachments: Attachment[];
  quotes: string[];
  inline_images: boolean;
};

function ReplyEditor({
  parent,
  user,
  busy,
  categories,
  autoFocus = false,
  onSubmit,
  onCancel,
  onRequireAuth,
  onError,
}: {
  parent: Comment | null;
  user: User | null;
  busy: boolean;
  categories: Category[];
  autoFocus?: boolean;
  onSubmit: (input: ReplyInput) => Promise<void>;
  onCancel?: () => void;
  onRequireAuth: () => void;
  onError: (message: string) => void;
}) {
  const [content, setContent] = useState(""),
    [files, setFiles] = useState<Attachment[]>([]),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [inlineImages, setInlineImages] = useState(true),
    [quoting, setQuoting] = useState(false);
  const empty = content.trim().length < 2 && !files.length && !quotes.length;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return onRequireAuth();
    if (empty) return;
    try {
      await onSubmit({
        content: content.trim(),
        parent_id: parent?.id ?? null,
        attachments: files,
        quotes: quotes.map((q) => q.id),
        inline_images: inlineImages,
      });
    } catch {
      return;
    }
    setContent("");
    setFiles([]);
    setQuotes([]);
  }
  return (
    <form className={`reply-form ${parent ? "nested" : ""}`} onSubmit={submit}>
      <textarea
        aria-label={parent ? `回复 ${parent.author_name}` : "回复内容"}
        placeholder={user ? undefined : "登录后，加入这场讨论…"}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={5000}
        autoFocus={autoFocus}
        rows={parent ? 2 : undefined}
      />
      <QuoteList quotes={quotes} onRemove={(id) => setQuotes((list) => list.filter((q) => q.id !== id))} />
      <div className="reply-form-tools">
        <AttachmentPicker
          files={files}
          onChange={setFiles}
          onError={onError}
          inline={inlineImages}
          onInline={setInlineImages}
          compact={!!parent}
          toolbarExtra={
            <QuoteButton onClick={() => setQuoting(true)} count={quotes.length} />
          }
          toolbarEnd={
            <>
              {onCancel && (
                <LiquidButton type="button" className="text-button" onClick={onCancel}>
                  取消
                </LiquidButton>
              )}
              {user ? (
                <LiquidButton className="button primary" disabled={busy || empty}>
                  {busy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <>
                      发布回复
                      <ArrowUpRight size={15} />
                    </>
                  )}
                </LiquidButton>
              ) : (
                <LiquidButton type="button" className="button primary" onClick={onRequireAuth}>
                  登录后回复
                  <ArrowUpRight size={15} />
                </LiquidButton>
              )}
            </>
          }
        />
      </div>
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
    </form>
  );
}

function CommentNode({
  comment,
  depth,
  parent,
  childMap,
  descendants,
  expanded,
  toggle,
  replyTo,
  setReplyTo,
  ...shared
}: {
  comment: Comment;
  depth: number;
  parent: Comment | null;
  childMap: Map<string, Comment[]>;
  descendants: Map<string, number>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  user: User | null;
  canModerate: boolean;
  postAuthorId: string;
  closed: boolean;
  busy: string;
  categories: Category[];
  categoryName: (id: string) => string;
  onSubmit: (input: ReplyInput) => Promise<void>;
  onVote: (comment: Comment, value: number) => void;
  onDelete: (comment: Comment) => void;
  onMessage: (comment: Comment) => void;
  onReport: (comment: Comment) => void;
  onOpenPost: (id: string) => void;
  onRequireAuth: () => void;
  onError: (message: string) => void;
}) {
  const {
    user,
    canModerate,
    postAuthorId,
    closed,
    busy,
    categories,
    categoryName,
    onSubmit,
    onVote,
    onDelete,
    onMessage,
    onReport,
    onOpenPost,
    onRequireAuth,
    onError,
  } = shared;
  const replies = childMap.get(comment.id) || [];
  const open = expanded.has(comment.id);
  const flattened = depth > MAX_INDENT;
  const mine = !!user && (comment.author_id === user.id || canModerate);
  const vote = (value: number) =>
    user ? onVote(comment, comment.my_vote === value ? 0 : value) : onRequireAuth();
  return (
    <article
      className={`comment ${comment.deleted ? "is-removed" : ""}`}
      data-depth={depth}
    >
      <Avatar
        name={comment.author_name}
        initials={comment.author_initials || "—"}
        avatar={comment.author_avatar}
        userId={comment.deleted ? undefined : comment.author_id}
      />
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{comment.deleted ? "已删除的回复" : comment.author_name}</strong>
          {!comment.deleted && comment.author_id === postAuthorId && (
            <span className="comment-badge">作者</span>
          )}
          <span>{timeAgo(comment.created_at)}</span>
          {flattened && parent && !parent.deleted && (
            <span className="comment-parent">
              <CornerDownRight size={12} />回复 {parent.author_name}
            </span>
          )}
        </div>
        {comment.deleted ? (
          <p className="comment-removed">该回复已被删除，下面的讨论仍然保留。</p>
        ) : (
          <>
            {comment.content && <RichText text={comment.content} />}
            <AttachmentList files={comment.attachments} />
            <QuoteList
              quotes={comment.quotes}
              categoryName={categoryName}
              onOpen={onOpenPost}
            />
            <div className="comment-actions">
              <LiquidButton
                type="button"
                className={`comment-vote ${comment.my_vote === 1 ? "is-active" : ""}`}
                aria-pressed={comment.my_vote === 1}
                disabled={busy === comment.id + "vote"}
                onClick={() => vote(1)}
              >
                <ThumbsUp
                  size={14}
                  fill={comment.my_vote === 1 ? "currentColor" : "none"}
                />
                {comment.likes > 0 && <span>{comment.likes}</span>}
              </LiquidButton>
              <LiquidButton
                type="button"
                className={`comment-vote ${comment.my_vote === -1 ? "is-active down" : ""}`}
                aria-pressed={comment.my_vote === -1}
                aria-label="不赞同这条回复"
                disabled={busy === comment.id + "vote"}
                onClick={() => vote(-1)}
              >
                <ThumbsDown
                  size={14}
                  fill={comment.my_vote === -1 ? "currentColor" : "none"}
                />
                {comment.dislikes > 0 && <span>{comment.dislikes}</span>}
              </LiquidButton>
              {!closed && (
                <LiquidButton
                  type="button"
                  className={`comment-vote ${replyTo === comment.id ? "is-active" : ""}`}
                  onClick={() =>
                    user
                      ? setReplyTo(replyTo === comment.id ? null : comment.id)
                      : onRequireAuth()
                  }
                >
                  <MessageCircle size={14} />
                  <span>回复</span>
                </LiquidButton>
              )}
              {user && comment.author_id !== user.id && (
                <LiquidButton
                  type="button"
                  className="comment-vote"
                  onClick={() => onMessage(comment)}
                >
                  <Send size={14} />
                  <span>私信</span>
                </LiquidButton>
              )}
              {(!user || comment.author_id !== user.id) && (
                <LiquidButton
                  type="button"
                  className="comment-vote"
                  onClick={() => (user ? onReport(comment) : onRequireAuth())}
                >
                  <Flag size={14} />
                  <span>投诉</span>
                </LiquidButton>
              )}
              {mine && (
                <LiquidButton
                  type="button"
                  className="comment-vote danger-text"
                  onClick={() => onDelete(comment)}
                >
                  <Trash2 size={14} />
                  <span>删除</span>
                </LiquidButton>
              )}
            </div>
          </>
        )}
        {replyTo === comment.id && !closed && (
          <ReplyEditor
            parent={comment}
            user={user}
            busy={busy === "reply"}
            categories={categories}
            autoFocus
            onSubmit={async (input) => {
              await onSubmit(input);
              setReplyTo(null);
            }}
            onCancel={() => setReplyTo(null)}
            onRequireAuth={onRequireAuth}
            onError={onError}
          />
        )}
        {replies.length > 0 && (
          <>
            <LiquidButton
              type="button"
              className="comment-toggle"
              aria-expanded={open}
              onClick={() => toggle(comment.id)}
            >
              <ChevronDown size={14} className={open ? "flipped" : ""} />
              {open
                ? "收起回复"
                : `查看 ${descendants.get(comment.id)} 条回复`}
            </LiquidButton>
            {open && (
              <div
                className={`comment-children ${flattened ? "is-flat" : ""}`}
              >
                {replies.map((child) => (
                  <CommentNode
                    key={child.id}
                    comment={child}
                    depth={depth + 1}
                    parent={comment}
                    childMap={childMap}
                    descendants={descendants}
                    expanded={expanded}
                    toggle={toggle}
                    replyTo={replyTo}
                    setReplyTo={setReplyTo}
                    {...shared}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export default function Comments({
  comments,
  user,
  canModerate = false,
  postAuthorId,
  closed = false,
  block = null,
  busy,
  categories,
  categoryName,
  onSubmit,
  onVote,
  onDelete,
  onMessage,
  onReport,
  onOpenPost,
  onRequireAuth,
  onError,
}: {
  comments: Comment[];
  user: User | null;
  canModerate?: boolean;
  postAuthorId: string;
  closed?: boolean;
  block?: string | null;
  busy: string;
  categories: Category[];
  categoryName: (id: string) => string;
  onSubmit: (input: ReplyInput) => Promise<void>;
  onVote: (comment: Comment, value: number) => void;
  onDelete: (comment: Comment) => void;
  onMessage: (comment: Comment) => void;
  onReport: (comment: Comment) => void;
  onOpenPost: (id: string) => void;
  onRequireAuth: () => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [replyTo, setReplyTo] = useState<string | null>(null);
  const { roots, childMap, descendants } = useMemo(() => {
    const childMap = new Map<string, Comment[]>();
    const roots: Comment[] = [];
    for (const c of comments) {
      if (!c.parent_id) roots.push(c);
      else childMap.set(c.parent_id, [...(childMap.get(c.parent_id) || []), c]);
    }
    const descendants = new Map<string, number>();
    const count = (id: string): number => {
      const total = (childMap.get(id) || []).reduce(
        (sum, c) => sum + 1 + count(c.id),
        0,
      );
      descendants.set(id, total);
      return total;
    };
    comments.forEach((c) => count(c.id));
    return { roots, childMap, descendants };
  }, [comments]);
  const gate: string | null = block ?? (closed ? "作者已关闭评论" : null);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  async function submit(input: ReplyInput) {
    await onSubmit(input);
    if (input.parent_id) {
      const open = new Set<string>();
      let id: string | null = input.parent_id;
      while (id) {
        open.add(id);
        id = comments.find((c) => c.id === id)?.parent_id ?? null;
      }
      setExpanded((prev) => new Set([...prev, ...open]));
    }
  }
  return (
    <>
      {gate ? (
        <p className="comments-closed" role="status">
          <MessageCircleOff size={15} />
          {gate}
        </p>
      ) : (
        <ReplyEditor
          parent={null}
          user={user}
          busy={busy === "reply"}
          categories={categories}
          onSubmit={submit}
          onRequireAuth={onRequireAuth}
          onError={onError}
        />
      )}
      {roots.length === 0 ? (
        <p className="no-comments">
          {gate ? "这篇讨论没有留下回复。" : "这里还很安静，来留下第一条回复。"}
        </p>
      ) : (
        <div className="comment-tree">
          {roots.map((c) => (
            <CommentNode
              key={c.id}
              comment={c}
              depth={0}
              parent={null}
              childMap={childMap}
              descendants={descendants}
              expanded={expanded}
              toggle={toggle}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              user={user}
              canModerate={canModerate}
              postAuthorId={postAuthorId}
              closed={!!gate}
              busy={busy}
              categories={categories}
              categoryName={categoryName}
              onSubmit={submit}
              onVote={onVote}
              onDelete={onDelete}
              onMessage={onMessage}
              onReport={onReport}
              onOpenPost={onOpenPost}
              onRequireAuth={onRequireAuth}
              onError={onError}
            />
          ))}
        </div>
      )}
    </>
  );
}
