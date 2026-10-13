import { randomUUID } from "node:crypto";
import { db } from "./database.mjs";
import { plainText } from "./rich-text.mjs";
import { createTask, deleteTask, describeSchedule, getTask, listTasks, repeats, updateTask } from "./assistant-tasks.mjs";
import { addMemory, forgetMemory, kindLabels, listMemories, memoryKinds } from "./assistant-memory.mjs";
import { WebSearchError, webSearch } from "./web-search.mjs";

// Everything a member can do on the site, exposed to Naimakes as tools. Each
// action goes through the site's own /api routes as the signed-in member, so
// permissions, mutes, rate limits and notifications match a real click.
// kind: "read" fetches, "write" runs at once, "confirm" waits for the member
// to press 确认 on a card in the chat before it runs.

db.exec(`
CREATE TABLE IF NOT EXISTS assistant_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  input TEXT NOT NULL,
  preview TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_user ON assistant_actions(user_id, created_at DESC);
`);

const PENDING_TTL = 30 * 60000;

export class ActionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const str = (description, max = 120, min = 0) => ({ type: "string", description, maxLength: max, ...(min ? { minLength: min } : {}) });
const ref = (description) => str(description, 120, 1);
const bool = (description) => ({ type: "boolean", description });
const int = (description, max = 100000) => ({ type: "integer", description, minimum: 0, maximum: max });
const oneOf = (values, description) => ({ type: "string", enum: values, description });
const list = (items, description, max, min = 0) => ({ type: "array", items, description, maxItems: max, ...(min ? { minItems: min } : {}) });
const shape = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const offset = int("分页偏移量，每页 12 条，默认 0");

