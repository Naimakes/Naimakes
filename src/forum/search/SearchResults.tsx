import { LiquidButton } from "../motion/LiquidButton";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCheck, ChevronDown, Hash, LoaderCircle, Search, Sparkles, X } from "lucide-react";
import { normalizeSearchQuery, searchSorts } from "./search-state";
import Avatar from "../ui/Avatar";
import { GlassSegments } from "../ui/GlassSegments";
import type { Category, MemberHit, Post } from "../api";
import "./search-results.css";

type Props = {
  query: string;
  keyword: boolean;
  exactTotal: number;
  relatedTotal: number;
  category: string;
  sort: string;
  categories: Category[];
  posts: Post[];
  total: number;
  loading: boolean;
  error: string;
  hasMore: boolean;
  onSearch: (query: string) => void;
  onFilter: (category: string, sort: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onMore: () => void;
  renderPost: (post: Post, index: number) => ReactNode;
  members: MemberHit[];
  onOpenMember: (id: string) => void;
};

export default function SearchResults(props: Props) {
  const { query, keyword, exactTotal, relatedTotal, category, sort, categories, posts, total, loading, error, hasMore, members } = props;
  const exactPosts = posts.filter((p) => p.match !== "related");
  const relatedPosts = posts.filter((p) => p.match === "related");
  const [draft, setDraft] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(query), [query]);
  const tabs = [{ id: "all", name: "综合" }, ...categories];
  const filtered = category !== "all" || sort === "unanswered";

  return (
    <section className="search-page" id="discussions" aria-label="搜索结果" tabIndex={-1}>
      <div className="search-page-top">
        <LiquidButton className="text-button" onClick={props.onBack}><ArrowLeft size={16} />返回发现</LiquidButton>
        <h1>搜索社区</h1>
      </div>
      <form className="search-page-form" role="search" onSubmit={(event) => {
        event.preventDefault();
        if (normalizeSearchQuery(draft)) props.onSearch(draft);
        else input.current?.focus();
      }}>
        <Search size={24} aria-hidden="true" />
        <input ref={input} type="search" value={draft} maxLength={120} aria-label="搜索关键词" placeholder="搜索话题、想法、关键词…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
        }} />
        {draft && <LiquidButton type="button" className="icon-button search-page-clear" aria-label="清空搜索输入" onClick={() => { setDraft(""); input.current?.focus(); }}><X size={18} /></LiquidButton>}
        <LiquidButton className="search-page-submit" type="submit" disabled={!normalizeSearchQuery(draft)}>搜索<ArrowRight size={17} /></LiquidButton>
      </form>
      <div className="search-page-tabs">
        <GlassSegments className="search-segs" label="搜索版块" value={category} onChange={(id) => props.onFilter(id, sort)} items={tabs.map((tab) => ({ id: tab.id, label: tab.name }))} />
      </div>
      <div className="search-page-toolbar">
        <div className="search-page-sorts">
          <GlassSegments className="search-segs is-compact" label="搜索结果排序" value={sort} onChange={(id) => props.onFilter(category, id)} items={searchSorts.map((option) => ({ id: option.id, label: option.label }))} />
        </div>
      </div>
      <div className="search-page-summary" role="status" aria-live="polite">
        <p>{query ? <>{keyword ? <>关键词 <span className="search-keyword-chip"><Hash size={13} aria-hidden="true" />{query}</span></> : <>「<strong>{query}</strong>」的搜索结果</>} <span>· {loading && !posts.length ? "搜索中…" : error ? "暂时无法获取" : `${exactTotal} 篇完全符合 · ${relatedTotal} 篇相近`}</span></> : "从一个关键词，找到感兴趣的讨论。"}</p>
        {filtered && <LiquidButton className="text-button" onClick={() => props.onFilter("all", "hot")}><X size={14} />重置筛选</LiquidButton>}
      </div>
      {query && members.length > 0 && category === "all" && (
        <section className="search-people" aria-label="相关成员">
          <h2>相关成员</h2>
          <div className="search-people-row">
            {members.map((m) => (
              <div className="search-person" key={m.id}>
                <Avatar name={m.name} initials={m.initials} avatar={m.avatar} userId={m.id} />
                <LiquidButton type="button" onClick={() => props.onOpenMember(m.id)}>
                  <strong>{m.name}</strong>
                  <small>{m.bio || "这位成员还没有留下简介。"}</small>
                </LiquidButton>
                <span>{m.stats.followers} 粉丝</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="search-page-results" aria-busy={loading}>
        {error ? <div className="empty-state"><Search size={38} strokeWidth={1.2} /><h2>搜索暂时不可用</h2><p>{error}</p><LiquidButton className="button primary" onClick={props.onRetry}>重新搜索<ArrowRight size={16} /></LiquidButton></div>
          : loading && !posts.length ? <div className="feed-skeleton" aria-label="正在搜索讨论">{[1, 2, 3].map((id) => <div key={id}><span /><b /><p /></div>)}</div>
          : !query || !posts.length ? <div className="empty-state"><Search size={42} strokeWidth={1.1} /><h2>{!query ? "你对什么感到好奇？" : "还没有找到相关讨论"}</h2><p>{!query ? "输入关键词并按回车，开始探索社区。" : filtered ? "试试其他版块，或重置筛选查看全部结果。" : "换一个更简短的关键词，或试试下面的探索方向。"}</p>
            <div className="search-page-suggestions">{filtered ? <LiquidButton className="button secondary" onClick={() => props.onFilter("all", "hot")}>查看全部结果<ArrowRight size={16} /></LiquidButton> : categories.slice(0, 4).map((item) => <LiquidButton key={item.id} onClick={() => props.onSearch(item.name)}>{item.name}<ArrowRight size={14} /></LiquidButton>)}</div>
          </div>
          : <>
            <div className="search-section-label">
              <CheckCheck size={15} aria-hidden="true" />
              <strong>完全符合</strong>
              <span>{keyword ? `设置了关键词「${query}」的讨论` : `包含「${query}」的讨论`} · {exactTotal} 篇</span>
            </div>
            {exactPosts.length > 0
              ? <div className="post-list">{exactPosts.map((p, i) => props.renderPost(p, i))}</div>
              : exactTotal === 0 && <p className="search-section-empty">没有完全符合的讨论，下面是与它相近的内容。</p>}
            {relatedPosts.length > 0 && <>
              <div className="search-divider" role="separator" aria-label={`以下为相近内容，共 ${relatedTotal} 篇，按符合程度排序`}>
                <span><Sparkles size={13} aria-hidden="true" />相近内容 · {relatedTotal} 篇 · 越符合越靠前</span>
              </div>
              <div className="post-list">{relatedPosts.map((p, i) => props.renderPost(p, exactPosts.length + i))}</div>
            </>}
          </>}
      </div>
      {!error && hasMore && <LiquidButton className="load-more" onClick={props.onMore} disabled={loading}>{loading ? <><LoaderCircle size={16} className="spin" />正在加载</> : <>加载更多结果<ChevronDown size={16} /></>}</LiquidButton>}
      {!error && !loading && posts.length > 0 && !hasMore && <p className="search-page-end">已显示全部 {total} 篇相关讨论</p>}
    </section>
  );
}
