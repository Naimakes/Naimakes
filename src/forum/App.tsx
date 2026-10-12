import { GlassToastStack, useToastQueue } from "./messages/GlassToast";
import { SubscribeBell } from "./boards/SubscribeBell";
import { useLiveNotifications } from "./messages/use-live-notifications";
import { PrimaryNavigation } from "./layout/PrimaryNavigation";
import { FooterLinks } from "./layout/FooterLinks";
import HomeExperience from "./home/HomePage";
import LandingLayer, { takeWelcome } from "./layout/LandingLayer";
import { usePageTransition } from "./motion/use-page-transition";
import { useMotionPreferences } from "./motion/motion-preferences";
import { LiquidPopover } from "./motion/LiquidPopover";
import { MotionCard } from "./motion/MotionCard";
import { TextDisclosure } from "./motion/TextDisclosure";
import { MotionSidebar } from "./motion/MotionSidebar";
import { MotionCount, ReactionIcon } from "./motion/MicroInteraction";
import { rememberPostOrigin, type Origin } from "./motion/motion-origin";
import { transitions } from "./motion/motion-tokens";
import { LiquidButton } from "./motion/LiquidButton";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  motion,
  AnimatePresence,
  LayoutGroup,
} from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  Search,
  Bell,
  Menu,
  X,
  Bookmark,
  MessageCircle,
  MessageCircleOff,
  ShieldAlert,
  MoreHorizontal,
  UserMinus,
  UserPlus,
  Lock,
  Orbit,
  ChevronDown,
  Eye,
  EyeOff,
  Check,
  LoaderCircle,
  SlidersHorizontal,
  List,
  Flame,
  Clock3,
  History,
  Users,
  UserRound,
  LogOut,
  Settings2,
  PenLine,
  Share2,
  Link2,
  Flag,
  Trash2,
  Telescope,
  Hash,
  Radio,
  MessagesSquare,
  Paperclip,
  Quote,
  Megaphone,
  Award,
  ShieldCheck,
  Send,
  Star,
  FileX2,
  ChartLine,
  BellPlus,
  BellRing,
} from "lucide-react";
import { ModalRegistration as Modal } from "./motion/OverlayHost";
import SearchResults from "./search/SearchResults";
import { normalizeSearchQuery, readSearchState, searchUrl } from "./search/search-state";
import FeedFilterDialog from "./discover/FeedFilterDialog";
import FollowingLists from "./profile/FollowingLists";
import {
  activeFilterCount,
  applyFeedFilters,
  defaultFeedFilters,
  type FeedFilters,
} from "./discover/feed-filters";
import Library from "./library/Library";
import FeaturedRail from "./discover/FeaturedRail";
import ShareSheet from "./share/ShareSheet";
import { openShare, setShareHandler, setSharedChatHandler, type ShareTarget } from "./share/share-api";
import { RichContent } from "./posts/rich-text/RichContent";
import { QuoteList } from "./posts/Quotes";
import ContextMenu, { useContextMenu } from "./ui/ContextMenu";
import { RecentsPanel, useRecents } from "./search/Recents";
import Comments from "./posts/Comments";
import Confirm from "./ui/Confirm";
import Avatar from "./ui/Avatar";
import { profileIdFromPath, profileUrl, setProfileNav } from "./profile/profile-nav";
import { AttachmentList } from "./posts/Attachments";
import { BookmarkPicker, TrackForm } from "./library/LibraryForms";
import { AuthForm } from "./auth/AuthForm";
import { BrandMark } from "./layout/BrandMark";
import { LoadingPopup } from "./ui/LoadingPopup";
import { Composer } from "./posts/Composer";
import { rememberViewed, setAssistantNavigator } from "../assistant/nav";
import { useMedia } from "./ui/use-media";
import { BoardForm, boardIcon } from "./boards/Boards";
import { GovernanceHost, MuteBadge } from "./governance/Governance";
import { GlassSegments } from "./ui/GlassSegments";
import BoardBar, { ClipMotion, defaultBoardLayout, type BoardLayout } from "./boards/BoardBar";
import ScopedSearch, { type PersonalScope } from "./search/ScopedSearch";
import { needsRequest, openGovernance } from "./governance/governance-api";
import {
  api,
  lockedLabel,
  mutedLabel,
  muteNotice,
  post as requestPost,
  timeAgo,
  postDescription,
  readingMinutes,
  byViews,
  countLabel,
  type User,
  type Post,
  type Category,
  type Attachment,
  type Comment,
  type MemberHit,
  type ProfileSettings,
  type LiveNotice,
  type NoticeTopic,
  type Subscriptions,
} from "./api";
const governanceKinds = new Set(["moderation", "appeal", "admin_request", "admin_action", "system_event"]);
const Profile = lazy(() => import("./profile/Profile"));
const AdminPanel = lazy(() => import("./governance/AdminPanel"));
const MessageCenter = lazy(() => import("./messages/MessageCenter"));
const PostManager = lazy(() => import("./insights/PostManager"));
const BoardManager = lazy(() => import("./insights/BoardManager"));
const AssistantDock = lazy(() => import("../assistant/AssistantDock"));
const sharedChatToken = (() => {
  try {
    const token = new URLSearchParams(location.search).get("nmk-chat") || "";
    return /^[A-Za-z0-9_-]{10,64}$/.test(token) ? token : "";
  } catch {
    return "";
  }
})();
const GuestSettings = lazy(() => import("./settings/GuestSettings"));
const loadMarkdown = () => import("./posts/MarkdownContent");
const MarkdownContent = lazy(loadMarkdown);
const shortcutMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
function dismissBoot() {
  const done = (window as { __nmkBootDone?: () => void }).__nmkBootDone;
  if (done) return done();
  const boot = document.getElementById("boot");
  if (!boot || boot.classList.contains("is-done")) return;
  boot.classList.add("is-done");
  boot.addEventListener("transitionend", () => boot.remove(), { once: true });
  setTimeout(() => boot.remove(), 900);
}
function currentPage() {
  const p = location.pathname;
  if (p.startsWith("/discussion/")) return "/discover";
  if (p.startsWith("/topics/")) return "/topics";
  if (p.startsWith("/collections/")) return p;
  if (profileIdFromPath(p)) return p;
  return [
    "/",
    "/discover",
    "/search",
    "/topics",
    "/saved",
    "/read-later",
    "/history",
    "/mine",
    "/following",
    "/settings",
  ].includes(p)
    ? p
    : "/";
}