const typeOf = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value);
function invalid(schema, value, at = "输入") {
  const type = typeOf(value);
  if (schema.type === "integer" ? type !== "integer" : schema.type !== type && !(schema.type === "number" && type === "integer"))
    return `${at} 应为 ${schema.type}`;
  if (schema.enum && !schema.enum.includes(value)) return `${at} 只能是 ${schema.enum.join(" / ")}`;
  if (type === "string") {
    const length = Array.from(value).length;
    if (schema.minLength && length < schema.minLength) return `${at} 至少 ${schema.minLength} 个字符`;
    if (schema.maxLength !== undefined && length > schema.maxLength) return `${at} 最多 ${schema.maxLength} 个字符`;
  }
  if (type === "integer" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)))
    return `${at} 超出范围`;
  if (type === "array") {
    if (schema.minItems && value.length < schema.minItems) return `${at} 至少 ${schema.minItems} 项`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${at} 最多 ${schema.maxItems} 项`;
    for (let i = 0; i < value.length; i++) {
      const problem = invalid(schema.items, value[i], `${at}[${i}]`);
      if (problem) return problem;
    }
  }
  if (type === "object") {
    for (const key of schema.required || []) if (value[key] === undefined) return `缺少 ${key}`;
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) return `不支持的参数 ${key}`;
      const problem = invalid(schema.properties[key], item, key);
      if (problem) return problem;
    }
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) return "至少需要提供一项要修改的内容";
  }
  return null;
}

const enc = encodeURIComponent;
const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? "?" + text : "";
};
const clip = (text, length) => {
  const chars = Array.from(String(text || ""));
  return chars.length > length ? chars.slice(0, length).join("") + "…" : chars.join("");
};
const day = (time) => (time ? new Date(time).toISOString().slice(0, 10) : null);
const postUrl = (id) => "/discussion/" + enc(id);
const userUrl = (id) => "/u/" + enc(id);
const boardUrl = (id) => "/topics/" + enc(id);
const collectionUrl = (id) => "/collections/" + enc(id);
const visibilityText = (v) => (v === "private" ? "仅自己可见" : "公开");

function brief(p) {
  if (p.deleted) return { id: p.id, deleted: true };
  const out = {
    id: p.id,
    title: p.title,
    url: postUrl(p.id),
    board: p.category,
    author: p.author_name,
    author_id: p.author_id,
    kind: p.kind,
    excerpt: clip(p.excerpt, 100),
    likes: p.likes,
    comments: p.comments,
    published: day(p.created_at),
  };
  if (p.tags?.length) out.tags = p.tags;
  for (const flag of ["liked", "bookmarked", "followed", "read_later"]) if (p[flag]) out[flag] = true;
  if (p.read_later) out.read_done = !!p.completed_at;
  if (p.visibility === "private") out.visibility = "private";
  return out;
}

const comment = (c) =>
  c.deleted
    ? { id: c.id, parent_id: c.parent_id, deleted: true }
    : {
        id: c.id,
        parent_id: c.parent_id,
        author: c.author_name,
        author_id: c.author_id,
        content: clip(c.content, 600),
        likes: c.likes,
        dislikes: c.dislikes,
        ...(c.my_vote ? { my_vote: c.my_vote === 1 ? "up" : "down" } : {}),
        published: day(c.created_at),
      };

const person = (u) => ({ id: u.id, name: u.name, bio: clip(u.bio, 80), url: userUrl(u.id), ...(u.followed ? { followed: true } : {}) });
const page = (r, key = "posts", view = brief) => ({ total: r.total, has_more: !!r.hasMore, [key]: (r[key] || []).map(view) });

async function findMember(call, id) {
  const { users } = await call("GET", "/users" + query({ q: id }));
  const found = users.find((u) => u.id === id);
  if (!found) throw new ActionError("这位成员不存在，请先用 find_users 查找正确的成员 ID。", 404);
  return found;
}
const boardOf = async (call, id) => (await call("GET", "/categories/" + enc(id))).category;
const postOf = async (call, id) => call("GET", "/posts/" + enc(id));
async function ownPost(call, user, id) {
  const { post, comments } = await postOf(call, id);
  if (post.author_id !== user.id) throw new ActionError("只能操作你自己发布的讨论。", 403);
  return { post, comments };
}
async function speaking(call) {
  const { user } = await call("GET", "/me");
  if (user?.muted) throw new ActionError("你目前处于禁言状态，暂时无法发帖、评论或发送私信。" + (user.mute_reason ? "原因：" + user.mute_reason : ""), 403);
}
const field = (label, value) => ({ label, value: String(value ?? "") });
const preview = (heading, fields, body = "") => ({ heading, fields: fields.filter((f) => f.value), body: clip(body, 600) });

const privacyLabels = {
  collections: "公开我的收藏夹",
  boards: "公开我的关注版块",
  history: "公开最近浏览",
  likes: "公开最近点赞",
  following: "公开我的关注列表",
  followers: "公开我的粉丝列表",
  tags: "公开个人标签",
  later: "公开稍后再看",
  topics: "公开跟踪的话题",
  moderating: "公开我管理的版块",
  letters: "允许未关注的人私信我",
  visitors: "记录来访的新访客",
};
const moduleLabels = {
  posts: "我的讨论",
  collections: "我的收藏夹",
  boards: "关注的版块",
  topics: "跟踪的话题",
  likes: "最近点赞",
  projects: "共创项目",
  later: "稍后再看",
  history: "最近浏览",
  tags: "个人标签",
  moderating: "管理的版块",
  announcements: "站内公告",
  intro: "个人资料",
};
const privacyKeys = Object.keys(privacyLabels);
const moduleKeys = Object.keys(moduleLabels);
const noticeKeys = ["letters", "author", "board", "topic", "reply", "mention", "interaction", "announcement", "other"];
export const shapes = ["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf", "square", "sparkle", "clover", "flower", "heart", "house", "star"];
export const colors = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"];
const thinkingLabels = { fast: "即时", balanced: "均衡", deep: "深入" };
const thinkingModes = Object.keys(thinkingLabels);
const defaultLook = { shape: "blob", color: "black", thinking: "fast" };
const reasonLabels = { spam: "垃圾内容", ad: "广告", abuse: "辱骂", attack: "人身攻击", harassment: "恶意骚扰", illegal: "违规内容", discomfort: "不适内容", impersonation: "冒充他人", flood: "恶意刷屏", other: "其他" };
const reportReasons = Object.keys(reasonLabels);
const flags = (keys, what) => ({ type: "object", description: what, properties: Object.fromEntries(keys.map((k) => [k, { type: "boolean" }])), additionalProperties: false, minProperties: 1 });

const actionList = [
  // —— 浏览与查找 ——
  {
    name: "search_posts",
    title: "搜索讨论",
    kind: "read",
    login: false,
    activity: "正在搜索讨论…",
    description: "按关键词或 #标签 全文搜索本站讨论。<site_documents> 里找不到、或需要找特定讨论的 ID 再操作时调用。",
    input: shape(
      {
        query: str("关键词；搜标签时以 # 开头", 120, 1),
        board_id: str("只在这个版块内搜索"),
        sort: oneOf(["hot", "new", "comments", "views", "unanswered"], "排序，默认 hot"),
        offset,
      },
      ["query"],
    ),
    async run(input, { call }) {
      const tag = input.query.startsWith("#");
      const q = tag ? input.query.replace(/^#+/, "") : input.query;
      const r = await call("GET", "/search" + query({ q, tag: tag ? 1 : "", category: input.board_id, sort: input.sort, offset: input.offset }));
      return { data: page(r) };
    },
  },
  {
    name: "list_posts",
    title: "浏览讨论",
    kind: "read",
    login: false,
    activity: "正在浏览讨论…",
    description:
      "按条件列出讨论：全站、某个版块、某位作者，或当前用户自己的列表（mine 我发布的 / bookmarks 我收藏的 / history 最近浏览 / following_boards 我关注版块里的）。用户想看最新、最热、自己发过或收藏过的讨论时调用。",
    input: shape({
      scope: oneOf(["all", "mine", "bookmarks", "history", "following_boards"], "范围，默认 all；除 all 外需要登录"),
      sort: oneOf(["latest", "hot", "comments", "likes", "views", "old", "unanswered"], "排序，默认 latest"),
      board_id: str("版块 ID"),
      author_id: str("作者的用户 ID"),
      kind: oneOf(["project", "announcement"], "只看共创项目或公告"),
      offset,
    }),
    async run(input, { call }) {
      const view = { mine: "mine", bookmarks: "bookmarks", history: "history", following_boards: "following" }[input.scope];
      const sort = input.sort === "latest" ? "" : input.sort;
      const r = await call("GET", "/posts" + query({ view, sort, category: input.board_id, author: input.author_id, kind: input.kind, offset: input.offset }));
      return { data: page(r) };
    },
  },
  {
    name: "get_post",
    title: "阅读讨论",
    kind: "read",
    login: false,
    activity: "正在阅读讨论…",
    description: "读取一篇讨论的正文、作者、统计、当前用户与它的关系（是否已赞同/收藏/关注），以及评论列表（含评论 ID）。回答具体内容、回复评论或操作前确认对象时调用。",
    input: shape({ post_id: ref("讨论 ID") }, ["post_id"]),
    async run(input, { call }) {
      const { post, comments } = await postOf(call, input.post_id);
      return {
        data: {
          ...brief(post),
          content: clip(plainText(post.content, post.format), 6000),
          views: post.views,
          followers: post.followers,
          comments_closed: post.comments_closed || undefined,
          locked: post.locked || undefined,
          collection_ids: post.collection_ids?.length ? post.collection_ids : undefined,
          quoted_posts: post.quotes?.length ? post.quotes.map((q) => ({ id: q.id, title: q.title })) : undefined,
          attachments: post.attachments?.length ? post.attachments.map((a) => a.name) : undefined,
          comment_list: comments.slice(-80).map(comment),
        },
      };
    },
  },
  {
    name: "list_boards",
    title: "查看版块",
    kind: "read",
    login: false,
    activity: "正在查看版块…",
    description: "列出全部版块（ID、名称、简介、数据），以及当前用户是否已关注、已加入、已开启新帖提醒。需要版块 ID 时调用。",
    input: shape({}),
    async run(_input, { call, user }) {
      const { categories } = await call("GET", "/categories");
      const me = user ? await call("GET", "/me") : null;
      return {
        data: {
          boards: categories.map((c) => ({
            id: c.id,
            name: c.name,
            description: clip(c.description, 80),
            posts: c.posts,
            followers: c.followers,
            url: boardUrl(c.id),
            ...(me?.follows.includes(c.id) ? { followed: true } : {}),
            ...(c.joined ? { joined: true } : {}),
            ...(me?.subscriptions.boards.includes(c.id) ? { notify: true } : {}),
          })),
        },
      };
    },
  },
  {
    name: "find_users",
    title: "查找成员",
    kind: "read",
    login: false,
    activity: "正在查找成员…",
    description: "按昵称查找成员，返回用户 ID 与是否已关注。关注、私信、查看某位成员之前，先用它拿到准确的用户 ID。",
    input: shape({ query: str("昵称或其中一部分", 60, 1) }, ["query"]),
    async run(input, { call }) {
      const { users } = await call("GET", "/users" + query({ q: input.query }));
      return { data: { users: users.map((u) => ({ ...person(u), role: u.role, followers: u.stats?.followers })) } };
    },
  },
  {
    name: "get_user",
    title: "查看成员主页",
    kind: "read",
    login: false,
    activity: "正在查看成员主页…",
    description: "读取一位成员的主页：简介、标签、数据、与当前用户的关注关系和最近的讨论。注意：已登录时会像真实访问一样记入对方的访客记录，只在用户想看这位成员时调用。",
    input: shape({ user_id: ref("用户 ID") }, ["user_id"]),
    async run(input, { call }) {
      const p = await call("GET", "/users/" + enc(input.user_id));
      const { posts } = await call("GET", "/posts" + query({ author: input.user_id }));
      return {
        data: {
          ...person(p.user),
          role: p.user.role,
          tags: p.tags,
          stats: p.stats,
          lead_boards: p.user.lead_boards?.map((b) => b.name),
          self: p.relation.self || undefined,
          followed: p.relation.followed,
          follows_me: p.relation.follows_me,
          recent_posts: posts.slice(0, 6).map(brief),
        },
      };
    },
  },
  {
    name: "list_people",
    title: "查看关注列表",
    kind: "read",
    login: false,
    activity: "正在查看成员列表…",
    description: "列出某位成员的粉丝（followers）或其关注的人（following）。对方可能没有公开这份名单。",
    input: shape({ user_id: ref("用户 ID"), list: oneOf(["followers", "following"], "要看的名单"), offset }, ["user_id", "list"]),
    async run(input, { call }) {
      const r = await call("GET", `/users/${enc(input.user_id)}/${input.list}` + query({ offset: input.offset }));
      return { data: page(r, "people", person) };
    },
  },
  {
    name: "list_my_following",
    title: "我的关注",
    kind: "read",
    activity: "正在查看你的关注…",
    description: "列出当前用户关注的成员和版块，以及开启了新帖提醒（铃铛）的作者和版块。",
    input: shape({}),
    async run(_input, { call }) {
      const following = await call("GET", "/me/following");
      const subs = await call("GET", "/subscriptions");
      return {
        data: {
          users: following.users.map(person),
          boards: following.boards.map((b) => ({ id: b.id, name: b.name, url: boardUrl(b.id) })),
          notify_authors: subs.people.map((u) => ({ id: u.id, name: u.name })),
          notify_boards: subs.categories.map((c) => ({ id: c.id, name: c.name })),
        },
      };
    },
  },
  {
    name: "list_collections",
    title: "我的收藏夹",
    kind: "read",
    activity: "正在查看收藏夹…",
    description: "列出当前用户的收藏夹（ID、名称、是否公开、篇数）和稍后再看的统计。",
    input: shape({}),
    async run(_input, { call }) {
      const { collections, later } = await call("GET", "/collections");
      return {
        data: {
          collections: collections.map((c) => ({
            id: c.id,
            name: c.name,
            description: clip(c.description, 60),
            is_public: !!c.is_public,
            ...(c.is_default ? { is_default: true } : {}),
            count: c.count,
            url: collectionUrl(c.id),
          })),
          read_later: later,
        },
      };
    },
  },
  {
    name: "list_collection_posts",
    title: "查看收藏夹",
    kind: "read",
    login: false,
    activity: "正在查看收藏夹…",
    description: "列出某个收藏夹里的讨论（自己的收藏夹，或别人公开的收藏夹）。",
    input: shape({ collection_id: ref("收藏夹 ID"), offset }, ["collection_id"]),
    async run(input, { call }) {
      return { data: page(await call("GET", `/collections/${enc(input.collection_id)}/posts` + query({ offset: input.offset }))) };
    },
  },
  {
    name: "list_read_later",
    title: "稍后再看",
    kind: "read",
    activity: "正在查看稍后再看…",
    description: "列出当前用户「稍后再看」里的讨论，可只看未读或已读。",
    input: shape({ progress: oneOf(["all", "unread", "read"], "默认 all"), offset }),
    async run(input, { call }) {
      const progress = input.progress === "all" ? "" : input.progress;
      return { data: page(await call("GET", "/read-later" + query({ progress, offset: input.offset }))) };
    },
  },
  {
    name: "list_topic_tracks",
    title: "跟踪的话题",
    kind: "read",
    activity: "正在查看跟踪的话题…",
    description: "列出当前用户跟踪的关键词和版块话题（含跟踪 ID）。",
    input: shape({}),
    async run(_input, { call }) {
      const { tracks } = await call("GET", "/topic-tracks");
      return {
        data: {
          tracks: tracks.map((t) => ({ id: t.id, kind: t.kind === "category" ? "board" : "keyword", value: t.value, posts: t.count, latest: day(t.latest_at) })),
        },
      };
    },
  },
  {
    name: "list_notifications",
    title: "查看通知",
    kind: "read",
    activity: "正在查看通知…",
    description: "列出当前用户最近的通知（回复、点赞、关注、提及、公告、站务等），含通知 ID 和是否未读。",
    input: shape({ unread_only: bool("只看未读") }),
    async run(input, { call }) {
      const { groups } = await call("GET", "/notifications");
      const items = groups
        .flatMap((g) => g.items.map((n) => ({ ...n, actor: g.actor_name })))
        .filter((n) => !input.unread_only || !n.seen)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 40);
      return {
        data: {
          notifications: items.map((n) => ({
            id: n.id,
            kind: n.kind,
            text: clip(n.text, 120),
            ...(n.actor ? { from: n.actor } : {}),
            ...(n.post_id ? { url: postUrl(n.post_id) } : {}),
            unread: !n.seen,
            at: day(n.created_at),
          })),
        },
      };
    },
  },
  {
    name: "list_conversations",
    title: "查看私信",
    kind: "read",
    activity: "正在查看私信…",
    description: "列出当前用户的私信对话：对方、未读数、最后一条消息。",
    input: shape({}),
    async run(_input, { call }) {
      const { threads } = await call("GET", "/messages");
      return {
        data: {
          conversations: threads.map((t) => ({
            user_id: t.peer.id,
            name: t.peer.name,
            unread: t.unread,
            ...(t.pinned ? { pinned: true } : {}),
            ...(t.saved ? { saved: true } : {}),
            last: t.last ? { from_me: t.last.mine, text: clip(t.last.content, 80), at: day(t.last.created_at) } : null,
          })),
        },
      };
    },
  },
  {
    name: "read_conversation",
    title: "阅读私信",
    kind: "read",
    activity: "正在阅读私信…",
    description: "读取与某位成员的私信记录（最近 40 条，含消息 ID）。和真实打开对话一样，会把对方发来的消息标记为已读。",
    input: shape({ user_id: ref("对方的用户 ID") }, ["user_id"]),
    async run(input, { call }) {
      const r = await call("GET", "/messages/" + enc(input.user_id));
      return {
        data: {
          peer: { id: r.peer.id, name: r.peer.name },
          messages: r.messages.slice(-40).map((m) => ({ id: m.id, from_me: m.mine, text: clip(m.content, 500), at: day(m.created_at) })),
        },
      };
    },
  },
  {
    name: "list_drafts",
    title: "查看草稿",
    kind: "read",
    activity: "正在查看草稿…",
    description: "列出当前用户保存的草稿（ID、标题、摘要、版块、标签）。",
    input: shape({}),
    async run(_input, { call }) {
      const { drafts } = await call("GET", "/drafts");
      return {
        data: {
          drafts: drafts.map((d) => ({ id: d.id, title: d.title, excerpt: clip(d.excerpt, 100), board: d.category, tags: d.tags, kind: d.kind, updated: day(d.updated_at) })),
        },
      };
    },
  },
  {
    name: "get_my_settings",
    title: "查看我的设置",
    kind: "read",
    activity: "正在查看你的设置…",
    description: "读取当前用户的昵称、简介、主页隐私选项、个人标签、主页模块顺序、各类通知开关，以及 Naimakes 的外观和思考模式。修改设置前先调用。",
    input: shape({}),
    async run(_input, { call }) {
      const me = await call("GET", "/me");
      const notices = await call("GET", "/me/notification-settings");
      const look = await call("GET", "/me/assistant");
      return {
        data: {
          name: me.user.name,
          bio: me.user.bio,
          role: me.user.role,
          muted: !!me.user.muted,
          privacy: me.profile?.privacy,
          profile_tags: me.profile?.tags,
          module_order: me.profile?.modules,
          notifications: Object.fromEntries(notices.options.map((o) => [o.id, { label: o.label, on: notices.settings[o.id], ...(o.locked ? { locked: true } : {}) }])),
          assistant: { ...defaultLook, ...look.prefs },
        },
      };
    },
  },

  // —— 立即执行的互动 ——
  {
    name: "set_post_like",
    title: "赞同讨论",
    kind: "write",
    description: "赞同或取消赞同一篇讨论（liked=true 赞同，false 取消）。会通知作者。",
    input: shape({ post_id: ref("讨论 ID"), liked: bool("目标状态") }, ["post_id", "liked"]),
    async run(input, { call }) {
      let { post } = await postOf(call, input.post_id);
      if (!!post.liked !== input.liked) ({ post } = await call("POST", `/posts/${enc(post.id)}/like`));
      return {
        data: { post_id: post.id, liked: post.liked, likes: post.likes },
        summary: `${post.liked ? "已赞同" : "已取消赞同"}「${post.title}」`,
        url: postUrl(post.id),
      };
    },
  },
  {
    name: "set_post_bookmark",
    title: "收藏讨论",
    kind: "write",
    description: "收藏一篇讨论到默认收藏夹，或取消收藏（会从所有收藏夹移除）。要放进指定收藏夹请用 set_post_collections。",
    input: shape({ post_id: ref("讨论 ID"), bookmarked: bool("目标状态") }, ["post_id", "bookmarked"]),
    async run(input, { call }) {
      let { post } = await postOf(call, input.post_id);
      if (!!post.bookmarked !== input.bookmarked) ({ post } = await call("POST", `/posts/${enc(post.id)}/bookmark`));
      return {
        data: { post_id: post.id, bookmarked: post.bookmarked, collection_ids: post.collection_ids },
        summary: `${post.bookmarked ? "已收藏" : "已取消收藏"}「${post.title}」`,
        url: postUrl(post.id),
      };
    },
  },
  {
    name: "set_post_collections",
    title: "整理收藏",
    kind: "write",
    description: "把一篇讨论放进指定的收藏夹（完整替换：讨论最终只在 collection_ids 列出的收藏夹里；传空数组即取消收藏）。收藏夹 ID 用 list_collections 获取。",
    input: shape({ post_id: ref("讨论 ID"), collection_ids: list(ref("收藏夹 ID"), "目标收藏夹", 50) }, ["post_id", "collection_ids"]),
    async run(input, { call }) {
      const { post } = await call("PUT", `/posts/${enc(input.post_id)}/collections`, { collection_ids: input.collection_ids });
      return {
        data: { post_id: post.id, collection_ids: post.collection_ids, bookmarked: post.bookmarked },
        summary: input.collection_ids.length ? `已把「${post.title}」放进 ${input.collection_ids.length} 个收藏夹` : `已取消收藏「${post.title}」`,
        url: postUrl(post.id),
      };
    },
  },
  {
    name: "set_read_later",
    title: "稍后再看",
    kind: "write",
    description: "把讨论加入（on=true）或移出（on=false）「稍后再看」。",
    input: shape({ post_id: ref("讨论 ID"), on: bool("目标状态") }, ["post_id", "on"]),
    async run(input, { call }) {
      const { post } = await call(input.on ? "PUT" : "DELETE", `/posts/${enc(input.post_id)}/later`);
      return {
        data: { post_id: post.id, read_later: post.read_later },
        summary: `${input.on ? "已加入" : "已移出"}稍后再看：「${post.title}」`,
        url: postUrl(post.id),
      };
    },
  },
  {
    name: "update_read_later",
    title: "整理稍后再看",
    kind: "write",
    description: "把「稍后再看」里的讨论标记为已读、未读，或移出列表。",
    input: shape({ post_ids: list(ref("讨论 ID"), "要处理的讨论", 100, 1), action: oneOf(["read", "unread", "remove"], "操作") }, ["post_ids", "action"]),
    async run(input, { call }) {
      await call("PATCH", "/read-later", { action: input.action, ids: input.post_ids });
      const verb = { read: "标记为已读", unread: "标记为未读", remove: "移出稍后再看" }[input.action];
      return { data: { ok: true }, summary: `已把 ${input.post_ids.length} 篇讨论${verb}` };
    },
  },
  {
    name: "set_post_follow",
    title: "关注讨论",
    kind: "write",
    description: "关注或取消关注一篇讨论；关注后有新回复会通知用户。不能关注自己的讨论。",
    input: shape({ post_id: ref("讨论 ID"), followed: bool("目标状态") }, ["post_id", "followed"]),
    async run(input, { call }) {
      let { post } = await postOf(call, input.post_id);
      if (!!post.followed !== input.followed) ({ post } = await call("POST", `/posts/${enc(post.id)}/follow`));
      return {
        data: { post_id: post.id, followed: post.followed },
        summary: `${post.followed ? "已关注" : "已取消关注"}讨论「${post.title}」`,
        url: postUrl(post.id),
      };
    },
  },
  {
    name: "set_user_follow",
    title: "关注成员",
    kind: "write",
    description: "关注或取消关注一位成员（关注时会通知对方）。user_id 必须是准确的用户 ID，不知道时先用 find_users 查找。",
    input: shape({ user_id: ref("用户 ID"), followed: bool("目标状态") }, ["user_id", "followed"]),
    async run(input, { call }) {
      const member = await findMember(call, input.user_id);
      let followed = !!member.followed;
      if (followed !== input.followed) ({ followed } = await call("POST", `/users/${enc(member.id)}/follow`));
      return {
        data: { user_id: member.id, name: member.name, followed },
        summary: `${followed ? "已关注" : "已取消关注"} ${member.name}`,
        url: userUrl(member.id),
      };
    },
  },
  {
    name: "set_board_follow",
    title: "关注版块",
    kind: "write",
    description: "关注或取消关注一个版块；关注的版块会出现在用户的「关注」动态里。",
    input: shape({ board_id: ref("版块 ID"), followed: bool("目标状态") }, ["board_id", "followed"]),
    async run(input, { call }) {
      const board = await boardOf(call, input.board_id);
      const { follows } = await call("GET", "/me");
      let followed = follows.includes(board.id);
      if (followed !== input.followed) ({ followed } = await call("POST", `/categories/${enc(board.id)}/follow`));
      return { data: { board_id: board.id, followed }, summary: `${followed ? "已关注" : "已取消关注"}版块「${board.name}」`, url: boardUrl(board.id) };
    },
  },
  {
    name: "set_board_membership",
    title: "加入版块",
    kind: "write",
    description: "加入或退出一个版块的成员名单。",
    input: shape({ board_id: ref("版块 ID"), joined: bool("目标状态") }, ["board_id", "joined"]),
    async run(input, { call, user }) {
      const board = await boardOf(call, input.board_id);
      if (!!board.joined !== input.joined)
        await (input.joined ? call("POST", `/categories/${enc(board.id)}/members`) : call("DELETE", `/categories/${enc(board.id)}/members/${enc(user.id)}`));
      return { data: { board_id: board.id, joined: input.joined }, summary: `${input.joined ? "已加入" : "已退出"}版块「${board.name}」`, url: boardUrl(board.id) };
    },
  },
  {
    name: "set_notify_subscription",
    title: "新帖提醒",
    kind: "write",
    description: "打开或关闭某位作者（author）或某个版块（board）的新帖提醒（铃铛订阅）。",
    input: shape(
      { kind: oneOf(["author", "board"], "订阅对象类型"), target_id: ref("用户 ID 或版块 ID"), subscribed: bool("目标状态") },
      ["kind", "target_id", "subscribed"],
    ),
    async run(input, { call }) {
      const name = input.kind === "author" ? (await findMember(call, input.target_id)).name : `版块「${(await boardOf(call, input.target_id)).name}」`;
      await call(input.subscribed ? "PUT" : "DELETE", `/subscriptions/${input.kind === "author" ? "authors" : "boards"}/${enc(input.target_id)}`);
      return { data: { subscribed: input.subscribed }, summary: `已${input.subscribed ? "打开" : "关闭"} ${name} 的新帖提醒` };
    },
  },
  {
    name: "vote_comment",
    title: "评价评论",
    kind: "write",
    description: "赞同（up）、不赞同（down）或撤销（clear）对一条评论的评价。评论 ID 用 get_post 获取。",
    input: shape({ comment_id: ref("评论 ID"), vote: oneOf(["up", "down", "clear"], "评价") }, ["comment_id", "vote"]),
    async run(input, { call }) {
      const value = { up: 1, down: -1, clear: 0 }[input.vote];
      const { comment: c } = await call("POST", `/comments/${enc(input.comment_id)}/vote`, { value });
      const verb = { up: "已赞同", down: "已不赞同", clear: "已撤销对" }[input.vote];
      return { data: { comment_id: c.id, likes: c.likes, dislikes: c.dislikes }, summary: `${verb} ${c.author_name} 的评论`, url: postUrl(c.post_id) };
    },
  },
  {
    name: "create_collection",
    title: "新建收藏夹",
    kind: "write",
    description: "新建一个收藏夹，默认私密。",
    input: shape({ name: str("名称", 20, 1), description: str("简介", 200), is_public: bool("是否公开，默认 false") }, ["name"]),
    async run(input, { call }) {
      const { collection } = await call("POST", "/collections", { name: input.name, description: input.description || "", is_public: !!input.is_public });
      return { data: { collection_id: collection.id, name: collection.name }, summary: `已新建收藏夹「${collection.name}」`, url: collectionUrl(collection.id) };
    },
  },
  {
    name: "update_collection",
    title: "修改收藏夹",
    kind: "write",
    description: "修改自己收藏夹的名称、简介或公开状态，只传要改的字段。",
    input: shape(
      { collection_id: ref("收藏夹 ID"), name: str("新名称", 20, 1), description: str("新简介", 200), is_public: bool("是否公开") },
      ["collection_id"],
    ),
    async run({ collection_id, ...patch }, { call }) {
      const { collection } = await call("PATCH", "/collections/" + enc(collection_id), patch);
      return { data: { collection_id: collection.id, name: collection.name, is_public: !!collection.is_public }, summary: `已更新收藏夹「${collection.name}」`, url: collectionUrl(collection.id) };
    },
  },
  {
    name: "move_collection_posts",
    title: "移动收藏",
    kind: "write",
    description: "把讨论从一个收藏夹移出；传 target_collection_id 则移动到另一个收藏夹。",
    input: shape(
      { collection_id: ref("当前所在收藏夹 ID"), post_ids: list(ref("讨论 ID"), "要移动的讨论", 100, 1), target_collection_id: str("目标收藏夹 ID，不传则只是移出") },
      ["collection_id", "post_ids"],
    ),
    async run(input, { call }) {
      await call("PATCH", `/collections/${enc(input.collection_id)}/items`, { ids: input.post_ids, ...(input.target_collection_id ? { target_id: input.target_collection_id } : {}) });
      return { data: { ok: true }, summary: `已${input.target_collection_id ? "移动" : "移出"} ${input.post_ids.length} 篇收藏` };
    },
  },
  {
    name: "track_topic",
    title: "跟踪话题",
    kind: "write",
    description: "跟踪一个关键词（keyword）或版块（board，value 填版块 ID）；相关新讨论会出现在用户的消息中心。",
    input: shape({ kind: oneOf(["keyword", "board"], "类型"), value: str("关键词或版块 ID", 40, 1) }, ["kind", "value"]),
    async run(input, { call }) {
      const { track } = await call("POST", "/topic-tracks", { kind: input.kind === "board" ? "category" : "keyword", value: input.value });
      return { data: { track_id: track.id }, summary: `已开始跟踪「${track.value}」` };
    },
  },
  {
    name: "untrack_topic",
    title: "取消跟踪",
    kind: "write",
    description: "取消跟踪一个话题，track_id 用 list_topic_tracks 获取。",
    input: shape({ track_id: ref("跟踪 ID") }, ["track_id"]),
    async run(input, { call }) {
      await call("DELETE", "/topic-tracks/" + enc(input.track_id));
      return { data: { ok: true }, summary: "已取消跟踪该话题" };
    },
  },
  {
    name: "mark_notifications_read",
    title: "标记通知已读",
    kind: "write",
    description: "把指定通知（notification_ids）或全部通知（all=true）标记为已读。",
    input: shape({ notification_ids: list(ref("通知 ID"), "要标记的通知", 200), all: bool("全部标记为已读") }),
    async run(input, { call }) {
      if (input.all) await call("PATCH", "/notifications");
      else if (input.notification_ids?.length) await call("POST", "/notifications/read", { ids: input.notification_ids });
      else throw new ActionError("请指定要标记的通知，或设置 all=true。");
      return { data: { ok: true }, summary: input.all ? "已把全部通知标记为已读" : `已把 ${input.notification_ids.length} 条通知标记为已读` };
    },
  },
  {
    name: "save_draft",
    title: "保存草稿",
    kind: "write",
    description: "把内容保存为草稿（仅自己可见，不会发布）；传 draft_id 则更新已有草稿，只覆盖传入的字段。用户想先存起来、以后再发时使用。content 使用 Markdown。",
    input: shape({
      draft_id: str("要更新的草稿 ID"),
      title: str("标题", 200),
      content: str("正文（Markdown）", 20000),
      board_id: str("版块 ID"),
      tags: list(str("关键词", 20, 1), "关键词，最多 5 个", 5),
      kind: oneOf(["discussion", "project"], "类型，默认 discussion"),
      visibility: oneOf(["public", "private"], "发布后的可见范围"),
      comments_closed: bool("发布后是否关闭评论"),
    }),
    async run(input, { call }) {
      let body = { format: "markdown" };
      if (input.draft_id) {
        const { drafts } = await call("GET", "/drafts");
        const d = drafts.find((x) => x.id === input.draft_id);
        if (!d) throw new ActionError("这份草稿不存在，可能已被删除。", 404);
        body = { ...d, quotes: d.quotes.map((q) => q.id) };
        if (input.content !== undefined) body.format = "markdown";
      }
      const set = { title: input.title, content: input.content, category: input.board_id, tags: input.tags, kind: input.kind, visibility: input.visibility, comments_closed: input.comments_closed };
      for (const [key, value] of Object.entries(set)) if (value !== undefined) body[key] = value;
      const { draft } = await call(input.draft_id ? "PATCH" : "POST", input.draft_id ? "/drafts/" + enc(input.draft_id) : "/drafts", body);
      return { data: { draft_id: draft.id }, summary: `已保存草稿「${draft.title || "无标题"}」` };
    },
  },
  {
    name: "update_notification_settings",
    title: "通知设置",
    kind: "write",
    description:
      "打开或关闭各类通知：letters 私信弹窗、author 作者新帖、board 版块新帖、topic 追踪话题、reply 评论回复、mention @提及、interaction 关注与点赞、announcement 公告弹窗、other 其他。站务通知无法关闭。",
    input: shape({ settings: flags(noticeKeys, "要修改的开关") }, ["settings"]),
    async run(input, { call }) {
      const { settings, options } = await call("PATCH", "/me/notification-settings", { settings: input.settings });
      const changed = Object.entries(input.settings).map(([k, v]) => `${options.find((o) => o.id === k)?.label || k}${v ? "开" : "关"}`);
      return { data: { settings }, summary: "已更新通知设置：" + changed.join("、") };
    },
  },
  {
    name: "update_assistant_settings",
    title: "Naimakes 设置",
    kind: "write",
    description: `修改 Naimakes（你自己）的形状、颜色或思考模式，只传要改的项。形状：${shapes.join(", ")}；颜色：${colors.join(", ")}；思考模式：fast 快速、balanced 均衡、deep 深入（从用户的下一个问题开始生效）。`,
    input: shape({ shape: oneOf(shapes, "形状"), color: oneOf(colors, "颜色"), thinking: oneOf(thinkingModes, "思考模式") }),
    async run(input, { call }) {
      if (!input.shape && !input.color && !input.thinking) throw new ActionError("请指定要修改的形状、颜色或思考模式。");
      const current = await call("GET", "/me/assistant");
      const next = { ...defaultLook, ...current.prefs };
      for (const key of ["shape", "color", "thinking"]) if (input[key]) next[key] = input[key];
      const { prefs, updated_at } = await call("PUT", "/me/assistant", { prefs: next });
      const summary = input.thinking && !input.shape && !input.color ? `已切换为「${thinkingLabels[prefs.thinking]}」思考模式` : "已更新 Naimakes 设置";
      return { data: { settings: prefs }, summary, effect: { look: prefs, updated_at } };
    },
  },
  {
    name: "set_announcement_hidden",
    title: "隐藏公告",
    kind: "write",
    description: "在用户的讨论列表里隐藏或重新显示一条公告。",
    input: shape({ post_id: ref("公告的讨论 ID"), hidden: bool("目标状态") }, ["post_id", "hidden"]),
    async run(input, { call }) {
      await call(input.hidden ? "POST" : "DELETE", `/posts/${enc(input.post_id)}/hide-announcement`);
      return { data: { hidden: input.hidden }, summary: input.hidden ? "已隐藏这条公告" : "已重新显示这条公告" };
    },
  },
  {
    name: "set_conversation_flags",
    title: "私信对话设置",
    kind: "write",
    description: "置顶（pinned）或收藏（saved）与某位成员的私信对话。",
    input: shape({ user_id: ref("对方的用户 ID"), pinned: bool("是否置顶"), saved: bool("是否收藏") }, ["user_id"]),
    async run(input, { call }) {
      if (input.pinned === undefined && input.saved === undefined) throw new ActionError("请指定 pinned 或 saved。");
      const member = await findMember(call, input.user_id);
      await call("POST", `/messages/${enc(member.id)}/state`, { pinned: input.pinned, saved: input.saved });
      return { data: { ok: true }, summary: `已更新与 ${member.name} 的对话设置` };
    },
  },

  // —— 联网搜索（站点配置了搜索服务时才有）——
  ...(webSearch.enabled
    ? [
        {
          name: "web_search",
          title: "联网搜索",
          kind: "read",
          login: false,
          activity: (input) => `正在联网搜索：${clip(input.query, 24)}`,
          description:
            "在互联网上搜索，返回网页的标题、url、网站、发布日期和摘要。用户问到新闻、最新进展、实时数据、本站没有的事实，或明确要求「上网查」「搜一下」时调用；只关于本站内容和使用方法的问题不要调用。关键词要具体，可以加上年份或时间；一次回答最多搜几次，结果不够再换关键词。",
          input: shape(
            {
              query: str("搜索关键词，具体、简短", 120, 1),
              recency: oneOf(["day", "week", "month", "year", "any"], "只看这段时间内发布的网页，默认 any；问最新动态时用 week 或 month"),
              count: { type: "integer", description: "返回几条结果，默认 6", minimum: 1, maximum: 10 },
            },
            ["query"],
          ),
          async run(input, ctx) {
            ctx.searches = (ctx.searches || 0) + 1;
            if (ctx.searches > webSearch.perAnswer) throw new ActionError(`这次回答已经联网搜索了 ${webSearch.perAnswer} 次，请根据已有结果作答。`, 429);
            let results;
            try {
              results = await webSearch.search({ query: input.query, recency: input.recency, count: input.count || 6 });
            } catch (error) {
              if (error instanceof WebSearchError) throw new ActionError(error.message, 503);
              throw error;
            }
            ctx.cite?.(results);
            return { data: { query: input.query, total: results.length, results } };
          },
        },
      ]
    : []),

  // —— 记忆 ——
  {
    name: "remember",
    title: "记住",
    kind: "write",
    description:
      "把用户明确要求记住的信息，或用户明确提出的长期要求（写作风格、以后执行操作时的习惯、回答方式、个人情况），存进用户的记忆，以后每次对话都会带上。一条记忆写成一句简短、自包含的话，如「写文章时用第一人称，语气轻松」。不要记密码、验证码、证件号等敏感信息；用户没有要求、只是随口一提的事不要自行记忆。",
    input: shape({ content: str("要记住的内容，一句话", 200, 2), kind: oneOf(memoryKinds, "类型：style 写作风格、action 执行操作的习惯、answer 回答要求、fact 个人信息或其他事实") }, ["content"]),
    async run(input, { user }) {
      const added = addMemory(user.id, { content: input.content, kind: input.kind, source: "user" });
      if (!added) throw new ActionError("记忆内容太短了。");
      return {
        data: { id: added.memory.id, saved: added.memory.content, already_known: !added.created },
        summary: added.created ? `已记住：${clip(added.memory.content, 40)}` : "这条我已经记着了",
      };
    },
  },
  {
    name: "list_memories",
    title: "查看记忆",
    kind: "read",
    activity: "正在查看记忆…",
    description: "列出用户当前所有的记忆（含 id、类型、内容、是否启用）。用户询问「你记得我什么」或要删除某条记忆前使用。",
    input: shape({}),
    async run(_input, { user }) {
      const memories = listMemories(user.id);
      return { data: { total: memories.length, memories: memories.map((m) => ({ id: m.id, type: kindLabels[m.kind], content: m.content, enabled: m.enabled })) } };
    },
  },
  {
    name: "forget_memory",
    title: "忘记",
    kind: "write",
    description: "删除一条记忆（memory_id 来自 list_memories）。用户要求忘掉某件事时先 list_memories 找到对应条目再删除。",
    input: shape({ memory_id: ref("记忆 ID") }, ["memory_id"]),
    async run(input, { user }) {
      if (!forgetMemory(user.id, input.memory_id)) throw new ActionError("没有找到这条记忆，请先用 list_memories 查看。", 404);
      return { data: { ok: true }, summary: "已忘掉这条记忆" };
    },
  },

  // —— 智能体 ——
  {
    name: "ask_choices",
    title: "向用户提问",
    kind: "ask",
    login: false,
    interactive: true,
    description:
      "向用户提出一个选择题，用来弄清用户的需求或偏好。界面会把问题和选项做成一张卡片，并自动附带「其他，我来说明」。选项 2–4 个，每个简短具体（不超过 20 字）。调用后本轮到此为止：不要再写任何文字（不要重复问题，也不要说「已发给你选项」之类的话），等用户点选或自己回答。一次只问一个问题。",
    input: shape({ question: str("问题，一句话", 80, 2), options: list(str("选项", 40, 1), "备选项", 4, 2) }, ["question", "options"]),
    async run() {
      return { data: { shown: true } };
    },
  },
  {
    name: "list_agents",
    title: "查看智能体",
    kind: "read",
    activity: "正在查看智能体…",
    description: "列出用户创建的所有智能体（id、名字、指令）和哪一个是主智能体（常驻屏幕的那个）。内置的 Naimakes 的 id 是 naimakes。",
    input: shape({}),
    async run(_input, { call }) {
      const { agents, main } = await call("GET", "/assistant/agents");
      return { data: { main, agents: agents.map((a) => ({ id: a.id, name: a.name, instructions: a.instructions, shape: a.shape, color: a.color })) } };
    },
  },
  {
    name: "create_agent",
    title: "新建智能体",
    kind: "write",
    interactive: true,
    description:
      "为用户新建一个智能体（一个有自己名字、外观和指令的 AI 助手）。用户明确说想要一个新的智能体 / 助手 / 分身时才使用。name 必填；instructions 只在用户已经明确说了它该做什么时才填，否则留空——新智能体会自己打开一段对话去了解用户的需求并写好指令。" +
      `形状可选：${shapes.join(", ")}；颜色可选：${colors.join(", ")}（不指定就自动挑选）。创建成功后，界面会自动打开一段与新智能体的对话；你只需用一句话告诉用户已经创建、这就去和它聊。`,
    input: shape(
      {
        name: str("智能体的名字，不超过 20 字，不能和已有的重名", 20, 1),
        instructions: str("给它的指令（角色、做事方式），用户没说清楚就不要填", 2000),
        shape: oneOf(shapes, "形状"),
        color: oneOf(colors, "颜色"),
      },
      ["name"],
    ),
    async run(input, { call }) {
      const { agent } = await call("POST", "/assistant/agents", input);
      return { data: { agent_id: agent.id, name: agent.name }, summary: `已新建智能体「${agent.name}」`, effect: { agent: { id: agent.id, kind: "created" } } };
    },
  },
  {
    name: "update_agent",
    title: "修改智能体",
    kind: "write",
    interactive: true,
    description:
      "修改一个智能体的名字、指令、形状或颜色，只传要改的项。agent_id 不填就是你自己。instructions 会整段替换原来的指令，所以要写成完整的、给智能体自己看的指令（角色定位、用户的目标与背景、做事方式与语气、固定安排，不超过 600 字），并保留原有内容里仍然有效的部分。" +
      "用户让你改你自己的设定，或你在了解用户需求后需要把约定写下来时使用。内置的 Naimakes 没有指令可改，它的外观用 update_assistant_settings。",
    input: shape(
      {
        agent_id: ref("要修改的智能体 id，不填就是你自己"),
        name: str("新名字", 20, 1),
        instructions: str("新的完整指令", 2000),
        shape: oneOf(shapes, "形状"),
        color: oneOf(colors, "颜色"),
      },
      [],
    ),
    async run(input, { call, agent }) {
      const { agent_id: target, ...patch } = input;
      const id = target || agent;
      if (!id || id === "naimakes") throw new ActionError("内置的 Naimakes 没有自定义指令可改；它的外观请用 update_assistant_settings。");
      if (!Object.keys(patch).length) throw new ActionError("请指定要修改的内容。");
      const { agent: updated } = await call("PATCH", "/assistant/agents/" + enc(id), patch);
      const changed = [patch.name && "名字", patch.instructions !== undefined && "指令", (patch.shape || patch.color) && "外观"].filter(Boolean).join("、");
      return { data: { agent_id: updated.id, name: updated.name }, summary: `已更新「${updated.name}」的${changed}`, effect: { agent: { id: updated.id, kind: "updated" } } };
    },
  },
  {
    name: "set_main_agent",
    title: "设置主智能体",
    kind: "write",
    interactive: true,
    description: "把某个智能体设为主智能体——常驻屏幕的那个小球就会换成它。agent_id 来自 list_agents；内置的 Naimakes 的 id 是 naimakes。",
    input: shape({ agent_id: ref("智能体 id") }, ["agent_id"]),
    async run(input, { call }) {
      const { agents } = await call("PUT", "/assistant/main-agent", { id: input.agent_id });
      const name = input.agent_id === "naimakes" ? "Naimakes" : agents.find((a) => a.id === input.agent_id)?.name || "智能体";
      return { data: { main: input.agent_id }, summary: `已把「${name}」设为主智能体`, effect: { agent: { id: input.agent_id, kind: "updated" } } };
    },
  },

  // —— 定时任务（只在和用户的对话里可用，定时运行时不能再设定新的任务） ——
  {
    name: "list_scheduled_tasks",
    title: "查看定时任务",
    kind: "read",
    interactive: true,
    activity: "正在查看定时任务…",
    description: "列出用户设置的全部定时任务（id、名称、时间、是否启用、上次运行结果）。",
    input: shape({}),
    async run(_input, { user }) {
      const tasks = listTasks(user.id);
      return { data: { total: tasks.length, tasks: tasks.map((t) => ({ id: t.id, title: t.title, schedule: t.schedule, enabled: t.enabled, auto_actions: t.allow_actions, last_run: day(t.last_run_at), last_status: t.last_status, last_result: clip(t.last_result, 200) })) } };
    },
  },
  {
    name: "create_scheduled_task",
    title: "设置定时任务",
    kind: "confirm",
    interactive: true,
    description:
      "为用户设置一个定时任务：到了固定时间，你会自动按 prompt 执行一遍（可以查找内容、整理收藏、发帖、评论等），再把结果发给用户。" +
      "prompt 要写成能独立执行的完整指令（当时没有人可以追问）。repeat：once 仅一次（需要 date）、daily 每天、weekdays 工作日、weekly 每周（需要 weekday）。时间按用户所在时区。" +
      "allow_actions 默认 false：定时运行时遇到需要用户确认的操作（发帖、评论、私信等）只会汇报而不执行；只有用户明确表示「到时候直接帮我发/做」时才设为 true。需要用户确认。",
    input: shape(
      {
        title: str("任务名称，不超过 40 字", 40, 1),
        prompt: str("到时间要执行的完整指令", 1000, 2),
        repeat: oneOf(repeats, "重复方式"),
        time: str("时间，24 小时制 HH:MM，如 08:30", 5, 5),
        date: str("仅一次的任务的日期，YYYY-MM-DD", 10, 10),
        weekday: int("每周任务的星期，0 周日 … 6 周六", 6),
        allow_actions: bool("是否允许到时自动执行需要确认的操作，默认 false"),
      },
      ["title", "prompt", "repeat", "time"],
    ),
    async check(input, { user, tz }) {
      let task;
      try {
        task = createTask(user.id, input, { tz, dryRun: true });
      } catch (error) {
        throw new ActionError(error.message, error.status || 400);
      }
      return preview("设置定时任务", [field("名称", task.title), field("时间", task.schedule), field("自动执行操作", task.allow_actions ? "允许（发帖、评论等会直接执行）" : "不允许（只汇报，不执行需要确认的操作）")], task.prompt);
    },
    async run(input, { user, tz, agent }) {
      let task;
      try {
        task = createTask(user.id, input, { tz, agent: agent && agent !== "naimakes" ? agent : null });
      } catch (error) {
        throw new ActionError(error.message, error.status || 400);
      }
      return { data: { task_id: task.id, schedule: task.schedule }, summary: `已设置定时任务「${task.title}」（${task.schedule}）` };
    },
  },
  {
    name: "update_scheduled_task",
    title: "修改定时任务",
    kind: "write",
    interactive: true,
    description: "启用或暂停（enabled）、改名或改内容、调整时间的定时任务。只传要改的项。task_id 来自 list_scheduled_tasks。",
    input: shape({
      task_id: ref("任务 ID"),
      enabled: bool("启用或暂停"),
      title: str("新名称", 40, 1),
      prompt: str("新的执行指令", 1000, 2),
      repeat: oneOf(repeats, "重复方式"),
      time: str("HH:MM", 5, 5),
      date: str("YYYY-MM-DD", 10, 10),
      weekday: int("0 周日 … 6 周六", 6),
    }, ["task_id"]),
    async run(input, { user }) {
      const { task_id, ...patch } = input;
      if (!Object.keys(patch).length) throw new ActionError("请指定要修改的内容。");
      let task;
      try {
        task = updateTask(user.id, task_id, patch);
      } catch (error) {
        throw new ActionError(error.message, error.status || 400);
      }
      return { data: { task_id: task.id, schedule: task.schedule, enabled: task.enabled }, summary: `已更新定时任务「${task.title}」（${task.enabled ? task.schedule : "已暂停"}）` };
    },
  },
  {
    name: "delete_scheduled_task",
    title: "删除定时任务",
    kind: "confirm",
    interactive: true,
    description: "删除一个定时任务（task_id 来自 list_scheduled_tasks）。需要用户确认。",
    input: shape({ task_id: ref("任务 ID") }, ["task_id"]),
    async check(input, { user }) {
      const task = getTask(user.id, input.task_id);
      if (!task) throw new ActionError("没有找到这个定时任务，请先用 list_scheduled_tasks 查看。", 404);
      return preview("删除定时任务", [field("名称", task.title), field("时间", describeSchedule(task))]);
    },
    async run(input, { user }) {
      if (!deleteTask(user.id, input.task_id)) throw new ActionError("没有找到这个定时任务。", 404);
      return { data: { ok: true }, summary: "已删除定时任务" };
    },
  },

  // —— 需要用户确认 ——
  {
    name: "create_post",
    title: "发布讨论",
    kind: "confirm",
    description:
      "以用户的名义发布一篇新讨论（需要用户确认）。content 使用 Markdown；按用户的意思撰写，信息不足时先问清楚。board_id 用 list_boards 获取。",
    input: shape(
      {
        title: str("标题", 200, 1),
        content: str("正文（Markdown）", 20000, 1),
        board_id: ref("版块 ID"),
        tags: list(str("关键词", 20, 1), "关键词，最多 5 个", 5),
        kind: oneOf(["discussion", "project"], "类型：普通讨论或共创项目，默认 discussion"),
        visibility: oneOf(["public", "private"], "可见范围，默认 public"),
        comments_closed: bool("是否关闭评论，默认 false"),
        quote_post_ids: list(ref("讨论 ID"), "要引用的公开讨论，最多 5 个", 5),
      },
      ["title", "content", "board_id"],
    ),
    async check(input, { call }) {
      await speaking(call);
      const board = await boardOf(call, input.board_id);
      return preview(
        "发布讨论",
        [
          field("版块", board.name),
          field("标题", input.title),
          field("关键词", (input.tags || []).join("、")),
          field("类型", input.kind === "project" ? "共创项目" : ""),
          field("可见范围", visibilityText(input.visibility)),
          field("评论", input.comments_closed ? "关闭" : ""),
        ],
        input.content,
      );
    },
    async run(input, { call }) {
      const { post } = await call("POST", "/posts", {
        title: input.title,
        content: input.content,
        format: "markdown",
        category: input.board_id,
        tags: input.tags || [],
        kind: input.kind || "discussion",
        visibility: input.visibility || "public",
        comments_closed: !!input.comments_closed,
        quotes: input.quote_post_ids || [],
      });
      return { data: { post_id: post.id, url: postUrl(post.id) }, summary: `已发布「${post.title}」`, url: postUrl(post.id) };
    },
  },
  {
    name: "update_profile_settings",
    title: "主页与隐私设置",
    kind: "confirm",
    description:
      "修改主页隐私开关（collections 收藏夹、boards 关注版块、history 最近浏览、likes 最近点赞、following 关注列表、followers 粉丝列表、tags 个人标签、later 稍后再看、topics 跟踪话题、moderating 管理的版块、letters 允许未关注的人私信、visitors 记录访客；true 为公开或开启）、个人标签（整体替换，最多 12 个，每个最多 12 字），或主页模块顺序（需要用户确认）。只传要改的部分。",
    input: shape({
      privacy: flags(privacyKeys, "隐私开关"),
      profile_tags: list(str("标签", 12, 1), "个人标签（整体替换）", 12),
      module_order: list(oneOf(moduleKeys, "模块"), "主页模块顺序，未列出的模块排在后面", moduleKeys.length),
    }),
    async check(input) {
      if (!input.privacy && !input.profile_tags && !input.module_order) throw new ActionError("请提供要修改的设置。");
      return preview("修改主页与隐私设置", [
        ...Object.entries(input.privacy || {}).map(([key, on]) => field(privacyLabels[key], on ? "开启" : "关闭")),
        field("个人标签", input.profile_tags && (input.profile_tags.join("、") || "清空")),
        field("模块顺序", input.module_order?.map((m) => moduleLabels[m]).join(" → ")),
      ]);
    },
    async run(input, { call }) {
      const { profile } = await call("PATCH", "/me/profile", { privacy: input.privacy, tags: input.profile_tags, modules: input.module_order });
      return { data: { privacy: profile.privacy, profile_tags: profile.tags, module_order: profile.modules }, summary: "已更新主页设置", url: "/settings" };
    },
  },
  {
    name: "publish_draft",
    title: "发布草稿",
    kind: "confirm",
    description: "把一份已保存的草稿原样发布为讨论（需要用户确认），发布后删除该草稿。草稿没有版块时必须传 board_id。",
    input: shape({ draft_id: ref("草稿 ID"), board_id: str("版块 ID，覆盖草稿里的版块") }, ["draft_id"]),
    async check(input, { call }) {
      await speaking(call);
      const { drafts } = await call("GET", "/drafts");
      const d = drafts.find((x) => x.id === input.draft_id);
      if (!d) throw new ActionError("这份草稿不存在，可能已被删除。", 404);
      if (!d.title) throw new ActionError("草稿还没有标题，请先用 save_draft 补上标题。");
      const boardId = input.board_id || d.category;
      if (!boardId) throw new ActionError("草稿没有选择版块，请传入 board_id。");
      const board = await boardOf(call, boardId);
      return preview("发布草稿", [field("版块", board.name), field("标题", d.title), field("关键词", d.tags.join("、")), field("可见范围", visibilityText(d.visibility))], d.excerpt);
    },
    async run(input, { call }) {
      const { drafts } = await call("GET", "/drafts");
      const d = drafts.find((x) => x.id === input.draft_id);
      if (!d) throw new ActionError("这份草稿不存在，可能已被删除。", 404);
      const { post } = await call("POST", "/posts", {
        title: d.title,
        content: d.content,
        format: d.format,
        category: input.board_id || d.category,
        tags: d.tags,
        kind: d.kind === "project" ? "project" : "discussion",
        visibility: d.visibility,
        comments_closed: d.comments_closed,
        inline_images: d.inline_images,
        attachments: d.attachments.map(({ url, name, mime, size }) => ({ url, name, mime, size })),
        quotes: d.quotes.map((q) => q.id),
      });
      await call("DELETE", "/drafts", { ids: [d.id] });
      return { data: { post_id: post.id, url: postUrl(post.id) }, summary: `已发布「${post.title}」`, url: postUrl(post.id) };
    },
  },
  {
    name: "edit_post",
    title: "编辑讨论",
    kind: "confirm",
    description: "修改用户自己发布的讨论的标题、正文（Markdown，整体替换）、版块或关键词（需要用户确认）。只传要改的字段；改正文前先用 get_post 读原文。",
    input: shape(
      {
        post_id: ref("讨论 ID"),
        title: str("新标题", 200, 1),
        content: str("新的完整正文（Markdown）", 20000, 1),
        board_id: str("移动到的版块 ID"),
        tags: list(str("关键词", 20, 1), "新的关键词（整体替换）", 5),
      },
      ["post_id"],
    ),
    async check(input, { call, user }) {
      if (![input.title, input.content, input.board_id, input.tags].some((v) => v !== undefined)) throw new ActionError("请提供要修改的内容。");
      await speaking(call);
      const { post } = await ownPost(call, user, input.post_id);
      const board = input.board_id ? await boardOf(call, input.board_id) : null;
      return preview(
        "编辑讨论",
        [
          field("讨论", post.title),
          field("新标题", input.title !== post.title ? input.title : ""),
          field("移动到", board?.name),
          field("关键词", input.tags?.join("、")),
          field("正文", input.content !== undefined ? "整体替换为下方内容" : ""),
        ],
        input.content || "",
      );
    },
    async run(input, { call, user }) {
      const { post } = await ownPost(call, user, input.post_id);
      const replace = input.content !== undefined;
      const { post: updated } = await call("PATCH", "/posts/" + enc(post.id), {
        title: input.title ?? post.title,
        content: replace ? input.content : post.content,
        format: replace ? "markdown" : post.format,
        category: input.board_id ?? post.category,
        tags: input.tags ?? post.tags,
        kind: post.kind,
        visibility: post.visibility,
        comments_closed: post.comments_closed,
        attachments: post.attachments.map(({ url, name, mime, size }) => ({ url, name, mime, size })),
        inline_images: post.attachments.some((a) => a.inline),
        quotes: post.quotes.map((q) => q.id),
      });
      return { data: { post_id: updated.id }, summary: `已更新「${updated.title}」`, url: postUrl(updated.id) };
    },
  },
  {
    name: "set_post_settings",
    title: "讨论设置",
    kind: "confirm",
    description: "修改自己讨论的可见范围（public / private）或是否关闭评论（需要用户确认）。",
    input: shape({ post_id: ref("讨论 ID"), visibility: oneOf(["public", "private"], "可见范围"), comments_closed: bool("是否关闭评论") }, ["post_id"]),
    async check(input, { call, user }) {
      if (input.visibility === undefined && input.comments_closed === undefined) throw new ActionError("请指定要修改的设置。");
      const { post } = await ownPost(call, user, input.post_id);
      return preview("修改讨论设置", [
        field("讨论", post.title),
        field("可见范围", input.visibility && visibilityText(input.visibility)),
        field("评论", input.comments_closed === undefined ? "" : input.comments_closed ? "关闭" : "开放"),
      ]);
    },
    async run(input, { call }) {
      const { post } = await call("PATCH", `/posts/${enc(input.post_id)}/settings`, { visibility: input.visibility, comments_closed: input.comments_closed });
      return { data: { visibility: post.visibility, comments_closed: post.comments_closed }, summary: `已更新「${post.title}」的设置`, url: postUrl(post.id) };
    },
  },
  {
    name: "delete_post",
    title: "删除讨论",
    kind: "confirm",
    description: "删除用户自己发布的一篇讨论（需要用户确认）。",
    input: shape({ post_id: ref("讨论 ID"), reason: str("删除原因（可选）", 200) }, ["post_id"]),
    async check(input, { call, user }) {
      const { post } = await ownPost(call, user, input.post_id);
      return preview("删除讨论", [field("讨论", post.title), field("评论数", post.comments), field("原因", input.reason)]);
    },
    async run(input, { call }) {
      const { post } = await postOf(call, input.post_id);
      await call("DELETE", "/posts/" + enc(post.id), { reason: input.reason || "" });
      return { data: { ok: true }, summary: `已删除「${post.title}」` };
    },
  },
  {
    name: "create_comment",
    title: "发表评论",
    kind: "confirm",
    description: "以用户的名义在讨论下发表评论，或回复某条评论（需要用户确认）。content 为纯文本（2–5000 字，不支持 Markdown）。回复评论时先用 get_post 拿到评论 ID。",
    input: shape(
      { post_id: ref("讨论 ID"), content: str("评论内容（纯文本）", 5000, 2), reply_to_comment_id: str("要回复的评论 ID") },
      ["post_id", "content"],
    ),
    async check(input, { call }) {
      await speaking(call);
      const { post, comments } = await postOf(call, input.post_id);
      if (post.comments_closed) throw new ActionError("作者已关闭这篇讨论的评论。", 403);
      if (post.locked) throw new ActionError("这篇讨论已被禁言，暂时无法评论。", 403);
      const parent = input.reply_to_comment_id ? comments.find((c) => c.id === input.reply_to_comment_id && !c.deleted) : null;
      if (input.reply_to_comment_id && !parent) throw new ActionError("要回复的评论不存在。", 404);
      return preview(parent ? "回复评论" : "发表评论", [field("讨论", post.title), field("回复给", parent && `${parent.author_name}：${clip(parent.content, 40)}`)], input.content);
    },
    async run(input, { call }) {
      const { post } = await call("POST", `/posts/${enc(input.post_id)}/comments`, { content: input.content, parent_id: input.reply_to_comment_id || null });
      return { data: { post_id: post.id, comments: post.comments }, summary: `已在「${post.title}」下发表评论`, url: postUrl(post.id) };
    },
  },
  {
    name: "delete_comment",
    title: "删除评论",
    kind: "confirm",
    description: "删除用户自己发表的一条评论（需要用户确认）。",
    input: shape({ post_id: ref("评论所在讨论的 ID"), comment_id: ref("评论 ID") }, ["post_id", "comment_id"]),
    async check(input, { call, user }) {
      const { post, comments } = await postOf(call, input.post_id);
      const c = comments.find((x) => x.id === input.comment_id && !x.deleted);
      if (!c) throw new ActionError("这条评论不存在或已被删除。", 404);
      if (c.author_id !== user.id) throw new ActionError("只能删除你自己发表的评论。", 403);
      return preview("删除评论", [field("讨论", post.title)], c.content);
    },
    async run(input, { call }) {
      const { post } = await call("DELETE", "/comments/" + enc(input.comment_id));
      return { data: { ok: true }, summary: "已删除这条评论", url: post ? postUrl(post.id) : undefined };
    },
  },
  {
    name: "send_message",
    title: "发送私信",
    kind: "confirm",
    description: "以用户的名义给一位成员发送私信（需要用户确认）。content 为纯文本（1–5000 字）。不知道用户 ID 时先用 find_users 查找。",
    input: shape({ user_id: ref("收件人的用户 ID"), content: str("私信内容（纯文本）", 5000, 1) }, ["user_id", "content"]),
    async check(input, { call, user }) {
      if (input.user_id === user.id) throw new ActionError("不能给自己发送私信。");
      await speaking(call);
      const member = await findMember(call, input.user_id);
      return preview("发送私信", [field("收件人", member.name)], input.content);
    },
    async run(input, { call }) {
      const member = await findMember(call, input.user_id);
      await call("POST", "/messages/" + enc(member.id), { content: input.content });
      return { data: { ok: true }, summary: `已发送私信给 ${member.name}` };
    },
  },
  {
    name: "delete_message",
    title: "撤回私信",
    kind: "confirm",
    description: "删除用户自己发出的一条私信，双方都将看不到（需要用户确认）。消息 ID 用 read_conversation 获取。",
    input: shape({ user_id: ref("对方的用户 ID"), message_id: ref("私信 ID") }, ["user_id", "message_id"]),
    async check(input, { call }) {
      const r = await call("GET", "/messages/" + enc(input.user_id));
      const m = r.messages.find((x) => x.id === input.message_id);
      if (!m) throw new ActionError("这条私信不存在。", 404);
      if (!m.mine) throw new ActionError("只能删除你自己发送的私信。", 403);
      return preview("撤回私信", [field("对方", r.peer.name)], m.content);
    },
    async run(input, { call }) {
      await call("DELETE", "/messages/item/" + enc(input.message_id));
      return { data: { ok: true }, summary: "已删除这条私信" };
    },
  },
  {
    name: "clear_conversation",
    title: "清空对话",
    kind: "confirm",
    description: "从用户的私信列表里清除与某位成员的全部对话记录（仅对用户自己生效，需要用户确认）。",
    input: shape({ user_id: ref("对方的用户 ID") }, ["user_id"]),
    async check(input, { call }) {
      const member = await findMember(call, input.user_id);
      return preview("清空私信对话", [field("对方", member.name)]);
    },
    async run(input, { call }) {
      const member = await findMember(call, input.user_id);
      await call("DELETE", "/messages/" + enc(member.id));
      return { data: { ok: true }, summary: `已清空与 ${member.name} 的对话` };
    },
  },
  {
    name: "report_content",
    title: "举报",
    kind: "confirm",
    description: "举报不当的讨论、评论、成员或版块（需要用户确认）。reason 为 other 时必须在 detail 写明原因。",
    input: shape(
      {
        target_type: oneOf(["post", "comment", "user", "board"], "举报对象类型"),
        target_id: ref("对象 ID"),
        reason: oneOf(reportReasons, "类型：" + reportReasons.map((r) => `${r} ${reasonLabels[r]}`).join("、")),
        detail: str("补充说明", 1000),
      },
      ["target_type", "target_id", "reason"],
    ),
    async check(input, { call }) {
      if (input.reason === "other" && Array.from((input.detail || "").trim()).length < 2) throw new ActionError("选择「其他」时，请在 detail 写明具体原因。");
      const label =
        input.target_type === "post"
          ? `讨论「${(await postOf(call, input.target_id)).post.title}」`
          : input.target_type === "user"
            ? `成员 ${(await findMember(call, input.target_id)).name}`
            : input.target_type === "board"
              ? `版块「${(await boardOf(call, input.target_id)).name}」`
              : "一条评论";
      return preview("举报", [field("对象", label), field("类型", reasonLabels[input.reason])], input.detail || "");
    },
    async run(input, { call }) {
      await call("POST", "/complaints", { target_type: input.target_type, target_id: input.target_id, category: input.reason, detail: input.detail || "" });
      return { data: { ok: true }, summary: "举报已提交，管理员会尽快处理" };
    },
  },
  {
    name: "file_appeal",
    title: "提出申诉",
    kind: "confirm",
    description: "对自己账号的禁言（target=account），或自己管理的版块的禁言（target=board，需 board_id）提出申诉（需要用户确认）。",
    input: shape({ target: oneOf(["account", "board"], "申诉对象"), board_id: str("版块 ID"), reason: str("申诉理由", 2000, 2) }, ["target", "reason"]),
    async check(input, { call }) {
      if (input.target === "board" && !input.board_id) throw new ActionError("请提供要申诉的版块 ID。");
      const what = input.target === "account" ? "我的账号禁言" : `版块「${(await boardOf(call, input.board_id)).name}」的禁言`;
      return preview("提出申诉", [field("对象", what)], input.reason);
    },
    async run(input, { call }) {
      if (input.target === "account") await call("POST", "/me/mute-appeal", { reason: input.reason });
      else await call("POST", "/appeals", { target_type: "board", target_id: input.board_id, reason: input.reason });
      return { data: { ok: true }, summary: "申诉已提交，请留意通知" };
    },
  },
  {
    name: "delete_collection",
    title: "删除收藏夹",
    kind: "confirm",
    description: "删除用户的一个收藏夹（默认收藏夹不能删除，需要用户确认）。",
    input: shape({ collection_id: ref("收藏夹 ID") }, ["collection_id"]),
    async check(input, { call }) {
      const { collections } = await call("GET", "/collections");
      const c = collections.find((x) => x.id === input.collection_id);
      if (!c) throw new ActionError("收藏夹不存在。", 404);
      if (c.is_default) throw new ActionError("默认收藏夹不能删除。");
      return preview("删除收藏夹", [field("收藏夹", c.name), field("篇数", c.count)]);
    },
    async run(input, { call }) {
      await call("DELETE", "/collections/" + enc(input.collection_id));
      return { data: { ok: true }, summary: "已删除收藏夹" };
    },
  },
  {
    name: "delete_drafts",
    title: "删除草稿",
    kind: "confirm",
    description: "删除用户的草稿（需要用户确认）。",
    input: shape({ draft_ids: list(ref("草稿 ID"), "要删除的草稿", 50, 1) }, ["draft_ids"]),
    async check(input, { call }) {
      const { drafts } = await call("GET", "/drafts");
      const found = drafts.filter((d) => input.draft_ids.includes(d.id));
      if (!found.length) throw new ActionError("没有找到这些草稿。", 404);
      return preview("删除草稿", [field("草稿", found.map((d) => `「${d.title || "无标题"}」`).join("、"))]);
    },
    async run(input, { call }) {
      await call("DELETE", "/drafts", { ids: input.draft_ids });
      return { data: { ok: true }, summary: `已删除 ${input.draft_ids.length} 份草稿` };
    },
  },
  {
    name: "create_board",
    title: "创建版块",
    kind: "confirm",
    description: "创建一个新版块，用户将成为版主（每人最多 5 个，需要用户确认）。",
    input: shape(
      { name: str("版块名称", 40, 1), description: str("版块简介", 300, 1), english_name: str("英文名（可选，只能用英文和常见符号）", 40) },
      ["name", "description"],
    ),
    async check(input, { call }) {
      await speaking(call);
      return preview("创建版块", [field("名称", input.name), field("英文名", input.english_name)], input.description);
    },
    async run(input, { call }) {
      const { category } = await call("POST", "/categories", { name: input.name, en: input.english_name || "", description: input.description });
      return { data: { board_id: category.id }, summary: `已创建版块「${category.name}」`, url: boardUrl(category.id) };
    },
  },
  {
    name: "update_profile",
    title: "修改资料",
    kind: "confirm",
    description: "修改用户的昵称（2–24 字）或个人简介（最多 160 字）（需要用户确认）。",
    input: shape({ name: str("新昵称", 24, 2), bio: str("新简介", 160) }),
    async check(input, { call }) {
      if (input.name === undefined && input.bio === undefined) throw new ActionError("请提供要修改的昵称或简介。");
      const { user } = await call("GET", "/me");
      if (input.name !== undefined && input.name.trim() !== user.name) {
        const { available } = await call("GET", "/auth/name-available" + query({ name: input.name.trim() }));
        if (!available) throw new ActionError("这个昵称已被占用，请换一个。", 409);
      }
      return preview("修改资料", [field("昵称", input.name !== undefined && `${user.name} → ${input.name}`), field("简介", input.bio !== undefined && "改为下方内容")], input.bio || "");
    },
    async run(input, { call }) {
      const { user } = await call("GET", "/me");
      const r = await call("PATCH", "/me", { name: input.name ?? user.name, bio: input.bio ?? user.bio, avatar: user.avatar || "", email: user.email });
      return { data: { name: r.user.name, bio: r.user.bio }, summary: "已更新个人资料", url: userUrl(r.user.id) };
    },
  },
  {
    name: "clear_history",
    title: "清除浏览记录",
    kind: "confirm",
    description: "删除最近浏览记录里的指定讨论（post_ids）或全部记录（all=true）（需要用户确认）。",
    input: shape({ post_ids: list(ref("讨论 ID"), "要删除的记录", 500), all: bool("清除全部") }),
    async check(input) {
      if (!input.all && !input.post_ids?.length) throw new ActionError("请指定要删除的记录，或设置 all=true。");
      return preview("清除浏览记录", [field("范围", input.all ? "全部最近浏览" : `${input.post_ids.length} 条记录`)]);
    },
    async run(input, { call }) {
      await call("DELETE", "/history", input.all ? { all: true } : { ids: input.post_ids });
      return { data: { ok: true }, summary: input.all ? "已清除全部浏览记录" : `已删除 ${input.post_ids.length} 条浏览记录` };
    },
  },
];

for (const action of actionList) action.login = action.login !== false;
export const actions = new Map(actionList.map((a) => [a.name, a]));

export function catalog() {
  return actionList.map(({ name, title, kind, login, description, input }) => ({ name, title, kind, login, description, input }));
}

export function parseInput(action, raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  const problem = value ? invalid(action.input, value) : "参数格式不正确";
  if (problem) throw new ActionError(`${action.name} 的参数有误：${problem}。`);
  return value;
}

const loopback = (address) => {
  const host = String(address || "127.0.0.1").replace(/^::ffff:/, "");
  return host.includes(":") ? `[${host}]` : host;
};

// Calls the site's own API as a member over loopback to the same server, so
// every route keeps its own checks. `token` is the member's session cookie.
export function memberApiWith({ token, base, ip }) {
  const headers = { accept: "application/json", "user-agent": "Naimakes-Assistant" };
  if (token) headers.cookie = "nmk_session=" + token;
  if (ip) headers["x-forwarded-for"] = ip;
  return async (method, path, body) => {
    let response;
    try {
      response = await fetch(base + path, {
        method,
        headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ActionError("站内服务暂时没有响应，请稍后再试。", 503);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ActionError(data.error || "操作没有成功，请稍后再试。", response.status);
    return data;
  };
}

// The same, on behalf of whoever made `req`.
export function memberApi(req, app) {
  const token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nmk_session="))
    ?.slice(12);
  return memberApiWith({
    token,
    base: `http://${loopback(req.socket.localAddress)}:${req.socket.localPort}/api`,
    ip: app.get("trust proxy") && req.ip ? req.ip : "",
  });
}

