export type TargetType = "user" | "post" | "comment" | "board";
export type PersonCard = {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  role?: string;
  status?: string;
  muted?: number;
  muted_until?: number | null;
};
type BoardCard = { id: string; name: string; icon: string; deleted?: boolean };
export type PenaltyInfo = { id: string; starts_at: number; until: number | null; reason: string };

export type CaseSummary = {
  id: string;
  target_type: TargetType;
  target_id: string;
  status: "pending" | "resolved" | "dismissed";
  action: string;
  note: string;
  opened_at: number;
  updated_at: number;
  resolved_at: number | null;
  resolver: PersonCard | null;
  count: number;
  categories: { id: string; label: string; count: number }[];
  latest: { category: string; detail: string; created_at: number } | null;
  title: string;
  excerpt: string;
  reply: boolean;
  exists: boolean;
  deleted: boolean;
  subject: PersonCard | null;
  board: BoardCard | null;
  post_id: string | null;
  icon: string;
  penalty: PenaltyInfo | null;
  request: { id: string; status: string; requester?: PersonCard | null } | null;
  can_handle: boolean;
  conflict: string;
  quick?: { id: string; mode: "direct" | "request" }[];
};
export type Snapshot = {
  title?: string;
  content?: string;
  name?: string;
  bio?: string;
  description?: string;
  en?: string;
  icon?: string;
  avatar?: string;
  initials?: string;
  id?: string;
  author?: PersonCard | null;
  lead?: PersonCard | null;
  board?: BoardCard | null;
  post?: { id: string; title: string } | null;
  reply?: boolean;
  reply_to?: PersonCard | null;
  captured_at?: number;
  created_at?: number;
};
type CaseAction = { id: string; label: string; danger: boolean; mode?: "direct" | "request" };
export type CaseDetail = CaseSummary & {
  snapshot: Snapshot;
  current: Snapshot | null;
  current_state: string;
  complaints: {
    id: string;
    category: string;
    label: string;
    detail: string;
    created_at: number;
    reporter: PersonCard | null;
  }[];
  actions: CaseAction[];
  request: RequestDetail | CaseSummary["request"];
};
export type AppealDetail = {
  id: string;
  status: "pending" | "approved" | "rejected" | "closed";
  status_label: string;
  reason: string;
  created_at: number;
  resolved_at: number | null;
  resolve_note: string;
  resolver: PersonCard | null;
  target_type: "user" | "board";
  target: { id: string; label: string; deleted: boolean; icon?: string };
  applicant: PersonCard | null;
  penalty: { id: string; reason: string; starts_at: number; until: number | null; status: string; actor: PersonCard | null } | null;
  can_decide: boolean;
};
export type RequestDetail = {
  id: string;
  status: "pending" | "approved" | "rejected" | "void";
  status_label: string;
  target_type: TargetType;
  target_id: string;
  target_label: string;
  target_state: string;
  snapshot: Snapshot;
  reason: string;
  detail: string;
  case_id: string | null;
  created_at: number;
  resolved_at: number | null;
  resolve_note: string;
  resolver: PersonCard | null;
  requester: PersonCard | null;
  can_decide: boolean;
};
type Capabilities = {
  mute: boolean;
  unmute: boolean;
  delete: "direct" | "request" | null;
  restore: boolean;
  purge: boolean;
  handle_case: boolean;
  reactivate?: boolean;
};
export type ManagedUser = PersonCard & {
  email: string;
  role: string;
  status: string;
  demo: number;
  created_at: number;
  posts: number;
  penalty: PenaltyInfo | null;
  appeal: { id: string; reason: string; created_at: number } | null;
  case: { id: string; count: number } | null;
  request: { id: string } | null;
  deleted_at: number | null;
  delete_reason: string;
  can: Capabilities;
  conflict: string;
};
export type ManagedBoard = {
  id: string;
  name: string;
  en: string;
  description: string;
  icon: string;
  builtin: boolean;
  created_at: number;
  posts: number;
  lead: PersonCard | null;
  assistants: PersonCard[];
  penalty: PenaltyInfo | null;
  appeal: { id: string; reason: string; created_at: number } | null;
  case: { id: string; count: number } | null;
  request: { id: string } | null;
  deleted_at: number | null;
  delete_reason: string;
  can: Capabilities;
  conflict: string;
};
type PostCapabilities = {
  lock: boolean;
  unlock: boolean;
  delete: "direct" | "request" | null;
  restore: boolean;
  purge: boolean;
  handle_case: boolean;
};
export type ManagedPost = {
  id: string;
  title: string;
  excerpt: string;
  kind: string;
  visibility: string;
  created_at: number;
  comments: number;
  likes: number;
  author: PersonCard | null;
  board: BoardCard | null;
  demo: number;
  pinned: boolean;
  locked: boolean;
  lock_reason: string;
  comments_closed: boolean;
  case: { id: string; count: number } | null;
  request: { id: string } | null;
  deleted_at: number | null;
  delete_reason: string;
  can: PostCapabilities;
  conflict: string;
};
export type TrashItem = {
  id: string;
  type: TargetType;
  label: string;
  excerpt: string;
  owner: PersonCard | null;
  board: BoardCard | null;
  post_id: string | null;
  posts: number | null;
  deleted_at: number;
  expires_at: number;
  deleted_by: PersonCard | null;
  delete_reason: string;
  can_restore: boolean;
  can_purge: boolean;
};
export type LogEntry = {
  id: string;
  actor: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  target_id: string;
  target_type: string;
  target_label: string;
  before_state: string;
  after_state: string;
  reason: string;
  detail: string | null;
  needs_approval: number;
  approver: string | null;
  approval_result: string;
  notified: number;
  created_at: number;
};