export default function App() {
  const [savingPost, setSavingPost] = useState<Post | null>(null);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [historyBatch, setHistoryBatch] = useState(false),
    [historyPicked, setHistoryPicked] = useState<string[]>([]),
    [confirmHistory, setConfirmHistory] = useState<"all" | "picked" | null>(
      null,
    );
  const [trackingKeyword, setTrackingKeyword] = useState<string | null>(null);
  const [settingsFocus, setSettingsFocus] = useState<{ section: string; nonce: number } | null>(() =>
    location.pathname === "/settings" && location.hash.length > 1 ? { section: location.hash.slice(1), nonce: Date.now() } : null,
  );
  const [assistantReady, setAssistantReady] = useState(!!sharedChatToken);
  const [sharedChat, setSharedChat] = useState<{ token: string; nonce: number } | null>(sharedChatToken ? { token: sharedChatToken, nonce: 0 } : null);
  const [page, setPage] = useState(currentPage),
    [category, setCategory] = useState(
      location.pathname.startsWith("/topics/")
        ? location.pathname.split("/")[2]
        : location.pathname === "/search"
          ? readSearchState().category
          : "all",
    ),
    [categories, setCategories] = useState<Category[]>([]),
    [boardIcons, setBoardIcons] = useState<string[]>([]),
    [manage, setManage] = useState<{ kind: "posts" | "boards"; focus?: string } | null>(null),
    [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<ProfileSettings | null>(null),
    [members, setMembers] = useState<MemberHit[]>([]),
    [follows, setFollows] = useState<string[]>([]),
    [subscriptions, setSubscriptions] = useState<Subscriptions>({ authors: [], boards: [] }),
    [unread, setUnread] = useState(0),
    [stats, setStats] = useState({
      posts: 0,
      members: 0,
      comments: 0,
      demo: false,
    });
  const [posts, setPosts] = useState<Post[]>([]),
    [featured, setFeatured] = useState<Post[]>([]),
    [total, setTotal] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [filters, setFilters] = useState<FeedFilters>(() => ({
      ...defaultFeedFilters,
      sort:
        location.pathname === "/search" ? readSearchState().sort : "hot",
    })),
    [search, setSearch] = useState(() =>
      location.pathname === "/search" ? readSearchState().query : "",
    ),
    [searchTag, setSearchTag] = useState(() =>
      location.pathname === "/search" ? readSearchState().tag : false,
    ),
    [searchTotals, setSearchTotals] = useState({ exact: 0, related: 0 }),
    [version, setVersion] = useState(0);
  const [welcome, setWelcome] = useState(takeWelcome);
  useEffect(() => {
    if (page !== "/") setWelcome(false);
  }, [page]);
  const [headerHidden, setHeaderHidden] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [accountMenu, setAccountMenu] = useState(false),
    [moreMenu, setMoreMenu] = useState(false),
    phone = useMedia("(max-width: 600px)"),
    [boardMenu, setBoardMenu] = useState(false),
    [modal, setModal] = useState(""),
    [detail, setDetail] = useState<Post | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [comments, setComments] = useState<Comment[]>([]),
    [chatPeer, setChatPeer] = useState(""),
    [chatRequest, setChatRequest] = useState(0),
    [centreFocus, setCentreFocus] = useState(""),
    [centreLive, setCentreLive] = useState<LiveNotice[]>([]),
    [topicFocus, setTopicFocus] = useState<{ kind: string; value: string; nonce: number } | null>(null),
    [busy, setBusy] = useState("");
  const [paletteQuery, setPaletteQuery] = useState(""),
    [paletteResults, setPaletteResults] = useState<Post[]>([]),
    [paletteLoading, setPaletteLoading] = useState(false),
    [replyError, setReplyError] = useState(""),
    [lockReason, setLockReason] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<Post | null>(null),
    [boardLayout, setBoardLayout] = useState<BoardLayout>(defaultBoardLayout),
    [hiddenAnnouncements, setHiddenAnnouncements] = useState<Post[]>([]),
    [announcementsOpen, setAnnouncementsOpen] = useState(false),
    [hideTarget, setHideTarget] = useState<Post | null>(null),
    [confirmComment, setConfirmComment] = useState<Comment | null>(null),
    [scopedActive, setScopedActive] = useState(false),
    [removedBoard, setRemovedBoard] = useState("");
  const composeKinds = ["compose", "announce", "edit"];
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const compose = useRef<{ pushed: boolean; after: null | (() => void) }>({ pushed: false, after: null });
  const [booted, setBooted] = useState(false);
  const bootCompose = useRef(location.pathname === "/compose");
  const sort = filters.sort;
  const setSort = useCallback(
    (id: string) => setFilters((f) => (f.sort === id ? f : { ...f, sort: id })),
    [],
  );
  const filterCount = activeFilterCount(filters);
  const customFeed =
    filterCount > 0 || !["hot", "new", "views", "comments", "unanswered"].includes(sort);
  const { reduced: reducedMotion } = useMotionPreferences();
  const pageTransitionRef = usePageTransition(page);
  const [feedSwap, setFeedSwap] = useState(0);
  const [feedPending, setFeedPending] = useState(false);
  const feedSwapRef = usePageTransition<HTMLDivElement>(String(feedSwap));
  const feedQuery = useRef({ scope: "", view: "" });
  const postOrigin = useRef<Origin | null>(null);
  const pendingProfile = useRef(false);
  const accountRevision = useRef(0);
  const topRef = useRef<HTMLElement>(null),
    feedRef = useRef<HTMLElement>(null),
    detailSequence = useRef(0),
    detailReturnUrl = useRef(
      location.pathname.startsWith("/discussion/")
        ? "/discover"
        : location.pathname + location.search,
    ),
    listSequence = useRef(0),
    accountRef = useRef<HTMLDivElement>(null),
    mobileTrigger = useRef<HTMLButtonElement>(null),
    moreMenuRef = useRef<HTMLDivElement>(null),
    boardMenuTrigger = useRef<HTMLButtonElement>(null),
    pendingAction = useRef<null | (() => void)>(null);
  const searchRecents = useRecents("search", !!user);
  const paletteFavoriteQuery = normalizeSearchQuery(paletteQuery.replace(/^#+/, ""));
  const paletteFavorite = {
    query: paletteFavoriteQuery,
    pinned: searchRecents.items.some((i) => i.pinned && i.value === paletteFavoriteQuery),
  };
  const toasts = useToastQueue();
  const notify = toasts.feedback;
  useEffect(() => {
    try {
      localStorage.removeItem("nmk-theme");
    } catch {}
  }, []);
  useEffect(() => {
    const warm = () => {
      loadMarkdown().catch(() => {});
    };
    const idle = window.requestIdleCallback;
    if (idle) {
      const handle = idle(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(warm, 2000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    let lastY = window.scrollY;
    const scrolling = () => {
      if (idle) clearTimeout(idle);
      const nextY = window.scrollY;
      const moved = Math.abs(nextY - lastY) > 1;
      lastY = nextY;
      if (
        nextY < 30 ||
        mobileMenu ||
        accountMenu ||
        modal ||
        document.querySelector(".site-header :focus-visible")
      ) {
        setHeaderHidden(false);
        return;
      }
      if (moved) setHeaderHidden(true);
      idle = setTimeout(() => setHeaderHidden(false), 280);
    };
    setHeaderHidden(false);
    window.addEventListener("scroll", scrolling, { passive: true });
    return () => {
      window.removeEventListener("scroll", scrolling);
      if (idle) clearTimeout(idle);
    };
  }, [mobileMenu, accountMenu, modal]);
  const syncMe = useCallback(async () => {
    const revision = accountRevision.current;
    const r = await api("/me");
    if (revision !== accountRevision.current) return;
    setUser(r.user);
    setProfile(r.profile || null);
    setFollows(r.follows);
    setSubscriptions(r.subscriptions || { authors: [], boards: [] });
    setUnread(r.unread);
  }, []);
  useEffect(() => {
    const id = detail?.id;
    if (!id || detail?.deleted) return;
    api<{ views: number }>("/posts/" + encodeURIComponent(id) + "/view", requestPost())
      .then(({ views }) => {
        const apply = (p: Post) => (p.id === id ? { ...p, views } : p);
        setDetail((d) => (d ? apply(d) : d));
        setPosts((list) => list.map(apply));
        setFeatured((list) => list.map(apply));
      })
      .catch(() => {});
  }, [detail?.id, user?.id]);
  useEffect(() => {
    if (page === "/topics" && !detail && !detailLoading)
      history.replaceState(
        {},
        "",
        category === "all" ? "/topics" : "/topics/" + category,
      );
  }, [page, category, detail, detailLoading]);
  useEffect(() => {
    if (reducedMotion || page !== "/discover") return;
    let frame = 0;
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        topRef.current?.style.setProperty(
          "--scroll",
          String(Math.min(1, window.scrollY / 650)),
        );
        frame = 0;
      });
    };
    window.addEventListener("scroll", scroll, { passive: true });
    scroll();
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [page, reducedMotion]);
  const refreshStats = useCallback(() => {
    api("/posts?sort=views").then((r) => setFeatured(r.posts.slice(0, 6))).catch(() => {});
    api("/stats")
      .then(setStats)
      .catch(() => {});
    api("/categories")
      .then((r) => {
        setCategories(r.categories);
        setBoardIcons(r.icons || []);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const cap = setTimeout(dismissBoot, 2400);
    Promise.all([
      syncMe(),
      api("/categories"),
      api("/stats"),
      api("/posts?sort=views"),
    ])
      .then(([, c, s, p]) => {
        setCategories(c.categories);
        setBoardIcons(c.icons || []);
        setStats(s);
        setFeatured(p.posts.slice(0, 6));
      })
      .catch(() => setLoadError("无法连接社区，请检查网络后重试。"))
      .finally(() => {
        clearTimeout(cap);
        dismissBoot();
        setBooted(true);
      });
    return () => clearTimeout(cap);
  }, [syncMe]);
  const loadPosts = useCallback(
    async (offset = 0) => {
      const seq = ++listSequence.current;
      if (page === "/search" && !search) {
        setPosts([]);
        setTotal(0);
        setHasMore(false);
        setLoadError("");
        setLoading(false);
        return;
      }
      if (
        page === "/saved" ||
        page === "/read-later" ||
        page === "/following" ||
        page.startsWith("/collections/") ||
        page.startsWith("/u/") ||
        page === "/settings"
      ) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError("");
      const scope = [page, page === "/topics" ? category : "", search, searchTag].join("\n");
      const viewKey = JSON.stringify([filters, category]);
      const swap =
        !offset &&
        scope === feedQuery.current.scope &&
        viewKey !== feedQuery.current.view;
      if (!offset) feedQuery.current = { scope, view: viewKey };
      setFeedPending(swap);
      if (!offset && !swap) {
        setPosts([]);
        setHasMore(false);
      }
      const view =
        (
          {
            "/saved": "bookmarks",
            "/history": "history",
            "/mine": "mine",
            "/following": "following",
          } as Record<string, string>
        )[page] || "";
      const params = applyFeedFilters(
        new URLSearchParams({ offset: String(offset) }),
        filters,
      );
      if (category !== "all") params.set("category", category);
      if (search) params.set("q", search);
      if (view) params.set("view", view);
      if (page === "/search") {
        params.delete("from");
        params.delete("to");
        params.delete("minComments");
        if (searchTag) params.set("tag", "1");
      }
      try {
        const r = await api((page === "/search" ? "/search?" : "/posts?") + params);
        if (seq !== listSequence.current) return;
        if (page === "/search")
          setSearchTotals({ exact: r.exactTotal ?? r.total, related: r.relatedTotal ?? 0 });
        setPosts((prev) => (offset ? [...prev, ...r.posts] : r.posts));
        if (swap) setFeedSwap((n) => n + 1);
        if (!offset) setHiddenAnnouncements(r.hiddenAnnouncements || []);
        setTotal(r.total);
        setHasMore(r.hasMore);
      } catch (e) {
        if (seq === listSequence.current) {
          setLoadError((e as Error).message);
          setPosts([]);
        }
      } finally {
        if (seq === listSequence.current) setLoading(false);
      }
    },
    [page, filters, category, search, searchTag],
  );
  useEffect(() => {
    let active = true;
    if (!user) {
      try {
        const saved = JSON.parse(localStorage.getItem("nmk-board-layout") || "null");
        setBoardLayout(saved && Array.isArray(saved.hidden) ? { order: Array.isArray(saved.order) ? saved.order : null, hidden: saved.hidden } : defaultBoardLayout);
      } catch {
        setBoardLayout(defaultBoardLayout);
      }
      return;
    }
    api<BoardLayout>("/me/board-layout")
      .then((r) => active && setBoardLayout({ order: r.order ?? null, hidden: r.hidden || [] }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);
  const saveBoardLayout = (next: BoardLayout, notice?: string) => {
    const previous = boardLayout;
    setBoardLayout(next);
    const done = () => notice && notify(notice, "success");
    if (!user) {
      try {
        localStorage.setItem("nmk-board-layout", JSON.stringify(next));
      } catch {}
      done();
      return;
    }
    api<BoardLayout>("/me/board-layout", { method: "PUT", body: JSON.stringify(next) })
      .then((r) => {
        setBoardLayout({ order: r.order ?? null, hidden: r.hidden || [] });
        done();
      })
      .catch((e) => {
        setBoardLayout(previous);
        notify((e as Error).message, "error");
      });
  };
  useEffect(() => {
    loadPosts();
  }, [loadPosts, version]);
  const reconnectAttempts = useRef(0);
  useEffect(() => {
    if (!loadError) {
      if (!loading) reconnectAttempts.current = 0;
      return;
    }
    if (loadError === "请先登录。") return;
    const retry = () => {
      syncMe().catch(() => {});
      refreshStats();
      loadPosts();
    };
    const timer = setTimeout(retry, Math.min(30000, 3000 * 2 ** reconnectAttempts.current++));
    const resume = () => document.visibilityState === "visible" && retry();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [loadError, loading, loadPosts, refreshStats, syncMe]);
  useEffect(() => {
    if (!accountMenu || modal) return;
    const close = (e: PointerEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (!accountRef.current?.contains(e.target as Node))
        setAccountMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [accountMenu, modal]);
  useEffect(() => {
    if (!moreMenu || modal) return;
    const close = (e: PointerEvent) => {
      const targetDialog = (e.target as Element)?.closest?.("dialog");
      if (targetDialog && targetDialog !== moreMenuRef.current?.closest("dialog")) return;
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreMenu(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMoreMenu(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [moreMenu, modal]);
  const scrollFeed = () =>
    setTimeout(
      () =>
        feedRef.current?.scrollIntoView({
          behavior: reducedMotion ? "instant" : "smooth",
          block: "start",
        }),
      60,
    );
  const navigate = (next: string, cat = "all") => {
    setPage(next);
    setCategory(cat);
    setSearch("");
    setMobileMenu(false);
    setAccountMenu(false);
    setDetail(null);
    setDetailLoading(false);
    detailSequence.current++;
    history.pushState(
      {},
      "",
      next === "/topics" && cat !== "all" ? "/topics/" + cat : next,
    );
    if (next === "/" || next === "/discover" || (next === "/topics" && cat !== "all")) {
      const smooth = page === next && category === cat && !reducedMotion;
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });
      if (!smooth)
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
    } else scrollFeed();
  };
  const handleAccountDeleted = () => {
    accountRevision.current++;
    listSequence.current++;
    pendingAction.current = null;
    pendingProfile.current = false;
    setUser(null); setProfile(null); setFollows([]); setUnread(0);
    setSubscriptions({ authors: [], boards: [] }); toasts.clearLive();
    setModal(""); setChatPeer(""); setComments([]); setPosts([]); setFeatured([]);
    setMembers([]); setPaletteResults([]); setTotal(0); setHasMore(false); setMoreMenu(false);
    try { localStorage.removeItem("nmk-draft"); } catch {}
    navigate("/");
    refreshStats();
    setVersion((value) => value + 1);
    notify("账户已删除", "success");
  };
  const openProfile = useCallback(
    (id: string) => {
      if (!id) return;
      setPage(profileUrl(id));
      setCategory("all");
      setSearch("");
      setModal("");
      setMobileMenu(false);
      setAccountMenu(false);
      setDetail(null);
      setDetailLoading(false);
      detailSequence.current++;
      if (location.pathname !== profileUrl(id))
        history.pushState({}, "", profileUrl(id));
      detailReturnUrl.current = profileUrl(id);
      window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
    },
    [reducedMotion],
  );
  useEffect(() => {
    setProfileNav(openProfile);
    return () => setProfileNav(null);
  }, [openProfile]);
  const assistantActions = useRef({ openPost: (_id: string) => {}, navigate: (_path: string, _cat?: string) => {}, openProfile, submitSearch: (_q: string) => {}, compose: () => {} });
  useEffect(() => {
    setAssistantNavigator((href) => {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return void window.open(url.href, "_blank", "noopener,noreferrer");
      const actions = assistantActions.current;
      const path = url.pathname;
      const discussion = path.match(/^\/discussion\/([^/]+)$/);
      if (discussion) return void actions.openPost(decodeURIComponent(discussion[1]));
      if (path === "/settings") return openSettingsRef.current(url.hash.slice(1) || "profile");
      const member = profileIdFromPath(path);
      if (member) return actions.openProfile(member);
      const topic = path.match(/^\/topics\/([^/]+)$/);
      if (topic) return actions.navigate("/topics", decodeURIComponent(topic[1]));
      if (path === "/search" && url.searchParams.get("q")) return actions.submitSearch(url.searchParams.get("q") || "");
      if (path === "/compose") return actions.compose();
      if (path.startsWith("/collections/")) return actions.navigate(path);
      const known = ["/", "/discover", "/topics", "/saved", "/read-later", "/history", "/mine", "/following"];
      actions.navigate(known.includes(path) ? path : "/discover");
    });
    return () => setAssistantNavigator(null);
  }, []);
  useEffect(() => {
    if (detail?.id && detail.title) rememberViewed({ id: detail.id, title: detail.title });
  }, [detail?.id, detail?.title]);
  useEffect(() => {
    const refresh = () => {
      syncMe().catch(() => {});
      refreshStats();
      setVersion((v) => v + 1);
      if (!detail?.id) return;
      const seq = detailSequence.current;
      api("/posts/" + encodeURIComponent(detail.id))
        .then((r) => {
          if (seq !== detailSequence.current) return;
          setDetail(r.post);
          setComments(r.comments);
        })
        .catch((e) => {
          if (seq === detailSequence.current && (e as { status?: number }).status === 404) closeDetail();
        });
    };
    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 200);
    };
    window.addEventListener("nmk-assistant-action", schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("nmk-assistant-action", schedule);
    };
  }, [detail?.id, syncMe, refreshStats]);
  useEffect(() => {
    const start = () => setAssistantReady(true);
    const idle = (window as { requestIdleCallback?: (fn: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      const handle = idle(start, { timeout: 2500 });
      return () => (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(start, 1200);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (page !== "/search" || !search) {
      setMembers([]);
      return;
    }
    let active = true;
    api("/users?" + new URLSearchParams({ q: search }))
      .then((r) => active && setMembers(r.users))
      .catch(() => active && setMembers([]));
    return () => {
      active = false;
    };
  }, [page, search]);
  const submitSearch = (value: string, tag = false) => {
    const query = normalizeSearchQuery(value.replace(/^#+/, ""));
    if (!query) return;
    setSearchTag(tag);
    searchRecents.remember(query);
    detailSequence.current++;
    listSequence.current++;
    setDetail(null);
    setDetailLoading(false);
    setModal("");
    setMobileMenu(false);
    setAccountMenu(false);
    setPage("/search");
    setSearch(query);
    setPaletteQuery(query);
    setCategory("all");
    setFilters(defaultFeedFilters);
    setPosts([]);
    setTotal(0);
    setHasMore(false);
    setLoading(true);
    setVersion((v) => v + 1);
    const url = searchUrl(query, "all", "hot", tag);
    if (location.pathname + location.search !== url)
      history.pushState({}, "", url);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const filterSearch = (nextCategory: string, nextSort: string) => {
    if (category === nextCategory && sort === nextSort) return;
    setCategory(nextCategory);
    setSort(nextSort);
    history.pushState({}, "", searchUrl(search, nextCategory, nextSort, searchTag));
  };
  const requireUser = (action: () => void) => {
    if (!user) {
      pendingAction.current = action;
      setModal("auth");
    } else action();
  };
  const muted = muteNotice(user);
  const staff = !!user && ["owner", "admin"].includes(user.role);
  const startComposing = () =>
    requireUser(() => (user?.muted ? notify(mutedLabel) : openComposer("compose")));
  function openComposer(kind: "compose" | "announce" | "edit", editId = detail?.id) {
    const url =
      kind === "edit" && editId
        ? "/compose?edit=" + encodeURIComponent(editId)
        : kind === "announce"
          ? "/compose?announcement=1"
          : "/compose";
    if (location.pathname !== "/compose") {
      history.pushState({ compose: kind }, "", url);
      compose.current.pushed = true;
    }
    setMoreMenu(false);
    setAccountMenu(false);
    setMobileMenu(false);
    setModal(kind);
  }
  function finishCompose() {
    setModal((m) => (composeKinds.includes(m) ? "" : m));
    const after = compose.current.after;
    compose.current.after = null;
    if (after) setTimeout(after, 0);
  }
  function closeComposer(after?: () => void) {
    compose.current.after = after || null;
    if (compose.current.pushed && location.pathname === "/compose") {
      compose.current.pushed = false;
      history.back();
      return;
    }
    if (location.pathname === "/compose")
      history.replaceState({}, "", detail ? "/discussion/" + encodeURIComponent(detail.id) : "/");
    finishCompose();
  }
  const finishComposeRef = useRef(finishCompose);
  finishComposeRef.current = finishCompose;
  async function openPost(id: string, push = true) {
    postOrigin.current = push ? rememberPostOrigin(id) : null;
    const seq = ++detailSequence.current;
    setDetail(posts.find((post) => post.id === id) || featured.find((post) => post.id === id) || null);
    setDetailLoading(true);
    setComments([]);
    setReplyError("");
    setConfirmDelete(false);
    setConfirmComment(null);
    if (push) {
      if (!location.pathname.startsWith("/discussion/"))
        detailReturnUrl.current = location.pathname + location.search;
      history.pushState({}, "", "/discussion/" + encodeURIComponent(id));
    }
    try {
      const r = await api("/posts/" + encodeURIComponent(id));
      if (seq !== detailSequence.current) return;
      setDetail(r.post);
      setComments(r.comments);
    } catch (e) {
      if (seq !== detailSequence.current) return;
      setDetail(null);
      notify((e as Error).message, (e as { data?: { deleted?: boolean } }).data?.deleted ? "info" : "error");
      history.replaceState({}, "", detailReturnUrl.current);
    } finally {
      if (seq === detailSequence.current) setDetailLoading(false);
    }
  }
  function closeDetail() {
    detailSequence.current++;
    setDetail(null);
    setDetailLoading(false);
    setConfirmDelete(false);
    setConfirmComment(null);
    setMoreMenu(false);
    history.replaceState({}, "", detailReturnUrl.current);
  }
  useEffect(() => {
    const initial = location.pathname.match(/^\/discussion\/([^/]+)$/);
    if (initial) openPost(decodeURIComponent(initial[1]), false);
    const pop = () => {
      if (composeKinds.includes(modalRef.current) && location.pathname !== "/compose") {
        compose.current.pushed = false;
        finishComposeRef.current();
        return;
      }
      if (location.pathname === "/compose") return;
      const match = location.pathname.match(/^\/discussion\/([^/]+)$/);
      if (match) openPost(decodeURIComponent(match[1]), false);
      else {
        detailSequence.current++;
        setDetail(null);
        setDetailLoading(false);
        setPage(currentPage());
        const nextSearch =
          location.pathname === "/search" ? readSearchState() : null;
        setSearch(nextSearch?.query || "");
        setSearchTag(nextSearch?.tag || false);
        setPaletteQuery(nextSearch?.query || "");
        if (nextSearch) setSort(nextSearch.sort);
        detailReturnUrl.current = location.pathname + location.search;
        setCategory(
          location.pathname.startsWith("/topics/")
            ? location.pathname.split("/")[2]
            : nextSearch?.category || "all",
        );
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal((m) => (m === "search" ? "" : "search"));
      }
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setAccountMenu(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (modal !== "search") return;
    let active = true;
    const timer = setTimeout(() => {
      setPaletteLoading(true);
      api("/posts?" + new URLSearchParams({ q: paletteQuery, sort: "hot" }))
        .then((r) => {
          if (active) setPaletteResults(r.posts.slice(0, 5));
        })
        .catch((e) => {
          if (active) notify(e.message);
        })
        .finally(() => {
          if (active) setPaletteLoading(false);
        });
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [paletteQuery, modal, notify]);
  const updatePost = (p: Post) => {
    setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    setFeatured((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    setDetail((d) => (d?.id === p.id ? p : d));
  };
  async function hideAnnouncement(p: Post) {
    setBusy(p.id + "hide");
    try {
      await api("/posts/" + p.id + "/hide-announcement", requestPost());
      setPosts((prev) => prev.filter((x) => x.id !== p.id));
      setHiddenAnnouncements((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
      setTotal((n) => Math.max(0, n - 1));
      setHideTarget(null);
      notify("公告已隐藏\n它收进了信息流最上方的「公告」里，展开即可查看或恢复。", "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }
  async function restoreAnnouncement(p: Post) {
    setBusy(p.id + "hide");
    try {
      await api("/posts/" + p.id + "/hide-announcement", { method: "DELETE" });
      setHiddenAnnouncements((prev) => {
        const next = prev.filter((x) => x.id !== p.id);
        if (!next.length) setAnnouncementsOpen(false);
        return next;
      });
      setPosts((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
      setTotal((n) => n + 1);
      notify("公告已恢复显示", "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }
  async function togglePost(p: Post, action: "like" | "bookmark" | "later" | "follow") {
    requireUser(async () => {
      if (action === "bookmark") {
        setSavingPost(p);
        return;
      }
      setBusy(p.id + action);
      try {
        const r = await api(
          "/posts/" + p.id + "/" + action,
          action === "later"
            ? { method: p.read_later ? "DELETE" : "PUT" }
            : requestPost(),
        );
        updatePost(r.post);
        if (action === "later") {
          notify(r.post.read_later ? "已加入稍后再看" : "已从稍后再看移除");
        }
        if (action === "follow")
          notify(r.post.followed ? "已关注这篇讨论\n有新的回复时会通知你。" : "已取消关注这篇讨论", "success");
        if (isLibraryPage) setVersion((v) => v + 1);
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBusy("");
      }
    });
  }
  async function follow(id: string) {
    requireUser(async () => {
      setBusy(id);
      try {
        const r = await api("/categories/" + id + "/follow", requestPost());
        setFollows((prev) =>
          r.followed ? [...prev, id] : prev.filter((x) => x !== id),
        );
        refreshStats();
        notify(
          r.followed ? "已关注版块，在「我的关注」查看动态" : "已取消关注",
        );
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBusy("");
      }
    });
  }
  async function toggleMembership(board: Category) {
    requireUser(async () => {
      setBusy(board.id + "member");
      try {
        const r = board.joined
          ? await api(`/categories/${board.id}/members/${user!.id}`, {
              method: "DELETE",
            })
          : await api(`/categories/${board.id}/members`, requestPost());
        boardChanged(r.category);
        notify(board.joined ? "已退出版块" : "已加入版块");
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBusy("");
      }
    });
  }
  function showNotifications(peer = "", focus = "") {
    requireUser(() => {
      setChatPeer(peer);
      if (peer) setChatRequest((n) => n + 1);
      setCentreFocus(focus);
      setCentreLive([]);
      toasts.clearOverflow();
      setModal("notifications");
    });
  }
  const centreOpen = modal === "notifications" && !!user;
  const governanceChanged = useCallback(() => {
    window.dispatchEvent(new Event("nmk-governance-changed"));
  }, []);
  useLiveNotifications(user?.id || null, {
    onUnread: setUnread,
    onUpdate: governanceChanged,
    onEvent: ({ notice, silent, unread: count }) => {
      setUnread(count);
      if (governanceKinds.has(notice.kind)) {
        syncMe().catch(() => {});
        refreshStats();
        governanceChanged();
      }
      if (centreOpen) return setCentreLive((list) => [...list, notice].slice(-50));
      if (silent || document.visibilityState !== "visible") return;
      toasts.live(notice);
    },
  });
  function openGovernanceRef(notice: { ref_type?: string; ref_id?: string }) {
    if (!notice.ref_id || !staff) return false;
    if (notice.ref_type === "appeal") openGovernance({ kind: "appeal", id: notice.ref_id });
    else if (notice.ref_type === "delete_request") openGovernance({ kind: "request", id: notice.ref_id });
    else if (notice.ref_type === "complaint_case") openGovernance({ kind: "case", id: notice.ref_id });
    else return false;
    return true;
  }
  function openNotice(notice: LiveNotice, toastId: string) {
    toasts.dismiss(toastId);
    if (notice.kind !== "message")
      api("/notifications/read", requestPost({ ids: [notice.id] }))
        .then((r) => setUnread(r.unread))
        .catch(() => {});
    switch (notice.kind) {
      case "message":
        return showNotifications(notice.peer_id || notice.actor?.id || "");
      case "follow":
        return notice.actor ? openProfile(notice.actor.id) : showNotifications("", notice.id);
      case "topic_post":
        return notice.topic ? openTopic(notice.topic) : notice.post_id ? openPost(notice.post_id) : showNotifications("", notice.id);
      case "moderation":
      case "appeal":
      case "admin_request":
      case "admin_action":
      case "system_event":
        return openGovernanceRef(notice) || showNotifications("", notice.id);
      default:
        return notice.post_id ? openPost(notice.post_id) : showNotifications("", notice.id);
    }
  }
  function openTopic(topic: NoticeTopic) {
    setModal("");
    if (topic.kind === "category") return navigate("/topics", topic.value);
    setTopicFocus({ kind: topic.kind, value: topic.value, nonce: Date.now() });
    navigate("/saved");
  }
  function openSettings(section = "profile") {
    setPage("/settings");
    setCategory("all");
    setSearch("");
    setModal("");
    setChatPeer("");
    setMobileMenu(false);
    setAccountMenu(false);
    setDetail(null);
    setDetailLoading(false);
    detailSequence.current++;
    const url = "/settings#" + section;
    if (location.pathname + location.hash !== url) history.pushState({}, "", url);
    detailReturnUrl.current = url;
    setSettingsFocus({ section, nonce: Date.now() });
    if (section === "profile") window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
  }
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;
  const pendingBells = useRef(new Set<string>());
  function toggleSubscription(kind: "author" | "board", id: string) {
    requireUser(async () => {
      const key = kind === "author" ? "authors" : "boards";
      const token = kind + ":" + id;
      if (pendingBells.current.has(token)) return;
      pendingBells.current.add(token);
      let turningOn = true;
      setSubscriptions((current) => {
        turningOn = !current[key].includes(id);
        return {
          ...current,
          [key]: turningOn ? [...current[key], id] : current[key].filter((x) => x !== id),
        };
      });
      const subject = kind === "author" ? "该作者" : "该版块";
      try {
        const r = await api(`/subscriptions/${key}/${encodeURIComponent(id)}`, {
          method: turningOn ? "PUT" : "DELETE",
        });
        setSubscriptions({ authors: r.authors, boards: r.boards });
        notify(`${r.subscribed ? "已开启" : "已关闭"}${subject}的新帖提醒`, "success");
      } catch (e) {
        setSubscriptions((current) => ({
          ...current,
          [key]: turningOn ? current[key].filter((x) => x !== id) : [...current[key], id],
        }));
        notify((e as Error).message, "error");
      } finally {
        pendingBells.current.delete(token);
      }
    });
  }
  async function sendReply(input: {
    content: string;
    parent_id: string | null;
    attachments: Attachment[];
    quotes: string[];
    inline_images: boolean;
  }) {
    if (!detail || !user) return setModal("auth");
    const id = detail.id;
    setBusy("reply");
    setReplyError("");
    try {
      const r = await api("/posts/" + id + "/comments", requestPost(input));
      setComments((prev) => [...prev, r.comment]);
      updatePost(r.post);
      refreshStats();
      notify(input.parent_id ? "回复已发布" : "评论已发布");
    } catch (e) {
      setReplyError((e as Error).message);
      throw e;
    } finally {
      setBusy("");
    }
  }
  async function voteComment(comment: Comment, value: number) {
    requireUser(async () => {
      setBusy(comment.id + "vote");
      try {
        const r = await api(
          "/comments/" + comment.id + "/vote",
          requestPost({ value }),
        );
        setComments((prev) =>
          prev.map((c) => (c.id === r.comment.id ? r.comment : c)),
        );
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBusy("");
      }
    });
  }
  async function copyLink(p: Post) {
    const url = location.origin + "/discussion/" + p.id;
    try {
      await navigator.clipboard.writeText(url);
      notify("讨论链接已复制\n发给站外的人也能直接打开。", "success");
    } catch {
      notify("当前讨论链接：" + url);
    }
  }
  const share = (p: Post) => openShare({ type: "post", post: p });
  useEffect(() => {
    setSharedChatHandler((token) => {
      setModal("");
      setAssistantReady(true);
      setSharedChat({ token, nonce: Date.now() });
    });
    return () => setSharedChatHandler(null);
  }, []);
  useEffect(() => {
    setShareHandler((target) => {
      setMoreMenu(false);
      setSharing(target);
    });
    return () => setShareHandler(null);
  }, []);
  useEffect(() => {
    if (!booted || !bootCompose.current) return;
    bootCompose.current = false;
    const params = new URLSearchParams(location.search);
    const editId = params.get("edit");
    const kind = editId ? "edit" : params.get("announcement") ? "announce" : "compose";
    if (!user) {
      history.replaceState({}, "", "/");
      pendingAction.current = () => openComposer(kind === "edit" ? "compose" : kind);
      setModal("auth");
      return;
    }
    if (kind === "announce" && user.role !== "owner") return void history.replaceState({}, "", "/");
    if (!editId) return setModal(kind);
    api("/posts/" + encodeURIComponent(editId))
      .then((r) => {
        detailReturnUrl.current = "/discover";
        setDetail(r.post);
        setComments(r.comments);
        setModal("edit");
      })
      .catch((e) => {
        history.replaceState({}, "", "/");
        notify((e as Error).message, "error");
      });
  }, [booted, user?.id]);
  async function editFromManager(id: string) {
    setManage(null);
    try {
      const r = await api("/posts/" + encodeURIComponent(id));
      if (!location.pathname.startsWith("/discussion/"))
        detailReturnUrl.current = location.pathname + location.search;
      detailSequence.current++;
      setDetail(r.post);
      setComments(r.comments);
      openComposer("edit", id);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }
  async function lockPost(locked: boolean, reason: string) {
    if (!detail) return;
    setBusy("lock");
    try {
      const r = await api("/admin/posts/" + detail.id + "/lock", {
        method: "PATCH",
        body: JSON.stringify({ locked, reason }),
      });
      updatePost(r.post);
      setModal("");
      setVersion((v) => v + 1);
      notify(
        locked
          ? "已禁言这篇帖子，作者会在消息中心收到提醒"
          : "已解除这篇帖子的禁言",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function deletePost(target: Post | null = detail) {
    if (!target) return;
    setBusy("delete");
    try {
      await api("/posts/" + target.id, { method: "DELETE" });
      if (detail?.id === target.id) closeDetail();
      setDeleteTarget(null);
      setConfirmDelete(false);
      setVersion((v) => v + 1);
      refreshStats();
      notify("讨论已删除");
    } catch (e) {
      if (needsRequest(e)) {
        setDeleteTarget(null);
        setConfirmDelete(false);
        openGovernance({ kind: "request-delete", type: "post", id: target.id, label: target.title });
      } else notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }
  async function deleteComment(comment: Comment) {
    if (!detail) return;
    setBusy("comment-delete");
    try {
      await api("/comments/" + comment.id, { method: "DELETE" });
      const fresh = await api("/posts/" + detail.id);
      setComments(fresh.comments);
      updatePost(fresh.post);
      setConfirmComment(null);
      refreshStats();
      notify("回复已删除");
    } catch (e) {
      if (needsRequest(e)) {
        setConfirmComment(null);
        openGovernance({
          kind: "request-delete",
          type: "comment",
          id: comment.id,
          label: `${comment.author_name}：${Array.from(comment.content.replace(/\s+/g, " ")).slice(0, 40).join("")}`,
        });
      } else notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }
  const mustRequest = (authorId: string, categoryId: string) => {
    if (user?.role !== "admin" || authorId === user.id) return false;
    const board = categories.find((c) => c.id === categoryId);
    return !(board?.lead?.id === user.id || board?.assistants.some((a) => a.id === user.id));
  };
  const removePost = (p: Post) =>
    mustRequest(p.author_id, p.category)
      ? openGovernance({ kind: "request-delete", type: "post", id: p.id, label: p.title })
      : detail?.id === p.id
        ? setConfirmDelete(true)
        : setDeleteTarget(p);
  const removeComment = (c: Comment) =>
    detail && mustRequest(c.author_id, detail.category)
      ? openGovernance({
          kind: "request-delete",
          type: "comment",
          id: c.id,
          label: `${c.author_name}：${Array.from(c.content.replace(/\s+/g, " ")).slice(0, 40).join("")}`,
        })
      : setConfirmComment(c);
  const reportPost = (p: Post) =>
    requireUser(() =>
      openGovernance({ kind: "report", type: "post", id: p.id, label: p.title, excerpt: Array.from(postDescription(p).replace(/\s+/g, " ")).slice(0, 400).join("") }),
    );
  const reportComment = (c: Comment) =>
    requireUser(() =>
      openGovernance({
        kind: "report",
        type: "comment",
        id: c.id,
        label: `${c.author_name} 的${c.parent_id ? "回复" : "评论"}`,
        excerpt: Array.from(c.content.replace(/\s+/g, " ")).slice(0, 400).join(""),
      }),
    );
  const historyMenu = useContextMenu<Post>();
  const postMenu = useContextMenu<Post>();
  async function removeHistory(body: { ids?: string[]; all?: boolean }) {
    setBusy("history");
    try {
      await api("/history", { method: "DELETE", body: JSON.stringify(body) });
      setConfirmHistory(null);
      setHistoryPicked([]);
      setHistoryBatch(false);
      setVersion((v) => v + 1);
      notify(body.all ? "已清空最近浏览" : "已从最近浏览中删除");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name || "探索";
  const iconFor = (id: string) =>
    boardIcon(categories.find((c) => c.id === id)?.icon);
  const activeCategory = categories.find((c) => c.id === category);
  useEffect(() => setBoardMenu(false), [category, page]);
  useEffect(() => {
    if (page !== "/topics" || category === "all" || activeCategory || !categories.length) {
      setRemovedBoard("");
      return;
    }
    let live = true;
    api("/categories/" + encodeURIComponent(category))
      .then(() => live && setRemovedBoard(""))
      .catch((e) => live && setRemovedBoard((e as { data?: { deleted?: boolean } }).data?.deleted ? "该内容已被删除" : "版块不存在"));
    return () => {
      live = false;
    };
  }, [page, category, activeCategory, categories.length]);
  const canModerate = (id: string) =>
    !!categories.find((c) => c.id === id)?.can_moderate;
  const boardChanged = (next: Category | null) => {
    if (next) setCategories((list) => list.map((c) => (c.id === next.id ? next : c)));
    else refreshStats();
  };
  const sectionTitle =
    page === "/saved" || page.startsWith("/collections/")
      ? page.startsWith("/collections/")
        ? "收藏夹"
        : "我的收藏"
      : page === "/read-later"
        ? "稍后再看"
        : page === "/history"
          ? "最近浏览"
          : page === "/mine"
            ? "我的讨论"
            : page === "/following"
              ? "我的关注"
              : page === "/topics"
                ? activeCategory?.name || (removedBoard ? "版块" : "找到你的好奇所在。")
                : "发现值得讨论的未来。";
  const routeIsPersonal = [
    "/saved",
    "/read-later",
    "/history",
    "/mine",
    "/following",
  ].includes(page);
  const isLibraryPage =
    page === "/saved" ||
    page === "/read-later" ||
    page.startsWith("/collections/");
  const announceScope =
    category === "all" &&
    !search &&
    !isLibraryPage &&
    !["/history", "/mine", "/following", "/search"].includes(page) &&
    !page.startsWith("/u/");
  const hiddenAnnouncementIds = new Set(hiddenAnnouncements.map((x) => x.id));
  const personalScope = (
    { "/mine": "mine", "/saved": "saved", "/read-later": "later", "/history": "history" } as Record<string, PersonalScope>
  )[page];
  const isFollowingPage = page === "/following";
  useEffect(() => setScopedActive(false), [page]);
  const highlightSearch = (value: string) => {
    if (page !== "/search" || !search) return value;
    const index = value.toLocaleLowerCase().indexOf(search.toLocaleLowerCase());
    return index < 0 ? (
      value
    ) : (
      <>
        {value.slice(0, index)}
        <mark>{value.slice(index, index + search.length)}</mark>
        {value.slice(index + search.length)}
      </>
    );
  };
  const postCard = (p: Post, i: number) => {
    if (p.deleted)
      return (
        <div className="removed-card" key={p.id} role="note">
          <FileX2 size={20} strokeWidth={1.6} />
          <div>
            <strong>该内容已被删除</strong>
            <small>{timeAgo(p.created_at)}发布</small>
          </div>
          {page === "/history" && (
            <LiquidButton type="button" className="button secondary" onClick={() => removeHistory({ ids: [p.id] })}>
              移除记录
            </LiquidButton>
          )}
        </div>
      );
    const announcement = p.kind === "announcement";
    const Icon = announcement ? Megaphone : iconFor(p.category);
    return (
      <MotionCard
        className={`post-card ${announcement ? "is-announcement" : ""}`}
        key={p.id} id={p.id} index={i} onContextMenu={page === "/history" || isLibraryPage ? undefined : (event) => postMenu.open(event, p)}
      >
        <div className="post-author">
          <Avatar
            name={p.author_name}
            initials={p.author_initials}
            avatar={p.author_avatar}
            className={`avatar-${p.category}`}
            userId={p.author_id}
          />
          {announcement && (
            <span className="announcement-label">
              <Megaphone size={12} />
              公告
            </span>
          )}
          <span className="author-name">{p.author_name}</span>
          <span className="meta-dot">·</span>
          <span>{timeAgo(p.created_at)}</span>
          {p.demo === 1 && <span className="sample-label">示例</span>}
          {p.visibility === "private" && (
            <span className="private-label">
              <Lock size={10} />
              仅自己可见
            </span>
          )}
          <span className="post-author-actions">
          <LiquidButton
            className={`save-button icon-button ${p.bookmarked ? "is-saved" : ""}`}
            aria-label={p.bookmarked ? "管理收藏夹" : "收藏讨论"}
            title={p.bookmarked ? "管理收藏夹" : "收藏到收藏夹"}
            disabled={busy === p.id + "bookmark"}
            onClick={() => togglePost(p, "bookmark")}
          >
            <ReactionIcon kind="bookmark" active={!!p.bookmarked} size={17} />
          </LiquidButton>
          {announcement && announceScope && (
            <LiquidButton
              type="button"
              className="icon-button hide-announcement-button"
              aria-label={hiddenAnnouncementIds.has(p.id) ? "恢复显示这条公告" : "隐藏这条公告"}
              title={hiddenAnnouncementIds.has(p.id) ? "恢复显示" : "隐藏公告"}
              disabled={busy === p.id + "hide"}
              onClick={() =>
                requireUser(() => (hiddenAnnouncementIds.has(p.id) ? restoreAnnouncement(p) : setHideTarget(p)))
              }
            >
              {hiddenAnnouncementIds.has(p.id) ? <Eye size={17} /> : <EyeOff size={17} />}
            </LiquidButton>
          )}
          <LiquidButton type="button" className="icon-button post-share-button" aria-label={"分享讨论：" + p.title} title="分享" onClick={() => share(p)}><Share2 size={16} /></LiquidButton>
          <LiquidButton type="button" className="icon-button post-more-button" aria-haspopup="menu" aria-label={"更多操作：" + p.title} onClick={(event) => postMenu.open(event, p)}><MoreHorizontal size={17} /></LiquidButton>
          </span>
        </div>
        <div className="post-link">
          <a
            className="post-title-link"
            href={"/discussion/" + p.id}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              openPost(p.id);
            }}
          >
            <h3>
              {p.pinned && <span className="pinned-label">置顶</span>}
              {p.kind === "project" && (
                <span className="project-label">共创</span>
              )}
              {highlightSearch(p.title)}
            </h3>
          </a>
          {postDescription(p) && (
            <TextDisclosure onActivate={() => openPost(p.id)}>
              {highlightSearch(postDescription(p))}
            </TextDisclosure>
          )}
        </div>
        <div className="post-footer">
          <LiquidButton
            className="category-label"
            onClick={() => {
              if (page === "/search") {
                setCategory(p.category);
                filterSearch(p.category, sort);
              } else if (announcement) setCategory(p.category);
              else navigate("/topics", p.category);
            }}
          >
            <Icon size={13} />
            {announcement ? "全站公告" : categoryName(p.category)}
          </LiquidButton>
          <div className="post-tags">
            {p.tags.slice(0, 2).map((t) => (
              <LiquidButton
                key={t}
                onClick={() => {
                  submitSearch(t, true);
                }}
              >
                #{t}
              </LiquidButton>
            ))}
          </div>
          <div className="post-stats">
            <span className="post-views" aria-label={`${p.views ?? 0} 人阅读`} title={`${p.views ?? 0} 人阅读`}>
              <Eye size={15} />
              {countLabel(p.views ?? 0)}
            </span>
            <LiquidButton
              className={`read-later-button ${p.read_later ? "is-saved" : ""}`}
              aria-pressed={p.read_later}
              disabled={busy === p.id + "later"}
              onClick={() => togglePost(p, "later")}
            >
              {p.read_later ? <Check size={15} /> : <Clock3 size={15} />}
              <span>{p.read_later ? "已加入稍后再看" : "稍后再看"}</span>
            </LiquidButton>
            <LiquidButton
              className={p.liked ? "is-liked" : ""}
              disabled={busy === p.id + "like"}
              onClick={() => togglePost(p, "like")}
              aria-label={`${p.liked ? "取消赞同" : "赞同"}，${p.likes} 人赞同`}
              aria-pressed={!!p.liked}
            >
              <ReactionIcon active={!!p.liked} size={15} />
              <MotionCount value={p.likes} />
            </LiquidButton>
            <LiquidButton
              className={p.comments_closed || p.locked ? "is-closed" : ""}
              onClick={() => openPost(p.id)}
              aria-label={
                p.comments_closed || p.locked
                  ? `评论已关闭，已有 ${p.comments} 条回复`
                  : `查看 ${p.comments} 条回复`
              }
              title={
                p.locked
                  ? "站主已关闭评论"
                  : p.comments_closed
                    ? "作者已关闭评论"
                    : undefined
              }
            >
              {p.comments_closed || p.locked ? (
                <MessageCircleOff size={15} />
              ) : (
                <MessageCircle size={15} />
              )}
              {p.comments}
            </LiquidButton>
          </div>
        </div>
      </MotionCard>
    );
  };
  const renderFeedItem = (p: Post, i: number) => {
    if (page !== "/history") return postCard(p, i);
    const checked = historyPicked.includes(p.id);
    return (
      <div
        className={`library-post-wrap ${checked ? "checked" : ""}`}
        key={p.id}
        onContextMenu={(e) => historyMenu.open(e, p)}
      >
        {historyBatch && (
          <label className="library-post-checkbox">
            <input
              type="checkbox"
              aria-label={"选择浏览记录：" + p.title}
              checked={checked}
              onChange={() =>
                setHistoryPicked((prev) =>
                  prev.includes(p.id)
                    ? prev.filter((id) => id !== p.id)
                    : [...prev, p.id],
                )
              }
            />
            <span>选择记录</span>
          </label>
        )}
        {postCard(p, i)}
      </div>
    );
  };
  assistantActions.current = {
    openPost: (id) => void openPost(id),
    navigate,
    openProfile,
    submitSearch: (q) => submitSearch(q),
    compose: startComposing,
  };
  return (
    <LayoutGroup>
      <LandingLayer
        onSignIn={() => {
          accountRevision.current++;
          syncMe().catch(() => {});
          refreshStats();
          setVersion((v) => v + 1);
        }}
        onEnter={() => setWelcome(true)}
      />
      <div className={`app-shell ${page === "/" ? "is-home" : ""}`}>
        <a className="skip-link" href={page === "/" ? "#home-content" : "#discussions"}>
          {page === "/" ? "跳至首页内容" : "跳至讨论"}
        </a>
        <header
          className={`site-header ${headerHidden ? "is-scrolling" : ""}`}
          onFocusCapture={() => setHeaderHidden(false)}
        >
          <div className="header-inner">
            <a
              className="brand"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              <BrandMark onDark />
              <span className="brand-divider" />
              <span className="brand-name">Naimakes 论坛</span>
            </a>
            <PrimaryNavigation page={page} navigate={navigate} />
            <div className="header-actions">
              <LiquidButton
                type="button"
                className="header-search"
                aria-label={`搜索社区，快捷键 ${shortcutMac ? "Command" : "Ctrl"} K`}
                aria-haspopup="dialog"
                aria-keyshortcuts={shortcutMac ? "Meta+K" : "Control+K"}
                onClick={() => setModal("search")}
              >
                <Search size={16} />
                <span>搜索</span>
                <kbd aria-hidden="true">{shortcutMac ? "⌘K" : "Ctrl K"}</kbd>
              </LiquidButton>
              <span className="action-divider" />
              <LiquidButton
                className="icon-button notification-button"
                title="消息通知"
                aria-label="消息通知"
                onClick={() => showNotifications()}
              >
                <Bell size={18} />
                {unread > 0 && <span className="notification-dot" />}
              </LiquidButton>
              <LiquidButton type="button" className="icon-button header-profile" aria-label="我的主页" onClick={() => { if (user) openProfile(user.id); else { pendingProfile.current = true; setModal("auth"); } }}><UserRound size={17}/></LiquidButton>
              {user ? (
                <div className="account-wrap" ref={accountRef} data-popover-owner="account">
                  <LiquidButton
                    className="user-button"
                    aria-label="个人菜单"
                    aria-expanded={accountMenu}
                    aria-haspopup="menu"
                    onClick={() => setAccountMenu((open) => !open)}
                  >
                    {user.avatar ? <img className="account-avatar-image" src={user.avatar} alt="" /> : user.initials}
                  </LiquidButton>
                  <LiquidPopover open={accountMenu} className="account-menu glass" label="个人菜单" onClose={() => setAccountMenu(false)}>
                      <div className="account-summary">
                        <strong>{user.name}</strong>
                        <span>{user.bio || "保持好奇，继续探索。"}</span>
                        {muted && <span className="account-muted">{muted}</span>}
                      </div>
                      <LiquidButton onClick={() => openProfile(user.id)}>
                        <UserRound size={16} />
                        我的主页
                      </LiquidButton>
                      <LiquidButton onClick={() => openSettings("profile")}>
                        <Settings2 size={16} />
                        设置
                      </LiquidButton>
                      {[
                        [PenLine, "我的讨论", "/mine"],
                        [Bookmark, "我的收藏", "/saved"],
                        [Users, "我的关注", "/following"],
                        [Clock3, "稍后再看", "/read-later"],
                        [History, "最近浏览", "/history"],
                      ].map(([Icon, label, path]: any, i: number) => (
                        <LiquidButton
                          key={path}
                          className={i === 0 ? "menu-group-start" : ""}
                          onClick={() => navigate(path)}
                        >
                          <Icon size={16} />
                          {label}
                        </LiquidButton>
                      ))}
                      {user.role === "owner" && (
                        <LiquidButton
                          className="announce-entry menu-group-start"
                          onClick={() => openComposer("announce")}
                        >
                          <Megaphone size={16} />
                          发布公告
                        </LiquidButton>
                      )}
                      <LiquidButton
                        className="menu-group-start"
                        onClick={() => {
                          setAccountMenu(false);
                          setManage({ kind: "posts" });
                        }}
                      >
                        <ChartLine size={16} />
                        管理帖子
                      </LiquidButton>
                      {categories.some((c) => c.can_moderate || c.can_lead) && (
                        <LiquidButton
                          onClick={() => {
                            setAccountMenu(false);
                            setManage({ kind: "boards" });
                          }}
                        >
                          <ShieldCheck size={16} />
                          管理版块
                        </LiquidButton>
                      )}
                      {["owner", "admin"].includes(user.role) && (
                        <LiquidButton
                          onClick={async () => {
                              try {
                              setAccountMenu(false);
                              setModal("admin");
                            } catch (e) {
                              notify((e as Error).message);
                            }
                          }}
                        >
                          <Flag size={16} />
                          管理后台
                        </LiquidButton>
                      )}
                      <LiquidButton className="menu-group-start" onClick={() => setModal("logout")}>
                        <LogOut size={16} />
                        退出登录
                      </LiquidButton>
                    </LiquidPopover>

                </div>
              ) : (
                <LiquidButton
                  className="button glass-button login-button"
                  onClick={() => {
                    pendingAction.current = null;
                    setModal("auth");
                  }}
                >
                  加入社区
                  <ArrowUpRight size={14} />
                </LiquidButton>
              )}
              <LiquidButton
                className="icon-button mobile-toggle"
                ref={mobileTrigger}
                aria-label="展开导航"
                aria-expanded={mobileMenu}
                onClick={() => setMobileMenu(!mobileMenu)}
              >
                {mobileMenu ? <X size={21} /> : <Menu size={21} />}
              </LiquidButton>
            </div>
          </div>
          <LiquidPopover open={mobileMenu} triggerRef={mobileTrigger} className="mobile-nav" role="navigation" label="移动端导航" onClose={() => setMobileMenu(false)}>
              <LiquidButton
                onClick={() => {
                  setMobileMenu(false);
                  if (user) openProfile(user.id); else { pendingProfile.current = true; setModal("auth"); }
                }}
              >
                我的主页
              </LiquidButton>
              <LiquidButton onClick={() => openSettings(user ? "profile" : "assistant")}>
                设置
              </LiquidButton>
            </LiquidPopover>
        </header>
        <main id="home-content" tabIndex={-1} ref={pageTransitionRef}>
          {page === "/" && <HomeExperience welcome={welcome} onDiscover={() => navigate("/discover")} onBoard={(id) => navigate("/topics", id)} onExplore={() => navigate("/topics")} />}
          {page === "/" ? null : page === "/settings" ? (
            <Suspense fallback={<LoadingPopup />}>
              {user ? (
                <Profile
                  key={"settings:" + user.id}
                  id={user.id}
                  me={user}
                  settings={profile}
                  onSettings={setProfile}
                  onUser={(next) => {
                    setUser(next);
                    setVersion((v) => v + 1);
                  }}
                  onAccountDeleted={handleAccountDeleted}
                  onOpenProfile={openProfile}
                  onOpenPost={openPost}
                  onOpenBoard={(id) => navigate("/topics", id)}
                  onRequireAuth={() => {
                    pendingAction.current = null;
                    setModal("auth");
                  }}
                  onMessage={(peer) => showNotifications(peer)}
                  onBack={() => navigate("/discover")}
                  notify={notify}
                  renderPost={postCard}
                  subscriptions={subscriptions}
                  onSubscribe={toggleSubscription}
                  initialTab="settings"
                  focus={settingsFocus}
                  onLogout={() => setModal("logout")}
                />
              ) : (
                <GuestSettings
                  onSignIn={() => {
                    pendingAction.current = null;
                    setModal("auth");
                  }}
                  onBack={() => navigate("/discover")}
                />
              )}
            </Suspense>
          ) : page.startsWith("/u/") ? (
            <Suspense fallback={<LoadingPopup />}>
              <Profile
                key={page}
                id={profileIdFromPath(page)}
                me={user}
                settings={profile}
                onSettings={setProfile}
                onUser={setUser}
                onAccountDeleted={handleAccountDeleted}
                onOpenProfile={openProfile}
                onOpenPost={openPost}
                onOpenBoard={(id) => navigate("/topics", id)}
                onRequireAuth={() => {
                  pendingAction.current = null;
                  setModal("auth");
                }}
                onMessage={(peer) => showNotifications(peer)}
                onBack={() => navigate("/discover")}
                notify={notify}
                renderPost={postCard}
                subscriptions={subscriptions}
                onSubscribe={toggleSubscription}
                onLogout={() => setModal("logout")}
              />
            </Suspense>
          ) : page === "/search" ? (
            <SearchResults
              query={search}
              keyword={searchTag}
              exactTotal={searchTotals.exact}
              relatedTotal={searchTotals.related}
              category={category}
              sort={sort}
              categories={categories}
              posts={posts}
              total={total}
              loading={loading}
              error={loadError}
              hasMore={hasMore}
              onSearch={submitSearch}
              onFilter={filterSearch}
              onBack={() => navigate("/discover")}
              onRetry={() => loadPosts()}
              onMore={() => loadPosts(posts.length)}
              renderPost={postCard}
              members={members}
              onOpenMember={openProfile}
            />
          ) : (
            <section
              key={routeIsPersonal || isLibraryPage ? page : "feed"}
              className={`community-section ${page !== "/discover" ? "inner-page" : ""} ${page === "/mine" || page === "/history" ? "lean-tools" : ""}`}
              id="discussions"
              ref={feedRef}
            >
              <div className="section-heading">
                <div>
                  {activeCategory && page === "/topics" && (
                    <LiquidButton
                      className="button secondary board-back"
                      onClick={() => navigate("/topics")}
                    >
                      <ArrowLeft size={16} />
                      返回话题广场
                    </LiquidButton>
                  )}
                  <div className="eyebrow">
                    {routeIsPersonal
                      ? "YOUR SPACE. YOUR CURIOSITY."
                      : page === "/topics"
                        ? "FOLLOW YOUR CURIOSITY"
                        : "THE CONVERSATION STARTS HERE"}
                  </div>
                  <h2>{sectionTitle}</h2>
                  {activeCategory && page === "/topics" && (
                    <>
                      <p>{activeCategory.description}</p>
                      {!!activeCategory.muted && (
                        <div className="board-mute-line">
                          <MuteBadge
                            kind="board"
                            targetId={activeCategory.id}
                            label={activeCategory.name}
                            mute={{
                              until: activeCategory.muted_until ?? null,
                              starts_at: activeCategory.mute_started_at,
                              reason: activeCategory.mute_reason,
                              appeal_pending: !!activeCategory.appeal_pending,
                              cooldown_until: activeCategory.appeal_cooldown_until,
                            }}
                            canAppeal={!!activeCategory.can_appeal}
                            onAppealed={() => {
                              notify("申诉已提交，站主处理后会通知你。", "success");
                              refreshStats();
                            }}
                          />
                        </div>
                      )}
                      <p className="board-lead-line">
                        <Award size={13} />
                        {activeCategory.lead ? (
                          <>
                            版主
                            <LiquidButton
                              className="text-button"
                              onClick={() =>
                                showNotifications(activeCategory.lead!.id)
                              }
                            >
                              {activeCategory.lead.name}
                            </LiquidButton>
                          </>
                        ) : (
                          <>
                            暂无版主，由站主
                            {activeCategory.acting_owner
                              ? ` ${activeCategory.acting_owner.name} `
                              : ""}
                            代管
                          </>
                        )}
                        {activeCategory.assistants.length > 0 &&
                          ` · ${activeCategory.assistants.length} 位协管`}
                      </p>
                    </>
                  )}
                </div>
                <div className="section-actions">
                  {page === "/topics" && !activeCategory && (
                    <LiquidButton
                      className="button secondary"
                      onClick={() =>
                        requireUser(() => setModal("create-board"))
                      }
                    >
                      <Plus size={16} />
                      创建版块
                    </LiquidButton>
                  )}
                  {activeCategory && (
                    <SubscribeBell
                      subscribed={subscriptions.boards.includes(activeCategory.id)}
                      label={activeCategory.name}
                      onToggle={() => toggleSubscription("board", activeCategory.id)}
                      className="board-bell"
                    />
                  )}
                  {activeCategory && (
                    <LiquidButton
                      className="button secondary"
                      onClick={() => follow(activeCategory.id)}
                      disabled={busy === activeCategory.id}
                    >
                      {follows.includes(activeCategory.id) ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}{" "}
                      {follows.includes(activeCategory.id)
                        ? "已关注"
                        : "关注版块"}
                    </LiquidButton>
                  )}
                  {activeCategory && (
                    <LiquidButton
                      className="button secondary"
                      onClick={() => toggleMembership(activeCategory)}
                      disabled={busy === activeCategory.id + "member"}
                    >
                      {activeCategory.joined ? (
                        <UserMinus size={16} />
                      ) : (
                        <UserPlus size={16} />
                      )}{" "}
                      {activeCategory.joined ? "退出版块" : "加入版块"}
                    </LiquidButton>
                  )}
                  {activeCategory && (
                      <div className="board-more" data-popover-owner="board-more">
                        <LiquidButton
                          ref={boardMenuTrigger}
                          type="button"
                          className="button secondary board-more-trigger"
                          aria-label="更多版块操作"
                          title="更多"
                          aria-haspopup="menu"
                          aria-expanded={boardMenu}
                          onClick={() => setBoardMenu((open) => !open)}
                        >
                          <MoreHorizontal size={18} />
                        </LiquidButton>
                        <LiquidPopover
                          open={boardMenu}
                          triggerRef={boardMenuTrigger}
                          className="board-more-menu glass"
                          label="版块操作"
                          onClose={() => setBoardMenu(false)}
                        >
                          <LiquidButton
                            onClick={() => {
                              setBoardMenu(false);
                              openShare({ type: "board", board: activeCategory });
                            }}
                          >
                            <Share2 size={16} />
                            分享版块
                          </LiquidButton>
                          {activeCategory.can_report && (
                            <LiquidButton
                              className="board-report-item"
                              onClick={() => {
                                setBoardMenu(false);
                                openGovernance({
                                  kind: "report",
                                  type: "board",
                                  id: activeCategory.id,
                                  label: activeCategory.name,
                                  excerpt: activeCategory.description,
                                });
                              }}
                            >
                              <Flag size={16} />
                              投诉
                            </LiquidButton>
                          )}
                          {(activeCategory.can_moderate || activeCategory.can_lead) && (
                            <LiquidButton
                              onClick={() => {
                                setBoardMenu(false);
                                setManage({ kind: "boards", focus: activeCategory.id });
                              }}
                            >
                              <ShieldCheck size={16} />
                              管理版块
                            </LiquidButton>
                          )}
                        </LiquidPopover>
                      </div>
                  )}
                  <LiquidButton
                    className={
                      "button primary" +
                      (["/discover", "/topics", "/mine"].includes(page) ? "" : " compose-off-mobile")
                    }
                    onClick={startComposing}
                  >
                    <Plus size={16} />
                    发起讨论
                  </LiquidButton>
                </div>
              </div>
              {personalScope && user && (
                <ScopedSearch
                  key={page + ":" + user.id}
                  scope={personalScope}
                  renderPost={postCard}
                  onOpenPost={openPost}
                  onOpenProfile={openProfile}
                  onActive={setScopedActive}
                />
              )}
              {page === "/topics" && category === "all" && (
                <div className="category-grid">
                  {[...categories]
                    .sort(byViews)
                    .slice(0, 5)
                    .map((c, i) => {
                    const Icon = iconFor(c.id);
                    return (
                      <motion.article
                        className="topic-card"
                        key={c.id}
                        whileHover={reducedMotion ? {} : { y: -5 }}
                      >
                        <div className="topic-card-top">
                          <Icon size={28} strokeWidth={1.1} />
                          <span>0{i + 1}</span>
                        </div>
                        <a
                          href={"/topics/" + c.id}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate("/topics", c.id);
                          }}
                        >
                          <span className="eyebrow">{c.en}</span>
                          <h3>
                            {c.name}
                            <ArrowUpRight size={18} />
                          </h3>
                          <p>{c.description}</p>
                        </a>
                        <div className="topic-card-meta">
                          <Award size={12} />
                          {c.lead ? `版主 ${c.lead.name}` : "站主代管"}
                          {c.builtin ? "" : " · 成员创建"}
                        </div>
                        <div className="topic-card-footer">
                          <span>
                            {countLabel(c.views ?? 0)} 人阅读 · {c.posts} 个讨论 · {c.followers} 人关注
                          </span>
                          <SubscribeBell
                            subscribed={subscriptions.boards.includes(c.id)}
                            label={c.name}
                            size={15}
                            className="is-compact topic-card-bell"
                            onToggle={() => toggleSubscription("board", c.id)}
                          />
                          <LiquidButton
                            className="icon-button topic-card-share"
                            aria-label={"分享版块：" + c.name}
                            title="分享版块"
                            onClick={() => openShare({ type: "board", board: c })}
                          >
                            <Share2 size={15} />
                          </LiquidButton>
                          <LiquidButton
                            className={`button ${follows.includes(c.id) ? "secondary" : "primary"}`}
                            onClick={() => follow(c.id)}
                            disabled={busy === c.id}
                          >
                            {follows.includes(c.id) ? (
                              <Check size={14} />
                            ) : (
                              <Plus size={14} />
                            )}{" "}
                            {follows.includes(c.id) ? "已关注" : "关注"}
                          </LiquidButton>
                        </div>
                      </motion.article>
                    );
                  })}
                  <LiquidButton
                    type="button"
                    className="topic-card topic-card-new"
                    onClick={() => requireUser(() => setModal("create-board"))}
                  >
                    <Plus size={26} strokeWidth={1.2} />
                    <h3>创建新版块</h3>
                    <p>
                      没有合适的去处？开一个版块，第一位在这里发帖的人将成为版主。
                    </p>
                  </LiquidButton>
                </div>
              )}
              {page === "/discover" && !search && category === "all" && (
                <FeaturedRail
                  posts={featured}
                  iconFor={iconFor}
                  categoryName={categoryName}
                  onOpen={openPost}
                />
              )}
              {page === "/mine" && user && !scopedActive && (
                <div className="personal-banner">
                  <Avatar
                    name={user.name}
                    initials={user.initials}
                    avatar={user.avatar}
                    className="profile-avatar"
                    userId={user.id}
                  />
                  <div>
                    <h3>{user.name}</h3>
                    <p>{user.bio || "用想法介绍自己，用行动定义未来。"}</p>
                  </div>
                  <LiquidButton
                    className="button secondary"
                    onClick={() => setModal("profile")}
                  >
                    编辑资料
                    <PenLine size={14} />
                  </LiquidButton>
                </div>
              )}
              {scopedActive ? null : removedBoard ? (
                <div className="empty-state">
                  <FileX2 size={40} strokeWidth={1} />
                  <h3>{removedBoard}</h3>
                  <LiquidButton className="button secondary" onClick={() => navigate("/topics")}>
                    浏览全部版块
                    <ArrowUpRight size={15} />
                  </LiquidButton>
                </div>
              ) : isLibraryPage ? (
                <Library
                  key={page + ":" + (user?.id || "guest")}
                  user={user}
                  categories={categories}
                  version={version}
                  startLater={page === "/read-later"}
                  publicId={
                    page.startsWith("/collections/")
                      ? page.split("/")[2]
                      : undefined
                  }
                  renderPost={postCard}
                  onLogin={() => setModal("auth")}
                  onDiscover={() => navigate("/discover")}
                  onChange={() => setVersion((v) => v + 1)}
                  notify={notify}
                  focusTopic={page === "/saved" ? topicFocus : null}
                />
              ) : (
                <motion.div layout className="community-layout" transition={transitions.surface}>
                  <div className="discussion-column">
                    {!isFollowingPage && (
                      <>
                      <div className="feed-nav">
                        <GlassSegments<string>
                          className="feed-segs is-compact"
                          label="讨论排序"
                          value={customFeed ? "custom" : sort}
                          onChange={(id) =>
                            id === "custom"
                              ? setModal("feed-filter")
                              : setFilters({ ...defaultFeedFilters, sort: id })
                          }
                          items={[
                            ["hot", "为你推荐", Flame],
                            ["new", "最新发布", Clock3],
                            ["views", "阅读最多", Eye],
                            ["comments", "最热讨论", MessagesSquare],
                            ["unanswered", "等待回应", MessageCircle],
                            ["custom", "自定义", SlidersHorizontal],
                          ].map(([id, label, Icon]: any) => ({
                            id,
                            label,
                            icon: <Icon size={15} />,
                            reselect: id === "custom",
                          }))}
                        />
                      </div>
                      <BoardBar
                        categories={categories}
                        value={category}
                        onChange={setCategory}
                        layout={boardLayout}
                        onLayoutChange={saveBoardLayout}
                        iconFor={iconFor}
                      />
                      </>
                    )}
                    {isFollowingPage ? (
                      <FollowingLists
                        version={version}
                        onOpenProfile={openProfile}
                        onOpenBoard={(id) => navigate("/topics", id)}
                        onChange={() => {
                          syncMe().catch(() => {});
                          refreshStats();
                        }}
                        notify={notify}
                      />
                    ) : (
                      <>
                      {page === "/history" && user && (
                        <div className="history-toolbar">
                          <span>共 {total} 条浏览记录</span>
                          <LiquidButton
                            className={`button secondary compact ${historyBatch ? "selected" : ""}`}
                            onClick={() => {
                              setHistoryBatch(!historyBatch);
                              setHistoryPicked([]);
                            }}
                          >
                            <List size={15} />
                            {historyBatch ? "退出管理" : "批量管理"}
                          </LiquidButton>
                          <LiquidButton
                            className="text-button danger-text"
                            disabled={!posts.length || busy === "history"}
                            onClick={() => setConfirmHistory("all")}
                          >
                            <Trash2 size={14} />
                            一键清空
                          </LiquidButton>
                        </div>
                      )}
                      {page === "/history" && historyBatch && (
                        <div className="library-batch-bar">
                          <label>
                            <input
                              type="checkbox"
                              checked={
                                posts.length > 0 &&
                                historyPicked.length === posts.length
                              }
                              onChange={(e) =>
                                setHistoryPicked(
                                  e.target.checked ? posts.map((p) => p.id) : [],
                                )
                              }
                            />
                            全选当前列表{" "}
                            <span>已选 {historyPicked.length}</span>
                          </label>
                          <LiquidButton
                            className="text-button danger"
                            disabled={!historyPicked.length || busy === "history"}
                            onClick={() => setConfirmHistory("picked")}
                          >
                            <Trash2 size={14} />
                            删除所选
                          </LiquidButton>
                        </div>
                      )}
                      {search && (
                        <div className="search-result-heading">
                          <span>
                            「{search}」的搜索结果 · {total} 篇
                          </span>
                          <LiquidButton
                            className="text-button"
                            onClick={() => setSearch("")}
                          >
                            <X size={14} />
                            清除
                          </LiquidButton>
                        </div>
                      )}
                      {announceScope && !loadError && hiddenAnnouncements.length > 0 && (
                        <section className={`announce-fold ${announcementsOpen ? "is-open" : ""}`}>
                          <LiquidButton
                            type="button"
                            className="announce-fold-pill"
                            aria-expanded={announcementsOpen}
                            aria-label={`已隐藏的公告 ${hiddenAnnouncements.length} 条，${announcementsOpen ? "收起" : "展开"}`}
                            onClick={() => setAnnouncementsOpen((open) => !open)}
                          >
                            <span>公告</span>
                            <em>{hiddenAnnouncements.length}</em>
                          </LiquidButton>
                          <AnimatePresence initial={false}>
                            {announcementsOpen && (
                              <ClipMotion
                                className="announce-fold-list post-list"
                                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                                animate={reducedMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                                transition={reducedMotion ? { duration: 0.12 } : transitions.surface}
                              >
                                {hiddenAnnouncements.map((p, i) => postCard(p, i))}
                              </ClipMotion>
                            )}
                          </AnimatePresence>
                        </section>
                      )}
                      <div
                        className="feed-results"
                        ref={feedSwapRef}
                        data-pending={(feedPending && loading) || undefined}
                      >
                      {loadError ? (
                        <div className="empty-state">
                          <Telescope size={36} strokeWidth={1} />
                          <h3>
                            {routeIsPersonal && !user
                              ? "你的探索，值得被记录。"
                              : "连接暂时中断"}
                          </h3>
                          <p>{loadError}</p>
                          <LiquidButton
                            className="button primary"
                            onClick={() =>
                              routeIsPersonal && !user
                                ? setModal("auth")
                                : loadPosts()
                            }
                          >
                            {routeIsPersonal && !user ? "登录社区" : "重新连接"}
                            <ArrowRight size={16} />
                          </LiquidButton>
                        </div>
                      ) : loading && posts.length === 0 ? (
                        <div className="feed-skeleton" aria-label="正在加载讨论">
                          {[1, 2, 3].map((x) => (
                            <div key={x}>
                              <span />
                              <b />
                              <p />
                            </div>
                          ))}
                        </div>
                      ) : posts.length === 0 ? (
                        <div className="empty-state">
                          <Orbit size={42} strokeWidth={1} />
                          <h3>
                            {page === "/saved"
                              ? "留住值得再读的想法。"
                              : page === "/following"
                                ? "从一个好奇的方向开始。"
                                : search
                                  ? "还没有找到相关讨论"
                                  : "下一场好讨论，由你开启。"}
                          </h3>
                          <p>
                            {page === "/saved"
                              ? "点击讨论旁的收藏图标，它就会出现在这里。"
                              : page === "/following"
                                ? "在话题广场关注版块，即可在这里看到新的讨论。"
                                : search
                                  ? "试试另一个关键词，或发起属于你的讨论。"
                                  : "每个未来，都从第一个想法开始。"}
                          </p>
                          <LiquidButton
                            className="button secondary"
                            onClick={() =>
                              page === "/following"
                                ? navigate("/topics")
                                : page === "/saved" || page === "/history"
                                  ? navigate("/")
                                  : startComposing()
                            }
                          >
                            {page === "/following"
                              ? "浏览话题"
                              : page === "/saved" || page === "/history"
                                ? "发现讨论"
                                : "发起讨论"}
                            <ArrowUpRight size={15} />
                          </LiquidButton>
                        </div>
                      ) : (
                        <div className="post-list">
                          {posts.map(renderFeedItem)}
                        </div>
                      )}
                      {hasMore ? (
                        <LiquidButton
                          className="load-more"
                          onClick={() => loadPosts(posts.length)}
                          disabled={loading}
                        >
                          {loading ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            "加载更多讨论"
                          )}
                          <ChevronDown size={15} />
                        </LiquidButton>
                      ) : (
                        posts.length > 0 && (
                          <div className="feed-end">
                            <span />
                            好奇心，没有终点。
                            <span />
                          </div>
                        )
                      )}
                      </div>
                      </>
                    )}
                  </div>
                  <MotionSidebar activeId={category} shortcuts={[...categories].sort(byViews).slice(0, 4).map((c) => { const Icon = iconFor(c.id); return { id: c.id, label: c.name, icon: <Icon size={18} />, onClick: () => navigate("/topics", c.id) }; })}>
                    <div className="welcome-card">
                      <div className="welcome-top">
                        <BrandMark />
                        <ArrowUpRight size={18} />
                      </div>
                      <h3>
                        保持好奇。
                        <br />
                        与未来同行。
                      </h3>
                      <p>
                        这里是探索者、思考者与创造者的交汇点。每一种想法，都有回声。
                      </p>
                      <LiquidButton
                        className="button liquid-light full-width"
                        onClick={() =>
                          user ? navigate("/topics") : setModal("auth")
                        }
                      >
                        {user ? "发现我的兴趣" : "成为其中一员"}
                        <ArrowUpRight size={16} />
                      </LiquidButton>
                      <div className="community-numbers">
                        <div>
                          <strong>
                            {stats.posts}
                            <span>+</span>
                          </strong>
                          <span>开放讨论</span>
                        </div>
                        <div>
                          <strong>
                            {categories.length.toString().padStart(2, "0")}
                          </strong>
                          <span>探索领域</span>
                        </div>
                        <div>
                          <strong>
                            {stats.members.toString().padStart(2, "0")}
                          </strong>
                          <span>社区成员</span>
                        </div>
                      </div>
                    </div>
                    <div className="sidebar-section">
                      <div className="sidebar-heading">
                        <h3>探索版块</h3>
                        <LiquidButton
                          className="icon-button"
                          aria-label="查看全部版块"
                          onClick={() => navigate("/topics")}
                        >
                          <ArrowUpRight size={16} />
                        </LiquidButton>
                      </div>
                      {[...categories].sort(byViews).slice(0, 4).map((c) => {
                        const Icon = iconFor(c.id);
                        return (
                          <div className="sidebar-topic" key={c.id}>
                            <LiquidButton onClick={() => navigate("/topics", c.id)}>
                              <span className="topic-icon">
                                <Icon size={19} strokeWidth={1.5} />
                              </span>
                              <span>
                                <strong>{c.name}</strong>
                                <small>{countLabel(c.views ?? 0)} 人阅读 · {c.posts} 个讨论</small>
                              </span>
                            </LiquidButton>
                            <LiquidButton
                              className="topic-follow"
                              aria-label={
                                follows.includes(c.id)
                                  ? "取消关注" + c.name
                                  : "关注" + c.name
                              }
                              title={
                                follows.includes(c.id) ? "取消关注" : "关注版块"
                              }
                              onClick={() => follow(c.id)}
                              disabled={busy === c.id}
                            >
                              {follows.includes(c.id) ? (
                                <Check size={15} />
                              ) : (
                                <Plus size={15} />
                              )}
                            </LiquidButton>
                          </div>
                        );
                      })}
                    </div>
                    {stats.demo && (
                      <p className="demo-notice">
                        社区预览 · 含示例讨论
                        <br />
                        欢迎发布你的第一个真实想法。
                      </p>
                    )}
                  </MotionSidebar>
                </motion.div>
              )}
            </section>
          )}
        </main>
        {page !== "/" && <footer className="site-footer">
          <div className="footer-top">
            <div className="footer-brand">
              <BrandMark />
              <span>Naimakes 论坛</span>
            </div>
            <p>Stay curious. Make what’s next.</p>
            <LiquidButton
              className="back-top"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: reducedMotion ? "instant" : "smooth",
                })
              }
              aria-label="返回顶部"
            >
              <ArrowUpRight size={19} />
            </LiquidButton>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Naimakes. 让未来发生。</span>
            <FooterLinks onOpen={setModal} />
            <span className="footer-coordinate">IMAGINATION HAS NO LIMIT.</span>
          </div>
        </footer>}
        {modal === "auth" && (
          <AuthForm
            onFeedback={notify}
            onClose={() => {
              setModal("");
              pendingAction.current = null;
              pendingProfile.current = false;
            }}
            onSuccess={(u, registered) => {
              accountRevision.current++;
              setUser(u);
              setModal("");
              syncMe();
              refreshStats();
              setVersion((v) => v + 1);
              if (detail)
                api("/posts/" + detail.id)
                  .then((r) => setDetail(r.post))
                  .catch(() => {});
              notify((registered ? "账号创建成功，欢迎来到 Naimakes，" : "登录成功，欢迎回来，") + u.name, "success");
              if (pendingProfile.current) { pendingProfile.current = false; openProfile(u.id); }
              const action = pendingAction.current;
              pendingAction.current = null;
              if (action) setTimeout(action, 80);
            }}
          />
        )}
        {modal === "compose" && (
          <Composer
            categories={categories}
            onClose={() => closeComposer()}
            onPublish={(p) =>
              closeComposer(() => {
                setVersion((v) => v + 1);
                refreshStats();
                openPost(p.id);
                notify("你的讨论已发布，期待新的回声。");
              })
            }
          />
        )}
        {modal === "create-board" && (
          <BoardForm
            icons={boardIcons}
            onClose={() => setModal("")}
            onCreated={(c) => {
              setModal("");
              setCategories((list) => [...list, c]);
              navigate("/topics", c.id);
              notify(
                `「${c.name}」版块已创建。第一位在这里发表讨论的成员将成为版主。`,
              );
            }}
          />
        )}
        {manage?.kind === "posts" && user && (
          <Suspense fallback={<LoadingPopup />}>
            <PostManager
              focusId={manage.focus}
              categoryName={categoryName}
              iconFor={iconFor}
              onClose={() => setManage(null)}
              onOpenPost={(id) => {
                setManage(null);
                openPost(id);
              }}
              onEditPost={editFromManager}
              onCompose={() => {
                setManage(null);
                startComposing();
              }}
              onChanged={() => {
                setVersion((v) => v + 1);
                refreshStats();
              }}
              notify={notify}
            />
          </Suspense>
        )}
        {manage?.kind === "boards" && user && (
          <Suspense fallback={<LoadingPopup />}>
            <BoardManager
              focusId={manage.focus}
              categories={categories}
              user={user}
              icons={boardIcons}
              iconFor={iconFor}
              onClose={() => setManage(null)}
              onChanged={(next) => {
                boardChanged(next);
                if (next) refreshStats();
              }}
              onMessage={(id) => {
                setManage(null);
                showNotifications(id);
              }}
              onOpenBoard={(id) => {
                setManage(null);
                navigate("/topics", id);
              }}
            />
          </Suspense>
        )}
        {modal === "announce" && user?.role === "owner" && (
          <Composer
            announcement
            categories={categories}
            onClose={() => closeComposer()}
            onPublish={(p) =>
              closeComposer(() => {
                setVersion((v) => v + 1);
                refreshStats();
                syncMe().catch(() => {});
                openPost(p.id);
                notify("公告已发布，所有成员都会收到通知。");
              })
            }
          />
        )}
        {modal === "edit" && detail && (
          <Composer
            categories={categories}
            editing={detail}
            onClose={() => closeComposer()}
            onPublish={(p) => {
              updatePost(p);
              closeComposer(() => {
                setVersion((v) => v + 1);
                refreshStats();
                notify("讨论已更新");
              });
            }}
          />
        )}
        {modal === "feed-filter" && (
          <FeedFilterDialog
            filters={filters}
            onClose={() => setModal("")}
            onApply={(next) => {
              setFilters(next);
              setModal("");
              scrollFeed();
            }}
          />
        )}
        {modal === "search" && (
          <Modal
            title="发现新的想法"
            onClose={() => setModal("")}
            className="search-modal"
          >
            <form
              className="search-input-wrap"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(paletteQuery);
              }}
            >
              <Search size={22} />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                placeholder="搜索话题、想法、关键词…"
                aria-label="搜索讨论"
                maxLength={120}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
                  )
                    e.preventDefault();
                }}
              />
              {user && paletteFavorite.query && (
                <LiquidButton
                  type="button"
                  className="search-pin"
                  aria-pressed={paletteFavorite.pinned}
                  aria-label={paletteFavorite.pinned ? "取消收藏这个关键词" : "收藏这个关键词"}
                  title={paletteFavorite.pinned ? "取消收藏" : "收藏这个关键词"}
                  onClick={() =>
                    searchRecents
                      .pin([paletteFavorite.query], !paletteFavorite.pinned)
                      .then(() =>
                        notify(paletteFavorite.pinned ? "已取消收藏" : "已收藏，下次打开搜索就能看到"),
                      )
                      .catch((e) => notify((e as Error).message, "error"))
                  }
                >
                  <Star size={17} />
                </LiquidButton>
              )}
              <kbd>ESC</kbd>
            </form>
            <RecentsPanel
              scope="search"
              title="最近搜索"
              pinnable
              items={searchRecents.items}
              onItems={searchRecents.setItems}
              onError={(message) => notify(message, "error")}
              onPick={(item) => submitSearch(item.value)}
            />
            <div className="search-suggestions">
              {!paletteQuery && <span>从一个关键词开始</span>}
              {!paletteQuery && (
                <div className="search-tags">
                  {["人工智能", "世界模型", "开源", "人类未来"].map((t) => (
                    <LiquidButton key={t} onClick={() => setPaletteQuery(t)}>
                      <Hash size={12} />
                      {t}
                    </LiquidButton>
                  ))}
                </div>
              )}
              {paletteLoading ? (
                <div className="small-loading">
                  <LoaderCircle className="spin" size={20} />
                </div>
              ) : (
                paletteResults.map((p) => (
                  <div className="palette-row" key={p.id}>
                    <LiquidButton
                      className="palette-result"
                      onClick={() => {
                        setModal("");
                        openPost(p.id);
                      }}
                    >
                      <MessageCircle size={18} />
                      <span>
                        <strong>{p.title}</strong>
                        <small>
                          {categoryName(p.category)} · {p.author_name}
                        </small>
                      </span>
                      <ArrowUpRight size={15} />
                    </LiquidButton>
                    <LiquidButton
                      type="button"
                      className="icon-button palette-share"
                      aria-label={"分享讨论：" + p.title}
                      title="分享"
                      onClick={() => share(p)}
                    >
                      <Share2 size={15} />
                    </LiquidButton>
                  </div>
                ))
              )}
              {!paletteLoading && paletteResults.length === 0 && (
                <p className="search-empty">还没有相关讨论，试试其他关键词。</p>
              )}
            </div>
          </Modal>
        )}
        {modal === "notifications" && user && (
          <Suspense fallback={<LoadingPopup />}>
          <MessageCenter
            initialPeer={chatPeer}
            peerRequest={chatRequest}
            onOpenCollection={(id) => {
              setModal("");
              navigate("/collections/" + id);
            }}
            onOpenBoard={(id) => {
              setModal("");
              navigate("/topics", id);
            }}
            focusId={centreFocus}
            live={centreLive}
            categories={categories}
            muted={!!user?.muted}
            staff={staff}
            onClose={() => {
              setModal("");
              setChatPeer("");
              setCentreFocus("");
              setCentreLive([]);
            }}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onOpenTopic={openTopic}
            onOpenSettings={() => openSettings("notifications")}
            onError={(message) => notify(message, "error")}
            onUnreadChange={() => syncMe().catch(() => {})}
          />
          </Suspense>
        )}
        {modal === "admin" &&
          user &&
          ["owner", "admin"].includes(user.role) && (
            <Suspense fallback={<LoadingPopup />}>
            <AdminPanel
              user={user}
              onClose={() => setModal("")}
              onInspect={(id) => {
                setModal("");
                openPost(id);
              }}
              onManageBoard={(id) => {
                setModal("");
                setManage({ kind: "boards", focus: id });
              }}
              onChange={() => {
                setFeatured([]); setPaletteResults([]);
                refreshStats();
                setVersion((v) => v + 1);
              }}
            />
            </Suspense>
          )}
        {["about", "guidelines", "privacy"].includes(modal) && (
          <Modal
            title={
              modal === "about"
                ? "关于 Naimakes"
                : modal === "guidelines"
                  ? "社区共识"
                  : "隐私说明"
            }
            onClose={() => setModal("")}
            wide
            className="reading-modal"
          >
            <div className="eyebrow">NAIMAKES / {modal.toUpperCase()}</div>
            {modal === "about" ? (
              <>
                <h2>
                  未来不是一个目的地。
                  <br />
                  是我们一起创造的过程。
                </h2>
                <div className="markdown">
                  <p>
                    Naimakes
                    论坛是一个关于前沿科技与人类未来的开放社区。在这里，研究者、独立开发者、思考者，以及每一个保持好奇的人，可以交流发现、提出问题，也可以一起把想法做出来。
                  </p>
                  <h3>我们关心什么</h3>
                  <p>
                    人工智能、太空探索、生命科学、未来能源，以及这些技术如何改变我们共同生活的世界。
                  </p>
                  <blockquote>Stay curious. Make what’s next.</blockquote>
                  <p>观点可以不同，探索不必独行。</p>
                </div>
                <LiquidButton
                  className="button primary"
                  onClick={() => {
                    setModal("");
                    navigate("/topics");
                  }}
                >
                  找到你的探索方向
                  <ArrowUpRight size={16} />
                </LiquidButton>
              </>
            ) : modal === "guidelines" ? (
              <>
                <h2>好的讨论，让彼此走得更远。</h2>
                <div className="markdown">
                  <h3>01 · 对观点认真，对人友善</h3>
                  <p>
                    欢迎质疑与不同意见。请围绕论点、证据和推理展开，避免人身攻击、骚扰与歧视。
                  </p>
                  <h3>02 · 让事实和想象各得其所</h3>
                  <p>
                    分享研究时尽量注明来源。清楚区分已经验证的结论、推测与思考实验；公开可能影响观点的利益关系。
                  </p>
                  <h3>03 · 尊重创造与隐私</h3>
                  <p>
                    引用他人作品请标明出处。不要发布未经同意的个人信息、违法内容或垃圾广告。
                  </p>
                  <h3>04 · 一起照顾这个空间</h3>
                  <p>
                    遇到不当内容，可使用讨论中的举报按钮。管理员会查看举报，并可移除不符合共识的讨论。作者可以删除自己的内容。
                  </p>
                </div>
              </>
            ) : (
              <>
                <h2>你的想法属于你。</h2>
                <div className="markdown">
                  <p>
                    本社区保存你主动提交的邮箱、昵称、简介、讨论和回复。邮箱用于账号登录，不会公开展示。密码以加盐哈希形式保存。
                  </p>
                  <h3>用于正常运作的数据</h3>
                  <p>
                    登录状态通过 HttpOnly Cookie
                    保持，收藏、关注及登录后的浏览历史保存在服务器。主题偏好和未发布草稿仅保存在当前设备。
                  </p>
                  <h3>你可以做的选择</h3>
                  <p>
                    你可以编辑个人资料、删除自己的讨论和回复、取消收藏及关注。退出登录会清除此设备的登录会话与本地草稿。
                  </p>
                  <h3>图片与链接</h3>
                  <p>
                    上传的图片可通过其链接公开访问。帖子中的外部图片可能向图片所在服务器发送访问请求。请勿上传不希望公开的信息。
                  </p>
                  <p>
                    当前版本不包含广告追踪，也不出售你的个人信息。如需账户删除或完整数据导出，请联系社区运营方处理。
                  </p>
                </div>
              </>
            )}
          </Modal>
        )}
        {detailLoading && !detail && <LoadingPopup />}
        {detail && (
          <Modal
            title={
              detail?.kind === "announcement"
                ? "NAIMAKES / ANNOUNCEMENT"
                : "NAIMAKES / DISCUSSION"
            }
            onClose={closeDetail}
            origin={postOrigin.current}
            motionKey="discussion"
            resizable
            wide
            className={`detail-modal ${detail?.kind === "announcement" ? "is-announcement" : ""}`}
          >
            {detail && (
                <>
                  <div className="detail-category">
                    {detail.kind === "announcement" ? (
                      <span className="announcement-label">
                        <Megaphone size={12} />
                        全站公告
                      </span>
                    ) : (
                      <LiquidButton
                        onClick={() => {
                          closeDetail();
                          navigate("/topics", detail.category);
                        }}
                      >
                        {categoryName(detail.category)}
                        <ArrowUpRight size={13} />
                      </LiquidButton>
                    )}
                    <span>
                      {detail.kind === "announcement"
                        ? "站主发布，已置顶"
                        : detail.kind === "project"
                          ? "开放共创"
                          : "话题讨论"}
                    </span>
                    {detail.demo === 1 && <span>示例内容</span>}
                    {detail.visibility === "private" && (
                      <span className="private-label">
                        <Lock size={10} />
                        仅自己可见
                      </span>
                    )}
                    {detail.comments_closed && (
                      <span className="private-label">
                        <MessageCircleOff size={10} />
                        评论已关闭
                      </span>
                    )}
                    {detail.locked && (
                      <span className="private-label is-muted">
                        <MessageCircleOff size={10} />
                        {lockedLabel}
                      </span>
                    )}
                  </div>
                  <h1 className="detail-title">{detail.title}</h1>
                  <div className="detail-author">
                    <Avatar
                      name={detail.author_name}
                      initials={detail.author_initials}
                      avatar={detail.author_avatar}
                      userId={detail.author_id}
                    />
                    <div>
                      <strong>{detail.author_name}</strong>
                      <span>
                        {timeAgo(detail.created_at)} · {readingMinutes(detail)} 分钟阅读 · {countLabel(detail.views ?? 0)} 人阅读
                      </span>
                    </div>
                    {user && detail.author_id !== user.id && (
                      <LiquidButton
                        className="icon-button"
                        aria-label="发送私信"
                        title="发送私信"
                        onClick={() => showNotifications(detail.author_id)}
                      >
                        <Send size={18} />
                      </LiquidButton>
                    )}
                  </div>
                  {detail.format === "html" ? (
                    <RichContent html={detail.content} />
                  ) : (
                  <div className="markdown post-content">
                    <Suspense fallback={null}>
                      <MarkdownContent content={detail.content} rich />
                    </Suspense>
                  </div>
                  )}
                  <div className="detail-action-bar">
                    <LiquidButton
                      className={`button ${detail.liked ? "primary" : "secondary"} detail-like-button`}
                      aria-pressed={detail.liked}
                      aria-label={detail.liked ? "已赞同" : "赞同"}
                      title={detail.liked ? "已赞同" : "赞同"}
                      onClick={() => togglePost(detail, "like")}
                      disabled={busy === detail.id + "like"}
                    >
                      <ReactionIcon active={!!detail.liked} />
                      <MotionCount value={detail.likes} />
                    </LiquidButton>
                    <LiquidButton
                      className="icon-button"
                      aria-label={detail.bookmarked ? "管理收藏" : "收藏"}
                      title={detail.bookmarked ? "管理收藏" : "收藏"}
                      onClick={() => togglePost(detail, "bookmark")}
                    >
                      <ReactionIcon kind="bookmark" active={!!detail.bookmarked} />
                    </LiquidButton>
                    {detail.author_id !== user?.id && detail.kind !== "announcement" && (
                      <LiquidButton
                        className={`icon-button ${detail.followed ? "active" : ""}`}
                        aria-pressed={!!detail.followed}
                        aria-label={detail.followed ? `已关注讨论，${detail.followers ?? 0} 人关注` : `关注讨论，${detail.followers ?? 0} 人关注`}
                        title={detail.followed ? "已关注 · 有新回复时通知你" : "关注讨论"}
                        disabled={busy === detail.id + "follow"}
                        onClick={() => togglePost(detail, "follow")}
                      >
                        {detail.followed ? <BellRing size={16} /> : <BellPlus size={16} />}
                      </LiquidButton>
                    )}
                    {!phone && (
                    <LiquidButton
                      className={`icon-button ${detail.read_later ? "active" : ""}`}
                      aria-pressed={detail.read_later}
                      aria-label={detail.read_later ? "已加入稍后再看" : "稍后再看"}
                      title={detail.read_later ? "已加入稍后再看" : "稍后再看"}
                      disabled={busy === detail.id + "later"}
                      onClick={() => togglePost(detail, "later")}
                    >
                      {detail.read_later ? (
                        <Check size={16} />
                      ) : (
                        <Clock3 size={16} />
                      )}
                    </LiquidButton>
                    )}
                    {!phone && (
                    <LiquidButton
                      className="icon-button"
                      aria-label="分享"
                      title="分享"
                      onClick={() => share(detail)}
                    >
                      <Share2 size={16} />
                    </LiquidButton>
                    )}
                    <div className="detail-action-extra">
                      {!phone && user &&
                        (detail.author_id === user.id ||
                          canModerate(detail.category)) && (
                          <LiquidButton
                            className="icon-button"
                            aria-label="编辑讨论"
                            title="编辑讨论"
                            onClick={() => openComposer("edit", detail.id)}
                          >
                            <PenLine size={16} />
                          </LiquidButton>
                        )}
                      {!phone && user &&
                        detail.author_id !== user.id &&
                          canModerate(detail.category) && (
                          <LiquidButton
                            className="icon-button"
                            aria-label="删除讨论"
                            title="删除讨论"
                            onClick={() => removePost(detail)}
                          >
                            <Trash2 size={16} />
                          </LiquidButton>
                        )}
                      <div className="more-menu-wrap" ref={moreMenuRef} data-popover-owner="more">
                        <LiquidButton
                          className="icon-button more-button"
                          aria-label="更多操作"
                          title="更多"
                          aria-expanded={moreMenu}
                          aria-haspopup="menu"
                          onClick={() => setMoreMenu(!moreMenu)}
                        >
                          <MoreHorizontal size={18} />
                        </LiquidButton>
                        <LiquidPopover open={moreMenu} className="more-menu glass" label="更多操作" onClose={() => setMoreMenu(false)}>
                            {phone && (
                              <LiquidButton
                                role="menuitem"
                                disabled={busy === detail.id + "later"}
                                onClick={() => {
                                  setMoreMenu(false);
                                  togglePost(detail, "later");
                                }}
                              >
                                {detail.read_later ? <Check size={16} /> : <Clock3 size={16} />}
                                {detail.read_later ? "已加入稍后再看" : "稍后再看"}
                              </LiquidButton>
                            )}
                            {phone && (
                              <LiquidButton
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenu(false);
                                  share(detail);
                                }}
                              >
                                <Share2 size={16} />
                                分享
                              </LiquidButton>
                            )}
                            {phone && user && (detail.author_id === user.id || canModerate(detail.category)) && (
                              <LiquidButton
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenu(false);
                                  openComposer("edit", detail.id);
                                }}
                              >
                                <PenLine size={16} />
                                编辑讨论
                              </LiquidButton>
                            )}
                            {user && detail.author_id === user.id && (
                              <LiquidButton
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenu(false);
                                  setManage({ kind: "posts", focus: detail.id });
                                }}
                              >
                                <ChartLine size={16} />
                                管理帖子
                              </LiquidButton>
                            )}
                            {phone && user && detail.author_id !== user.id && canModerate(detail.category) && (
                              <LiquidButton
                                role="menuitem"
                                className="detail-delete-item"
                                onClick={() => {
                                  setMoreMenu(false);
                                  removePost(detail);
                                }}
                              >
                                <Trash2 size={16} />
                                删除讨论
                              </LiquidButton>
                            )}
                            {detail.visibility !== "private" && (
                              <LiquidButton
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenu(false);
                                  copyLink(detail);
                                }}
                              >
                                <Link2 size={16} />
                                复制链接
                              </LiquidButton>
                            )}
                            <LiquidButton
                              role="menuitem"
                              onClick={() => {
                                setMoreMenu(false);
                                requireUser(() =>
                                  setTrackingKeyword(
                                    detail.tags[0] || detail.title,
                                  ),
                                );
                              }}
                            >
                              <Radio size={16} />
                              跟踪话题
                            </LiquidButton>
                            {detail.author_id !== user?.id && (
                              <LiquidButton
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenu(false);
                                  reportPost(detail);
                                }}
                              >
                                <ShieldAlert size={16} />
                                投诉此内容
                              </LiquidButton>
                            )}
                            {(staff || canModerate(detail.category)) && detail.author_id !== user?.id && (
                              <LiquidButton
                                role="menuitem"
                                className={detail.locked ? "is-muted" : ""}
                                disabled={busy === "lock"}
                                onClick={() => {
                                  setMoreMenu(false);
                                  if (detail.locked) lockPost(false, "");
                                  else {
                                    setLockReason("");
                                    setModal("lock");
                                  }
                                }}
                              >
                                {detail.locked ? (
                                  <MessageCircle size={16} />
                                ) : (
                                  <MessageCircleOff size={16} />
                                )}
                                {detail.locked ? "解除禁言" : "禁言此帖"}
                              </LiquidButton>
                            )}
                          </LiquidPopover>
                      </div>
                    </div>
                  </div>
                  {detail.attachments.length > 0 && (
                    <section className="post-attachments">
                      <h4>
                        <Paperclip size={14} />
                        附件 {detail.attachments.length}
                      </h4>
                      <AttachmentList files={detail.attachments} />
                    </section>
                  )}
                  {detail.quotes.length > 0 && (
                    <section className="post-attachments">
                      <h4>
                        <Quote size={14} />
                        引用 {detail.quotes.length}
                      </h4>
                      <QuoteList
                        quotes={detail.quotes}
                        categoryName={categoryName}
                        onOpen={(id) => {
                          closeDetail();
                          openPost(id);
                        }}
                      />
                    </section>
                  )}
                  {detail.tags.length > 0 && (
                    <div className="detail-tags post-keywords" aria-label="关键词">
                      {detail.tags.map((t) => (
                        <LiquidButton
                          key={t}
                          onClick={() => {
                            closeDetail();
                            submitSearch(t, true);
                          }}
                        >
                          #{t}
                        </LiquidButton>
                      ))}
                    </div>
                  )}
                  <section className="comments-section">
                    <div className="comments-heading">
                      <h3>
                        让想法，有回声。
                        <span>{comments.filter((c) => !c.deleted).length}</span>
                      </h3>
                      <MessageCircle size={19} />
                    </div>
                    {replyError && (
                      <p role="alert" className="form-error">
                        {replyError}
                      </p>
                    )}
                    <Comments
                      comments={comments}
                      user={user}
                      canModerate={canModerate(detail.category)}
                      postAuthorId={detail.author_id}
                      closed={detail.comments_closed}
                      block={
                        detail.locked
                          ? lockedLabel
                          : user?.muted
                            ? mutedLabel
                            : null
                      }
                      busy={busy}
                      categories={categories}
                      categoryName={categoryName}
                      onSubmit={sendReply}
                      onVote={voteComment}
                      onDelete={removeComment}
                      onMessage={(c) => showNotifications(c.author_id)}
                      onReport={reportComment}
                      onOpenPost={(id) => {
                        closeDetail();
                        openPost(id);
                      }}
                      onRequireAuth={() => setModal("auth")}
                      onError={notify}
                    />
                  </section>
                </>
            )}
          </Modal>
        )}
        {modal === "logout" && (
          <Confirm title="退出登录" heading="要退出当前账号吗？" description="你可以继续浏览社区，发布和收藏时需要重新登录。" confirmLabel="退出登录" busy={busy === "logout"} onClose={() => setModal("")} onConfirm={async () => {
            setBusy("logout");
            try {
              await api("/auth/logout", requestPost());
              setModal(""); setUser(null); setFollows([]); setUnread(0); setAccountMenu(false);
              setSubscriptions({ authors: [], boards: [] }); toasts.clearLive();
              setVersion((v) => v + 1); localStorage.removeItem("nmk-draft"); notify("已退出登录");
            } catch (e) { notify((e as Error).message); } finally { setBusy(""); }
          }} />
        )}
        {confirmDelete && detail && (
          <Confirm
            title="删除讨论"
            heading="删除这篇讨论？"
            description={`「${detail.title}」及其下全部回复将不再显示。`}
            confirmLabel="删除"
            cancelLabel="保留讨论"
            busy={busy === "delete"}
            onConfirm={() => deletePost()}
            onClose={() => setConfirmDelete(false)}
          />
        )}
        {confirmComment && (
          <Confirm
            title="删除回复"
            heading="删除这条回复？"
            description={
              comments.some((c) => c.parent_id === confirmComment.id)
                ? "这条回复下面还有其他讨论，删除后会保留占位，下方的回复不受影响。"
                : "删除后这条回复将不再显示。"
            }
            confirmLabel="删除回复"
            busy={busy === "comment-delete"}
            onConfirm={() => deleteComment(confirmComment)}
            onClose={() => setConfirmComment(null)}
          />
        )}
        {modal === "lock" && detail && (
          <Modal title="禁言这篇帖子" onClose={() => setModal("")}>
            <h2>只停下这一篇的讨论。</h2>
            <p className="modal-note">
              禁言后，这篇帖子不再接收任何新的评论与回复——作者、其他成员，以及你自己都一样；已有内容保留，大家在别处发言不受影响。说明会随提醒发送给作者。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lockPost(true, lockReason);
              }}
            >
              <label>
                处理说明（可留空）
                <textarea
                  autoFocus
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  maxLength={200}
                  rows={3}
                  placeholder="例如：讨论已偏离主题，暂时停止回复。"
                />
              </label>
              <LiquidButton
                className="button primary full-width"
                disabled={busy === "lock"}
              >
                禁言此帖
                <MessageCircleOff size={16} />
              </LiquidButton>
            </form>
          </Modal>
        )}
        {savingPost && (
          <BookmarkPicker
            article={savingPost}
            onClose={() => setSavingPost(null)}
            onSaved={(p) => {
              updatePost(p);
              setSavingPost(null);
              setVersion((v) => v + 1);
              notify(p.bookmarked ? "已保存到所选收藏夹" : "已取消收藏");
            }}
          />
        )}
        {sharing && (
          <ShareSheet
            target={sharing}
            user={user}
            categoryName={categoryName}
            notify={notify}
            onClose={() => setSharing(null)}
            onLogin={() => {
              const target = sharing;
              setSharing(null);
              pendingAction.current = () => openShare(target);
              setModal("auth");
            }}
            onOpenChat={(peerId) => {
              setSharing(null);
              showNotifications(peerId);
            }}
          />
        )}
        {postMenu.menu && <ContextMenu x={postMenu.menu.x} y={postMenu.menu.y} open={postMenu.isOpen} onClose={postMenu.close} onExited={postMenu.finish} triggerRef={postMenu.triggerRef} items={[
          { label: "打开讨论", icon: <ArrowUpRight size={14}/>, onSelect: () => openPost(postMenu.menu!.item.id) },
          { label: postMenu.menu.item.bookmarked ? "管理收藏" : "收藏讨论", icon: <Bookmark size={14}/>, onSelect: () => togglePost(postMenu.menu!.item,"bookmark") },
          { label: postMenu.menu.item.read_later ? "移出稍后再看" : "稍后再看", icon: <Clock3 size={14}/>, onSelect: () => togglePost(postMenu.menu!.item,"later") },
          { label: "分享", icon: <Share2 size={14}/>, onSelect: () => share(postMenu.menu!.item) },
          ...(postMenu.menu.item.visibility !== "private" ? [{ label: "复制链接", icon: <Link2 size={14}/>, onSelect: () => copyLink(postMenu.menu!.item) }] : []),
          ...(postMenu.menu.item.author_id !== user?.id ? [{ label: "投诉", icon: <Flag size={14}/>, onSelect: () => reportPost(postMenu.menu!.item) }] : []),
          ...(user && postMenu.menu.item.author_id === user.id ? [{ label: "管理帖子", icon: <ChartLine size={14}/>, onSelect: () => setManage({ kind: "posts", focus: postMenu.menu!.item.id }) }] : []),
          ...(user && postMenu.menu.item.author_id !== user.id && canModerate(postMenu.menu.item.category) ? [{ label: "删除讨论", icon: <Trash2 size={14}/>, danger: true, onSelect: () => removePost(postMenu.menu!.item) }] : []),
        ]}/>}
        {hideTarget && (
          <Confirm
            title="隐藏公告"
            heading="隐藏这条公告？"
            description={`「${hideTarget.title}」将不再出现在信息流里，它会和其他隐藏的公告一起折叠在最上方的「公告」里，随时可以展开查看或恢复。`}
            confirmLabel="隐藏"
            cancelLabel="保留"
            tone="primary"
            icon={<EyeOff size={22} strokeWidth={1.6} />}
            busy={busy === hideTarget.id + "hide"}
            onConfirm={() => hideAnnouncement(hideTarget)}
            onClose={() => setHideTarget(null)}
          />
        )}
        {deleteTarget && <Confirm title="删除讨论" heading="删除这篇讨论？" description={`「${deleteTarget.title}」及其下全部回复将不再显示。`} confirmLabel="删除" cancelLabel="保留讨论" busy={busy === "delete"} onConfirm={() => deletePost(deleteTarget)} onClose={() => setDeleteTarget(null)}/>}
        {historyMenu.menu && (
          <ContextMenu
            x={historyMenu.menu.x}
            y={historyMenu.menu.y}
            onClose={historyMenu.close} open={historyMenu.isOpen} onExited={historyMenu.finish} triggerRef={historyMenu.triggerRef}
            items={[
              { label: "选择这条记录", icon: <Check size={14} />, onSelect: () => { setHistoryBatch(true); setHistoryPicked([historyMenu.menu!.item.id]); } },
              {
                label: "删除这条记录",
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () =>
                  removeHistory({ ids: [historyMenu.menu!.item.id] }),
              },
              {
                label: "清空全部浏览记录",
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () => setConfirmHistory("all"),
              },
            ]}
          />
        )}
        {confirmHistory && (
          <Confirm
            title={confirmHistory === "all" ? "清空最近浏览" : "删除浏览记录"}
            heading={
              confirmHistory === "all"
                ? "清空全部浏览记录？"
                : `删除选中的 ${historyPicked.length} 条记录？`
            }
            description="只会清除你这边的浏览记录，讨论本身以及收藏、稍后再看都不受影响。"
            confirmLabel={confirmHistory === "all" ? "清空记录" : "删除记录"}
            busy={busy === "history"}
            onConfirm={() =>
              removeHistory(
                confirmHistory === "all"
                  ? { all: true }
                  : { ids: historyPicked },
              )
            }
            onClose={() => setConfirmHistory(null)}
          />
        )}
        {trackingKeyword !== null && (
          <TrackForm
            categories={categories}
            initial={trackingKeyword}
            onClose={() => setTrackingKeyword(null)}
            onSaved={() => {
              setTrackingKeyword(null);
              setVersion((v) => v + 1);
              notify("已开始跟踪，在「我的收藏」查看话题更新");
            }}
          />
        )}
        {user && (
          <GovernanceHost
            isOwner={user.role === "owner"}
            notify={notify}
            onChanged={() => {
              refreshStats();
              setVersion((v) => v + 1);
              syncMe().catch(() => {});
              governanceChanged();
            }}
            onInspect={(id) => {
              setModal("");
              openPost(id);
            }}
          />
        )}
        <GlassToastStack
          items={toasts.items}
          overflow={toasts.overflow}
          overflowId={toasts.overflowId}
          onDismiss={toasts.dismiss}
          onOpen={openNotice}
          onOverflow={() => showNotifications()}
          onClearOverflow={toasts.clearOverflow}
        />
      </div>
      {assistantReady && (
        <Suspense fallback={null}>
          <AssistantDock userId={user?.id || null} shared={sharedChat} />
        </Suspense>
      )}
    </LayoutGroup>
  );
}
