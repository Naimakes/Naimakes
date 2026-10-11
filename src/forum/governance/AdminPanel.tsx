import { LiquidButton } from "../motion/LiquidButton";
import { FluidTabs } from "../motion/FluidTabs";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crown,
  FileText,
  Flag,
  LayoutGrid,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Mic,
  MicOff,
  RotateCcw,
  Undo2,
  EyeOff,
  Search,
  ShieldCheck,
  ShieldMinus,
  ShieldPlus,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import Avatar from "../ui/Avatar";
import AccountDeletion from "../profile/AccountDeletion";
import { GlassSegments } from "../ui/GlassSegments";
import { boardIcon } from "../boards/Boards";
import { DangerConfirm, MuteDialog, PostLockDialog } from "./Governance";
import {
  applyFeedFilters,
  defaultFeedFilters,
  type FeedFilters,
} from "../discover/feed-filters";
import { api, post as requestPost, timeAgo, type User } from "../api";
import {
  caseActionLabel,
  caseStatusLabel,
  dateTimeText,
  logActions,
  logDetailText,
  muteLabel,
  openGovernance,
  roleNames,
  targetNouns,
  type CaseSummary,
  type LogEntry,
  type ManagedBoard,
  type ManagedPost,
  type ManagedUser,
  type PersonCard,
  type RequestDetail,
  type TargetType,
  type TrashItem,
} from "./governance-api";

type Tab = "users" | "reports" | "boards" | "posts" | "admins" | "trash" | "logs";
type Overview = Record<"members" | "posts" | "reports" | "appeals" | "requests" | "muted" | "muted_boards" | "locked" | "trash" | "admins", number>;
type Page<T> = { items: T[]; total: number; hasMore: boolean };
const empty = <T,>(): Page<T> => ({ items: [], total: 0, hasMore: false });
const daysLeft = (expires: number) => {
  const days = Math.ceil((expires - Date.now()) / 86400000);
  return days > 1 ? `${days} 天后永久删除` : "即将永久删除";
};

const userFilters = [
  ["all", "全部"],
  ["active", "正常"],
  ["muted", "已禁言"],
  ["appealing", "申诉中"],
  ["complained", "待处理"],
  ["suspended", "已停用"],
] as const;
const boardFilters = [
  ["all", "全部"],
  ["active", "正常"],
  ["muted", "已禁言"],
  ["appealing", "申诉中"],
  ["complained", "待处理"],
] as const;
const postStatusFilters = [
  ["all", "全部"],
  ["active", "正常"],
  ["locked", "已禁言"],
  ["complained", "待处理"],
  ["hidden", "仅自己可见"],
] as const;
const adminFeed: FeedFilters = { ...defaultFeedFilters, sort: "new" };
const caseFilters = [
  ["all", "全部"],
  ["pending", "待处理"],
  ["resolved", "已处理"],
  ["dismissed", "已驳回"],
] as const;
type CaseType = TargetType | "all";
const caseTypes: [CaseType, string][] = [
  ["all", "全部"],
  ["board", "版块"],
  ["post", "帖子"],
  ["comment", "评论"],
  ["user", "用户"],
];
type TrashType = TargetType | "all" | "member";
const trashTypes: [TrashType, string][] = [
  ["all", "全部"],
  ["user", "用户"],
  ["board", "版块"],
  ["post", "帖子"],
  ["comment", "评论"],
];
const ownerTrashTypes: [TrashType, string][] = [trashTypes[0], trashTypes[1], ["member", "版块成员"], ...trashTypes.slice(2)];
const logTypes: [CaseType, string][] = [
  ["all", "全部"],
  ["user", "用户"],
  ["board", "版块"],
  ["post", "帖子"],
  ["comment", "评论"],
];
type MemberRemoval = {
  id: string;
  member: PersonCard;
  board: { id: string; name: string; icon: string };
  removed_by: PersonCard | null;
  removed_at: number;
  expires_at: number;
};

function Card({ main, status, actions, onOpen, tone = "", columns = 2, lead }: { main: ReactNode; status: ReactNode; actions: ReactNode[]; onOpen?: () => void; tone?: string; columns?: 2 | 3; lead?: ReactNode }) {
  const slots = Array.from({ length: columns }, (_, i) => actions[i] ?? null);
  const hasActions = slots.some(Boolean);
  return (
    <article className={`gov-card ${columns === 3 ? "is-three" : ""} ${lead ? "has-lead" : ""} ${tone}`}>
      {lead}
      {onOpen ? (
        <button type="button" className="gov-card-main is-link" onClick={onOpen}>
          {main}
        </button>
      ) : (
        <div className="gov-card-main">{main}</div>
      )}
      <div className="gov-card-status">{status}</div>
      {hasActions && (
        <div className="gov-card-actions">
          {slots.map((slot, i) => slot ?? <span key={i} className="gov-slot" aria-hidden="true" />)}
        </div>
      )}
    </article>
  );
}
const Action = ({ children, danger, onClick, disabled, title }: { children: ReactNode; danger?: boolean; onClick: () => void; disabled?: boolean; title?: string }) => (
  <LiquidButton type="button" className={"admin-action gov-slot-button" + (danger ? " admin-action-danger" : "")} onClick={onClick} disabled={disabled} title={title}>
    {children}
  </LiquidButton>
);
const Pill = ({ children, tone = "" }: { children: ReactNode; tone?: string }) => <span className={`gov-chip ${tone ? "is-" + tone : ""}`}>{children}</span>;
const PersonLine = ({ person, sub, badges }: { person: PersonCard; sub?: ReactNode; badges?: ReactNode }) => (
  <span className="gov-card-person">
    <Avatar name={person.name} initials={person.initials} avatar={person.avatar} size={42} />
    <span className="gov-card-text">
      <strong>
        <span className="gov-ellipsis">{person.name}</span>
        {badges}
      </strong>
      <small className="gov-ellipsis">{sub ?? "ID · " + person.name}</small>
    </span>
  </span>
);
const BoardLine = ({ name, icon, sub, badges }: { name: string; icon?: string; sub?: ReactNode; badges?: ReactNode }) => {
  const Icon = boardIcon(icon);
  return (
    <span className="gov-card-person">
      <span className="gov-glyph is-board">
        <Icon size={20} strokeWidth={1.6} />
      </span>
      <span className="gov-card-text">
        <strong>
          <span className="gov-ellipsis">{name}</span>
          {badges}
        </strong>
        <small className="gov-ellipsis">{sub}</small>
      </span>
    </span>
  );
};