export async function runAction(action, input, ctx) {
  if (action.login && !ctx.user) throw new ActionError("这个操作需要先登录。", 401);
  const result = await action.run(input, ctx);
  return { summary: action.title, ...result };
}

const rowOf = (id, userId) => db.prepare("SELECT * FROM assistant_actions WHERE id=? AND user_id=?").get(id, userId);
const readJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};
export const cardOf = (row) => ({
  id: row.id,
  name: row.action,
  title: actions.get(row.action)?.title || row.action,
  status: row.status,
  preview: readJson(row.preview),
  ...readJson(row.result),
});

export async function propose(action, input, ctx) {
  if (!ctx.user) throw new ActionError("这个操作需要先登录。", 401);
  const shown = await action.check(input, ctx);
  const now = Date.now();
  db.prepare("DELETE FROM assistant_actions WHERE user_id=? AND created_at<?").run(ctx.user.id, now - 7 * 86400000);
  const id = randomUUID();
  db.prepare("INSERT INTO assistant_actions(id,user_id,action,input,preview,status,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?)").run(
    id,
    ctx.user.id,
    action.name,
    JSON.stringify(input),
    JSON.stringify(shown),
    now,
    now,
  );
  return cardOf(rowOf(id, ctx.user.id));
}

function settle(row, status, result) {
  db.prepare("UPDATE assistant_actions SET status=?,result=?,updated_at=? WHERE id=?").run(status, JSON.stringify(result), Date.now(), row.id);
  return cardOf(rowOf(row.id, row.user_id));
}

