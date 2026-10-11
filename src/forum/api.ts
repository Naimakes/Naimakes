export type User = {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  email?: string;
  bio: string;
  role: string;
  created_at: number;
  muted?: number;
  muted_until?: number | null;
  mute_reason?: string;
  appeal_pending?: number;
  mute_started_at?: number | null;
  appeal_cooldown_until?: number | null;
};
export const mutedLabel = "您已被禁言";
export const lockedLabel = "此帖子已被禁言";
export const muteNotice = (user: User | null) =>
  !user?.muted
    ? ""
    : `${mutedLabel}，${
        user.muted_until
          ? new Date(user.muted_until).toLocaleString("zh-CN", {
              hour12: false,
            }) + " 自动解除"
          : "解除前"
      }无法发帖、评论、回复或发送私信；浏览与收藏不受影响。${
        user.mute_reason ? "原因：" + user.mute_reason : ""
      }`;
export type BoardModerator = {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  role: "lead" | "assistant";
  since: number;
};
export type BoardMember = {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  bio: string;
  source: string;
  created_at: number;
};
export type Category = {
  id: string;
  name: string;
  en: string;
  description: string;
  icon: string;
  builtin: boolean;
  created_by: string | null;
  created_at: number;
  posts: number;
  followers: number;
  views?: number;
  members: number;
  joined: boolean;
  lead: BoardModerator | null;
  assistants: BoardModerator[];
  acting_owner: { id: string; name: string; initials: string } | null;
  can_moderate: boolean;
  can_lead: boolean;
  muted?: number;
  muted_until?: number | null;
  mute_started_at?: number | null;
  mute_reason?: string;
  appeal_pending?: number;
  appeal_cooldown_until?: number | null;
  can_appeal?: boolean;
  can_report?: boolean;
};
export type Post = {
  id: string;
  author_id: string;
  author_name: string;
  author_initials: string;
  author_avatar: string;
  author_bio: string;
  category: string;
  title: string;
  excerpt: string;
  content: string;
  tags: string[];
  kind: string;
  likes: number;
  comments: number;
  views?: number;
  followers?: number;
  followed?: boolean;
  liked: boolean;
  bookmarked: boolean;
  collection_ids: string[];
  read_later: boolean;
  later_added_at: number | null;
  completed_at: number | null;
  reading_minutes: number;
  attachments: Attachment[];
  quotes: Quote[];
  pinned: boolean;
  visibility: PostVisibility;
  comments_closed: boolean;
  locked: boolean;
  lock_reason: string;
  demo: number;
  created_at: number;
  format?: "markdown" | "html";
  match?: "exact" | "related";
  relevance?: number;
  deleted?: boolean;
  snippet?: string;
};
const DESCRIPTION_LIMIT = 320;
export function postDescription(p: Pick<Post, "content" | "excerpt"> & { format?: string }) {
  if (p.format === "html") {
    const text = Array.from(htmlText(p.content || ""));
    if (!text.length) return p.excerpt || "";
    return text.length > DESCRIPTION_LIMIT ? text.slice(0, DESCRIPTION_LIMIT).join("").trimEnd() + "…" : text.join("");
  }
  const text = Array.from((p.content || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>_~|]/g, "")
    .replace(/\s+/g, " ")
    .trim());
  if (!text.length) return p.excerpt || "";
  return text.length > DESCRIPTION_LIMIT ? text.slice(0, DESCRIPTION_LIMIT).join("").trimEnd() + "…" : text.join("");
}
function htmlText(html: string) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("p,h1,h2,h3,h4,li,blockquote,pre,tr,div").forEach((el) => el.append(" "));
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}
export const readingMinutes = (p: Pick<Post, "content"> & { format?: string }) =>
  Math.max(1, Math.ceil(Array.from(p.format === "html" ? htmlText(p.content) : p.content).length / 400));
