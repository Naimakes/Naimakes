import { useBannerTone } from "./banner-tone";
import { useMotionPreferences } from "../motion/motion-preferences";
import { LiquidSwitch } from "../ui/LiquidSwitch";
import { LiquidPopover } from "../motion/LiquidPopover";
import { FollowLabel } from "../motion/MicroInteraction";
import { LiquidButton } from "../motion/LiquidButton";
import { FluidTabs } from "../motion/FluidTabs";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Flag,
  Bookmark,
  Check,
  ChevronDown,
  Eye,
  Hash,
  Heart,
  Home,
  LoaderCircle,
  LogOut,
  MessageCircle,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Award,
  Shield,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Avatar from "../ui/Avatar";
import BannerEditor from "./BannerEditor";
import AccountSettings from "../settings/AccountSettings";
import InlineName from "./InlineName";
import { SettingsNav, scrollToSection } from "../settings/SettingsNav";
import "../settings/settings.css";
import AccountDeletion from "./AccountDeletion";
import ModuleSorter from "./ModuleSorter";
import { StatusPill, type StatusState } from "../motion/StatusPill";
import NotificationSettings from "./NotificationSettings";
import { SubscribeBell } from "../boards/SubscribeBell";
import { boardIcon } from "../boards/Boards";
import {
  api,
  post as requestPost,
  timeAgo,
  type Collection,
  type Post,
  type ProfileBoard,
  type ProfilePerson,
  type ReceivedLike,
  type ProfileSettings,
  type ProfileStats,
  type ProfileView,
  type Subscriptions,
  type User,
} from "../api";
import { MuteBadge } from "../governance/Governance";
import { openGovernance } from "../governance/governance-api";
import "./profile.css";

const AssistantSettings = lazy(() => import("../../assistant/AssistantSettings"));

const privacyItems: { id: string; label: string; hint: string }[] = [
  { id: "collections", label: "公开我的收藏夹", hint: "私密收藏夹始终只有自己可见" },
  { id: "boards", label: "公开我的关注版块", hint: "包括关注和加入的版块" },
  { id: "history", label: "公开最近浏览", hint: "别人能看到你读过哪些讨论" },
  { id: "likes", label: "公开最近点赞", hint: "你赞同过的讨论会出现在主页" },
  { id: "following", label: "公开我的关注列表", hint: "你关注了哪些成员" },
  { id: "followers", label: "公开我的粉丝列表", hint: "哪些成员关注了你" },
  { id: "tags", label: "公开个人标签", hint: "关掉后标签只在设置里可见" },
  { id: "later", label: "公开稍后再看", hint: "待读清单默认不公开" },
  { id: "topics", label: "公开跟踪的话题", hint: "你正在持续跟踪的关键词与版块" },
  { id: "moderating", label: "公开我管理的版块", hint: "担任版主或协管的版块" },
  { id: "letters", label: "允许未关注的人私信我", hint: "关掉后只有互相关注才能发起对话" },
  { id: "visitors", label: "记录来访的新访客", hint: "关掉后不再留下访客记录" },
];
const moduleItems: Record<string, string> = {
  posts: "我的讨论",
  collections: "我的收藏夹",
  boards: "关注的版块",
  topics: "跟踪的话题",
  likes: "最近点赞的讨论",
  projects: "我的共创项目",
  later: "稍后再看",
  history: "最近浏览",
  tags: "个人标签",
  moderating: "我管理的版块",
  announcements: "站内公告",
  intro: "个人资料",
};
const defaultModules = Object.keys(moduleItems);
const tabs = [
  { id: "home", label: "主页", Icon: Home },
  { id: "posts", label: "帖子", Icon: PenLine },
  { id: "boards", label: "版块", Icon: Hash },
  { id: "collections", label: "收藏", Icon: Bookmark },
  { id: "settings", label: "设置", Icon: Settings2 },
];
const tabIcon = { size: 20, strokeWidth: 1.7 } as const;
const tagLimit = 12;
const joinedOn = (time: number) =>
  new Date(time).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

function RoleBadges({ person, large = false }: { person: Pick<ProfilePerson, "role" | "lead_boards">; large?: boolean }) {
  const size = large ? 12 : 11;
  const cls = "profile-owner-pill" + (large ? " is-large" : "");
  return (
    <>
      {person.role === "owner" && (
        <span className={cls}>
          <ShieldCheck size={size} />
          站主
        </span>
      )}
      {person.role === "admin" && (
        <span className={cls}>
          <Shield size={size} />
          管理员
        </span>
      )}
      {person.lead_boards?.map((b) => (
        <span className={cls} key={b.id} title={`「${b.name}」版块的版主`}>
          <Award size={size} />
          版主 · {b.name}
        </span>
      ))}
    </>
  );
}