export async function confirmAction(id, ctx) {
  const row = rowOf(id, ctx.user.id);
  if (!row) throw new ActionError("没有找到这个待确认的操作。", 404);
  if (row.status !== "pending") throw Object.assign(new ActionError("这个操作已经处理过了。", 409), { card: cardOf(row) });
  if (row.created_at < Date.now() - PENDING_TTL) {
    const card = settle(row, "expired", { error: "确认已超时，请重新让 Naimakes 发起。" });
    throw Object.assign(new ActionError(card.error, 410), { card });
  }
  const claimed = db.prepare("UPDATE assistant_actions SET status='running',updated_at=? WHERE id=? AND status='pending'").run(Date.now(), row.id);
  if (!claimed.changes) throw new ActionError("这个操作正在处理中。", 409);
  const action = actions.get(row.action);
  try {
    if (!action) throw new ActionError("这个操作已不再支持。");
    const done = await runAction(action, parseInput(action, readJson(row.input)), ctx);
    return settle(row, "done", { summary: done.summary, ...(done.url ? { url: done.url } : {}), ...(done.effect ? { effect: done.effect } : {}) });
  } catch (error) {
    const message = error instanceof ActionError ? error.message : "操作没有成功，请稍后再试。";
    if (!(error instanceof ActionError)) console.error("Assistant action failed:", error);
    throw Object.assign(new ActionError(message, error.status || 500), { card: settle(row, "failed", { error: message }) });
  }
}

export function cancelAction(id, user) {
  const row = rowOf(id, user.id);
  if (!row) throw new ActionError("没有找到这个待确认的操作。", 404);
  if (row.status !== "pending") return cardOf(row);
  return settle(row, "cancelled", {});
}
