import { LiquidButton } from "../motion/LiquidButton";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Heart,
  LoaderCircle,
  MessageCircle,
  Quote as QuoteIcon,
  MessagesSquare,
  Search,
  Share2,
  X,
} from "lucide-react";
import { openShare } from "../share/share-api";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import Avatar from "../ui/Avatar";
import { RecentsPanel, useRecents } from "../search/Recents";
import {
  api,
  timeAgo,
  type Category,
  type Post,
  type Quote,
} from "../api";

export function QuoteCard({
  quote,
  categoryName,
  onOpen,
  onRemove,
  mark = "引用",
  shareable = false,
}: {
  quote: Quote;
  categoryName?: (id: string) => string;
  onOpen?: (id: string) => void;
  onRemove?: () => void;
  mark?: string;
  shareable?: boolean;
}) {
  return (
    <div className={`quote-card ${shareable ? "is-shareable" : ""}`}>
      <LiquidButton
        type="button"
        className="quote-card-open"
        onClick={() => onOpen?.(quote.id)}
        disabled={!onOpen}
      >
        <span className="quote-card-top">
          <Avatar
            name={quote.author_name}
            initials={quote.author_initials}
            avatar={quote.author_avatar}
          />
          <span className="quote-card-author">{quote.author_name}</span>
          <span className="meta-dot">·</span>
          <span>{timeAgo(quote.created_at)}</span>
          {quote.demo === 1 && <span className="sample-label">示例</span>}
          <span className="quote-card-mark">
            {mark === "引用" ? <QuoteIcon size={13} /> : <MessagesSquare size={12} />}
            {mark}
          </span>
        </span>
        <strong className="quote-card-title">
          {quote.kind === "project" && <span className="project-label">共创</span>}
          {quote.title}
        </strong>
        {quote.excerpt && <span className="quote-card-excerpt">{quote.excerpt}</span>}
        <span className="quote-card-foot">
          <span className="quote-card-board">
            {categoryName ? categoryName(quote.category) : "站内讨论"}
          </span>
          <span className="quote-card-stats">
            <Heart size={13} />
            {quote.likes}
            <MessageCircle size={13} />
            {quote.comments}
          </span>
          {onOpen && <ArrowUpRight size={14} />}
        </span>
      </LiquidButton>
      {shareable && !onRemove && (
        <LiquidButton
          type="button"
          className="icon-button quote-card-remove quote-card-share"
          aria-label={`分享讨论 ${quote.title}`}
          title="分享"
          onClick={() => openShare({ type: "post", post: quote })}
        >
          <Share2 size={14} />
        </LiquidButton>
      )}
      {onRemove && (
        <LiquidButton
          type="button"
          className="icon-button quote-card-remove"
          aria-label={`移除引用 ${quote.title}`}
          onClick={onRemove}
        >
          <X size={14} />
        </LiquidButton>
      )}
    </div>
  );
}

export function QuoteList({
  quotes,
  categoryName,
  onOpen,
  onRemove,
  mark,
}: {
  quotes: Quote[];
  categoryName?: (id: string) => string;
  onOpen?: (id: string) => void;
  onRemove?: (id: string) => void;
  mark?: string;
}) {
  if (!quotes.length) return null;
  return (
    <div className="quote-list">
      {quotes.map((q) => (
        <QuoteCard
          key={q.id}
          quote={q}
          categoryName={categoryName}
          onOpen={onOpen}
          onRemove={onRemove ? () => onRemove(q.id) : undefined}
          mark={mark}
          shareable={!onRemove && !!onOpen}
        />
      ))}
    </div>
  );
}

const asQuote = (p: Post): Quote => ({
  id: p.id,
  title: p.title,
  excerpt: p.excerpt,
  category: p.category,
  kind: p.kind,
  created_at: p.created_at,
  demo: p.demo,
  author_name: p.author_name,
  author_initials: p.author_initials,
  author_avatar: p.author_avatar,
  likes: p.likes,
  comments: p.comments,
});

export function QuotePicker({
  categories,
  chosen,
  onClose,
  onPick,
  onError,
}: {
  categories: Category[];
  chosen: Quote[];
  onClose: () => void;
  onPick: (quote: Quote) => void;
  onError?: (message: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Post[]>([]),
    [loading, setLoading] = useState(false);
  const recents = useRecents("quote");
  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name || "站内讨论";
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api("/posts?" + new URLSearchParams({ q: query, sort: "hot" }))
        .then((r) => {
          if (live)
            setResults(
              r.posts.filter((p: Post) => p.visibility === "public").slice(0, 8),
            );
        })
        .catch((e) => live && onError?.((e as Error).message))
        .finally(() => live && setLoading(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const choose = (p: Post) => {
    if (query.trim()) recents.remember(query.trim());
    onPick(asQuote(p));
  };
  return (
    <Modal title="引用站内内容" onClose={onClose} className="quote-modal">
      <h2>引用文章</h2>
      <div className="search-input-wrap" role="search">
        <Search size={20} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题、正文或标签…"
          aria-label="搜索可引用的内容"
          maxLength={120}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.nativeEvent.isComposing) return;
            if (query.trim()) recents.remember(query.trim());
          }}
        />
        {query && (
          <LiquidButton
            type="button"
            className="icon-button"
            aria-label="清空搜索"
            onClick={() => setQuery("")}
          >
            <X size={15} />
          </LiquidButton>
        )}
      </div>
      <RecentsPanel
        scope="quote"
        title="最近搜索"
        items={recents.items}
        onItems={recents.setItems}
        onPick={(item) => setQuery(item.value)}
        onError={onError}
      />
      <div className="quote-results">
        {loading && !results.length ? (
          <div className="small-loading">
            <LoaderCircle className="spin" size={20} />
          </div>
        ) : !results.length ? (
          <p className="search-empty">没有找到可引用的讨论，换个关键词试试。</p>
        ) : (
          results.map((p) => {
            const picked = chosen.some((q) => q.id === p.id);
            return (
              <LiquidButton
                key={p.id}
                type="button"
                className={`quote-result ${picked ? "is-picked" : ""}`}
                disabled={picked}
                onClick={() => choose(p)}
              >
                <span>
                  <strong>{p.title}</strong>
                  <small>
                    {categoryName(p.category)} · {p.author_name} ·{" "}
                    {timeAgo(p.created_at)}
                  </small>
                </span>
                {picked ? <span className="quote-picked">已引用</span> : <QuoteIcon size={16} />}
              </LiquidButton>
            );
          })
        )}
      </div>
      {chosen.length > 0 && (
        <div className="quote-chosen">
          <span>已选 {chosen.length} 篇</span>
          <LiquidButton type="button" className="button primary compact" onClick={onClose}>
            完成
          </LiquidButton>
        </div>
      )}
    </Modal>
  );
}

export function QuoteButton({
  onClick,
  count,
  disabled = false,
}: {
  onClick: () => void;
  count: number;
  disabled?: boolean;
}) {
  return (
    <LiquidButton
      type="button"
      className="text-button"
      onClick={onClick}
      disabled={disabled}
      title="引用站内内容"
      aria-label={count > 0 ? `引用 ${count}` : "引用"}
    >
      <QuoteIcon size={16} />
      <span className="tool-label">{count > 0 ? `引用 ${count}` : "引用"}</span>
    </LiquidButton>
  );
}