function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <LiquidSwitch checked={on} label={label} disabled={disabled} onChange={onChange} />
  );
}

function PersonRow({
  person,
  me,
  busy,
  subscribed,
  onFollow,
  onSubscribe,
  onOpen,
}: {
  person: ProfilePerson;
  me: User | null;
  busy: boolean;
  subscribed: boolean;
  onFollow: (person: ProfilePerson) => void;
  onSubscribe: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="profile-person">
      <Avatar
        name={person.name}
        initials={person.initials}
        avatar={person.avatar}
        userId={person.id}
      />
      <LiquidButton
        type="button"
        className="profile-person-body"
        onClick={() => onOpen(person.id)}
      >
        <strong>
          {person.name}
          <RoleBadges person={person} />
        </strong>
        <small>{person.bio || "这位成员还没有留下简介。"}</small>
      </LiquidButton>
      {person.since && (
        <span className="profile-person-time">{timeAgo(person.since)}</span>
      )}
      {me && !person.mine && (
        <SubscribeBell
          subscribed={subscribed}
          label={person.name}
          size={15}
          onToggle={() => onSubscribe(person.id)}
        />
      )}
      {me && !person.mine && (
        <LiquidButton
          type="button"
          layout
          className={`button ${person.followed ? "secondary" : "primary"} profile-follow-mini`}
          disabled={busy}
          onClick={() => onFollow(person)}
        >
          {person.followed ? <UserMinus size={14} /> : <UserPlus size={14} />}
          <FollowLabel followed={!!person.followed} />
        </LiquidButton>
      )}
    </div>
  );
}