export type PostVisibility = "public" | "private";
export const visibilityLabels: Record<PostVisibility, string> = {
  public: "公开",
  private: "仅自己可见",
};
export type Attachment = {
  id?: string;
  url: string;
  name: string;
  mime: string;
  size: number;
  inline?: boolean;
};
export type Quote = {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  kind: string;
  created_at: number;
  demo: number;
  author_name: string;
  author_initials: string;
  author_avatar: string;
  likes: number;
  comments: number;
};
export type Draft = {
  id: string;
  title: string;
  content: string;
  format: "markdown" | "html";
  excerpt: string;
  category: string;
  kind: string;
  tags: string[];
  visibility: PostVisibility;
  comments_closed: boolean;
  inline_images: boolean;
  attachments: Attachment[];
  quotes: Quote[];
  created_at: number;
  updated_at: number;
};
export type Recent = {
  value: string;
  label: string;
  updated_at: number;
  pinned?: boolean;
  user?: Member;
};
export type Member = {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  bio?: string;
};
export type ProfilePerson = {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  bio: string;
  role: string;
  lead_boards?: { id: string; name: string }[];
  created_at: number;
  since?: number;
  followed?: boolean;
  mine?: boolean;
};
export type ReceivedLike = {
  kind: "post" | "comment";
  liker: ProfilePerson;
  post_id: string;
  post_title: string;
  comment_id: string | null;
  excerpt: string;
  created_at: number | null;
};
export type ProfileStats = {
  following: number;
  followers: number;
  likes: number;
  views: number;
  posts: number;
};
export type ProfileSettings = {
  banner: string;
  banner_mobile: string;
  privacy: Record<string, boolean>;
  modules: string[];
  tags: string[];
};
export type ProfileView = {
  user: ProfilePerson;
  banner: string;
  banner_mobile: string;
  tags: string[];
  stats: ProfileStats;
  privacy: Record<string, boolean> | null;
  modules: string[] | null;
  relation: { self: boolean; followed: boolean; follows_me: boolean };
  visible: Record<string, boolean>;
  mute?: {
    id: string;
    starts_at: number;
    until: number | null;
    reason: string;
    appeal_pending: boolean;
    cooldown_until: number | null;
  } | null;
  can_report?: boolean;
};
export type MemberHit = ProfilePerson & { stats: { followers: number } };
export type ProfileBoard = {
  id: string;
  name: string;
  en: string;
  description: string;
  icon: string;
  role?: string;
  since?: number;
};
export type Comment = {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_initials: string;
  author_avatar: string;
  content: string;
  deleted: boolean;
  likes: number;
  dislikes: number;
  my_vote: number;
  attachments: Attachment[];
  quotes: Quote[];
  created_at: number;
};
export type Collection = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  cover: string;
  is_public: number;
  is_default: number;
  created_at: number;
  count: number;
  owner_name?: string;
};
export type TopicTrack = {
  id: string;
  kind: "keyword" | "category";
  value: string;
  count: number;
  latest_at: number | null;
};
type NoticeBoard = { id: string; name: string; icon: string };
export type NoticeTopic = { kind: "keyword" | "category"; value: string; label: string };
export type Notification = {
  id: string;
  post_id: string;
  text: string;
  seen: number;
  kind: string;
  pinned: number;
  saved: number;
  created_at: number;
  board?: NoticeBoard | null;
  topic?: NoticeTopic | null;
  reasons?: string[];
  preview?: string;
  important?: number;
  ref_type?: string;
  ref_id?: string;
  state?: "" | "pending" | "handled";
  detail?: GovernanceDetail | null;
  result?: string;
};
type GovernanceDetail = {
  title: string;
  lines: { label: string; value: string }[];
  result: string;
  next: string;
};
export type NotificationGroup = {
  key: string;
  kind: string;
  actor_id: string | null;
  actor_name: string;
  actor_initials: string;
  actor_avatar: string;
  board?: NoticeBoard | null;
  topic?: NoticeTopic | null;
  items: Notification[];
  unread: number;
  pinned: number;
  saved: number;
  urgent?: number;
  latest_at: number;
};
export type AdminChannels = Record<"requests" | "appeals" | "actions" | "system" | "handled", { total: number; unread: number }>;
export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender_name: string;
  sender_initials: string;
  sender_avatar: string;
  content: string;
  mine: boolean;
  attachments: Attachment[];
  quotes: Quote[];
  share?: ShareCardData | null;
  read_at: number | null;
  created_at: number;
};
type SharePerson = { id: string; name: string; initials: string; avatar?: string };
export type ShareUnavailable = { type: "collection" | "board"; id: string; unavailable: string };
export const isShareUnavailable = (card: ShareCardData): card is ShareUnavailable => typeof card.unavailable === "string";
export type ShareCardData =
  | ShareUnavailable
  | {
      type: "collection";
      id: string;
      unavailable?: undefined;
      name: string;
      description: string;
      cover: string;
      count: number;
      created_at: number;
      owner: SharePerson | null;
      previews: { id: string; title: string }[];
    }
  | {
      type: "board";
      id: string;
      unavailable?: undefined;
      name: string;
      en: string;
      description: string;
      icon: string;
      builtin?: boolean;
      posts: number;
      followers: number;
      members: number;
      lead: SharePerson | null;
      acting_owner: SharePerson | null;
      creator: SharePerson | null;
    }
  | { type: "message"; id: string; unavailable?: undefined; text: string; files: number; quote: string; mine: boolean; created_at: number }
  | { type: "notice"; id: string; unavailable?: undefined; kind: string; text: string; preview: string; created_at: number };