function Filters<T extends string>({ items, value, onChange, counts, label = "筛选" }: { items: readonly (readonly [T, string])[]; value: T; onChange: (next: T) => void; counts?: Partial<Record<T, number>>; label?: string }) {
  return <GlassSegments className="gov-segs" label={label} value={value} onChange={onChange} items={items.map(([id, text]) => ({ id, label: text, count: counts?.[id] }))} />;
}
function StageSearch({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder: string }) {
  return (
    <div className="admin-search gov-search" role="search">
      <Search size={16} />
      <input type="search" aria-label={placeholder} placeholder={placeholder} value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <LiquidButton type="button" className="icon-button" aria-label="清空搜索" onClick={() => onChange("")}>
          <X size={14} />
        </LiquidButton>
      )}
    </div>
  );
}
function StageState({ loading, error, empty: isEmpty, query, onRetry, children }: { loading: boolean; error: string; empty: boolean; query: string; onRetry: () => void; children: ReactNode }) {
  if (error)
    return (
      <div className="gov-empty is-error" role="alert">
        <strong>加载失败，请重试</strong>
        <small>{error}</small>
        <LiquidButton type="button" className="admin-action" onClick={onRetry}>
          <RotateCcw size={14} />
          重试
        </LiquidButton>
      </div>
    );
  if (loading && isEmpty)
    return (
      <div className="gov-empty">
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  if (isEmpty)
    return (
      <div className="gov-empty">
        <strong>{query ? "没有找到相关内容" : "暂无结果"}</strong>
      </div>
    );
  return <>{children}</>;
}

function usePaged<T>(url: string | null, pick: (r: any) => T[], deps: unknown[]) {
  const [page, setPage] = useState<Page<T>>(empty());
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [extra, setExtra] = useState<any>(null);
  const seq = useRef(0);
  const load = useCallback(
    async (offset = 0) => {
      if (!url) return;
      const id = ++seq.current;
      setLoading(true);
      setError("");
      try {
        const r = await api(url + (url.includes("?") ? "&" : "?") + "offset=" + offset);
        if (id !== seq.current) return;
        setExtra(r);
        setPage((prev) => ({ items: offset ? [...prev.items, ...pick(r)] : pick(r), total: r.total ?? 0, hasMore: !!r.hasMore }));
      } catch (e) {
        if (id === seq.current) setError((e as Error).message);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [url],
  );
  useEffect(() => {
    setPage(empty());
    const timer = setTimeout(() => load(0), 200);
    return () => clearTimeout(timer);
  }, [load, ...deps]);
  return { page, setPage, loading, error, extra, reload: () => load(0), more: () => load(page.items.length) };
}
function More({ show, loading, onMore }: { show: boolean; loading: boolean; onMore: () => void }) {
  if (!show) return null;
  return (
    <LiquidButton type="button" className="load-more admin-action" disabled={loading} onClick={onMore}>
      {loading ? "加载中…" : "查看更多"}
      <ChevronDown size={14} />
    </LiquidButton>
  );
}

export default function AdminPanel({
  user,
  onClose,
  onInspect,
  onManageBoard,
  onChange,
  initialTab = "users",
}: {
  user: User;
  onClose: () => void;
  onInspect: (id: string) => void;
  onManageBoard: (id: string) => void;
  onChange: () => void;
  initialTab?: Tab;
}) {
  const isOwner = user.role === "owner";
  const [tab, setTab] = useState<Tab>(initialTab),
    [query, setQuery] = useState(""),
    [userStatus, setUserStatus] = useState<(typeof userFilters)[number][0]>("all"),
    [boardStatus, setBoardStatus] = useState<(typeof boardFilters)[number][0]>("all"),
    [postStatus, setPostStatus] = useState<(typeof postStatusFilters)[number][0]>("all"),
    [caseType, setCaseType] = useState<CaseType>("all"),
    [caseStatus, setCaseStatus] = useState<(typeof caseFilters)[number][0]>("pending"),
    [trashType, setTrashType] = useState<TrashType>("all"),
    [logType, setLogType] = useState<CaseType>("all"),
    [logBatch, setLogBatch] = useState(false),
    [logPicked, setLogPicked] = useState<string[]>([]),
    [overview, setOverview] = useState<Overview | null>(null),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const [locking, setLocking] = useState<ManagedPost | null>(null);
  const [muting, setMuting] = useState<{ kind: "user"; item: ManagedUser } | { kind: "board"; item: ManagedBoard } | null>(null),
    [confirm, setConfirm] = useState<{ heading: string; description: string; label: string; run: () => Promise<unknown>; done: string } | null>(null),
    [purgingUser, setPurgingUser] = useState<ManagedUser | null>(null),
    [granting, setGranting] = useState(false);
  const refresh = useCallback(() => {
    setRevision((n) => n + 1);
    onChange();
  }, [onChange]);
  const settle = (message: string) => {
    setNotice(message);
    refresh();
  };
  useEffect(() => {
    const again = () => setRevision((n) => n + 1);
    window.addEventListener("nmk-governance-changed", again);
    return () => window.removeEventListener("nmk-governance-changed", again);
  }, []);
  useEffect(() => {
    api<Overview>("/admin/overview").then(setOverview).catch(() => {});
  }, [revision]);
  const q = encodeURIComponent(query.trim());
  const users = usePaged<ManagedUser>(tab === "users" ? `/admin/users?q=${q}&status=${userStatus}` : null, (r) => r.users, [revision]);
  const boards = usePaged<ManagedBoard>(tab === "boards" ? `/admin/boards?q=${q}&status=${boardStatus}` : null, (r) => r.boards, [revision]);
  const postsUrl =
    "/admin/posts?" +
    applyFeedFilters(new URLSearchParams({ q: query.trim(), status: postStatus, board: "all" }), adminFeed).toString();
  const posts = usePaged<ManagedPost>(tab === "posts" ? postsUrl : null, (r) => r.posts, [revision]);
  const cases = usePaged<CaseSummary>(
    tab === "reports" ? `/admin/complaints?type=${caseType}&status=${caseStatus}&q=${q}` : null,
    (r) => r.cases,
    [revision],
  );
  const trash = usePaged<TrashItem>(tab === "trash" && trashType !== "member" ? `/admin/trash?type=${trashType}` : null, (r) => r.items, [revision]);
  const removals = usePaged<MemberRemoval>(tab === "trash" && trashType === "member" && isOwner ? "/admin/member-removals" : null, (r) => r.items, [revision]);
  const logs = usePaged<LogEntry>(tab === "logs" ? `/admin/logs?type=${logType}` : null, (r) => r.logs, [revision]);
  const [admins, setAdmins] = useState<{ admins: (PersonCard & { email?: string; granted_at: number | null; pending_requests: number })[]; requests: RequestDetail[] } | null>(null),
    [adminError, setAdminError] = useState("");
  useEffect(() => {
    if (tab !== "admins") return;
    setAdminError("");
    api("/admin/admins")
      .then(setAdmins)
      .catch((e) => setAdminError((e as Error).message));
  }, [tab, revision]);
  const caseCounts: Partial<Record<CaseType, number>> = { ...(cases.extra?.counts || {}) };
  caseCounts.all = Object.values(caseCounts).reduce((n, v) => n + (v || 0), 0);

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      settle(confirm.done);
      setConfirm(null);
    } catch (e) {
      const err = e as Error & { code?: string };
      setConfirm(null);
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }
  const switchTab = (next: Tab) => {
    setTab(next);
    setQuery("");
    setNotice("");
    setLogBatch(false);
    setLogPicked([]);
  };
  const hideLogs = (ids: string[]) =>
    setConfirm({
      heading: `删除选中的 ${ids.length} 条操作记录？`,
      description: "只从你的列表里移除，原始日志仍完整保留，其他管理员不受影响。",
      label: "删除记录",
      done: `已删除 ${ids.length} 条记录。`,
      run: async () => {
        await api("/admin/logs/hide", requestPost({ ids }));
        setLogPicked([]);
        setLogBatch(false);
      },
    });
  const clearLogs = () =>
    setConfirm({
      heading: "清空全部操作记录？",
      description: "只清空你的列表，之后的新操作仍会出现；原始日志仍完整保留，其他管理员不受影响。",
      label: "清空记录",
      done: "操作记录已清空。",
      run: async () => {
        await api("/admin/logs/clear", requestPost({}));
        setLogPicked([]);
        setLogBatch(false);
      },
    });
  const removeUser = (u: ManagedUser) =>
    u.can.delete === "request"
      ? openGovernance({ kind: "request-delete", type: "user", id: u.id, label: u.name, onDone: refresh })
      : setConfirm({
          heading: `删除用户「${u.name}」？`,
          description: "账号立即无法登录，前台不再显示其内容；可在回收站恢复。",
          label: "删除用户",
          done: "用户已删除，对方已收到通知。",
          run: () => api(`/admin/users/${encodeURIComponent(u.id)}/remove`, requestPost({})),
        });
  const removeBoard = (b: ManagedBoard) =>
    b.can.delete === "request"
      ? openGovernance({ kind: "request-delete", type: "board", id: b.id, label: b.name, onDone: refresh })
      : setConfirm({
          heading: `删除版块「${b.name}」？`,
          description: `版块入口立即失效，${b.posts} 篇讨论不再公开显示；可在回收站恢复。`,
          label: "删除版块",
          done: "版块已删除，版主已收到通知。",
          run: () => api("/categories/" + encodeURIComponent(b.id), { method: "DELETE", body: JSON.stringify({}) }),
        });
  const removePost = (p: ManagedPost) =>
    p.can.delete === "request"
      ? openGovernance({ kind: "request-delete", type: "post", id: p.id, label: p.title, onDone: refresh })
      : setConfirm({
          heading: `删除帖子「${p.title}」？`,
          description: `帖子立即不再公开显示，${p.comments} 条留言一并收起；可在回收站恢复。`,
          label: "删除帖子",
          done: "帖子已删除，作者已收到通知。",
          run: () => api("/posts/" + encodeURIComponent(p.id), { method: "DELETE", body: JSON.stringify({}) }),
        });
  const restore = (type: TargetType, id: string, label: string) =>
    setConfirm({
      heading: `恢复${targetNouns[type]}「${label}」？`,
      description: type === "user" ? "账号恢复正常，可以重新登录，并通知对方。" : "恢复后重新对其他人可见，并通知相关用户。",
      label: "恢复",
      done: "已恢复，相关用户已收到通知。",
      run: () => api("/admin/restore", requestPost({ target_type: type, target_id: id })),
    });
  const undoRemoval = (r: MemberRemoval) =>
    setConfirm({
      heading: `撤回移出，让 ${r.member.name} 回到「${r.board.name}」？`,
      description: "对方会重新成为版块成员，并收到提醒。",
      label: "撤回",
      done: `${r.member.name} 已回到「${r.board.name}」。`,
      run: () => api(`/admin/member-removals/${r.id}/undo`, requestPost({})),
    });
  const ignoreRemoval = (r: MemberRemoval) =>
    setConfirm({
      heading: `忽略对 ${r.member.name} 的移出记录？`,
      description: `移出结果保持不变，这条记录会从回收站消失，不会通知任何人。`,
      label: "忽略",
      done: "已忽略这条记录。",
      run: () => api(`/admin/member-removals/${r.id}/ignore`, requestPost({})),
    });
  const purge = (item: TrashItem) =>
    item.type === "user"
      ? setPurgingUser({ id: item.id, name: item.label } as ManagedUser)
      : setConfirm({
          heading: "永久删除后将无法恢复，是否继续？",
          description:
            (item.type === "board"
              ? `版块「${item.label}」及其中 ${item.posts ?? 0} 篇讨论会被永久删除。`
              : `${targetNouns[item.type]}「${item.label}」会被永久删除，附件一并清除。`) + "永久删除后将无法恢复。",
          label: "永久删除",
          done: "已永久删除。",
          run: () => api("/admin/purge", requestPost({ target_type: item.type, target_id: item.id, confirm: true })),
        });

  const tiles: [Tab, typeof Users, string, number | undefined, string?][] = [
    ["users", Users, "社区成员", overview?.members],
    ["posts", FileText, "全站讨论", overview?.posts],
    ["reports", Flag, "待处理投诉", overview?.reports],
    ["users", Mic, "待处理申诉", overview?.appeals],
    ["admins", ShieldCheck, "删除申请", overview?.requests],
    ["users", MicOff, "禁言成员", overview?.muted],
    ["boards", LayoutGrid, "禁言版块", overview?.muted_boards],
    ["posts", MicOff, "禁言帖子", overview?.locked, "locked"],
  ];
  const tabs: [Tab, string, typeof Users][] = [
    ["users", "管理用户", Users],
    ["boards", "管理版块", LayoutGrid],
    ["posts", "管理帖子", FileText],
    ["admins", "管理员", ShieldCheck],
    ["reports", "投诉处理", Flag],
    ["logs", "操作记录", Activity],
    ["trash", "回收站", ArchiveRestore],
  ];

  return (
    <Modal title="NAIMAKES / COMMUNITY CONSOLE" wide onClose={onClose} className="admin-modal gov-console">
      <div className="admin-title">
        <div>
          <div className="eyebrow">CARE FOR THE COMMUNITY</div>
          <h2>社区管理</h2>
        </div>
        <span className="role-pill">
          <Crown size={14} />
          {roleNames[user.role]} · {user.name}
        </span>
      </div>
      <div className="admin-overview gov-overview">
        {tiles.map(([target, Icon, label, count, preset]) => (
          <button
            key={label}
            type="button"
            className="gov-tile"
            onClick={() => {
              switchTab(target);
              if (target === "posts") setPostStatus((preset as (typeof postStatusFilters)[number][0]) || "all");
            }}
          >
            <span>
              <Icon size={15} />
              {label}
            </span>
            <strong>{count ?? "—"}</strong>
          </button>
        ))}
      </div>
      <div className="admin-toolbar">
        <FluidTabs className="segmented gov-tabs" active={tab} label="社区管理导航">
          {tabs.map(([id, label, Icon]) => (
            <LiquidButton
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => switchTab(id)}
            >
              <Icon size={14} />
              {label}
            </LiquidButton>
          ))}
        </FluidTabs>
      </div>
      {notice && (
        <div className="admin-notice" role="status">
          <Check size={15} />
          {notice}
          <LiquidButton className="admin-action" aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={13} />
          </LiquidButton>
        </div>
      )}

      <section className="admin-stage gov-stage" aria-live="polite">
        {tab === "users" && (
          <>
            <div className="gov-stage-head">
              <StageSearch value={query} onChange={setQuery} placeholder="昵称 / 用户 ID / 邮箱" />
              <Filters items={userFilters} value={userStatus} onChange={setUserStatus} label="用户状态" />
            </div>
            <StageState loading={users.loading} error={users.error} empty={!users.page.items.length} query={query} onRetry={users.reload}>
              <div className="gov-list">
                {users.page.items.map((u) => {
                  const deleted = u.status === "deleted";
                  const primary = u.case && u.can.handle_case ? (
                    <Action key="case" onClick={() => openGovernance({ kind: "case", id: u.case!.id })}>
                      <Flag size={14} />
                      处理投诉
                    </Action>
                  ) : u.appeal && isOwner ? (
                    <Action key="appeal" onClick={() => openGovernance({ kind: "appeal", id: u.appeal!.id })}>
                      <Mic size={14} />
                      处理申诉
                    </Action>
                  ) : u.can.mute || u.can.unmute ? (
                    <Action key="mute" danger={!u.penalty} onClick={() => setMuting({ kind: "user", item: u })}>
                      <MicOff size={14} />
                      {u.penalty ? "调整禁言" : "禁言"}
                    </Action>
                  ) : u.can.reactivate ? (
                    <Action
                      key="reactivate"
                      onClick={() =>
                        setConfirm({
                          heading: `恢复「${u.name}」的账号？`,
                          description: "恢复后可以重新登录。",
                          label: "恢复账号",
                          done: "账号已恢复，对方已收到通知。",
                          run: () => api("/admin/users/" + encodeURIComponent(u.id), { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
                        })
                      }
                    >
                      <UserCheck size={14} />
                      恢复账号
                    </Action>
                  ) : null;
                  const secondary = deleted ? (
                    u.can.restore ? (
                      <Action key="restore" onClick={() => restore("user", u.id, u.name)}>
                        <ArchiveRestore size={14} />
                        恢复
                      </Action>
                    ) : null
                  ) : u.request ? (
                    <Action key="req" disabled title="删除申请正在处理中" onClick={() => {}}>
                      申请中
                    </Action>
                  ) : u.can.delete ? (
                    <Action key="del" danger onClick={() => removeUser(u)}>
                      <Trash2 size={14} />
                      删除
                    </Action>
                  ) : null;
                  return (
                    <Card
                      key={u.id}
                      tone={u.appeal ? "is-appeal" : u.penalty ? "is-muted" : ""}
                      main={
                        <PersonLine
                          person={u}
                          sub={
                            <>
                              ID · {u.name}
                              {u.email && <> · {u.email}</>}
                            </>
                          }
                          badges={
                            <>
                              <span className={"role-pill role-" + u.role}>
                                {u.role === "owner" && <Crown size={11} />}
                                {roleNames[u.role]}
                              </span>
                              {u.demo === 1 && <span className="sample-label">示例</span>}
                              {u.appeal &&
                                (isOwner ? (
                                  <LiquidButton type="button" className="appeal-chip" onClick={(e) => { e.stopPropagation(); openGovernance({ kind: "appeal", id: u.appeal!.id }); }}>
                                    <Mic size={11} />
                                    申请撤销禁言
                                  </LiquidButton>
                                ) : (
                                  <span className="appeal-chip is-static">
                                    <Mic size={11} />
                                    申请撤销禁言
                                  </span>
                                ))}
                            </>
                          }
                        />
                      }
                      status={
                        <>
                          {deleted ? (
                            <Pill tone="danger">已删除</Pill>
                          ) : u.status === "suspended" ? (
                            <Pill tone="danger">已停用</Pill>
                          ) : u.penalty ? (
                            <Pill tone="danger">{muteLabel(u.penalty.until)}</Pill>
                          ) : (
                            <Pill>正常</Pill>
                          )}
                          {u.case && <Pill tone="wait">{u.case.count} 条投诉</Pill>}
                          {!u.case && <small>{u.posts} 篇讨论</small>}
                        </>
                      }
                      actions={[primary, secondary]}
                    />
                  );
                })}
              </div>
              <More show={users.page.hasMore} loading={users.loading} onMore={users.more} />
            </StageState>
          </>
        )}

        {tab === "reports" && (
          <>
            <div className="gov-stage-head is-reports">
              <Filters items={caseTypes} value={caseType} onChange={setCaseType} counts={caseCounts} label="投诉对象" />
              <StageSearch
                value={query}
                onChange={setQuery}
                placeholder={{ all: "搜索投诉内容", board: "版块名称 / 版主", post: "帖子标题 / 正文 / 作者", comment: "评论内容 / 所在帖子 / 作者", user: "昵称 / 用户 ID" }[caseType]}
              />
              <Filters items={caseFilters} value={caseStatus} onChange={setCaseStatus} label="处理状态" />
            </div>
            <StageState loading={cases.loading} error={cases.error} empty={!cases.page.items.length} query={query} onRetry={cases.reload}>
              <div className="gov-list">
                {cases.page.items.map((c) => {
                  const open = (preset?: string) => openGovernance({ kind: "case", id: c.id, preset });
                  const pendingRequest = c.request?.status === "pending";
                  const statusPill =
                    c.status === "pending" ? (
                      pendingRequest ? <Pill tone="wait">待审批删除</Pill> : <Pill tone="wait">待处理</Pill>
                    ) : (
                      <Pill tone={c.status === "dismissed" ? "" : "ok"}>{caseActionLabel[c.action] || caseStatusLabel[c.status]}</Pill>
                    );
                  const quick = new Map((c.quick || []).map((a) => [a.id, a]));
                  const blocked = !c.can_handle ? c.conflict || (pendingRequest ? "删除申请正在处理中" : "你无权处理这条投诉") : "";
                  const why = (id: string) =>
                    blocked ||
                    (quick.has(id)
                      ? undefined
                      : id === "delete"
                        ? c.deleted
                          ? "原内容已删除"
                          : "不能删除这个对象"
                        : c.deleted
                          ? "对象已被删除，无法禁言"
                          : "不能禁言这个对象");
                  const deleteLabel = { user: "删除用户", board: "删除版块", post: "删除帖子", comment: c.reply ? "删除回复" : "删除评论" }[c.target_type];
                  const actions: ReactNode[] =
                    c.status !== "pending"
                      ? [null, null, <Action key="view" onClick={() => open()}>查看</Action>]
                      : [
                          <Action key="dismiss" disabled={!quick.has("dismiss")} title={why("dismiss")} onClick={() => open("dismiss")}>
                            <RotateCcw size={14} />
                            驳回
                          </Action>,
                          <Action
                            key="mute"
                            danger
                            disabled={!quick.has(c.target_type === "board" ? "mute_board" : "mute")}
                            title={why(c.target_type === "board" ? "mute_board" : "mute")}
                            onClick={() => open(c.target_type === "board" ? "mute_board" : "mute")}
                          >
                            <MicOff size={14} />
                            禁言
                          </Action>,
                          <Action key="delete" danger disabled={!quick.has("delete")} title={why("delete")} onClick={() => open("delete")}>
                            <Trash2 size={14} />
                            {quick.get("delete")?.mode === "request" ? "申请删除" : deleteLabel}
                          </Action>,
                        ];
                  const main =
                    c.target_type === "user" && c.subject ? (
                      <PersonLine person={c.subject} badges={c.penalty && <span className="mute-chip is-static"><MicOff size={10} />{muteLabel(c.penalty.until, true)}</span>} />
                    ) : c.target_type === "board" ? (
                      <BoardLine
                        name={c.title}
                        icon={c.icon}
                        sub={c.subject ? `版主 ${c.subject.name} · ID ${c.subject.name}` : "站主代管"}
                        badges={c.penalty && <span className="mute-chip is-static"><MicOff size={10} />{muteLabel(c.penalty.until, true)}</span>}
                      />
                    ) : (
                      <span className="gov-card-content">
                        <span className="gov-kicker">
                          {c.target_type === "post" ? <FileText size={12} /> : <MessageSquareText size={12} />}
                          {c.target_type === "post" ? "帖子" : c.reply ? "回复" : "评论"}
                          {c.board && <> · {c.board.name}</>}
                        </span>
                        <strong className="gov-ellipsis">{c.target_type === "post" ? c.title : `「${c.title}」下的${c.reply ? "回复" : "评论"}`}</strong>
                        {c.excerpt && <small className="gov-clamp">{c.excerpt}</small>}
                        {c.subject && (
                          <span className="gov-card-author">
                            <Avatar name={c.subject.name} initials={c.subject.initials} avatar={c.subject.avatar} size={20} />
                            <span className="gov-ellipsis">{c.subject.name}</span>
                            {c.penalty && <span className="mute-chip is-static"><MicOff size={10} />{muteLabel(c.penalty.until, true)}</span>}
                          </span>
                        )}
                      </span>
                    );
                  return (
                    <Card
                      key={c.id}
                      tone={c.deleted ? "is-removed" : ""}
                      onOpen={() => open()}
                      main={main}
                      status={
                        <>
                          {statusPill}
                          <span className="gov-reasons">
                            {c.categories.slice(0, 2).map((x) => (
                              <Pill key={x.id} tone="danger">
                                {x.label}
                                {x.count > 1 && ` ×${x.count}`}
                              </Pill>
                            ))}
                          </span>
                          {c.deleted && <Pill tone="danger">原内容已删除</Pill>}
                          <small>
                            {c.count} 条 · {timeAgo(c.status === "pending" ? c.updated_at : c.resolved_at || c.updated_at)}
                          </small>
                        </>
                      }
                      actions={actions}
                      columns={3}
                    />
                  );
                })}
              </div>
              <More show={cases.page.hasMore} loading={cases.loading} onMore={cases.more} />
            </StageState>
          </>
        )}

        {tab === "boards" && (
          <>
            <div className="gov-stage-head">
              <StageSearch value={query} onChange={setQuery} placeholder="版块名称 / 版主 / 简介" />
              <Filters items={boardFilters} value={boardStatus} onChange={setBoardStatus} label="版块状态" />
            </div>
            <StageState loading={boards.loading} error={boards.error} empty={!boards.page.items.length} query={query} onRetry={boards.reload}>
              <div className="gov-list">
                {boards.page.items.map((b) => {
                  const deleted = !!b.deleted_at;
                  const muteButton = deleted ? (
                    b.can.purge ? (
                      <Action key="purge" danger onClick={() => purge({ id: b.id, type: "board", label: b.name, posts: b.posts } as TrashItem)}>
                        <Trash2 size={14} />
                        永久删除
                      </Action>
                    ) : null
                  ) : b.case && b.can.handle_case ? (
                    <Action key="case" danger onClick={() => openGovernance({ kind: "case", id: b.case!.id, preset: "mute_board" })}>
                      <MicOff size={14} />
                      禁言
                    </Action>
                  ) : (
                    <Action key="mute" danger={!b.penalty} disabled={!b.can.mute && !b.can.unmute} title={b.conflict || undefined} onClick={() => setMuting({ kind: "board", item: b })}>
                      <MicOff size={14} />
                      {b.penalty ? "调整禁言" : "禁言"}
                    </Action>
                  );
                  const deleteButton = deleted ? (
                    <Action key="restore" disabled={!b.can.restore} onClick={() => restore("board", b.id, b.name)}>
                      <ArchiveRestore size={14} />
                      恢复
                    </Action>
                  ) : b.request ? (
                    <Action key="req" disabled title="删除申请正在处理中" onClick={() => {}}>
                      申请中
                    </Action>
                  ) : (
                    <Action key="del" danger disabled={!b.can.delete} onClick={() => removeBoard(b)}>
                      <Trash2 size={14} />
                      删除版块
                    </Action>
                  );
                  return (
                    <Card
                      key={b.id}
                      tone={b.appeal ? "is-appeal" : b.penalty ? "is-muted" : deleted ? "is-removed" : ""}
                      main={
                        <BoardLine
                          name={b.name}
                          icon={b.icon}
                          sub={
                            <>
                              {b.lead ? `版主 ${b.lead.name}` : "站主代管"}
                              {b.assistants.length > 0 && ` · ${b.assistants.length} 位协管`} · /topics/{b.id}
                            </>
                          }
                          badges={
                            <>
                              {b.builtin && <span className="sample-label">内置</span>}
                              {!deleted && (
                                <LiquidButton type="button" className="icon-button gov-inline-link" aria-label={`打开「${b.name}」版块管理`} title="版块管理" onClick={() => onManageBoard(b.id)}>
                                  <ArrowUpRight size={13} />
                                </LiquidButton>
                              )}
                              {b.appeal &&
                                (isOwner ? (
                                  <LiquidButton type="button" className="appeal-chip" onClick={(e) => { e.stopPropagation(); openGovernance({ kind: "appeal", id: b.appeal!.id }); }}>
                                    <Mic size={11} />
                                    申请撤销禁言
                                  </LiquidButton>
                                ) : (
                                  <span className="appeal-chip is-static">
                                    <Mic size={11} />
                                    申请撤销禁言
                                  </span>
                                ))}
                            </>
                          }
                        />
                      }
                      status={
                        <>
                          {deleted ? <Pill tone="danger">已删除</Pill> : b.penalty ? <Pill tone="danger">{muteLabel(b.penalty.until)}</Pill> : <Pill>正常</Pill>}
                          {b.case ? <Pill tone="wait">{b.case.count} 条投诉</Pill> : <small>{b.posts} 篇讨论</small>}
                        </>
                      }
                      actions={[muteButton, deleteButton]}
                    />
                  );
                })}
              </div>
              <More show={boards.page.hasMore} loading={boards.loading} onMore={boards.more} />
            </StageState>
          </>
        )}

        {tab === "posts" && (
          <>
            <div className="gov-stage-head is-feed">
              <StageSearch value={query} onChange={setQuery} placeholder="帖子标题 / 正文 / 标签 / 作者" />
              <Filters items={postStatusFilters} value={postStatus} onChange={setPostStatus} label="帖子状态" />
            </div>
            <StageState loading={posts.loading} error={posts.error} empty={!posts.page.items.length} query={query} onRetry={posts.reload}>
              <div className="gov-list">
                {posts.page.items.map((p) => {
                  const deleted = !!p.deleted_at;
                  const lockButton = deleted ? (
                    p.can.purge ? (
                      <Action key="purge" danger onClick={() => purge({ id: p.id, type: "post", label: p.title } as TrashItem)}>
                        <Trash2 size={14} />
                        永久删除
                      </Action>
                    ) : null
                  ) : p.case && p.can.handle_case ? (
                    <Action key="case" onClick={() => openGovernance({ kind: "case", id: p.case!.id })}>
                      <Flag size={14} />
                      处理投诉
                    </Action>
                  ) : (
                    <Action
                      key="lock"
                      danger={!p.locked}
                      disabled={!p.can.lock && !p.can.unlock}
                      title={p.conflict || undefined}
                      onClick={() => setLocking(p)}
                    >
                      {p.locked ? <Mic size={14} /> : <MicOff size={14} />}
                      {p.locked ? "解除禁言" : "禁言"}
                    </Action>
                  );
                  const deleteButton = deleted ? (
                    <Action key="restore" disabled={!p.can.restore} onClick={() => restore("post", p.id, p.title)}>
                      <ArchiveRestore size={14} />
                      恢复
                    </Action>
                  ) : p.request ? (
                    <Action key="req" disabled title="删除申请正在处理中" onClick={() => {}}>
                      申请中
                    </Action>
                  ) : (
                    <Action key="del" danger disabled={!p.can.delete} onClick={() => removePost(p)}>
                      <Trash2 size={14} />
                      删除帖子
                    </Action>
                  );
                  return (
                    <Card
                      key={p.id}
                      tone={p.locked ? "is-muted" : deleted ? "is-removed" : ""}
                      main={
                        <span className="gov-card-content">
                          <span className="gov-kicker">
                            <FileText size={12} />
                            {p.kind === "announcement" ? "公告" : "帖子"}
                            {p.board && <> · {p.board.name}</>}
                            {p.demo === 1 && <span className="sample-label">示例</span>}
                            {!deleted && (
                              <LiquidButton
                                type="button"
                                className="icon-button gov-inline-link"
                                aria-label={`打开讨论「${p.title}」`}
                                title="查看帖子"
                                onClick={() => onInspect(p.id)}
                              >
                                <ArrowUpRight size={13} />
                              </LiquidButton>
                            )}
                          </span>
                          <strong className="gov-ellipsis">{p.title}</strong>
                          {p.excerpt && <small className="gov-clamp">{p.excerpt}</small>}
                          {p.author && (
                            <span className="gov-card-author">
                              <Avatar name={p.author.name} initials={p.author.initials} avatar={p.author.avatar} size={20} />
                              <span className="gov-ellipsis">{p.author.name}</span>
                              {!!p.author.muted && (
                                <span className="mute-chip is-static">
                                  <MicOff size={10} />
                                  {muteLabel(p.author.muted_until ?? null, true)}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      }
                      status={
                        <>
                          {deleted ? <Pill tone="danger">已删除</Pill> : p.locked ? <Pill tone="danger">已禁言</Pill> : <Pill>正常</Pill>}
                          {p.case && <Pill tone="wait">{p.case.count} 条投诉</Pill>}
                          {p.visibility !== "public" && <Pill>仅自己可见</Pill>}
                          {p.comments_closed && !p.locked && <Pill>作者已关闭评论</Pill>}
                          <small>
                            {p.comments} 条留言 · {p.likes} 赞同 · {timeAgo(p.created_at)}
                          </small>
                        </>
                      }
                      actions={[lockButton, deleteButton]}
                    />
                  );
                })}
              </div>
              <More show={posts.page.hasMore} loading={posts.loading} onMore={posts.more} />
            </StageState>
          </>
        )}

        {tab === "admins" && (
          <>
            <div className="gov-panel">
              <div className="gov-stage-head is-inline">
                <h3 className="gov-stage-title">当前管理员</h3>
                {isOwner && (
                  <LiquidButton type="button" className="admin-action gov-slot-button" onClick={() => setGranting(true)}>
                    <ShieldPlus size={14} />
                    授予管理员
                  </LiquidButton>
                )}
              </div>
              <StageState loading={!admins && !adminError} error={adminError} empty={!admins?.admins.length} query="" onRetry={() => setRevision((n) => n + 1)}>
                <div className="gov-list">
                  {admins?.admins.map((a) => (
                    <Card
                      key={a.id}
                      main={<PersonLine person={a} sub={<>ID · {a.name}{a.email && <> · {a.email}</>}</>} badges={<span className="role-pill role-admin">管理员</span>} />}
                      status={
                        <>
                          {a.pending_requests > 0 ? <Pill tone="wait">{a.pending_requests} 份待审批</Pill> : <Pill>无待审批</Pill>}
                          {a.granted_at && <small>{dateTimeText(a.granted_at)} 授予</small>}
                        </>
                      }
                      actions={[
                        null,
                        isOwner ? (
                          <Action
                            key="revoke"
                            danger
                            onClick={() =>
                              setConfirm({
                                heading: `移除「${a.name}」的管理员权限？`,
                                description: "立即失去管理后台中的全部能力，对方会收到通知；已提交的删除申请仍由你处理。",
                                label: "移除管理员",
                                done: "已移除管理员权限，对方已收到通知。",
                                run: () => api("/admin/admins/" + encodeURIComponent(a.id), { method: "DELETE", body: JSON.stringify({}) }),
                              })
                            }
                          >
                            <ShieldMinus size={14} />
                            移除管理员
                          </Action>
                        ) : null,
                      ]}
                    />
                  ))}
                </div>
              </StageState>
            </div>
            <div className="gov-panel">
              <div className="gov-stage-head is-inline">
                <h3 className="gov-stage-title">删除申请</h3>
              </div>
              {admins && !admins.requests.length ? (
                <div className="gov-empty">
                  <strong>暂无结果</strong>
                </div>
              ) : (
                <div className="gov-list">
                  {admins?.requests.map((r) => (
                    <Card
                      key={r.id}
                      onOpen={() => openGovernance({ kind: "request", id: r.id })}
                      main={
                        <span className="gov-card-content">
                          <span className="gov-kicker">
                            申请删除{targetNouns[r.target_type]}
                            {r.requester && <> · {r.requester.name}</>}
                          </span>
                          <strong className="gov-ellipsis">{r.target_label}</strong>
                          <small className="gov-clamp">{r.reason}</small>
                        </span>
                      }
                      status={
                        <>
                          <Pill tone={r.status === "pending" ? "wait" : r.status === "approved" ? "ok" : ""}>{r.status_label}</Pill>
                          <small>{timeAgo(r.created_at)}</small>
                        </>
                      }
                      actions={[
                        null,
                        <Action key="open" danger={r.status === "pending" && isOwner} onClick={() => openGovernance({ kind: "request", id: r.id })}>
                          {r.status === "pending" && isOwner ? "审批" : "查看"}
                        </Action>,
                      ]}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === "trash" && (
          <>
            <div className="gov-stage-head">
              <Filters items={isOwner ? ownerTrashTypes : trashTypes} value={trashType} onChange={setTrashType} label="回收站类型" />
              <p className="gov-stage-hint">
                {trashType === "member"
                  ? "版主或站主移出版块的成员，保留 30 天。可以撤回移出，或忽略这条记录。"
                  : isOwner
                    ? "保留最近 30 天删除的内容，到期后自动永久删除。站主可以恢复或永久删除。"
                    : "这里只显示你申请、经站主批准后删除的内容，保留 30 天，可以恢复。"}
              </p>
            </div>
            {trashType === "member" ? (
              <StageState loading={removals.loading} error={removals.error} empty={!removals.page.items.length} query="" onRetry={removals.reload}>
                <div className="gov-list">
                  {removals.page.items.map((r) => (
                    <Card
                      key={r.id}
                      tone="is-removed"
                      main={<PersonLine person={r.member} sub={<>移出自「{r.board.name}」</>} />}
                      status={
                        <>
                          <Pill tone="danger">已移出</Pill>
                          <small className="gov-ellipsis">
                            {r.removed_by ? r.removed_by.name : "已注销用户"} · {timeAgo(r.removed_at)}
                          </small>
                          <small className="gov-ellipsis">{Math.max(1, Math.ceil((r.expires_at - Date.now()) / 86400000))} 天后记录自动清除</small>
                        </>
                      }
                      actions={[
                        <Action key="undo" disabled={busy} onClick={() => undoRemoval(r)}>
                          <Undo2 size={14} />
                          撤回
                        </Action>,
                        <Action key="ignore" disabled={busy} onClick={() => ignoreRemoval(r)}>
                          <EyeOff size={14} />
                          忽略
                        </Action>,
                      ]}
                    />
                  ))}
                </div>
                <More show={removals.page.hasMore} loading={removals.loading} onMore={removals.more} />
              </StageState>
            ) : (
            <StageState loading={trash.loading} error={trash.error} empty={!trash.page.items.length} query="" onRetry={trash.reload}>
              <div className="gov-list">
                {trash.page.items.map((item) => (
                  <Card
                    key={item.type + item.id}
                    tone="is-removed"
                    main={
                      item.type === "user" && item.owner ? (
                        <PersonLine person={item.owner} />
                      ) : item.type === "board" ? (
                        <BoardLine name={item.label} icon={item.board?.icon} sub={`${item.posts ?? 0} 篇讨论 · /topics/${item.id}`} />
                      ) : (
                        <span className="gov-card-content">
                          <span className="gov-kicker">
                            {targetNouns[item.type]}
                            {item.board && <> · {item.board.name}</>}
                            {item.owner && <> · {item.owner.name}</>}
                          </span>
                          <strong className="gov-ellipsis">{item.label}</strong>
                          {item.excerpt && <small className="gov-clamp">{item.excerpt}</small>}
                        </span>
                      )
                    }
                    status={
                      <>
                        <Pill tone="danger">已删除</Pill>
                        <small className="gov-ellipsis">
                          {item.deleted_by ? item.deleted_by.name : "系统"} · {timeAgo(item.deleted_at)}
                        </small>
                        <small className="gov-ellipsis">{daysLeft(item.expires_at)}</small>
                        {item.delete_reason && <small className="gov-ellipsis">{item.delete_reason}</small>}
                      </>
                    }
                    actions={[
                      <Action key="restore" disabled={!item.can_restore} onClick={() => restore(item.type, item.id, item.label)}>
                        <ArchiveRestore size={14} />
                        恢复
                      </Action>,
                      item.can_purge ? (
                        <Action key="purge" danger onClick={() => purge(item)}>
                          <Trash2 size={14} />
                          永久删除
                        </Action>
                      ) : null,
                    ]}
                  />
                ))}
              </div>
              <More show={trash.page.hasMore} loading={trash.loading} onMore={trash.more} />
            </StageState>
            )}
          </>
        )}

        {tab === "logs" && (
          <>
            <div className="gov-stage-head is-inline gov-log-toolbar">
              <Filters
                items={logTypes}
                value={logType}
                onChange={(next) => {
                  setLogType(next);
                  setLogPicked([]);
                }}
                label="操作对象"
              />
              <div className="gov-log-tools">
                <LiquidButton
                  type="button"
                  className={"admin-action gov-slot-button" + (logBatch ? " is-selected" : "")}
                  disabled={!logs.page.items.length}
                  onClick={() => {
                    setLogBatch(!logBatch);
                    setLogPicked([]);
                  }}
                >
                  <ListChecks size={14} />
                  {logBatch ? "退出管理" : "批量管理"}
                </LiquidButton>
                <LiquidButton type="button" className="admin-action gov-slot-button admin-action-danger" disabled={!logs.page.items.length || busy} onClick={clearLogs}>
                  <Trash2 size={14} />
                  一键清空
                </LiquidButton>
              </div>
            </div>
            <p className="gov-stage-count gov-log-count">共 {logs.page.total} 条操作记录</p>
            {logBatch && logs.page.items.length > 0 && (
              <div className="gov-batch-bar">
                <label>
                  <input
                    type="checkbox"
                    checked={logPicked.length === logs.page.items.length}
                    onChange={(e) => setLogPicked(e.target.checked ? logs.page.items.map((l) => l.id) : [])}
                  />
                  全选当前列表 <span>已选 {logPicked.length}</span>
                </label>
                <LiquidButton type="button" className="admin-action gov-slot-button admin-action-danger" disabled={!logPicked.length || busy} onClick={() => hideLogs(logPicked)}>
                  <Trash2 size={14} />
                  删除所选
                </LiquidButton>
              </div>
            )}
            <StageState loading={logs.loading} error={logs.error} empty={!logs.page.items.length} query="" onRetry={logs.reload}>
              <div className="gov-list">
                {logs.page.items.map((l) => {
                  const text = logDetailText(l);
                  const picked = logPicked.includes(l.id);
                  const toggle = () => setLogPicked((prev) => (prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id]));
                  return (
                    <article className={"gov-log" + (logBatch ? " is-picking" : "") + (picked ? " is-picked" : "")} key={l.id}>
                      {logBatch && (
                        <label className="gov-log-check">
                          <input type="checkbox" aria-label={"选择记录：" + (logActions[l.action] || l.action)} checked={picked} onChange={toggle} />
                        </label>
                      )}
                      <span className="gov-glyph">
                        {l.actor_role === "system" ? <Activity size={16} /> : <UserRound size={16} />}
                      </span>
                      <div className="gov-log-body">
                        <strong>
                          {logActions[l.action] || l.action}
                          {l.target_label && <span className="gov-ellipsis"> · {l.target_label}</span>}
                        </strong>
                        <div className="gov-log-meta">
                          <Pill>{l.actor}{l.actor_role && ` · ${roleNames[l.actor_role] || l.actor_role}`}</Pill>
                          {l.target_type && <Pill>{targetNouns[l.target_type as TargetType] || l.target_type}</Pill>}
                          {(l.before_state || l.after_state) && (
                            <Pill>
                              {l.before_state || "—"} → {l.after_state || "—"}
                            </Pill>
                          )}
                          {l.needs_approval === 1 && <Pill tone="wait">需审批{l.approver ? ` · ${l.approver}` : ""}{l.approval_result ? ` · ${l.approval_result === "approved" ? "已批准" : "已驳回"}` : ""}</Pill>}
                          <Pill tone={l.notified ? "ok" : ""}>{l.notified ? "已通知" : "无需通知"}</Pill>
                        </div>
                        {text && <p>{text}</p>}
                      </div>
                      <time>{dateTimeText(l.created_at)}</time>
                    </article>
                  );
                })}
              </div>
              <More show={logs.page.hasMore} loading={logs.loading} onMore={logs.more} />
            </StageState>
          </>
        )}
      </section>

      {muting && (
        <MuteDialog
          kind={muting.kind}
          id={muting.item.id}
          name={muting.item.name}
          person={muting.kind === "user" ? muting.item : null}
          icon={muting.kind === "board" ? muting.item.icon : undefined}
          lead={muting.kind === "board" ? muting.item.lead : undefined}
          penalty={muting.item.penalty}
          canUnmute={muting.item.can.unmute}
          onClose={() => setMuting(null)}
          onDone={(message) => {
            setMuting(null);
            settle(message);
          }}
        />
      )}
      {locking && (
        <PostLockDialog
          id={locking.id}
          title={locking.title}
          author={locking.author}
          board={locking.board}
          locked={locking.locked}
          lockReason={locking.lock_reason}
          canUnlock={locking.can.unlock}
          onClose={() => setLocking(null)}
          onDone={(message) => {
            setLocking(null);
            settle(message);
          }}
        />
      )}
      {confirm && (
        <DangerConfirm
          title={confirm.label}
          heading={confirm.heading}
          description={confirm.description}
          confirmLabel={confirm.label}
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
      {purgingUser && (
        <AccountDeletion
          mode="admin"
          target={purgingUser}
          onClose={() => setPurgingUser(null)}
          onDeleted={() => {
            setPurgingUser(null);
            settle("用户已永久删除。");
          }}
        />
      )}
      {granting && (
        <GrantAdmin
          onClose={() => setGranting(false)}
          onDone={(message) => {
            setGranting(false);
            settle(message);
          }}
        />
      )}
    </Modal>
  );
}

function GrantAdmin({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [query, setQuery] = useState(""),
    [people, setPeople] = useState<ManagedUser[]>([]),
    [picked, setPicked] = useState<ManagedUser | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api(`/admin/users?status=active&q=${encodeURIComponent(query.trim())}`)
        .then((r) => live && setPeople((r.users as ManagedUser[]).filter((u) => u.role === "member" && !u.demo)))
        .catch((e) => live && setError((e as Error).message));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  async function grant() {
    if (!picked) return;
    setBusy(true);
    try {
      await api("/admin/admins/" + encodeURIComponent(picked.id), { method: "PUT", body: JSON.stringify({}) });
      onDone(`已授予「${picked.name}」管理员权限，对方已收到通知。`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setPicked(null);
    }
  }
  return (
    <Modal title="授予管理员" className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      <header className="gov-head">
        <span className="confirm-icon">
          <ShieldPlus size={20} strokeWidth={1.7} />
        </span>
        <div>
          <h2>授予管理员</h2>
        </div>
      </header>
      <StageSearch value={query} onChange={setQuery} placeholder="昵称 / 用户 ID" />
      <div className="gov-pick-list">
        {people.length ? (
          people.map((p) => (
            <LiquidButton key={p.id} type="button" className="admin-action gov-pick" onClick={() => setPicked(p)}>
              <Avatar name={p.name} initials={p.initials} avatar={p.avatar} size={30} />
              <span className="gov-card-text">
                <strong className="gov-ellipsis">{p.name}</strong>
                <small className="gov-ellipsis">ID · {p.name}</small>
              </span>
              <ArrowUpRight size={14} />
            </LiquidButton>
          ))
        ) : (
          <div className="gov-empty">
            <strong>{query ? "没有找到相关内容" : "暂无结果"}</strong>
          </div>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {picked && (
        <DangerConfirm
          title="授予管理员"
          heading={`授予「${picked.name}」管理员权限？`}
          description="管理员可以处理用户、投诉与版块；删除他人内容需要向你申请。对方会收到通知。"
          confirmLabel="确认授予"
          busy={busy}
          onConfirm={grant}
          onClose={() => setPicked(null)}
        />
      )}
    </Modal>
  );
}