export default function Profile({
  id,
  me,
  settings,
  onSettings,
  onUser,
  onAccountDeleted,
  onOpenProfile,
  onOpenPost,
  onOpenBoard,
  onRequireAuth,
  onMessage,
  onBack,
  notify,
  renderPost,
  subscriptions,
  onSubscribe,
  initialTab = "home",
  focus,
  onLogout,
}: {
  id: string;
  me: User | null;
  settings: ProfileSettings | null;
  onSettings: (next: ProfileSettings) => void;
  onUser: (next: User) => void;
  onAccountDeleted?: () => void;
  onOpenProfile: (id: string) => void;
  onOpenPost: (id: string) => void;
  onOpenBoard: (id: string) => void;
  onRequireAuth: () => void;
  onMessage: (peer: string) => void;
  onBack: () => void;
  notify: (text: string) => void;
  renderPost: (post: Post, index: number) => ReactNode;
  subscriptions: Subscriptions;
  onSubscribe: (kind: "author" | "board", id: string) => void;
  initialTab?: string;
  focus?: { section: string; nonce: number } | null;
  onLogout?: () => void;
}) {
  const [view, setView] = useState<ProfileView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [tab, setTab] = useState("home"),
    [asVisitor, setAsVisitor] = useState(false),
    [viewMenu, setViewMenu] = useState(false),
    [busy, setBusy] = useState("");
  const [posts, setPosts] = useState<Post[]>([]),
    [postsLoading, setPostsLoading] = useState(false),
    [query, setQuery] = useState(""),
    [boards, setBoards] = useState<{
      followed: ProfileBoard[] | null;
      joined: ProfileBoard[] | null;
      moderating: ProfileBoard[] | null;
    } | null>(null),
    [collections, setCollections] = useState<Collection[] | null>(null);
  const [people, setPeople] = useState<{
    scope: string;
    items: ProfilePerson[];
  } | null>(null),
    [peopleLoading, setPeopleLoading] = useState(false),
    [fansMenu, setFansMenu] = useState(false),
    [likes, setLikes] = useState<ReceivedLike[] | null>(null),
    [likesLoading, setLikesLoading] = useState(false);
  const [tagDraft, setTagDraft] = useState(""),
    [orderStatus, setOrderStatus] = useState<StatusState>(null);
  const [deletingAccount, setDeletingAccount] = useState(false),
    [editingBanner, setEditingBanner] = useState(false);
  const fansRef = useRef<HTMLDivElement>(null),
    viewRef = useRef<HTMLDivElement>(null);

  const { reduced } = useMotionPreferences();
  const self = !!view?.relation.self;
  const editing = self && !asVisitor;
  const owned: ProfileSettings | null = self ? settings : null;
  const privacy = owned?.privacy || {};
  const order = useMemo(() => {
    const kept = (owned?.modules || []).filter(
      (m, i, list) => moduleItems[m] && list.indexOf(m) === i,
    );
    return kept.concat(defaultModules.filter((m) => !kept.includes(m)));
  }, [owned?.modules]);
  const canSee = useCallback(
    (key: string) =>
      self && !asVisitor ? true : self ? !!privacy[key] : !!view?.visible[key],
    [self, asVisitor, privacy, view],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setView(null);
    setTab(initialTab);
    setAsVisitor(false);
    setPeople(null);
    setLikes(null);
    setPosts([]);
    setQuery("");
    setBoards(null);
    setCollections(null);
    setDeletingAccount(false);
    api<ProfileView>("/users/" + encodeURIComponent(id))
      .then((r) => active && setView(r))
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!view) return;
    if (tab !== "home" && tab !== "posts") return;
    let active = true;
    setPostsLoading(true);
    const timer = setTimeout(
      () => {
        api(
          "/posts?" +
            new URLSearchParams({
              author: view.user.id,
              ...(query.trim() ? { q: query.trim() } : {}),
            }),
        )
          .then((r) => active && setPosts(r.posts))
          .catch((e) => active && notify((e as Error).message))
          .finally(() => active && setPostsLoading(false));
      },
      query ? 260 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [view?.user.id, tab, query]);

  useEffect(() => {
    if (!view || boards || (tab !== "home" && tab !== "boards")) return;
    api("/users/" + encodeURIComponent(view.user.id) + "/boards")
      .then(setBoards)
      .catch(() => setBoards({ followed: null, joined: null, moderating: null }));
  }, [view, tab, boards]);
  useEffect(() => {
    if (!view || collections || tab !== "collections") return;
    api("/users/" + encodeURIComponent(view.user.id) + "/collections")
      .then((r) => setCollections(r.collections || []))
      .catch(() => setCollections([]));
  }, [view, tab, collections]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      const node = event.target as Node;
      if (fansRef.current && !fansRef.current.contains(node)) setFansMenu(false);
      if (viewRef.current && !viewRef.current.contains(node)) setViewMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFansMenu(false);
      setViewMenu(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  async function toggleLikes() {
    if (!view) return;
    if (likes) return setLikes(null);
    setFansMenu(false);
    setPeople(null);
    setLikes([]);
    setLikesLoading(true);
    try {
      const r = await api<{ items: ReceivedLike[] }>(
        "/users/" + encodeURIComponent(view.user.id) + "/likes-received",
      );
      setLikes(r.items);
    } catch (e) {
      setLikes(null);
      notify((e as Error).message);
    } finally {
      setLikesLoading(false);
    }
  }

  async function openPeople(scope: string) {
    if (!view) return;
    setFansMenu(false);
    setLikes(null);
    setPeople({ scope, items: [] });
    setPeopleLoading(true);
    try {
      const r = await api(
        "/users/" + encodeURIComponent(view.user.id) + "/" + scope,
      );
      setPeople({ scope, items: r.people });
    } catch (e) {
      setPeople(null);
      notify((e as Error).message);
    } finally {
      setPeopleLoading(false);
    }
  }

  async function saveProfile(patch: Partial<ProfileSettings>, key = "profile") {
    if (!owned) return false;
    const previous = owned;
    const next = { ...owned, ...patch };
    onSettings(next);
    setBusy(key);
    try {
      const r = await api("/me/profile", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onSettings(r.profile);
      return true;
    } catch (e) {
      onSettings(previous);
      notify((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function follow(person: ProfilePerson) {
    if (!me) return onRequireAuth();
    setBusy("follow-" + person.id);
    try {
      const r = await api(
        "/users/" + encodeURIComponent(person.id) + "/follow",
        requestPost(),
      );
      setPeople((list) =>
        list
          ? {
              ...list,
              items: list.items.map((p) =>
                p.id === person.id ? { ...p, followed: r.followed } : p,
              ),
            }
          : list,
      );
      if (view && person.id === view.user.id)
        setView({
          ...view,
          stats: r.stats as ProfileStats,
          relation: { ...view.relation, followed: r.followed },
        });
      else if (view && me.id === view.user.id)
        setView({
          ...view,
          stats: {
            ...view.stats,
            following: view.stats.following + (r.followed ? 1 : -1),
          },
        });
      notify(r.followed ? `已关注 ${person.name}` : `已取消关注 ${person.name}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const updateUser = (next: User) => {
    onUser(next);
    setView((current) => (current ? { ...current, user: { ...current.user, ...next } } : current));
  };

  const openSettings = (section = "profile") => {
    setAsVisitor(false);
    setTab("settings");
    setTimeout(() => scrollToSection(section, !reduced), 60);
  };

  useEffect(() => {
    if (!focus || !view?.relation.self) return;
    setAsVisitor(false);
    setTab("settings");
    let moved = false;
    const stop = () => {
      moved = true;
    };
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchmove", stop, { passive: true, once: true });
    const timers = [80, 420, 900].map((delay) => setTimeout(() => !moved && scrollToSection(focus.section, false), delay));
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
    };
  }, [focus?.nonce, view?.relation.self]);

  async function saveBanner(next: { banner: string; banner_mobile: string }) {
    if (!(await saveProfile(next, "banner"))) return false;
    setView((current) => (current ? { ...current, ...next } : current));
    setEditingBanner(false);
    notify("背景图已更新");
    return true;
  }

  const saveOrder = async (modules: string[]) => {
    setOrderStatus({ state: "busy", at: Date.now() });
    const ok = await saveProfile({ modules }, "modules");
    setOrderStatus({ state: ok ? "done" : "error", at: Date.now() });
  };

  const addTag = () => {
    if (!owned) return;
    const tag = tagDraft.trim();
    if (!tag) return;
    if (owned.tags.includes(tag)) {
      setTagDraft("");
      return notify("这个标签已经有了。");
    }
    if (owned.tags.length >= tagLimit)
      return notify(`个人标签最多 ${tagLimit} 个。`);
    setTagDraft("");
    saveProfile({ tags: [...owned.tags, tag] }, "tags");
  };

  const bannerTone = useBannerTone(view?.banner);
  if (loading)
    return (
      <section className="profile-page is-loading" aria-busy="true">
        <div className="small-loading">
          <LoaderCircle className="spin" size={22} />
        </div>
      </section>
    );
  if (error || !view)
    return (
      <section className="profile-page">
        <div className="empty-state">
          <Users size={40} strokeWidth={1.1} />
          <h2>打不开这个人的主页</h2>
          <p>{error || "这位成员可能已经离开社区。"}</p>
          <LiquidButton className="button primary" onClick={onBack}>
            <ArrowLeft size={16} />
            返回社区
          </LiquidButton>
        </div>
      </section>
    );

  const person = view.user;
  const mute =
    self && me
      ? me.muted
        ? {
            until: me.muted_until ?? null,
            starts_at: me.mute_started_at ?? null,
            reason: me.mute_reason || "",
            appeal_pending: !!me.appeal_pending,
            cooldown_until: me.appeal_cooldown_until ?? null,
          }
        : null
      : view.mute || null;
  const stats: [string, number, string][] = [
    ["关注", view.stats.following, "following"],
    ["粉丝", view.stats.followers, "followers"],
    ["获赞", view.stats.likes, "likes"],
  ];
  const tags = self ? owned?.tags || [] : view.tags;
  const shownTabs = tabs.filter((t) => t.id !== "settings" || editing);
  const peopleTitles: Record<string, string> = {
    followers: editing ? "我的粉丝" : person.name + " 的粉丝",
    following: editing ? "我关注的人" : person.name + " 关注的人",
    visitors: "新访客",
  };

  return (
    <section className="profile-page" aria-label={person.name + " 的个人中心"}>
      <header
        className="profile-banner"
        style={{
          ...bannerTone,
          ...(view.banner ? { "--banner-wide": `url(${view.banner})` } : {}),
          ...(view.banner_mobile ? { "--banner-tall": `url(${view.banner_mobile})` } : {}),
        } as CSSProperties}
      >
        <div className="profile-banner-shade" />
        <LiquidButton className="profile-back" type="button" onClick={onBack}>
          <ArrowLeft size={15} />
          返回社区
        </LiquidButton>
        {self && (
          <div className="profile-viewas" ref={viewRef}>
            <LiquidButton
              type="button"
              aria-expanded={viewMenu}
              onClick={() => setViewMenu(!viewMenu)}
            >
              <Eye size={14} />
              视角：{asVisitor ? "访客" : "我自己"}
              <ChevronDown size={14} />
            </LiquidButton>
            <LiquidPopover open={viewMenu} className="profile-dropdown glass" label="主页视角" radius={20} onClose={() => setViewMenu(false)}>
                {[
                  [false, "我自己"],
                  [true, "访客"],
                ].map(([value, label]: any) => (
                  <LiquidButton
                    key={label}
                    type="button"
                    className={asVisitor === value ? "is-active" : ""}
                    onClick={() => {
                      setAsVisitor(value);
                      setViewMenu(false);
                      if (value && tab === "settings") setTab("home");
                    }}
                  >
                    <span>
                      <strong>{label}</strong>
                    </span>
                    {asVisitor === value && <Check size={15} />}
                  </LiquidButton>
                ))}
              </LiquidPopover>
          </div>
        )}
        <div className="profile-identity">
          <div className="profile-portrait">
            <Avatar
              name={person.name}
              initials={person.initials}
              avatar={person.avatar}
              className="profile-face"
            />
            {editing && (
              <LiquidButton
                type="button"
                className="profile-portrait-mask"
                aria-label="在设置中更换头像"
                onClick={() => openSettings("profile")}
              >
                <span>更换头像</span>
              </LiquidButton>
            )}
            {mute && (
              <span className="profile-mute-slot">
                <MuteBadge
                  kind="user"
                  targetId={person.id}
                  label={person.name}
                  mute={mute}
                  canAppeal={self && !asVisitor}
                  onAppealed={() => {
                    notify("申诉已提交，站主处理后会通知你。");
                    if (me) onUser({ ...me, appeal_pending: 1 });
                  }}
                />
              </span>
            )}
          </div>
          <div className="profile-heading">
            <h1>
              {editing && me ? (
                <InlineName user={me} onUser={updateUser} notify={notify} />
              ) : (
                person.name
              )}
              <RoleBadges person={person} large />
            </h1>
            {editing ? (
              <LiquidButton
                type="button"
                className="profile-bio-edit"
                onClick={() => openSettings("profile")}
              >
                <PenLine size={13} />
                {person.bio || "编辑个性签名"}
              </LiquidButton>
            ) : (
              <p className="profile-bio">
                {person.bio || "这位成员还没有留下签名。"}
              </p>
            )}
            <p className="profile-joined">
              <span>{joinedOn(person.created_at)} 加入</span><span aria-hidden="true"> · </span><span>{view.stats.posts} 篇讨论</span>
              {view.relation.follows_me && !self && (
                <span className="profile-mutual">关注了你</span>
              )}
            </p>
          </div>
          {!self && (
            <div className="profile-actions">
              <SubscribeBell
                subscribed={subscriptions.authors.includes(person.id)}
                label={person.name}
                onToggle={() => onSubscribe("author", person.id)}
              />
              <LiquidButton
                type="button"
                layout
                className={`button ${view.relation.followed ? "secondary" : "primary"}`}
                disabled={busy === "follow-" + person.id}
                onClick={() =>
                  me
                    ? follow({ ...person, followed: view.relation.followed })
                    : onRequireAuth()
                }
              >
                {view.relation.followed ? (
                  <UserMinus size={15} />
                ) : (
                  <UserPlus size={15} />
                )}
                <FollowLabel followed={!!view.relation.followed} />
              </LiquidButton>
              <LiquidButton
                type="button"
                className="button secondary"
                onClick={() => (me ? onMessage(person.id) : onRequireAuth())}
              >
                <MessageCircle size={15} />
                私信
              </LiquidButton>
              <LiquidButton
                type="button"
                className="button secondary icon-button profile-report"
                aria-label={"投诉 " + person.name}
                title="投诉"
                onClick={() =>
                  me
                    ? openGovernance({ kind: "report", type: "user", id: person.id, label: person.name })
                    : onRequireAuth()
                }
              >
                <Flag size={15} />
              </LiquidButton>
            </div>
          )}
        </div>
      </header>

      <nav className="profile-bar" aria-label="个人中心导航">
        <FluidTabs className="profile-tabs profile-nav-tabs" active={tab} label="个人中心导航">
          {shownTabs.map(({ id: tabId, label, Icon }) => (
            <LiquidButton
              key={tabId}
              type="button"
              role="tab"
              aria-selected={tab === tabId}
              tabIndex={tab === tabId ? 0 : -1}
              onClick={() => setTab(tabId)}
            >
              <Icon size={tabIcon.size} strokeWidth={tabIcon.strokeWidth} />
              <span>{label}</span>
            </LiquidButton>
          ))}
        </FluidTabs>
<div className="profile-bar-end">
        <div className="profile-search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            maxLength={60}
            placeholder="搜索帖子"
            aria-label={"搜索 " + person.name + " 的帖子"}
            onChange={(event) => {
              setQuery(event.target.value);
              if (tab !== "posts") setTab("posts");
            }}
          />
          {query && (
            <LiquidButton
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </LiquidButton>
          )}
        </div>
        <div className="profile-stats" ref={fansRef}>
          {stats.map(([label, value, key]) => {
            const clickable =
              key === "followers" ||
              key === "likes" ||
              (key === "following" && canSee("following"));
            const cell = (
              <>
                <strong>{value.toLocaleString("zh-CN")}</strong>
                <small>{label}</small>
              </>
            );
            if (!clickable)
              return (
                <div className="profile-stat" key={key}>
                  {cell}
                </div>
              );
            return (
              <div className="profile-stat-wrap" key={key}>
                <LiquidButton
                  type="button"
                  className="profile-stat is-clickable"
                  aria-expanded={
                    key === "followers" ? fansMenu : key === "likes" ? !!likes : undefined
                  }
                  onClick={() =>
                    key === "followers"
                      ? setFansMenu(!fansMenu)
                      : key === "likes"
                        ? toggleLikes()
                        : openPeople("following")
                  }
                >
                  {cell}
                </LiquidButton>
                {key === "followers" && (
                  <LiquidPopover open={fansMenu} className="profile-dropdown glass" label="关注与访客" onClose={() => setFansMenu(false)}>
                    <LiquidButton type="button" onClick={() => openPeople("followers")}>
                      <span>
                        <strong>{self ? "我的粉丝" : "TA 的粉丝"}</strong>
                        <small>关注了这个人的成员</small>
                      </span>
                      <Users size={15} />
                    </LiquidButton>
                    {self && (
                      <LiquidButton type="button" onClick={() => openPeople("visitors")}>
                        <span>
                          <strong>新访客</strong>
                          <small>最近来看过我主页的人</small>
                        </span>
                        <Eye size={15} />
                      </LiquidButton>
                    )}
                  </LiquidPopover>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </nav>

      {people && (
        <section className="profile-card profile-people">
          <div className="profile-card-head">
            <h2>{peopleTitles[people.scope]}</h2>
            <LiquidButton
              type="button"
              className="text-button"
              onClick={() => setPeople(null)}
            >
              <X size={14} />
              收起名单
            </LiquidButton>
          </div>
          {peopleLoading ? (
            <div className="small-loading">
              <LoaderCircle className="spin" size={20} />
            </div>
          ) : !people.items.length ? (
            <p className="profile-empty">
              {people.scope === "visitors"
                ? "还没有人来看过这里。发一篇讨论，让更多人找到你。"
                : people.scope === "followers"
                  ? "还没有粉丝。持续发言，会有人因为你的想法留下来。"
                  : "还没有关注任何人。在讨论里遇到聊得来的人，点头像就能关注。"}
            </p>
          ) : (
            <div className="profile-person-list">
              {people.items.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  me={me}
                  busy={busy === "follow-" + p.id}
                  subscribed={subscriptions.authors.includes(p.id)}
                  onFollow={follow}
                  onSubscribe={(personId) => onSubscribe("author", personId)}
                  onOpen={onOpenProfile}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {likes && (
        <section className="profile-card profile-likes">
          <div className="profile-card-head">
            <h2>{self ? "谁赞了我" : "谁赞了 TA"}</h2>
            <LiquidButton
              type="button"
              className="text-button"
              onClick={() => setLikes(null)}
            >
              <X size={14} />
              收起
            </LiquidButton>
          </div>
          {likesLoading ? (
            <div className="small-loading">
              <LoaderCircle className="spin" size={20} />
            </div>
          ) : !likes.length ? (
            <p className="profile-empty">
              {self
                ? "还没有收到赞。写下一篇讨论，或认真回复一条评论。"
                : "暂时没有可以公开的获赞记录。"}
            </p>
          ) : (
            <div className="profile-like-list">
              {likes.map((item) => (
                <div
                  className="profile-like-item"
                  key={item.kind + item.liker.id + (item.comment_id || item.post_id)}
                >
                  <Avatar
                    name={item.liker.name}
                    initials={item.liker.initials}
                    avatar={item.liker.avatar}
                    userId={item.liker.id}
                  />
                  <div className="profile-like-body">
                    <p>
                      <LiquidButton
                        type="button"
                        className="inline-link"
                        onClick={() => onOpenProfile(item.liker.id)}
                      >
                        {item.liker.name}
                      </LiquidButton>
                      <span>
                        {item.kind === "post" ? " 赞同了讨论" : " 赞同了回复"}
                      </span>
                    </p>
                    <LiquidButton
                      type="button"
                      className="profile-like-target"
                      onClick={() => onOpenPost(item.post_id)}
                    >
                      {item.kind === "comment" && item.excerpt && (
                        <span className="profile-like-excerpt">「{item.excerpt}」</span>
                      )}
                      <strong>{item.post_title}</strong>
                    </LiquidButton>
                  </div>
                  <span className="profile-like-meta">
                    <Heart size={13} />
                    {item.created_at ? timeAgo(item.created_at) : "较早"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "home" && (
        <div className="profile-body">
          {canSee("tags") && tags.length > 0 && (
            <section className="profile-card">
              <h2>个人标签</h2>
              <div className="profile-tag-row">
                {tags.map((tag) => (
                  <span className="profile-tag" key={tag}>
                    <Hash size={12} />
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
          <section className="profile-card">
            <div className="profile-card-head">
              <h2>最近的讨论</h2>
              {posts.length > 0 && (
                <LiquidButton
                  type="button"
                  className="text-button"
                  onClick={() => setTab("posts")}
                >
                  查看全部
                </LiquidButton>
              )}
            </div>
            {postsLoading && !posts.length ? (
              <div className="small-loading">
                <LoaderCircle className="spin" size={20} />
              </div>
            ) : !posts.length ? (
              <p className="profile-empty">
                {self
                  ? "还没有发布过讨论。写下第一篇，让别人找到你。"
                  : "这位成员还没有公开的讨论。"}
              </p>
            ) : (
              <div className="post-list">{posts.slice(0, 3).map(renderPost)}</div>
            )}
          </section>
          {canSee("boards") && boards?.followed && (
            <section className="profile-card">
              <h2>关注的版块</h2>
              {!boards.followed.length ? (
                <p className="profile-empty">还没有关注任何版块。</p>
              ) : (
                <div className="profile-board-row">
                  {boards.followed.map((board) => {
                    const Icon = boardIcon(board.icon);
                    return (
                      <LiquidButton
                        key={board.id}
                        type="button"
                        className="profile-board"
                        onClick={() => onOpenBoard(board.id)}
                      >
                        <Icon size={16} />
                        {board.name}
                      </LiquidButton>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "posts" && (
        <div className="profile-body">
          <section className="profile-card">
            <div className="profile-card-head">
              <h2>
                {query ? `「${query}」的结果` : self ? "我的讨论" : "TA 的讨论"}
              </h2>
              <span className="profile-count">{posts.length} 篇</span>
            </div>
            {postsLoading ? (
              <div className="small-loading">
                <LoaderCircle className="spin" size={20} />
              </div>
            ) : !posts.length ? (
              <p className="profile-empty">
                {query ? "没有找到相关讨论，换个关键词试试。" : "这里还空着。"}
              </p>
            ) : (
              <div className="post-list">{posts.map(renderPost)}</div>
            )}
          </section>
        </div>
      )}

      {tab === "boards" && (
        <div className="profile-body">
          {(
            [
              ["关注的版块", boards?.followed, "boards"],
              ["加入的版块", boards?.joined, "boards"],
              ["管理的版块", boards?.moderating, "moderating"],
            ] as [string, ProfileBoard[] | null | undefined, string][]
          ).map(([title, list, key]) => (
            <section className="profile-card" key={title}>
              <h2>{title}</h2>
              {!canSee(key) || list === null ? (
                <p className="profile-empty">这位成员没有公开这部分内容。</p>
              ) : !list?.length ? (
                <p className="profile-empty">暂时还没有。</p>
              ) : (
                <div className="profile-board-row">
                  {list.map((board) => {
                    const Icon = boardIcon(board.icon);
                    return (
                      <LiquidButton
                        key={board.id + title}
                        type="button"
                        className="profile-board"
                        onClick={() => onOpenBoard(board.id)}
                      >
                        <Icon size={16} />
                        {board.name}
                        {board.role && (
                          <span className="profile-board-role">
                            {board.role === "lead" ? "版主" : "协管"}
                          </span>
                        )}
                      </LiquidButton>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === "collections" && (
        <div className="profile-body">
          <section className="profile-card">
            <h2>收藏夹</h2>
            {!canSee("collections") ? (
              <p className="profile-empty">这位成员没有公开自己的收藏。</p>
            ) : collections === null ? (
              <div className="small-loading">
                <LoaderCircle className="spin" size={20} />
              </div>
            ) : !collections.length ? (
              <p className="profile-empty">还没有建立收藏夹。</p>
            ) : (
              <div className="profile-collection-row">
                {collections.map((c) => (
                  <div className="profile-collection" key={c.id}>
                    <strong>{c.name}</strong>
                    <small>{c.description || "还没有写简介。"}</small>
                    <span>
                      {c.count} 篇
                      {!c.is_public && (
                        <em className="profile-private">私密</em>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "settings" && editing && owned && me && (
        <div className="profile-body settings-body">
          <SettingsNav />
          <AccountSettings
            user={me}
            banner={view.banner}
            onUser={updateUser}
            onEditBanner={() => setEditingBanner(true)}
            notify={notify}
          />

          <Suspense fallback={<section className="profile-card settings-section" id="settings-assistant"><div className="small-loading"><LoaderCircle className="spin" size={20} /></div></section>}>
            <AssistantSettings />
          </Suspense>

          <div className="settings-section" id="settings-notifications">
            <NotificationSettings
              subscriptions={subscriptions}
              onSubscribe={onSubscribe}
              onOpenBoard={onOpenBoard}
              notify={notify}
            />
          </div>

          <section className="profile-card settings-section" id="settings-privacy">
            <div className="profile-card-head">
              <h2>隐私设置</h2>
              <p className="profile-card-note">
                关掉的部分只有自己可见，切到「访客」视角就能看到别人眼中的样子。
              </p>
            </div>
            <div className="profile-grid" data-liquid-switch-group="privacy">
              {privacyItems.map((item) => (
                <div className="profile-setting" key={item.id}>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <Toggle
                    on={!!privacy[item.id]}
                    label={item.label}
                    disabled={busy === "privacy"}
                    onChange={() =>
                      saveProfile(
                        { privacy: { ...privacy, [item.id]: !privacy[item.id] } },
                        "privacy",
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="profile-card settings-section" id="settings-order">
            <div className="profile-card-head">
              <h2>主页排序</h2>
              <StatusPill status={orderStatus} labels={{ done: "顺序已保存", error: "没能保存，已恢复原来的顺序" }} />
              <LiquidButton
                type="button"
                className="profile-reset"
                disabled={busy === "modules"}
                onClick={() => saveOrder(defaultModules)}
              >
                <RotateCcw size={13} />
                恢复默认排序
              </LiquidButton>
            </div>
            <p className="profile-card-note">
              按住一行拖动，其他模块会让出位置；也可以聚焦手柄用上下方向键移动。
            </p>
            <ModuleSorter
              order={order}
              labels={moduleItems}
              reduced={reduced}
              disabled={busy === "modules"}
              onCommit={saveOrder}
            />
          </section>

          <section className="profile-card settings-section" id="settings-tags">
            <h2>个人标签</h2>
            <p className="profile-card-note">
              最多 {tagLimit} 个，每个 12 字以内。标签会出现在主页上，让别人一眼知道你在关注什么。
            </p>
            <div className="profile-tag-form">
              <div className="profile-tag-input">
                <Hash size={14} />
                <input
                  value={tagDraft}
                  maxLength={12}
                  placeholder="例如：深空探测"
                  aria-label="新的个人标签"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    addTag();
                  }}
                />
                {tagDraft && (
                  <LiquidButton
                    type="button"
                    aria-label="清空输入"
                    onClick={() => setTagDraft("")}
                  >
                    <X size={14} />
                  </LiquidButton>
                )}
              </div>
              <LiquidButton
                type="button"
                className="profile-tag-add"
                disabled={!tagDraft.trim() || busy === "tags"}
                onClick={addTag}
              >
                <Plus size={14} />
                新增
              </LiquidButton>
            </div>
            {owned.tags.length > 0 && (
              <div className="profile-tag-row">
                {owned.tags.map((tag) => (
                  <span className="profile-tag is-editable" key={tag}>
                    <Hash size={12} />
                    {tag}
                    <LiquidButton
                      type="button"
                      aria-label={`删除标签 ${tag}`}
                      onClick={() =>
                        saveProfile(
                          { tags: owned.tags.filter((t) => t !== tag) },
                          "tags",
                        )
                      }
                    >
                      <Trash2 size={12} />
                    </LiquidButton>
                  </span>
                ))}
              </div>
            )}
          </section>
          <section className="profile-card settings-section settings-account" id="settings-account">
            <div className="profile-card-head">
              <h2>账户</h2>
              <p className="profile-card-note">登录邮箱：{me.email || "未设置"}。修改邮箱请前往上方「个人资料」。</p>
            </div>
            <div className="settings-account-row">
              <span>
                <strong>退出登录</strong>
                <small>清除此设备上的登录状态与本地草稿，账户数据不会受影响。</small>
              </span>
              <LiquidButton type="button" className="button secondary" onClick={onLogout}>
                <LogOut size={15} />
                退出登录
              </LiquidButton>
            </div>
            {me.id === id && me.role !== "owner" && (
              <div className="settings-account-row">
                <span>
                  <strong>删除账户</strong>
                  <small>永久删除账户、讨论和个人数据，此操作无法撤销。</small>
                </span>
                <LiquidButton type="button" className="button danger account-delete-trigger" disabled={!!busy}
                  onClick={() => setDeletingAccount(true)}><Trash2 size={16} />删除账户</LiquidButton>
              </div>
            )}
          </section>
        </div>
      )}

      {deletingAccount && me && me.id === id && me.role !== "owner" && <AccountDeletion mode="self" target={me}
        onClose={() => setDeletingAccount(false)} onDeleted={() => { setDeletingAccount(false); onAccountDeleted?.(); }} />}

      {editingBanner && editing && (
        <BannerEditor
          banner={view.banner}
          bannerMobile={view.banner_mobile}
          onCancel={() => setEditingBanner(false)}
          onSave={saveBanner}
        />
      )}

    </section>
  );
}