export type LiveNotice = {
  id: string;
  kind: string;
  text: string;
  created_at: number;
  seen: number;
  post_id: string | null;
  important: boolean | number;
  ref_type?: string;
  ref_id?: string;
  state?: string;
  detail?: GovernanceDetail | null;
  actor: { id: string; name: string; initials: string; avatar: string } | null;
  post: { id: string; title: string; category: string } | null;
  board: NoticeBoard | null;
  topic: NoticeTopic | null;
  reasons: string[];
  preview: string;
  peer_id?: string;
};
export type LiveEvent = { notice: LiveNotice; silent: boolean; unread: number; update?: boolean };
export type Subscriptions = { authors: string[]; boards: string[] };
export type NotificationOption = {
  id: string;
  label: string;
  hint: string;
  locked?: boolean;
  popupOnly?: boolean;
};
export type MessageThread = {
  peer: { id: string; name: string; initials: string; avatar?: string; bio?: string };
  pinned: number;
  saved: number;
  last: Message | null;
  unread: number;
  latest_at: number;
};
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      signal: options.signal ?? AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    throw new Error(
      (error as Error)?.name === "TimeoutError"
        ? "网络连接超时，请检查网络后重试。"
        : "网络连接失败，请检查网络后重试。",
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json"))
    throw new Error("社区服务暂时不可用，请稍后重试。");
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "暂时无法连接，请稍后重试。"), {
      status: response.status,
      code: data.code as string | undefined,
      data,
    });
  return data;
}
export type InsightMetric = "views" | "likes" | "bookmarks" | "comments" | "followers";
export type InsightSeries = {
  times: number[];
  series: Partial<Record<InsightMetric, number[]>>;
  totals: Partial<Record<InsightMetric, number>>;
  range: string;
  updated_at: number;
};
export type ManagedPost = {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  kind: string;
  created_at: number;
  visibility: PostVisibility;
  comments_closed: boolean;
  locked: boolean;
  lock_reason: string;
  demo: number;
  can_lock: boolean;
} & Record<InsightMetric, number>;
export type ManagedBoard = {
  id: string;
  name: string;
  en: string;
  icon: string;
  description: string;
  created_at: number;
  posts: number;
  can_moderate: boolean;
} & Record<Exclude<InsightMetric, "comments">, number>;
export const byViews = <T extends { views?: number; posts?: number; created_at: number }>(a: T, b: T) =>
  (b.views ?? 0) - (a.views ?? 0) || (b.posts ?? 0) - (a.posts ?? 0) || a.created_at - b.created_at;
export function countLabel(value: number) {
  if (value >= 100000000) return (value / 100000000).toFixed(value >= 1000000000 ? 0 : 1).replace(/\.0$/, "") + " 亿";
  if (value >= 10000) return (value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, "") + " 万";
  return String(value);
}
export type ApiError = Error & { status?: number; code?: string; data?: any };
export const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body ? { body: JSON.stringify(body) } : {}),
});
export function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/uploads");
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => reject(new Error("上传失败，请稍后重试。"));
    request.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(request.responseText);
      } catch {}
      if (request.status < 200 || request.status >= 300) reject(new Error(data.error || "上传失败，请稍后重试。"));
      else resolve(data);
    };
    request.send(file);
  });
}
export function timeAgo(time: number) {
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}
