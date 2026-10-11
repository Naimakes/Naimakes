export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  postId: string;
  boardId: string;
  authorAvatar: string;
  authorInitials: string;
  authorBio: string;
  likes: number;
  comments: number;
  views: number;
  readingMinutes: number;
  tags: string[];
  body: string[];
  createdAt: number;
  announcement: boolean;
  pinned: boolean;
}

export interface BoardInfo {
  id: string;
  name: string;
  en: string;
  description: string;
  icon: string;
  posts: number;
  members: number;
  followers: number;
  views: number;
  lead: string;
}

export interface ArchivePayload {
  columns: string[];
  records: ArchiveRecord[];
  boards: BoardInfo[];
}

type RawBoard = {
  id: string;
  name: string;
  en?: string;
  description?: string;
  icon?: string;
  position?: number;
  posts?: number;
  members?: number;
  followers?: number;
  views?: number;
  created_at?: number;
  lead?: { name?: string } | null;
  acting_owner?: { name?: string } | null;
};

type RawPost = {
  id: string;
  title: string;
  excerpt?: string;
  content?: string;
  format?: string;
  author_name?: string;
  author_avatar?: string;
  author_initials?: string;
  author_bio?: string;
  tags?: string[];
  kind?: string;
  pinned?: boolean;
  likes?: number;
  comments?: number;
  views?: number;
  reading_minutes?: number;
  created_at: number;
};

const ABSTRACT_LIMIT = 220;
export const WELCOME_POST_ID = "welcome";

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(post: RawPost) {
  const body = plainText(post.excerpt || "") || plainText(post.content || "");
  if (!body) return "这篇帖子还没有正文摘要，打开后可以读到完整内容。";
  const letters = Array.from(body);
  return letters.length > ABSTRACT_LIMIT
    ? letters.slice(0, ABSTRACT_LIMIT).join("").trimEnd() + "…"
    : body;
}

export function paragraphsFromContent(raw: string, title = "") {
  const blocks = raw
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n\s*\n/);
  const out: string[] = [];
  for (const block of blocks) {
    const text = plainText(block);
    if (!text) continue;
    if (!out.length && text === title.trim()) continue;
    out.push(text);
  }
  return out;
}

function paragraphsOf(post: RawPost) {
  const out = paragraphsFromContent(post.content || post.excerpt || "", post.title || "");
  return out.length ? out : [summarize(post)];
}

function initialsOf(name: string) {
  const letters = Array.from(name.replace(/\s+/g, ""));
  return (letters.slice(0, 2).join("") || "NM").toUpperCase();
}

function boardInfo(board: RawBoard, posts: number): BoardInfo {
  return {
    id: board.id,
    name: board.name,
    en: (board.en || board.id || "").toUpperCase(),
    description: board.description || "这个版块还没有写简介。",
    icon: board.icon || "Hash",
    posts: board.posts ?? posts,
    members: board.members ?? 0,
    followers: board.followers ?? 0,
    views: board.views ?? 0,
    lead: board.lead?.name || board.acting_owner?.name || "Naimakes",
  };
}

function formatDate(time: number) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function highlights(post: RawPost): string[] {
  const tags = (post.tags || []).filter(Boolean).slice(0, 6);
  const notes = tags.map((tag) => `话题 · ${tag}`);
  if (post.comments) notes.push(`这篇帖子已经有 ${post.comments} 条回复。`);
  if (post.views) notes.push(`已有 ${post.views} 人读过这篇帖子。`);
  if (post.likes) notes.push(`${post.likes} 人点过赞。`);
  if (post.reading_minutes) notes.push(`大约需要 ${post.reading_minutes} 分钟读完。`);
  return notes.length ? notes : ["打开帖子可以读到完整内容，并参与讨论。"];
}

function statusOf(post: RawPost, board: RawBoard) {
  if (post.kind === "announcement") return "公告";
  if (post.pinned) return "置顶";
  return board.en || "NAIMAKES";
}

function buildArchive(
  boards: RawBoard[],
  postsByBoard: Map<string, RawPost[]>,
): ArchivePayload {
  const welcomeBoard = boards.find((board) =>
    (postsByBoard.get(board.id) || []).some((post) => post.id === WELCOME_POST_ID),
  );
  const ordered = [...boards].sort(
    (a, b) =>
      Number(b === welcomeBoard) - Number(a === welcomeBoard) ||
      (b.views ?? 0) - (a.views ?? 0) ||
      (b.posts ?? 0) - (a.posts ?? 0) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      (a.created_at ?? 0) - (b.created_at ?? 0),
  );
  const columns: string[] = [];
  const records: ArchiveRecord[] = [];
  const infos = ordered.map((board) => boardInfo(board, (postsByBoard.get(board.id) || []).length));
  for (const board of ordered) {
    const posts = (postsByBoard.get(board.id) || [])
      .slice()
      .sort(
        (a, b) =>
          Number(b.id === WELCOME_POST_ID) - Number(a.id === WELCOME_POST_ID) ||
          b.created_at - a.created_at,
      );
    if (!posts.length) continue;
    columns.push(board.name);
    for (const post of posts) {
      records.push({
        id: `N-${String(records.length + 1).padStart(3, "0")}`,
        title: post.title || "无标题",
        en: post.author_name || "Naimakes",
        department: board.name,
        category: board.name,
        date: formatDate(post.created_at),
        lead: post.author_name || "Naimakes",
        clearance: statusOf(post, board),
        abstract: summarize(post),
        findings: highlights(post),
        source: `/discussion/${encodeURIComponent(post.id)}`,
        postId: post.id,
        boardId: board.id,
        authorAvatar: post.author_avatar || "",
        authorInitials: post.author_initials || initialsOf(post.author_name || "Naimakes"),
        authorBio: post.author_bio || "",
        likes: post.likes || 0,
        comments: post.comments || 0,
        views: post.views || 0,
        readingMinutes: post.reading_minutes || 1,
        tags: (post.tags || []).filter(Boolean),
        body: paragraphsOf(post),
        createdAt: post.created_at,
        announcement: post.kind === "announcement",
        pinned: Boolean(post.pinned),
      });
    }
  }
  return { columns, records, boards: infos };
}

declare global {
  interface Window {
    __NAIMAKES_ARCHIVE__?: ArchivePayload;
  }
}

export async function loadArchive(): Promise<ArchivePayload | null> {
  try {
    const boardsResponse = await fetch("/api/categories", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!boardsResponse.ok) return null;
    const boards: RawBoard[] = (await boardsResponse.json()).categories || [];
    if (!boards.length) return null;
    const postsByBoard = new Map<string, RawPost[]>();
    await Promise.all(
      boards.map(async (board) => {
        try {
          const response = await fetch(
            `/api/posts?category=${encodeURIComponent(board.id)}&sort=new`,
            { credentials: "same-origin", headers: { accept: "application/json" } },
          );
          if (!response.ok) return;
          postsByBoard.set(board.id, (await response.json()).posts || []);
        } catch {
        }
      }),
    );
    const archive = buildArchive(boards, postsByBoard);
    return archive.records.length ? archive : null;
  } catch {
    return null;
  }
}

export function recordView(postId: string) {
  if (!postId) return;
  void fetch(`/api/posts/${encodeURIComponent(postId)}/view`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  }).catch(() => {});
}