export const targetNouns: Record<TargetType, string> = { user: "用户", post: "帖子", comment: "评论", board: "版块" };
export const complaintCategories = [
  { id: "spam", label: "垃圾内容" },
  { id: "ad", label: "广告" },
  { id: "abuse", label: "辱骂" },
  { id: "attack", label: "人身攻击" },
  { id: "harassment", label: "恶意骚扰" },
  { id: "illegal", label: "违规内容" },
  { id: "discomfort", label: "不适内容" },
  { id: "impersonation", label: "冒充他人" },
  { id: "flood", label: "恶意刷屏" },
  { id: "other", label: "其他" },
];
export const roleNames: Record<string, string> = {
  owner: "站主",
  admin: "管理员",
  lead: "版主",
  assistant: "协管",
  member: "成员",
  system: "系统",
};
const pad = (n: number) => String(n).padStart(2, "0");
export const dateText = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};
export const dateTimeText = (time: number) => {
  const d = new Date(time);
  return `${dateText(time)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const muteLabel = (until: number | null | undefined, short = false) =>
  until ? (short ? "已禁言" : `禁言至 ${dateText(until)}`) : "永久禁言";
export const caseStatusLabel: Record<string, string> = { pending: "待处理", resolved: "已处理", dismissed: "已驳回" };
export const caseActionLabel: Record<string, string> = {
  dismiss: "已驳回",
  mute: "已禁言",
  mute_board: "版块已禁言",
  delete: "已删除",
};
export const logActions: Record<string, string> = {
  update_user: "调整账号状态",
  grant_admin: "授予管理员",
  revoke_admin: "移除管理员",
  resolve_report: "处理投诉",
  dismiss_report: "驳回投诉",
  delete_post: "删除帖子",
  delete_comment: "删除评论",
  delete_category: "删除版块",
  remove_user: "删除用户",
  delete_user: "永久删除用户",
  delete_own_account: "注销账户",
  restore_post: "恢复帖子",
  restore_comment: "恢复评论",
  restore_category: "恢复版块",
  restore_user: "恢复用户",
  purge_post: "永久删除帖子",
  purge_comment: "永久删除评论",
  purge_category: "永久删除版块",
  create_category: "创建版块",
  update_category: "修改版块资料",
  claim_board: "成为版主",
  appoint_moderator: "任命协管",
  remove_moderator: "撤销版块管理",
  transfer_moderator: "移交版主",
  remove_member: "移出版块成员",
  undo_remove_member: "撤回移出版块成员",
  mute_user: "禁言用户",
  extend_mute_user: "延长用户禁言",
  modify_mute_user: "修改用户禁言",
  escalate_mute_user: "升级为永久禁言",
  unmute_user: "解除用户禁言",
  expire_mute_user: "用户禁言到期",
  mute_board: "禁言版块",
  extend_mute_board: "延长版块禁言",
  modify_mute_board: "修改版块禁言",
  escalate_mute_board: "版块永久禁言",
  unmute_board: "解除版块禁言",
  expire_mute_board: "版块禁言到期",
  lock_post: "禁言帖子",
  unlock_post: "解除帖子禁言",
  move_post: "移动帖子",
  edit_post: "编辑帖子",
  close_comments: "关闭评论",
  open_comments: "开放评论",
  file_appeal: "提交申诉",
  approve_appeal: "同意申诉",
  reject_appeal: "驳回申诉",
  request_delete: "申请删除",
  approve_delete_request: "批准删除申请",
  reject_delete_request: "驳回删除申请",
  void_delete_request: "关闭删除申请",
};

const detailKeys: Record<string, string> = {
  note: "说明",
  until: "期限",
  context: "起因",
  posts: "帖子",
  comments: "评论",
  attachments: "附件",
  messages: "私信",
  collections: "收藏夹",
  boards: "担任版主",
  boards_created: "创建版块",
};
const detailValues: Record<string, string> = { ...roleNames, active: "正常", suspended: "已停用", deleted: "已删除" };
export function logDetailText(entry: Pick<LogEntry, "detail" | "reason" | "target_label">) {
  if (entry.reason) return entry.reason;
  const raw = (entry.detail || "").trim();
  if (!raw.startsWith("{")) return raw === entry.target_label ? "" : raw;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  return Object.entries(data)
    .filter(([key, value]) => detailKeys[key] && value !== "" && value !== null && value !== 0)
    .map(([key, value]) => `${detailKeys[key]}：${detailValues[String(value)] ?? String(value)}`)
    .join(" · ");
}

export type GovernanceRef =
  | { kind: "case"; id: string; preset?: string }
  | { kind: "appeal"; id: string }
  | { kind: "request"; id: string }
  | { kind: "report"; type: TargetType; id: string; label: string; excerpt?: string }
  | { kind: "request-delete"; type: TargetType; id: string; label: string; caseId?: string; onDone?: () => void };
let handler: ((ref: GovernanceRef) => void) | null = null;
export const setGovernanceNav = (next: ((ref: GovernanceRef) => void) | null) => {
  handler = next;
};
export const openGovernance = (ref: GovernanceRef) => handler?.(ref);
export const needsRequest = (error: unknown) => (error as { code?: string })?.code === "request_required";
