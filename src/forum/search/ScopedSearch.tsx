import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, LoaderCircle, MessageSquareText, RotateCcw, Search, X } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { normalizeSearchQuery } from "./search-state";
import Avatar from "../ui/Avatar";
import { api, timeAgo, type Post } from "../api";

export type PersonalScope = "mine" | "saved" | "following" | "later" | "history";
type Hit = {
  posts: Post[];
  comments: { id: string; post_id: string; post_title: string; reply: boolean; reply_to: string; snippet: string; created_at: number }[];
  people: { id: string; name: string; initials: string; avatar: string; bio: string }[];
};
const placeholders: Record<PersonalScope, string> = {
  mine: "搜索我发表的帖子、评论与回复",
  saved: "搜索收藏的帖子或作者",
  following: "搜索关注的人：昵称或用户 ID",
  later: "搜索稍后再看的帖子或作者",
  history: "搜索浏览过的帖子或用户",
};
const mark = (text: string, query: string): ReactNode => {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
};

export default function ScopedSearch({
  scope,
  renderPost,
  onOpenPost,
  onOpenProfile,
  onActive,
}: {
  scope: PersonalScope;
  renderPost: (post: Post, index: number) => ReactNode;
  onOpenPost: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onActive: (active: boolean) => void;
}) {
  const [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [hit, setHit] = useState<Hit | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(onActive);
  active.current = onActive;
  useEffect(() => {
    active.current(!!query);
  }, [query]);
  useEffect(() => () => active.current(false), []);
  useEffect(() => {
    if (!query) return setHit(null);
    let live = true;
    setLoading(true);
    setError("");
    api<Hit>(`/me/search?scope=${scope}&q=${encodeURIComponent(query)}`)
      .then((r) => live && setHit(r))
      .catch((e) => {
        if (!live) return;
        setError((e as Error).message);
        setHit(null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [scope, query, attempt]);
  const submit = () => {
    const next = normalizeSearchQuery(draft);
    if (!next) return input.current?.focus();
    setQuery(next);
    setAttempt((n) => n + 1);
  };
  const clear = () => {
    setDraft("");
    setQuery("");
    input.current?.focus();
  };
  const total = hit ? hit.posts.length + hit.comments.length + hit.people.length : 0;
  return (
    <div className="scoped-search">
      <form
        className="search-page-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Search size={20} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={draft}
          maxLength={60}
          aria-label={placeholders[scope]}
          placeholder={placeholders[scope]}
          onChange={(event) => {
            setDraft(event.target.value);
            if (!event.target.value) setQuery("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
            if (event.key === "Escape" && draft) {
              event.preventDefault();
              clear();
            }
          }}
        />
        {draft && (
          <LiquidButton type="button" className="icon-button search-page-clear" aria-label="清空搜索" onClick={clear}>
            <X size={17} />
          </LiquidButton>
        )}
        <LiquidButton className="search-page-submit" type="submit" disabled={!normalizeSearchQuery(draft)}>
          搜索
          <ArrowRight size={16} />
        </LiquidButton>
      </form>
      {query && (
        <div className="scoped-results" aria-live="polite" aria-busy={loading}>
          {error ? (
            <div className="scoped-empty is-error" role="alert">
              <strong>加载失败，请重试</strong>
              <small>{error}</small>
              <LiquidButton type="button" className="button secondary" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCcw size={14} />
                重试
              </LiquidButton>
            </div>
          ) : loading && !hit ? (
            <div className="scoped-empty">
              <LoaderCircle size={22} className="spin" />
            </div>
          ) : !total ? (
            <div className="scoped-empty">
              <strong>没有找到相关内容</strong>
            </div>
          ) : (
            <>
              {hit!.people.length > 0 && (
                <section aria-label="用户">
                  <h3>
                    用户<span>{hit!.people.length}</span>
                  </h3>
                  <div className="scoped-people">
                    {hit!.people.map((p) => (
                      <div className="scoped-person" key={p.id}>
                        <Avatar name={p.name} initials={p.initials} avatar={p.avatar} userId={p.id} />
                        <LiquidButton type="button" onClick={() => onOpenProfile(p.id)}>
                          <strong>{mark(p.name, query)}</strong>
                          <small>ID · {mark(p.name, query)}</small>
                        </LiquidButton>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {hit!.posts.length > 0 && (
                <section aria-label="帖子">
                  <h3>
                    帖子<span>{hit!.posts.length}</span>
                  </h3>
                  <div className="post-list">{hit!.posts.map((p, i) => renderPost(p, i))}</div>
                </section>
              )}
              {hit!.comments.length > 0 && (
                <section aria-label="评论与回复">
                  <h3>
                    评论与回复<span>{hit!.comments.length}</span>
                  </h3>
                  <div className="scoped-comments">
                    {hit!.comments.map((c) => (
                      <LiquidButton key={c.id} type="button" className="scoped-comment" onClick={() => onOpenPost(c.post_id)}>
                        <span>
                          <MessageSquareText size={13} />
                          {c.reply ? `回复 ${c.reply_to || "评论"}` : "评论"} · {timeAgo(c.created_at)}
                        </span>
                        <strong>{mark(c.post_title, query)}</strong>
                        <p>{mark(c.snippet, query)}</p>
                      </LiquidButton>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
