import { GlassSelect } from "../ui/GlassSelect";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";
import { GlassSegments } from "../ui/GlassSegments";
import { LiquidButton } from "../motion/LiquidButton";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bookmark,
  Folder,
  FolderPlus,
  Plus,
  ChevronDown,
  Clock3,
  Radio,
  Search,
  Globe2,
  LockKeyhole,
  PenLine,
  Share2,
  Trash2,
  List,
  LoaderCircle,
  Check,
  SlidersHorizontal,
  ArrowUpRight,
  X,
} from "lucide-react";
import {
  api,
  timeAgo,
  type Category,
  type Collection,
  type Post,
  type TopicTrack,
  type User,
} from "../api";
import GlassDateTime from "../ui/GlassDateTime";
import { CollectionForm, TrackForm } from "./LibraryForms";
import { openShare } from "../share/share-api";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import ContextMenu, { useContextMenu } from "../ui/ContextMenu";

type Selection =
  { kind: "folder" | "track"; id: string } | { kind: "later" | "tracks" };
type Result = { posts: Post[]; total: number; hasMore: boolean };
const todayKey = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
export default function Library({
  user,
  categories,
  version,
  startLater,
  publicId,
  renderPost,
  onLogin,
  onDiscover,
  onChange,
  notify,
  focusTopic = null,
}: {
  user: User | null;
  categories: Category[];
  version: number;
  startLater: boolean;
  publicId?: string;
  renderPost: (p: Post, index: number) => ReactNode;
  onLogin: () => void;
  onDiscover: () => void;
  onChange: () => void;
  notify: (message: string) => void;
  focusTopic?: { kind: string; value: string; nonce: number } | null;
}) {
  const [folders, setFolders] = useState<Collection[]>([]),
    [tracks, setTracks] = useState<TopicTrack[]>([]);
  const [sharedFolder, setSharedFolder] = useState<Collection | null>(null);
  const [later, setLater] = useState({ total: 0, completed: 0 });
  const [selection, setSelection] = useState<Selection>(
    startLater
      ? { kind: "later" }
      : publicId
        ? { kind: "folder", id: publicId }
        : { kind: "tracks" },
  );
  const [initialized, setInitialized] = useState(startLater || !!publicId || !!focusTopic);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<Result>({
    posts: [],
    total: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(false),
    [pageError, setPageError] = useState("");
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("recent");
  const [progress, setProgress] = useState("all"),
    [date, setDate] = useState("all"),
    [duration, setDuration] = useState("all");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filters, setFilters] = useState(false);
  const [collapseRead, setCollapseRead] = useState(true);
  const [batch, setBatch] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState("");
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<Collection | undefined>(),
    [tracking, setTracking] = useState(false);
  const [confirm, setConfirm] = useState<
      "folder" | "clear" | "remove" | "empty" | "one" | null
    >(null),
    [single, setSingle] = useState<Post | null>(null),
    [busy, setBusy] = useState(false);
  const itemMenu = useContextMenu<Post>();
  const [refresh, setRefresh] = useState(0);
  const requestSequence = useRef(0);
  const sharedId =
    selection.kind === "folder" && selection.id === publicId
      ? publicId
      : undefined;
  const folder =
    selection.kind === "folder"
      ? folders.find((f) => f.id === selection.id) ||
        (sharedFolder?.id === selection.id ? sharedFolder : null)
      : null;
  const track =
    selection.kind === "track"
      ? tracks.find((t) => t.id === selection.id)
      : null;
  const isLater = selection.kind === "later",
    isTracks = selection.kind === "tracks";
  const ownFolder = !!folder && folder.user_id === user?.id;
  const trackName = (t: TopicTrack) =>
    t.kind === "category"
      ? categories.find((c) => c.id === t.value)?.name || t.value
      : t.value;
  const changeSelection = (next: Selection) => {
    requestSequence.current++;
    setSelection(next);
    setInitialized(true);
    setSearch("");
    setSort("recent");
    setResult({ posts: [], total: 0, hasMore: false });
    setSelected([]);
    setBatch(false);
    setTarget("");
    setPageError("");
  };
  useEffect(() => {
    let live = true;
    setError("");
    Promise.all([
      user
        ? api("/collections")
        : Promise.resolve({
            collections: [],
            later: { total: 0, completed: 0 },
          }),
      user ? api("/topic-tracks") : Promise.resolve({ tracks: [] }),
      sharedId
        ? api("/collections/" + encodeURIComponent(sharedId))
        : Promise.resolve(null),
    ])
      .then(([r, t, shared]) => {
        if (!live) return;
        setFolders(r.collections);
        setLater(r.later);
        setTracks(t.tracks);
        setSharedFolder(shared?.collection || null);
        if (!initialized && r.collections.length) {
          setSelection({ kind: "folder", id: r.collections[0].id });
          setInitialized(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [user?.id, version, refresh, sharedId, initialized]);

  const focusedNonce = useRef(0);
  useEffect(() => {
    if (!focusTopic || !ready || focusedNonce.current === focusTopic.nonce) return;
    focusedNonce.current = focusTopic.nonce;
    const match = tracks.find((t) => t.kind === focusTopic.kind && t.value === focusTopic.value);
    changeSelection(match ? { kind: "track", id: match.id } : { kind: "tracks" });
  }, [focusTopic?.nonce, ready, tracks]);

  const query = new URLSearchParams({ q: search, sort, progress, duration });
  if (isLater) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date === "today") query.set("from", String(today.getTime()));
    if (date === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      query.set("from", String(yesterday.getTime()));
      query.set("to", String(today.getTime()));
    }
    if (date === "week") {
      const week = new Date(today);
      week.setDate(week.getDate() - 6);
      query.set("from", String(week.getTime()));
    }
    if (date === "custom") {
      if (from)
        query.set("from", String(new Date(from + "T00:00:00").getTime()));
      if (to) {
        const end = new Date(to + "T00:00:00");
        end.setDate(end.getDate() + 1);
        query.set("to", String(end.getTime()));
      }
    }
  }
  const queryString = query.toString();
  const endpoint =
    selection.kind === "folder"
      ? "/collections/" + encodeURIComponent(selection.id) + "/posts"
      : selection.kind === "track"
        ? "/topic-tracks/" + encodeURIComponent(selection.id) + "/posts"
        : isLater
          ? "/read-later"
          : "";
  const reload = () => {
    setRefresh((v) => v + 1);
    setSelected([]);
    onChange();
  };
  const loadMore = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setPageError("");
    try {
      const r = await api<Result>(
        endpoint + "?" + queryString + "&offset=" + result.posts.length,
      );
      if (sequence === requestSequence.current)
        setResult((prev) => ({ ...r, posts: [...prev.posts, ...r.posts] }));
    } catch (e) {
      if (sequence === requestSequence.current)
        setPageError((e as Error).message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [endpoint, queryString, result.posts.length]);
  useEffect(() => {
    if (!endpoint || (!user && !publicId)) return;
    requestSequence.current++;
    let live = true;
    setLoading(true);
    setPageError("");
    setSelected([]);
    const timer = setTimeout(() => {
      if (date === "custom" && from && to && from > to && isLater) {
        setPageError("结束日期不能早于开始日期。");
        setLoading(false);
        return;
      }
      api<Result>(endpoint + "?" + queryString)
        .then((r) => {
          if (live) setResult(r);
        })
        .catch((e) => {
          if (live) {
            setPageError(e.message);
            setResult({ posts: [], total: 0, hasMore: false });
          }
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 180);
    return () => {
      live = false;
      requestSequence.current++;
      clearTimeout(timer);
    };
  }, [
    endpoint,
    queryString,
    user?.id,
    publicId,
    version,
    refresh,
    date,
    from,
    to,
    isLater,
  ]);
  useEffect(() => {
    if (selection.kind !== "track" && selection.kind !== "tracks") return;
    const update = () => setRefresh((v) => v + 1);
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [selection.kind]);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      setConfirm(null);
      reload();
      notify(message);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const manageLater = (action: string, ids = selected) =>
    run(
      () =>
        api("/read-later", {
          method: "PATCH",
          body: JSON.stringify({ action, ids }),
        }),
      action === "read"
        ? "已标记为已读"
        : action === "unread"
          ? "已标记为未读"
          : "已从稍后再看移除",
    );
  const manageFolder = (targetId?: string, ids = selected) =>
    folder &&
    run(
      () =>
        api("/collections/" + folder.id + "/items", {
          method: "PATCH",
          body: JSON.stringify({ ids, target_id: targetId }),
        }),
      targetId ? "已移动到所选收藏夹" : "已从收藏夹移除",
    );
  const emptyList = () => manageLater("clear_all", []);
  const removeOne = (p: Post) =>
    isLater ? manageLater("remove", [p.id]) : manageFolder(undefined, [p.id]);
  const shareFolder = () =>
    folder && openShare({ type: "collection", collection: { ...folder, owner_name: folder.owner_name || user?.name } });
  const resetFilters = () => {
    setSearch("");
    setProgress("all");
    setDate("all");
    setDuration("all");
    setFrom("");
    setTo("");
  };
  const hasFilters =
    !!search ||
    (isLater && (progress !== "all" || date !== "all" || duration !== "all"));
  const filterButtons = (
    items: string[][],
    active: string,
    set: (v: string) => void,
    label: string,
  ) => (
    <GlassSegments<string>
      className="library-segs"
      label={label}
      value={active}
      onChange={set}
      items={items.map(([id, text]) => ({ id, label: text }))}
    />
  );
  const renderLibraryItem = (p: Post, i: number) => (
    <div
      className={`library-post-wrap ${selected.includes(p.id) ? "checked" : ""}`}
      key={p.id}
      onContextMenu={(e) => (isLater || ownFolder) && itemMenu.open(e, p)}
    >
      {batch && (
        <label className="library-post-checkbox">
          <input
            type="checkbox"
            aria-label={"选择文章：" + p.title}
            checked={selected.includes(p.id)}
            onChange={() =>
              setSelected((prev) =>
                prev.includes(p.id)
                  ? prev.filter((id) => id !== p.id)
                  : [...prev, p.id],
              )
            }
          />
          <span>选择文章</span>
        </label>
      )}
      {renderPost(p, i)}
      {isLater && (
        <div className="later-item-meta">
          <span>
            {p.completed_at ? <Check size={14} /> : <Clock3 size={14} />}
            {p.completed_at ? "已读" : "未读"}
            <span>·</span>约 {p.reading_minutes} 分钟
            <span>·</span>
            {p.later_added_at ? timeAgo(p.later_added_at) + "添加" : ""}
          </span>
          <LiquidButton
            className="text-button"
            disabled={busy}
            onClick={() =>
              manageLater(p.completed_at ? "unread" : "read", [p.id])
            }
          >
            {p.completed_at ? "标为未读" : "标为已读"}
          </LiquidButton>
        </div>
      )}
    </div>
  );

  if (!user && !publicId)
    return (
      <div className="empty-state library-login">
        <Bookmark size={36} strokeWidth={1} />
        <h3>把值得再读的想法，收进自己的空间。</h3>
        <p>登录后即可创建收藏夹、跟踪话题和保存稍后再看。</p>
        <LiquidButton className="button primary" onClick={onLogin}>
          登录社区
          <ArrowUpRight size={16} />
        </LiquidButton>
      </div>
    );
  return (
    <div className={`library-layout ${!user || startLater ? "library-shared" : ""}`}>
      {user && !startLater && (
        <aside className="library-sidebar" aria-label="收藏中心导航">
          <AnimatedDisclosure
            summary="我创建的收藏夹"
            defaultOpen
            className="library-folders-card"
          >
            <LiquidButton
              className="library-nav-create"
              onClick={() => setCreating(true)}
            >
              <FolderPlus size={18} />
              新建收藏夹
              <Plus size={15} />
            </LiquidButton>
            {folders.map((f) => (
              <LiquidButton
                key={f.id}
                className={`library-nav-item ${selection.kind === "folder" && selection.id === f.id ? "active" : ""}`}
                onClick={() => changeSelection({ kind: "folder", id: f.id })}
                aria-current={
                  selection.kind === "folder" && selection.id === f.id
                    ? "page"
                    : undefined
                }
              >
                <Folder size={17} />
                <span>{f.name}</span>
                <small>{f.count}</small>
              </LiquidButton>
            ))}
          </AnimatedDisclosure>
          <AnimatedDisclosure
            summary="我跟踪的话题"
            defaultOpen
            className="library-tracks-card"
          >
            <LiquidButton
              className={`library-nav-item ${isTracks ? "active" : ""}`}
              onClick={() => changeSelection({ kind: "tracks" })}
            >
              <Radio size={17} />
              <span>全部跟踪</span>
              <small>{tracks.length}</small>
            </LiquidButton>
            {tracks.map((t) => (
              <LiquidButton
                key={t.id}
                className={`library-nav-item ${selection.kind === "track" && selection.id === t.id ? "active" : ""}`}
                onClick={() => changeSelection({ kind: "track", id: t.id })}
              >
                <span className="track-hash">#</span>
                <span>{trackName(t)}</span>
                <small>{t.count}</small>
              </LiquidButton>
            ))}
            <LiquidButton
              className="library-nav-create"
              onClick={() => setTracking(true)}
            >
              <Plus size={17} />
              跟踪新话题
            </LiquidButton>
          </AnimatedDisclosure>
          <p className="library-sidebar-note">
            {folders.length} 个收藏夹 · {tracks.length} 个跟踪话题
          </p>
        </aside>
      )}
      <div className="library-content">
        {error ? (
          <div className="empty-state">
            <h3>暂时无法打开收藏</h3>
            <p role="alert">{error}</p>
            <LiquidButton
              className="button secondary"
              onClick={() => setRefresh((v) => v + 1)}
            >
              重试
            </LiquidButton>
          </div>
        ) : !ready ? (
          <div className="library-loading">
            <LoaderCircle className="spin" />
            正在加载收藏中心
          </div>
        ) : (
          <>
            {folder && (
              <div className="collection-header">
                <div
                  className={`collection-cover ${folder.cover ? "has-cover" : ""}`}
                >
                  {folder.cover ? (
                    <img src={folder.cover} alt={folder.name + "封面"} />
                  ) : (
                    <Folder size={48} strokeWidth={1} />
                  )}
                </div>
                <div className="collection-intro">
                  <span className="library-eyebrow">COLLECTION</span>
                  <h2>{folder.name}</h2>
                  <div className="collection-meta">
                    {folder.is_public ? (
                      <Globe2 size={14} />
                    ) : (
                      <LockKeyhole size={14} />
                    )}
                    <span>{folder.is_public ? "公开" : "私密"}</span>
                    <span>·</span>
                    <span>{folder.count} 篇文章</span>
                    <span>·</span>
                    <span>{folder.owner_name || user?.name}</span>
                  </div>
                  <p>{folder.description || "收藏那些值得反复阅读的想法。"}</p>
                  <div className="collection-header-actions">
                    {ownFolder && (
                      <LiquidButton
                        className="icon-button"
                        aria-label="编辑收藏夹"
                        title="编辑收藏夹"
                        onClick={() => setEditing(folder)}
                      >
                        <PenLine size={16} />
                      </LiquidButton>
                    )}
                    {(!!folder.is_public || ownFolder) && (
                      <LiquidButton className="icon-button collection-share" aria-label="分享收藏夹" title="分享收藏夹" onClick={shareFolder}>
                        <Share2 size={16} />
                      </LiquidButton>
                    )}
                    {ownFolder && !folder.is_default && (
                      <LiquidButton
                        className="icon-button"
                        aria-label="删除收藏夹"
                        title="删除收藏夹"
                        onClick={() => setConfirm("folder")}
                      >
                        <Trash2 size={16} />
                      </LiquidButton>
                    )}
                  </div>
                </div>
              </div>
            )}
            {isLater && (
              <div className="library-section-heading is-later">
                <div>
                  <span className="library-eyebrow">READ IT LATER</span>
                  <h2>
                    <Clock3 size={27} />
                    稍后再看 <span>{later.total}</span>
                  </h2>
                </div>
              </div>
            )}
            {(isTracks || track) && (
              <div className="library-section-heading">
                <div>
                  <span className="library-eyebrow">FOLLOW YOUR CURIOSITY</span>
                  <h2>
                    <Radio size={27} />
                    {track ? trackName(track) : "我跟踪的话题"}{" "}
                    <span>{track ? result.total : tracks.length}</span>
                  </h2>
                  <p>
                    {track
                      ? "与话题相关的新文章，会持续汇集在这里。"
                      : "把感兴趣的方向连成线，持续发现新的讨论。"}
                  </p>
                </div>
                <LiquidButton
                  className="button secondary compact"
                  onClick={() => setTracking(true)}
                >
                  <Plus size={16} />
                  跟踪话题
                </LiquidButton>
              </div>
            )}
            {track && (
              <div className="track-context">
                <span>
                  {track.kind === "keyword"
                    ? "关键词匹配标题、正文和标签"
                    : "跟踪版块中的全部讨论"}
                </span>
                <LiquidButton
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("/topic-tracks/" + track.id, {
                        method: "DELETE",
                      });
                      changeSelection({ kind: "tracks" });
                    }, "已停止跟踪话题")
                  }
                >
                  <X size={14} />
                  停止跟踪
                </LiquidButton>
              </div>
            )}
            {isTracks ? (
              <div className="tracked-topics-grid">
                {tracks.map((t) => (
                  <LiquidButton
                    className="tracked-topic-card"
                    key={t.id}
                    onClick={() => changeSelection({ kind: "track", id: t.id })}
                  >
                    <div>
                      <span className="tracked-topic-icon">
                        <Radio size={22} />
                      </span>
                      <ArrowUpRight size={18} />
                    </div>
                    <h3>{trackName(t)}</h3>
                    <p>{t.count} 篇相关讨论</p>
                    <small>
                      {t.latest_at
                        ? "最近发布 · " + timeAgo(t.latest_at)
                        : "有新内容时将出现在这里"}
                    </small>
                  </LiquidButton>
                ))}
                <LiquidButton
                  className="tracked-topic-card add-track-card"
                  onClick={() => setTracking(true)}
                >
                  <Plus size={28} />
                  <h3>跟踪一个新话题</h3>
                  <p>从一个关键词开始</p>
                </LiquidButton>
              </div>
            ) : (
              <>
                <div className="library-toolbar">
                  <div className="library-sort">
                    <label className="sr-only" htmlFor="library-sort">
                      排序方式
                    </label>
                    <GlassSelect
                      id="library-sort"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      {isLater ? (
                        <>
                          <option value="recent">最近添加</option>
                          <option value="oldest">最早添加</option>
                          <option value="duration">阅读时间最短</option>
                        </>
                      ) : track ? (
                        <option value="recent">最新文章</option>
                      ) : (
                        <>
                          <option value="recent">最近收藏</option>
                          <option value="published">最新发布</option>
                          <option value="popular">最多赞同</option>
                        </>
                      )}
                    </GlassSelect>
                  </div>
                  <div className="library-search">
                    <Search size={17} />
                    <input
                      aria-label={isLater ? "搜索稍后再看" : "搜索收藏内容"}
                      placeholder={
                        isLater ? "搜索稍后再看" : "搜索标题、内容或作者"
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <LiquidButton
                        className="icon-button"
                        aria-label="清除搜索"
                        onClick={() => setSearch("")}
                      >
                        <X size={14} />
                      </LiquidButton>
                    )}
                  </div>
                  {(isLater || ownFolder) && (
                    <LiquidButton
                      className={`button secondary compact glass-btn ${batch ? "selected" : ""}`}
                      onClick={() => {
                        setBatch(!batch);
                        setSelected([]);
                      }}
                    >
                      <List size={16} />
                      {batch ? "退出管理" : "批量管理"}
                    </LiquidButton>
                  )}
                </div>
                {isLater && (
                  <div className="later-filters">
                    <div className="library-filter-row">
                      {filterButtons(
                        [
                          ["all", "全部进度"],
                          ["unread", "未读"],
                          ["read", "已读"],
                        ],
                        progress,
                        setProgress,
                        "阅读进度",
                      )}
                      <LiquidButton
                        className={`more-filters ${filters ? "active" : ""}`}
                        aria-expanded={filters}
                        onClick={() => setFilters(!filters)}
                      >
                        <SlidersHorizontal size={14} />
                        更多筛选
                        <ChevronDown size={14} />
                      </LiquidButton>
                      <div className="clear-read-group">
                      <LiquidButton
                        className="clear-read"
                        disabled={!later.completed || busy}
                        onClick={() => setConfirm("clear")}
                      >
                        <Trash2 size={14} />
                        清除已读
                      </LiquidButton>
                      <LiquidButton
                        className="clear-read"
                        disabled={!later.total || busy}
                        onClick={() => setConfirm("empty")}
                      >
                        <Trash2 size={14} />
                        一键清空
                      </LiquidButton>
                      </div>
                    </div>
                    {filters && (
                      <>
                        <div className="library-filter-row">
                          {filterButtons(
                            [
                              ["all", "全部添加"],
                              ["today", "今天"],
                              ["yesterday", "昨天"],
                              ["week", "近一周"],
                              ["custom", "自定义日期"],
                            ],
                            date,
                            setDate,
                            "添加时间",
                          )}
                        </div>
                        {date === "custom" && (
                          <div className="library-date-range">
                            <div className="library-date-field">
                              <span>开始日期</span>
                              <GlassDateTime
                                label="开始日期"
                                granularity="date"
                                value={from}
                                max={to || todayKey()}
                                onChange={setFrom}
                              />
                            </div>
                            <span aria-hidden="true">至</span>
                            <div className="library-date-field">
                              <span>结束日期</span>
                              <GlassDateTime
                                label="结束日期"
                                granularity="date"
                                value={to}
                                min={from || undefined}
                                max={todayKey()}
                                onChange={setTo}
                              />
                            </div>
                          </div>
                        )}
                        <div className="library-filter-row">
                          {filterButtons(
                            [
                              ["all", "全部阅读时长"],
                              ["short", "10 分钟以内"],
                              ["medium", "10–30 分钟"],
                              ["long", "30–60 分钟"],
                              ["extended", "60 分钟以上"],
                            ],
                            duration,
                            setDuration,
                            "阅读时长",
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {batch && (
                  <div className="library-batch-bar">
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          result.posts.length > 0 &&
                          selected.length === result.posts.length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? result.posts.map((p) => p.id)
                              : [],
                          )
                        }
                      />
                      全选当前列表 <span>已选 {selected.length}</span>
                    </label>
                    {isLater ? (
                      <>
                        <LiquidButton
                          className="text-button"
                          disabled={!selected.length || busy}
                          onClick={() => manageLater("read")}
                        >
                          <Check size={14} />
                          标为已读
                        </LiquidButton>
                        <LiquidButton
                          className="text-button"
                          disabled={!selected.length || busy}
                          onClick={() => manageLater("unread")}
                        >
                          标为未读
                        </LiquidButton>
                      </>
                    ) : (
                      <>
                        <GlassSelect
                          aria-label="移动到收藏夹"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="">移动到收藏夹</option>
                          {folders
                            .filter((f) => f.id !== folder?.id)
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                        </GlassSelect>
                        <LiquidButton
                          className="text-button"
                          disabled={!target || !selected.length || busy}
                          onClick={() => manageFolder(target)}
                        >
                          移动
                        </LiquidButton>
                      </>
                    )}
                    <LiquidButton
                      className="text-button danger"
                      disabled={!selected.length || busy}
                      onClick={() => setConfirm("remove")}
                    >
                      <Trash2 size={14} />
                      移除
                    </LiquidButton>
                  </div>
                )}
                {hasFilters && (
                  <div className="library-results-caption">
                    <span>找到 {result.total} 篇文章</span>
                    <LiquidButton className="text-button" onClick={resetFilters}>
                      重置筛选
                      <X size={13} />
                    </LiquidButton>
                  </div>
                )}
                {pageError ? (
                  <div className="empty-state">
                    <h3>暂时无法加载内容</h3>
                    <p role="alert">{pageError}</p>
                    <LiquidButton
                      className="button secondary"
                      onClick={() => setRefresh((v) => v + 1)}
                    >
                      重试
                    </LiquidButton>
                  </div>
                ) : loading && !result.posts.length ? (
                  <div className="library-loading">
                    <LoaderCircle className="spin" />
                    正在加载文章
                  </div>
                ) : !result.posts.length ? (
                  <div className="empty-state library-empty">
                    {isLater ? (
                      <Clock3 size={45} strokeWidth={1} />
                    ) : track ? (
                      <Radio size={45} strokeWidth={1} />
                    ) : (
                      <Folder size={45} strokeWidth={1} />
                    )}
                    <h3>
                      {hasFilters
                        ? "没有符合筛选的文章"
                        : isLater
                          ? "好文章，留给有空的时候。"
                          : track
                            ? "等待下一篇相关讨论。"
                            : "留住值得再读的想法。"}
                    </h3>
                    <p>
                      {hasFilters
                        ? "换个关键词，或试试其他筛选条件。"
                        : isLater
                          ? "点击文章底部的「稍后再看」，就能在这里接着读。"
                          : track
                            ? "匹配这个话题的新文章会自动汇集到这里。"
                            : "点击文章的收藏按钮，选择这个收藏夹即可收纳。"}
                    </p>
                    <LiquidButton
                      className="button secondary"
                      onClick={hasFilters ? resetFilters : onDiscover}
                    >
                      {hasFilters ? "重置筛选" : "发现讨论"}
                      <ArrowUpRight size={15} />
                    </LiquidButton>
                  </div>
                ) : isLater ? (
                  (() => {
                    const readPosts = result.posts.filter(
                      (p) => p.completed_at,
                    );
                    const unreadPosts = result.posts.filter(
                      (p) => !p.completed_at,
                    );
                    return (
                      <div
                        className="library-posts"
                        aria-busy={loading}
                      >
                        {readPosts.length > 0 && (
                          <div className="later-read-group">
                            <LiquidButton
                              type="button"
                              className="later-read-toggle"
                              aria-expanded={!collapseRead}
                              onClick={() => setCollapseRead((v) => !v)}
                            >
                              <ChevronDown
                                size={14}
                                className={
                                  collapseRead ? "" : "later-read-toggle-open"
                                }
                              />
                              已读 {readPosts.length} 篇
                            </LiquidButton>
                            {!collapseRead && (
                              <div className="later-read-list">
                                {readPosts.map((p, i) =>
                                  renderLibraryItem(p, i),
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {readPosts.length > 0 && unreadPosts.length > 0 && (
                          <div className="later-read-divider" role="separator" />
                        )}
                        {unreadPosts.map((p, i) => renderLibraryItem(p, i))}
                      </div>
                    );
                  })()
                ) : (
                  <div
                    className="library-posts"
                    aria-busy={loading}
                  >
                    {result.posts.map((p, i) => renderLibraryItem(p, i))}
                  </div>
                )}
                {result.hasMore && (
                  <LiquidButton
                    className="load-more"
                    disabled={loading}
                    onClick={loadMore}
                  >
                    {loading ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      "加载更多文章"
                    )}
                    <ChevronDown size={15} />
                  </LiquidButton>
                )}
              </>
            )}
          </>
        )}
      </div>
      {(creating || editing) && (
        <CollectionForm
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(undefined);
          }}
          onSaved={(f) => {
            setCreating(false);
            setEditing(undefined);
            changeSelection({ kind: "folder", id: f.id });
            reload();
            notify(editing ? "收藏夹已更新" : "收藏夹已创建");
          }}
        />
      )}
      {tracking && (
        <TrackForm
          categories={categories}
          onClose={() => setTracking(false)}
          onSaved={(t) => {
            setTracking(false);
            changeSelection({ kind: "track", id: t.id });
            reload();
            notify("已开始跟踪话题");
          }}
        />
      )}
      {itemMenu.menu && (
        <ContextMenu
          x={itemMenu.menu.x}
          y={itemMenu.menu.y}
          onClose={itemMenu.close} open={itemMenu.isOpen} onExited={itemMenu.finish} triggerRef={itemMenu.triggerRef}
          items={[
            { label: "选择这篇文章", icon: <Check size={14} />, onSelect: () => { setBatch(true); setSelected([itemMenu.menu!.item.id]); } },
            ...(!itemMenu.menu.item.deleted
              ? [{ label: "分享这篇讨论", icon: <Share2 size={14} />, onSelect: () => openShare({ type: "post", post: itemMenu.menu!.item }) }]
              : []),
            {
              label: isLater ? "从稍后再看移除" : "从收藏夹移除",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => {
                setSingle(itemMenu.menu!.item);
                setConfirm("one");
              },
            },
            ...(isLater
              ? [
                  {
                    label: itemMenu.menu.item.completed_at
                      ? "标为未读"
                      : "标为已读",
                    icon: <Check size={14} />,
                    onSelect: () =>
                      manageLater(
                        itemMenu.menu!.item.completed_at ? "unread" : "read",
                        [itemMenu.menu!.item.id],
                      ),
                  },
                ]
              : []),
            ...(isLater
              ? [
                  {
                    label: "清空稍后再看",
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onSelect: () => setConfirm("empty"),
                  },
                ]
              : []),
          ]}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === "folder"
              ? "删除收藏夹"
              : confirm === "clear"
                ? "清除已读文章"
                : confirm === "empty"
                  ? "清空稍后再看"
                  : confirm === "one"
                    ? "移除这篇文章"
                    : "移除所选文章"
          }
          onClose={() => !busy && setConfirm(null)}
          className="collection-modal"
        >
          <p className="library-confirm-copy">
            {confirm === "folder"
              ? `确定删除「${folder?.name}」？其中的收藏记录将被移除，文章和其他收藏夹中的收藏仍会保留。`
              : confirm === "clear"
                ? `确定从稍后再看中移除全部 ${later.completed} 篇已读文章？`
                : confirm === "empty"
                  ? `确定清空稍后再看中的全部 ${later.total} 篇文章？文章本身不受影响。`
                  : confirm === "one"
                    ? `确定从${isLater ? "稍后再看" : "这个收藏夹"}中移除「${single?.title}」？`
                    : `确定从${isLater ? "稍后再看" : "这个收藏夹"}中移除选中的 ${selected.length} 篇文章？`}
          </p>
          <div className="library-form-actions">
            <LiquidButton
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              取消
            </LiquidButton>
            <LiquidButton
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (confirm === "clear") manageLater("clear_read");
                else if (confirm === "empty") emptyList();
                else if (confirm === "one" && single) removeOne(single);
                else if (confirm === "remove")
                  isLater ? manageLater("remove") : manageFolder();
                else if (folder)
                  run(async () => {
                    await api("/collections/" + folder.id, {
                      method: "DELETE",
                    });
                    const next = folders.find((f) => f.is_default);
                    if (next) changeSelection({ kind: "folder", id: next.id });
                  }, "收藏夹已删除");
              }}
            >
              {busy && <LoaderCircle className="spin" size={16} />}确认
              {confirm === "folder"
                ? "删除"
                : confirm === "empty"
                  ? "清空"
                  : "移除"}
            </LiquidButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
