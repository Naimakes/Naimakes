import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  randomUUID,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fromRoot } from "./project-paths.mjs";
import { db, dataDir } from "./database.mjs";
import {
  installBoards,
  hasCategory,
  canModerateBoard,
  isBoardLead,
  joinBoard,
} from "./boards.mjs";
import { provisionOwner } from "./site-owner.mjs";
import { installLibrary } from "./library.mjs";
import { installProfiles, profileOf } from "./profiles.mjs";
import { installAccountDeletion } from "./account-deletion.mjs";
import { installSearch, installPersonalSearch } from "./search.mjs";
import { installFeedPrefs } from "./feed-preferences.mjs";
import { installDrafts } from "./drafts.mjs";
import { installInsights } from "./insights.mjs";
import { installAssistant } from "./assistant.mjs";
import { hasRichMedia, plainText, postFormat } from "./rich-text.mjs";
import { prepareShare, shareCard } from "./sharing.mjs";
import {
  installNotifications,
  notify,
  deliverPost,
  mentionedUsers,
  publishMessage,
  unreadCount,
  subscriptionsOf,
  formatNotice,
  closeAllStreams,
  governanceKinds,
  sentence,
  noteLine,
  tidyNotice,
} from "./notifications.mjs";
import {
  installGovernance,
  configureGovernance,
  handle,
  act,
  actorRole,
  isStaff,
  isOwner,
  userMute,
  boardMute,
  penaltyView,
  fileComplaint,
  fileAppeal,
  requestOrRemove,
  conflictOf,
  loadTarget,
  isAdmin,
  boardRoleOf,
  GovernanceError,
} from "./governance.mjs";
provisionOwner();
const app = express();
const production = process.env.NODE_ENV === "production";
const secureCookies =
  process.env.COOKIE_SECURE === "true" ||
  (production && process.env.COOKIE_SECURE !== "false");
if (production) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            mediaSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"],
            upgradeInsecureRequests: secureCookies ? [] : null,
          },
        }
      : false,
    strictTransportSecurity: secureCookies ? undefined : false,
  }),
);
app.use("/api/uploads", express.raw({ type: () => true, limit: "26mb" }));
const jsonBody = express.json({ limit: "8mb" });
app.use((req, res, next) => (req.path === "/api/assistant/chat" ? next() : jsonBody(req, res, next)));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: Number(process.env.API_RATE_LIMIT) || 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "操作太频繁，请稍后再试。" },
  }),
);
const authLimiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "尝试次数过多，请 15 分钟后再试。" },
});
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      try {
        if (
          new URL(origin).host !== req.get("host") &&
          origin !== process.env.APP_ORIGIN
        )
          return res.status(403).json({ error: "请求来源无效。" });
      } catch {
        return res.status(403).json({ error: "请求来源无效。" });
      }
    }
    if (req.get("sec-fetch-site") === "cross-site")
      return res.status(403).json({ error: "请求来源无效。" });
  }
  const token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nmk_session="))
    ?.slice(12);
  if (token)
    req.user = db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.status='active'",
      )
      .get(digest(token), Date.now());
  next();
});
const digest = (v) => createHash("sha256").update(v).digest("hex");
const hashPassword = async (password) => {
  const salt = randomBytes(16).toString("hex");
  const key = await promisify(scrypt)(password, salt, 64);
  return salt + ":" + key.toString("hex");
};
const checkPassword = async (password, stored) => {
  if (!stored || !stored.includes(":")) {
    await promisify(scrypt)(password, "naimakes-timing-salt", 64);
    return false;
  }
  const [salt, hex] = stored.split(":");
  return timingSafeEqual(
    Buffer.from(hex, "hex"),
    await promisify(scrypt)(password, salt, 64),
  );
};
const publicUser = (u) =>
  u
    ? {
        id: u.id,
        name: u.name,
        initials: u.initials,
        avatar: u.avatar || "",
        email: u.email,
        bio: u.bio,
        role: u.role,
        created_at: u.created_at,
        ...muteFields(u),
      }
    : null;
function muteFields(u) {
  const view = penaltyView("user", u.id, { privileged: true });
  return {
    muted: view ? 1 : 0,
    muted_until: view?.until ?? null,
    mute_reason: view?.reason || "",
    mute_started_at: view?.starts_at ?? null,
    appeal_pending: view?.appeal_pending ? 1 : 0,
    appeal_cooldown_until: view?.cooldown_until ?? null,
  };
}
const auth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "登录后即可参与讨论。" });
const validText = (v, min, max) =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const postVisibilities = ["public", "private"];
const liveClause =
  "p.deleted_at IS NULL AND p.category NOT IN (SELECT id FROM categories WHERE deleted_at IS NOT NULL) AND p.author_id NOT IN (SELECT id FROM users WHERE status='deleted')";
const visibleClause = `(${liveClause} AND (p.visibility='public' OR p.author_id=?))`;
const libraryClause = "(p.visibility='public' OR p.author_id=?)";
const validSettings = (visibility, commentsClosed) => {
  if (!postVisibilities.includes(visibility)) return "请选择有效的可见范围。";
  if (typeof commentsClosed !== "boolean")
    return "请选择是否允许其他人评论。";
  return null;
};
const announcementCategory = "announcement";
const muteState = (user) => userMute(user);
const whenText = (time) =>
  new Date(time).toLocaleString("zh-CN", { hour12: false });
const mutedNotice = "您已被禁言";
const muteMessage = (state) =>
  `${mutedNotice}，${state.until ? `将于 ${whenText(state.until)} 自动解除，期间` : "解除前"}无法发帖、评论、回复或发送私信。` +
  (state.reason ? `原因：${sentence(state.reason)}` : "");
const lockedNotice = "此帖子已被禁言";
const lockMessage = (post) =>
  `${lockedNotice}。` + (post.lock_reason ? `原因：${sentence(post.lock_reason)}` : "");
const speaking = (req, res, next) => {
  const state = muteState(req.user);
  return state ? res.status(403).json({ error: muteMessage(state) }) : next();
};
const moderatorTitle = (user, categoryId) =>
  isOwner(user)
    ? "站主"
    : isStaff(user)
      ? "管理员"
      : isBoardLead(user, categoryId)
        ? "版主"
        : "协管";
function moderate(actor, { action, post, text, reason = "", before = "", after = "", summary = "", logDetail = null, pinned = true }) {
  act(actor, {
    action,
    role: actorRole(actor, post.category),
    target: { type: "post", id: post.id, label: post.title },
    before,
    after,
    reason,
    summary,
    logDetail,
    notices: post.author_id ? [{ userId: post.author_id, text, postId: post.id, important: pinned }] : [],
  });
}
function purgeComment(c) {
  if (childCount(c.id)) {
    dropAttachments("comment", [c.id]);
    dropQuotes("comment", [c.id]);
    db.prepare("UPDATE comments SET deleted=1,content='',deleted_at=COALESCE(deleted_at,?) WHERE id=?").run(Date.now(), c.id);
    return;
  }
  const gone = subtreeIds(c.id);
  dropAttachments("comment", gone);
  dropQuotes("comment", gone);
  db.prepare("DELETE FROM comments WHERE id=?").run(c.id);
  let parent = c.parent_id;
  while (parent) {
    const above = db
      .prepare("SELECT * FROM comments WHERE id=?")
      .get(parent);
    if (!above?.deleted || above.content || childCount(above.id)) break;
    dropAttachments("comment", [above.id]);
    db.prepare("DELETE FROM comments WHERE id=?").run(above.id);
    parent = above.parent_id;
  }
}
function purgePost(post) {
  const threadIds = db
    .prepare("SELECT id FROM comments WHERE post_id=?")
    .all(post.id)
    .map((c) => c.id);
  dropAttachments("comment", threadIds);
  dropQuotes("comment", threadIds);
  dropAttachments("post", [post.id]);
  dropQuotes("post", [post.id]);
  db.prepare(
    `UPDATE notifications SET post_id=NULL WHERE post_id=? AND kind IN (${governanceKinds.map(() => "?").join(",")})`,
  ).run(post.id, ...governanceKinds);
  db.prepare("DELETE FROM posts WHERE id=?").run(post.id);
}
configureGovernance({ purgePost, purgeComment });
function announceToEveryone(post, actorId) {
  const preview = Array.from(post.excerpt || "").slice(0, 80).join("");
  for (const u of db.prepare("SELECT id FROM users WHERE status='active'").all())
    notify(u.id, {
      kind: "announcement",
      text: post.title,
      actorId,
      postId: post.id,
      pinned: true,
      allowSelf: true,
      dedupeKey: "announcement:" + post.id,
      meta: { preview },
    });
}
function notifyQuoted(ownerType, ownerId, quoteIds, actor, where) {
  for (const id of quoteIds) {
    const quoted = db.prepare("SELECT id,author_id,title FROM posts WHERE id=?").get(id);
    if (!quoted || quoted.author_id === actor.id) continue;
    notify(quoted.author_id, {
      kind: "quote",
      text: `${actor.name} 在「${where.title}」中引用了你的讨论「${quoted.title}」`,
      actorId: actor.id,
      postId: where.id,
      dedupeKey: `quote:${ownerType}:${ownerId}:${quoted.id}`,
    });
  }
}
function startSession(res, user) {
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(token),
    user.id,
    Date.now() + 30 * 86400000,
  );
  res.cookie("nmk_session", token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
const selectPost = `SELECT p.*, u.name AS author_name, u.initials AS author_initials, u.avatar AS author_avatar, u.bio AS author_bio,
(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted=0) AS comments,
(SELECT COUNT(*) FROM post_views v WHERE v.post_id=p.id) AS views,
(SELECT COUNT(*) FROM post_follows pf WHERE pf.post_id=p.id) AS followers,
EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,
EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id=p.id AND b.user_id=?) AS bookmarked
FROM posts p JOIN users u ON u.id=p.author_id`;
const removedPost = (p) =>
  !!p.deleted_at ||
  !!db
    .prepare(
      "SELECT 1 FROM categories WHERE id=? AND deleted_at IS NOT NULL UNION ALL SELECT 1 FROM users WHERE id=? AND status='deleted'",
    )
    .get(p.category, p.author_id);
const formatPost = (p, user = "") => {
  if (removedPost(p)) {
    const later = db
      .prepare("SELECT added_at,completed_at FROM read_later WHERE post_id=? AND user_id=?")
      .get(p.id, user);
    return {
      id: p.id,
      deleted: true,
      author_id: "",
      author_name: "",
      author_initials: "",
      author_avatar: "",
      author_bio: "",
      category: p.category,
      title: "",
      excerpt: "",
      content: "",
      tags: [],
      kind: p.kind,
      likes: 0,
      comments: 0,
      views: 0,
      followers: 0,
      followed: false,
      liked: false,
      bookmarked: !!p.bookmarked,
      collection_ids: [],
      read_later: !!later,
      later_added_at: later?.added_at ?? null,
      completed_at: later?.completed_at ?? null,
      reading_minutes: 1,
      attachments: [],
      quotes: [],
      pinned: false,
      visibility: "public",
      comments_closed: false,
      locked: false,
      lock_reason: "",
      demo: 0,
      created_at: p.created_at,
    };
  }
  const later = db
    .prepare(
      "SELECT added_at,completed_at FROM read_later WHERE post_id=? AND user_id=?",
    )
    .get(p.id, user);
  return {
    ...p,
    author_avatar: p.author_avatar || "",
    tags: JSON.parse(p.tags),
    liked: !!p.liked,
    bookmarked: !!p.bookmarked,
    views: p.views ?? 0,
    followers: p.followers ?? 0,
    followed: !!user && !!db.prepare("SELECT 1 FROM post_follows WHERE post_id=? AND user_id=?").get(p.id, user),
    collection_ids: db
      .prepare(
        "SELECT i.collection_id FROM collection_items i JOIN collections c ON c.id=i.collection_id WHERE i.post_id=? AND c.user_id=?",
      )
      .all(p.id, user)
      .map((i) => i.collection_id),
    read_later: !!later,
    later_added_at: later?.added_at ?? null,
    completed_at: later?.completed_at ?? null,
    reading_minutes: Math.max(1, Math.ceil(Array.from(plainText(p.content, p.format)).length / 400)),
    attachments: listAttachments("post", p.id),
    quotes: listQuotes("post", p.id),
    pinned: !!p.pinned,
    visibility: p.visibility || "public",
    comments_closed: !!p.comments_closed,
    locked: !!p.locked,
    lock_reason: p.lock_reason || "",
  };
};
const getPost = (id, user = "") => {
  const p = db.prepare(selectPost + " WHERE p.id=?").get(user, user, id);
  return p ? formatPost(p, user) : null;
};
const canSeePost = (post, user) =>
  !!post && !post.deleted && (post.visibility === "public" || post.author_id === user);
const getVisiblePost = (id, user = "") => {
  const post = getPost(id, user);
  return canSeePost(post, user) ? post : null;
};
const uploadDir = resolve(dataDir, "uploads");
mkdirSync(uploadDir, { recursive: true });
const uploadTypes = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/zip": "zip",
  "application/x-7z-compressed": "7z",
  "application/vnd.rar": "rar",
  "application/x-tar": "tar",
  "application/gzip": "gz",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};
const uploadLimit = 25 * 1024 * 1024;
const uploadPath = /^\/uploads\/[a-f0-9-]{36}\.[a-z0-9]{1,4}$/;
const validUpload = (url) =>
  uploadPath.test(url) && existsSync(resolve(uploadDir, url.slice(9)));
const attachmentColumns = "id,url,name,mime,size,inline";
const asAttachment = (row) => ({ ...row, inline: !!row.inline });
const listAttachments = (ownerType, ownerId) =>
  db
    .prepare(
      `SELECT ${attachmentColumns} FROM attachments WHERE owner_type=? AND owner_id=? ORDER BY position`,
    )
    .all(ownerType, ownerId)
    .map(asAttachment);
function groupAttachments(ownerType, ownerIds) {
  const grouped = new Map(ownerIds.map((id) => [id, []]));
  if (!ownerIds.length) return grouped;
  db.prepare(
    `SELECT owner_id,${attachmentColumns} FROM attachments WHERE owner_type=? AND owner_id IN (${ownerIds.map(() => "?").join(",")}) ORDER BY position`,
  )
    .all(ownerType, ...ownerIds)
    .forEach(({ owner_id, ...file }) =>
      grouped.get(owner_id)?.push(asAttachment(file)),
    );
  return grouped;
}
const quoteColumns = `SELECT p.id,p.title,p.excerpt,p.category,p.kind,p.created_at,p.demo,p.deleted_at,
  u.name AS author_name,u.initials AS author_initials,u.avatar AS author_avatar,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted=0) AS comments
  FROM posts p JOIN users u ON u.id=p.author_id`;
const asQuote = ({ deleted_at, ...row }) => ({ ...row, author_avatar: row.author_avatar || "" });
const listQuotes = (ownerType, ownerId) =>
  db
    .prepare(
      `${quoteColumns} JOIN quotes q ON q.post_id=p.id
       WHERE q.owner_type=? AND q.owner_id=? AND ${liveClause} ORDER BY q.position`,
    )
    .all(ownerType, ownerId)
    .map(asQuote);
const quoteCards = (ids) => {
  if (!ids.length) return [];
  const rows = db
    .prepare(`${quoteColumns} WHERE p.id IN (${ids.map(() => "?").join(",")}) AND ${liveClause}`)
    .all(...ids)
    .map(asQuote);
  return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
};
function groupQuotes(ownerType, ownerIds) {
  const grouped = new Map(ownerIds.map((id) => [id, []]));
  if (!ownerIds.length) return grouped;
  db.prepare(
    `SELECT q.owner_id,x.* FROM quotes q JOIN (${quoteColumns} WHERE ${liveClause}) x ON x.id=q.post_id
     WHERE q.owner_type=? AND q.owner_id IN (${ownerIds.map(() => "?").join(",")}) ORDER BY q.position`,
  )
    .all(ownerType, ...ownerIds)
    .forEach(({ owner_id, ...row }) => grouped.get(owner_id)?.push(asQuote(row)));
  return grouped;
}
const quotableIds = (list) => {
  if (!Array.isArray(list) || list.length > 5) return null;
  const ids = [...new Set(list)];
  if (ids.some((id) => typeof id !== "string" || !id)) return null;
  return ids.every((id) =>
    db
      .prepare(`SELECT 1 FROM posts p WHERE p.id=? AND p.visibility='public' AND ${liveClause}`)
      .get(id),
  )
    ? ids
    : null;
};
function saveQuotes(ownerType, ownerId, ids = []) {
  db.prepare("DELETE FROM quotes WHERE owner_type=? AND owner_id=?").run(
    ownerType,
    ownerId,
  );
  const insert = db.prepare("INSERT INTO quotes VALUES(?,?,?,?)");
  ids.forEach((id, i) => insert.run(ownerType, ownerId, id, i));
}
function dropQuotes(ownerType, ownerIds) {
  if (!ownerIds.length) return;
  db.prepare(
    `DELETE FROM quotes WHERE owner_type=? AND owner_id IN (${ownerIds.map(() => "?").join(",")})`,
  ).run(ownerType, ...ownerIds);
}
const validAttachments = (list) =>
  Array.isArray(list) &&
  list.every(
    (f) =>
      f &&
      typeof f.url === "string" &&
      uploadPath.test(f.url) &&
      existsSync(resolve(uploadDir, f.url.slice(9))) &&
      validText(f.name, 1, 200) &&
      validText(f.mime, 1, 120) &&
      Number.isInteger(f.size) &&
      f.size > 0 &&
      f.size <= uploadLimit,
  );
function saveAttachments(ownerType, ownerId, userId, list = [], inline = false) {
  db.prepare("DELETE FROM attachments WHERE owner_type=? AND owner_id=?").run(
    ownerType,
    ownerId,
  );
  const insert = db.prepare(
    "INSERT INTO attachments(id,owner_type,owner_id,user_id,url,name,mime,size,position,created_at,inline) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  list.forEach((f, i) =>
    insert.run(
      randomUUID(),
      ownerType,
      ownerId,
      userId,
      f.url,
      f.name.trim().slice(0, 200),
      f.mime.trim(),
      f.size,
      i,
      Date.now(),
      inline ? 1 : 0,
    ),
  );
}
function dropAttachments(ownerType, ownerIds) {
  if (!ownerIds.length) return;
  db.prepare(
    `DELETE FROM attachments WHERE owner_type=? AND owner_id IN (${ownerIds.map(() => "?").join(",")})`,
  ).run(ownerType, ...ownerIds);
}
const subtreeIds = (id) =>
  db
    .prepare(
      `WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT c.id FROM comments c JOIN tree t ON c.parent_id=t.id) SELECT id FROM tree`,
    )
    .all(id)
    .map((r) => r.id);
const selectComments = `SELECT c.*, u.name AS author_name, u.initials AS author_initials, u.avatar AS author_avatar, u.status AS author_status,
(SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id=c.id AND v.value=1) AS likes,
(SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id=c.id AND v.value=-1) AS dislikes,
(SELECT v.value FROM comment_votes v WHERE v.comment_id=c.id AND v.user_id=?) AS my_vote
FROM comments c JOIN users u ON u.id=c.author_id`;
function formatComments(rows) {
  rows = rows.map(({ author_status, delete_reason, deleted_by, deleted_at, ...r }) =>
    author_status === "deleted" ? { ...r, deleted: 1 } : r,
  );
  const live = rows.filter((r) => !r.deleted).map((r) => r.id);
  const files = groupAttachments("comment", live);
  const quotes = groupQuotes("comment", live);
  return rows.map((r) => ({
    ...r,
    parent_id: r.parent_id ?? null,
    deleted: !!r.deleted,
    content: r.deleted ? "" : r.content,
    author_id: r.deleted ? "" : r.author_id,
    author_name: r.deleted ? "" : r.author_name,
    author_initials: r.deleted ? "" : r.author_initials,
    author_avatar: r.deleted ? "" : r.author_avatar || "",
    likes: r.deleted ? 0 : r.likes,
    dislikes: r.deleted ? 0 : r.dislikes,
    my_vote: r.deleted ? 0 : (r.my_vote ?? 0),
    attachments: files.get(r.id) || [],
    quotes: quotes.get(r.id) || [],
  }));
}
function threadOf(postId, user = "") {
  const rows = formatComments(
    db
      .prepare(selectComments + " WHERE c.post_id=? ORDER BY c.created_at")
      .all(user, postId),
  );
  const children = new Map();
  for (const r of rows) {
    if (!r.parent_id) continue;
    if (!children.has(r.parent_id)) children.set(r.parent_id, []);
    children.get(r.parent_id).push(r);
  }
  const memo = new Map();
  const shown = (r, depth = 0) => {
    if (memo.has(r.id)) return memo.get(r.id);
    const value = !r.deleted || (depth < 64 && (children.get(r.id) || []).some((c) => shown(c, depth + 1)));
    memo.set(r.id, value);
    return value;
  };
  return rows.filter((r) => shown(r));
}
const getComment = (id, user = "") => {
  const row = db.prepare(selectComments + " WHERE c.id=?").get(user, id);
  return row ? formatComments([row])[0] : null;
};
const commentDepth = (id) =>
  db
    .prepare(
      `WITH RECURSIVE up(id,parent_id,n) AS (SELECT id,parent_id,1 FROM comments WHERE id=?
       UNION ALL SELECT c.id,c.parent_id,up.n+1 FROM comments c JOIN up ON c.id=up.parent_id)
       SELECT MAX(n) AS n FROM up`,
    )
    .get(id).n;
const childCount = (id) =>
  db.prepare("SELECT COUNT(*) AS n FROM comments WHERE parent_id=?").get(id).n;
installAssistant(app, { auth, liveClause });
installLibrary(app, {
  db,
  dataDir,
  auth,
  getPost: getVisiblePost,
  visibleClause,
  libraryClause,
  selectPost,
  formatPost,
  hasCategory,
});
installSearch(app, { db, selectPost, formatPost, visibleClause, hasCategory });
installPersonalSearch(app, { db, auth, selectPost, formatPost, visibleClause, libraryClause });
installBoards(app, { auth, validText, speaking });
installProfiles(app, { auth, validText, validUpload });
installFeedPrefs(app, { db, auth, hasCategory });
installDrafts(app, {
  db,
  auth,
  validText,
  validAttachments,
  quotableIds,
  quoteCards,
  postFormat,
  summarize: (...args) => summarize(...args),
});
installNotifications(app, { auth });
installGovernance(app, { auth });
installInsights(app, { auth, liveClause });
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/me", (req, res) => {
  muteState(req.user);
  return res.json({
    user: publicUser(req.user),
    profile: req.user ? profileOf(req.user.id) : null,
    follows: req.user
      ? db
          .prepare("SELECT category FROM follows WHERE user_id=?")
          .all(req.user.id)
          .map((x) => x.category)
      : [],
    unread: req.user ? unreadCount(req.user.id) : 0,
    subscriptions: req.user
      ? subscriptionsOf(req.user.id)
      : { authors: [], boards: [] },
  });
});
const nameTaken = (name, exceptId = "") =>
  !!db
    .prepare("SELECT 1 FROM users WHERE name=? COLLATE NOCASE AND id<>?")
    .get(name.trim(), exceptId);
const nameTakenReply = {
  error: "此用户名已存在，请换一个。",
  code: "name_taken",
};
app.get("/api/auth/name-available", (req, res) => {
  const name = req.query.name;
  if (!validText(name, 2, 24))
    return res.status(400).json({ error: "用户名需为 2–24 字。" });
  res.set("Cache-Control", "no-store");
  res.json({ available: !nameTaken(name, req.user?.id) });
});
app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (
    !validText(name, 2, 24) ||
    !validText(email, 5, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !validText(password, 8, 128)
  )
    return res
      .status(400)
      .json({ error: "请填写有效邮箱、2–24 字昵称，以及 8–128 位密码。" });
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email.trim()))
    return res.status(409).json({ error: "这个邮箱已注册，请直接登录。" });
  if (nameTaken(name)) return res.status(409).json(nameTakenReply);
  const id = randomUUID();
  const hashed = await hashPassword(password);
  if (nameTaken(name)) return res.status(409).json(nameTakenReply);
  try {
    db.prepare(
      "INSERT INTO users (id,email,name,initials,password,role,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      email.trim().toLowerCase(),
      name.trim(),
      name.trim().slice(0, 2).toUpperCase(),
      hashed,
      "member",
      Date.now(),
    );
  } catch (e) {
    if (e.code?.includes("CONSTRAINT"))
      return res.status(409).json({ error: "这个邮箱已注册。" });
    throw e;
  }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!validText(email, 1, 254) || !validText(password, 1, 128))
    return res.status(400).json({ error: "请填写邮箱和密码。" });
  const findLive = () => db.prepare(
    "SELECT * FROM users WHERE email=?1 OR name=?1 COLLATE NOCASE OR id=?1 COLLATE NOCASE ORDER BY (email=?1) DESC LIMIT 1",
  ).get(email.trim());
  const findFormer = () => db.prepare(
    "SELECT password FROM deleted_accounts WHERE email=?1 OR name=?1 COLLATE NOCASE OR id=?1 COLLATE NOCASE ORDER BY deleted_at DESC LIMIT 1",
  ).get(email.trim());
  const initialUser = findLive();
  const former = !initialUser && findFormer();
  const credential = initialUser?.password || former?.password;
  if (!(await checkPassword(password, credential)))
    return res.status(401).json({ error: "账号或密码不正确。" });
  const user = findLive();
  if (!user) {
    if (findFormer()?.password === credential)
      return res.status(403).json({ error: "您的帐户已被删除" });
    return res.status(401).json({ error: "账号或密码不正确。" });
  }
  if (user.id !== initialUser?.id || user.password !== credential)
    return res.status(401).json({ error: "账号或密码不正确。" });
  if (user.status === "deleted")
    return res.status(403).json({ error: "您的帐户已被删除" });
  if (user.status !== "active")
    return res.status(403).json({ error: "此账号已被停用，请联系站主。" });
  startSession(res, user);
  res.json({ user: publicUser(user) });
});
app.post("/api/auth/logout", (req, res) => {
  const token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nmk_session="))
    ?.slice(12);
  if (token)
    db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
  res.clearCookie("nmk_session", {
    path: "/",
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
  });
  res.json({ ok: true });
});
installAccountDeletion(app, { auth, authLimiter, checkPassword, secureCookies });
app.patch("/api/me", auth, (req, res) => {
  const { name, bio, avatar = req.user.avatar || "", email = req.user.email } =
    req.body;
  if (!validText(name, 2, 24) || typeof bio !== "string" || bio.length > 160)
    return res
      .status(400)
      .json({ error: "昵称需为 2–24 字，简介最多 160 字。" });
  if (
    typeof avatar !== "string" ||
    (avatar && !validUpload(avatar))
  )
    return res.status(400).json({ error: "头像图片无效，请重新上传。" });
  if (
    !validText(email, 5, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    return res.status(400).json({ error: "请填写有效的邮箱地址。" });
  if (name.trim() !== req.user.name && nameTaken(name, req.user.id))
    return res.status(409).json(nameTakenReply);
  const address = email.trim().toLowerCase();
  if (
    address !== (req.user.email || "").toLowerCase() &&
    db
      .prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE AND id<>?")
      .get(address, req.user.id)
  )
    return res.status(409).json({ error: "这个邮箱已被其他账号使用。" });
  db.prepare(
    "UPDATE users SET name=?,initials=?,bio=?,avatar=?,email=? WHERE id=?",
  ).run(
    name.trim(),
    name.trim().slice(0, 2).toUpperCase(),
    bio.trim(),
    avatar,
    address,
    req.user.id,
  );
  res.json({
    user: publicUser(
      db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
    ),
  });
});
app.post("/api/categories/:id/follow", auth, (req, res) => {
  if (!hasCategory(req.params.id))
    return res.status(404).json({ error: "版块不存在。" });
  const exists = db
    .prepare("SELECT 1 FROM follows WHERE user_id=? AND category=?")
    .get(req.user.id, req.params.id);
  if (exists)
    db.prepare("DELETE FROM follows WHERE user_id=? AND category=?").run(req.user.id, req.params.id);
  else
    db.prepare("INSERT INTO follows(user_id,category,created_at) VALUES(?,?,?)").run(
      req.user.id,
      req.params.id,
      Date.now(),
    );
  res.json({ followed: !exists });
});
app.get("/api/me/following", auth, (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id,u.name,u.initials,u.avatar,u.bio,f.created_at AS since
       FROM user_follows f JOIN users u ON u.id=f.target_id
       WHERE f.follower_id=? AND u.status='active'
       ORDER BY f.created_at DESC, u.name`,
    )
    .all(req.user.id);
  const boards = db
    .prepare(
      `SELECT c.id,c.name,c.en,c.description,c.icon,f.created_at AS since,
              (SELECT COUNT(*) AS n FROM posts p WHERE p.category=c.id AND p.visibility='public' AND ${liveClause}) AS posts,
              (SELECT COUNT(*) AS n FROM follows f2 WHERE f2.category=c.id) AS followers
       FROM follows f JOIN categories c ON c.id=f.category
       WHERE f.user_id=? AND c.deleted_at IS NULL
       ORDER BY f.created_at DESC, c.position, c.name`,
    )
    .all(req.user.id);
  res.json({ users, boards });
});
app.get("/api/stats", (_req, res) =>
  res.json({
    posts: db
      .prepare(`SELECT COUNT(*) AS n FROM posts p WHERE p.visibility='public' AND ${liveClause}`)
      .get().n,
    members: db.prepare("SELECT COUNT(*) AS n FROM users WHERE demo=0 AND status<>'deleted'").get().n,
    comments: db
      .prepare(`SELECT COUNT(*) AS n FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.deleted=0 AND ${liveClause}`)
      .get().n,
    demo: !!db.prepare("SELECT 1 FROM posts WHERE demo=1 LIMIT 1").get(),
  }),
);
const recentScopes = ["search", "quote", "share"];
function rememberRecent(userId, scope, value, label = "") {
  if (!userId || !value) return;
  db.prepare(
    `INSERT INTO recents(user_id,scope,value,label,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(user_id,scope,value) DO UPDATE SET label=excluded.label,updated_at=excluded.updated_at`,
  ).run(userId, scope, String(value).slice(0, 200), String(label).slice(0, 120), Date.now());
  db.prepare(
    `DELETE FROM recents WHERE user_id=? AND scope=? AND pinned=0 AND value NOT IN
      (SELECT value FROM recents WHERE user_id=? AND scope=? AND pinned=0 ORDER BY updated_at DESC,rowid DESC LIMIT 20)`,
  ).run(userId, scope, userId, scope);
}
const recentRows = (userId, scope) => {
  const rows = db
    .prepare(
      "SELECT value,label,updated_at,pinned FROM recents WHERE user_id=? AND scope=? ORDER BY pinned DESC,updated_at DESC,rowid DESC",
    )
    .all(userId, scope)
    .map((r) => ({ ...r, pinned: !!r.pinned }));
  if (scope !== "share") return rows;
  return rows
    .map((r) => {
      const person = db
        .prepare(
          "SELECT id,name,initials,avatar,bio FROM users WHERE id=? AND status='active'",
        )
        .get(r.value);
      return person
        ? { ...r, label: person.name, user: { ...person, avatar: person.avatar || "" } }
        : null;
    })
    .filter(Boolean);
};
app.get("/api/recents/:scope", auth, (req, res) => {
  if (!recentScopes.includes(req.params.scope))
    return res.status(404).json({ error: "没有这种记录。" });
  res.json({ items: recentRows(req.user.id, req.params.scope) });
});
app.post("/api/recents/:scope", auth, (req, res) => {
  if (!recentScopes.includes(req.params.scope))
    return res.status(404).json({ error: "没有这种记录。" });
  if (!validText(req.body?.value, 1, 200))
    return res.status(400).json({ error: "无效的记录。" });
  rememberRecent(
    req.user.id,
    req.params.scope,
    req.body.value.trim(),
    typeof req.body.label === "string" ? req.body.label : "",
  );
  res.json({ items: recentRows(req.user.id, req.params.scope) });
});
app.delete("/api/recents/:scope", auth, (req, res) => {
  if (!recentScopes.includes(req.params.scope))
    return res.status(404).json({ error: "没有这种记录。" });
  const { values, all } = req.body || {};
  if (all === true)
    db.prepare("DELETE FROM recents WHERE user_id=? AND scope=? AND pinned=0").run(
      req.user.id,
      req.params.scope,
    );
  else {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 200 ||
      values.some((v) => typeof v !== "string")
    )
      return res.status(400).json({ error: "请先选择要删除的记录。" });
    db.prepare(
      `DELETE FROM recents WHERE user_id=? AND scope=? AND value IN (${values
        .map(() => "?")
        .join(",")})`,
    ).run(req.user.id, req.params.scope, ...values);
  }
  res.json({ items: recentRows(req.user.id, req.params.scope) });
});
const pinScopes = ["search"];
const maxPinned = 30;
app.patch("/api/recents/:scope", auth, (req, res) => {
  if (!pinScopes.includes(req.params.scope))
    return res.status(404).json({ error: "这里的记录不能收藏。" });
  const { values, pinned } = req.body || {};
  if (
    typeof pinned !== "boolean" ||
    !Array.isArray(values) ||
    !values.length ||
    values.length > 200 ||
    values.some((v) => !validText(v, 1, 200))
  )
    return res.status(400).json({ error: "请先选择要收藏的关键词。" });
  const scope = req.params.scope,
    list = [...new Set(values.map((v) => v.trim()))];
  if (pinned) {
    const already = new Set(
      db
        .prepare("SELECT value FROM recents WHERE user_id=? AND scope=? AND pinned=1")
        .all(req.user.id, scope)
        .map((r) => r.value),
    );
    if (already.size + list.filter((v) => !already.has(v)).length > maxPinned)
      return res
        .status(400)
        .json({ error: `最多收藏 ${maxPinned} 个关键词，先取消几个再试。` });
  }
  const pin = db.prepare(
      `INSERT INTO recents(user_id,scope,value,label,updated_at,pinned) VALUES(?,?,?,'',?,1)
       ON CONFLICT(user_id,scope,value) DO UPDATE SET pinned=1`,
    ),
    unpin = db.prepare(
      "UPDATE recents SET pinned=0 WHERE user_id=? AND scope=? AND value=?",
    );
  db.exec("BEGIN");
  try {
    for (const value of list)
      if (pinned) pin.run(req.user.id, scope, value, Date.now());
      else unpin.run(req.user.id, scope, value);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ items: recentRows(req.user.id, scope) });
});
app.get("/api/members", auth, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const rows = db
    .prepare(
      `SELECT id,name,initials,avatar,bio FROM users
       WHERE status='active' AND id<>?
       ${q ? "AND (instr(lower(name),lower(?))>0 OR instr(lower(id),lower(?))>0)" : ""}
       ORDER BY name LIMIT 20`,
    )
    .all(...(q ? [req.user.id, q, q] : [req.user.id]));
  res.json({ members: rows.map((r) => ({ ...r, avatar: r.avatar || "" })) });
});
app.delete("/api/history", auth, (req, res) => {
  const { ids, all } = req.body || {};
  if (all === true)
    db.prepare("DELETE FROM history WHERE user_id=?").run(req.user.id);
  else {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== "string")
    )
      return res.status(400).json({ error: "请先选择要删除的记录。" });
    db.prepare(
      `DELETE FROM history WHERE user_id=? AND post_id IN (${ids
        .map(() => "?")
        .join(",")})`,
    ).run(req.user.id, ...ids);
  }
  res.json({
    total: db
      .prepare("SELECT COUNT(*) AS n FROM history WHERE user_id=?")
      .get(req.user.id).n,
  });
});
const bodyTextError = (content, attachments, quotes, min, max, hint) => {
  if (content.length > max) return hint;
  if (!content && (attachments.length || quotes.length)) return null;
  return content.length < min ? hint : null;
};
const richBody = (content, format) =>
  format === "html" && !plainText(content, "html") && !hasRichMedia(content) ? "" : content;
const cleanKeywords = (tags) => {
  const seen = new Set();
  return tags
    .map((t) => t.trim().replace(/^#+/, "").trim())
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
const stripMarkup = (content) =>
  content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const summarize = (content, quotes, attachments, format = "markdown") => {
  const text = plainText(content, format).slice(0, 150);
  if (text) return text;
  const first = quotes[0]
    ? db.prepare("SELECT title FROM posts WHERE id=?").get(quotes[0])?.title
    : null;
  if (first) return `引用了讨论「${first}」`;
  return attachments.length ? `分享了 ${attachments.length} 个附件` : "";
};
app.get("/api/posts", (req, res) => {
  const user = req.user?.id || "";
  const { category, q, sort, view, kind, author } = req.query;
  const boundary = (value) => {
    const time = parseInt(value, 10);
    return Number.isFinite(time) && time > 0 ? time : null;
  };
  const from = boundary(req.query.from);
  const to = boundary(req.query.to);
  const minComments = Math.max(
    0,
    Math.min(10000, parseInt(req.query.minComments, 10) || 0),
  );
  const conditions = [["bookmarks", "history"].includes(view) ? libraryClause : visibleClause];
  const args = [user, user, user];
  if (category && hasCategory(category)) {
    conditions.push("p.category=?");
    args.push(category);
  }
  if (q && typeof q === "string") {
    conditions.push("(p.title LIKE ? OR p.content LIKE ? OR p.tags LIKE ?)");
    const s = "%" + q.slice(0, 120) + "%";
    args.push(s, s, s);
  }
  if (kind === "project") conditions.push("p.kind='project'");
  if (kind === "announcement") conditions.push("p.kind='announcement'");
  if (author && typeof author === "string") {
    conditions.push("p.author_id=?");
    args.push(author);
  }
  if (["bookmarks", "history", "following", "mine"].includes(view) && !req.user)
    return res.status(401).json({ error: "请先登录。" });
  if (view === "bookmarks") {
    conditions.push(
      "EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id=p.id AND b.user_id=?)",
    );
    args.push(user);
  }
  if (view === "history") {
    conditions.push(
      "EXISTS(SELECT 1 FROM history h WHERE h.post_id=p.id AND h.user_id=?)",
    );
    args.push(user);
  }
  if (view === "following") {
    conditions.push(
      "EXISTS(SELECT 1 FROM follows f WHERE f.category=p.category AND f.user_id=?)",
    );
    args.push(user);
  }
  if (view === "mine") {
    conditions.push("p.author_id=?");
    args.push(user);
  }
  const pinFirst =
    !category && !["bookmarks", "history", "following", "mine"].includes(view);
  const hideAnnouncements = pinFirst && !!req.user && kind !== "announcement";
  if (hideAnnouncements) {
    conditions.push(
      "NOT (p.kind='announcement' AND EXISTS(SELECT 1 FROM hidden_announcements ha WHERE ha.post_id=p.id AND ha.user_id=?))",
    );
    args.push(user);
  }
  if (sort === "unanswered")
    conditions.push(
      (pinFirst ? "(p.kind='announcement' OR " : "(") +
        "NOT EXISTS(SELECT 1 FROM comments c WHERE c.post_id=p.id))",
    );
  if (from !== null) {
    conditions.push("p.created_at>=?");
    args.push(from);
  }
  if (to !== null) {
    conditions.push("p.created_at<=?");
    args.push(to);
  }
  if (minComments > 0) {
    conditions.push(
      "(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted=0)>=?",
    );
    args.push(minComments);
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const pinStrict = ["comments", "unanswered"].includes(sort);
  const orderings = {
    __proto__: null,
    hot: " (likes*3+comments*5) DESC,p.created_at DESC,p.rowid DESC",
    comments: " comments DESC,p.created_at DESC,p.rowid DESC",
    likes: " likes DESC,p.created_at DESC,p.rowid DESC",
    views: " views DESC,p.created_at DESC,p.rowid DESC",
    old: " p.created_at ASC,p.rowid ASC",
  };
  let order =
    (pinFirst ? " (p.kind='announcement') DESC," + (pinStrict ? "" : " p.pinned DESC,") : " ") +
    (orderings[sort] || " p.created_at DESC,p.rowid DESC");
  if (view === "history") {
    order =
      " (SELECT seen_at FROM history WHERE post_id=p.id AND user_id=?) DESC,p.rowid DESC";
  }
  const offset = Math.max(0, Math.min(100000, parseInt(req.query.offset) || 0));
  const limit = 12;
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM posts p" + where)
    .get(...args.slice(2)).n;
  if (view === "history") args.push(user);
  const posts = db
    .prepare(selectPost + where + " ORDER BY" + order + " LIMIT ? OFFSET ?")
    .all(...args, limit, offset)
    .map((p) => formatPost(p, user));
  const hiddenAnnouncements =
    hideAnnouncements && !offset && !q
      ? db
          .prepare(
            selectPost +
              " WHERE " + visibleClause +
              " AND p.kind='announcement' AND EXISTS(SELECT 1 FROM hidden_announcements ha WHERE ha.post_id=p.id AND ha.user_id=?)" +
              " ORDER BY p.created_at DESC,p.rowid DESC LIMIT 50",
          )
          .all(user, user, user, user)
          .map((p) => formatPost(p, user))
      : [];
  res.json({ posts, total, hasMore: offset + posts.length < total, hiddenAnnouncements });
});
app.get("/api/posts/:id", (req, res) => {
  const found = getPost(req.params.id, req.user?.id);
  if (found?.deleted)
    return res.status(404).json({ error: "该内容已被删除", deleted: true });
  const post = canSeePost(found, req.user?.id) ? found : null;
  if (!post)
    return res.status(404).json({ error: "这篇讨论不存在或已被删除。" });
  res.json({ post, comments: threadOf(post.id, req.user?.id ?? "") });
});
const visitorOf = (req, res) => {
  if (req.user) return "u:" + req.user.id;
  let token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nmk_visitor="))
    ?.slice(12);
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    token = randomBytes(16).toString("hex");
    res.cookie("nmk_visitor", token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 365 * 86400000,
      path: "/",
    });
  }
  return "v:" + digest(token);
};
app.post("/api/posts/:id/view", (req, res) => {
  const post = getVisiblePost(req.params.id, req.user?.id);
  if (!post) return res.status(404).json({ error: "讨论不存在。" });
  const now = Date.now();
  if (post.author_id !== req.user?.id)
    db.prepare("INSERT OR IGNORE INTO post_views(post_id,viewer,viewed_at) VALUES(?,?,?)").run(post.id, visitorOf(req, res), now);
  if (req.user)
    db.prepare(
      "INSERT INTO history VALUES(?,?,?) ON CONFLICT(user_id,post_id) DO UPDATE SET seen_at=excluded.seen_at",
    ).run(req.user.id, post.id, now);
  res.json({ views: db.prepare("SELECT COUNT(*) AS n FROM post_views WHERE post_id=?").get(post.id).n });
});
app.post("/api/posts/:id/follow", auth, (req, res) => {
  const post = getVisiblePost(req.params.id, req.user.id);
  if (!post) return res.status(404).json({ error: "讨论不存在。" });
  if (post.author_id === req.user.id) return res.status(400).json({ error: "不能关注自己的讨论。" });
  if (post.followed)
    db.prepare("DELETE FROM post_follows WHERE user_id=? AND post_id=?").run(req.user.id, post.id);
  else
    db.prepare("INSERT OR IGNORE INTO post_follows(user_id,post_id,created_at) VALUES(?,?,?)").run(req.user.id, post.id, Date.now());
  res.json({ post: getPost(post.id, req.user.id) });
});
app.patch("/api/posts/:id/settings", auth, (req, res) => {
  const post = getPost(req.params.id, req.user.id);
  if (!post || post.deleted) return res.status(404).json({ error: "讨论不存在。" });
  if (post.author_id !== req.user.id) return res.status(403).json({ error: "只有作者可以修改这些设置。" });
  const visibility = req.body?.visibility ?? post.visibility;
  const commentsClosed = req.body?.comments_closed ?? post.comments_closed;
  if (post.kind === "announcement" && visibility !== "public")
    return res.status(400).json({ error: "公告需要保持公开。" });
  const settingsError = validSettings(visibility, commentsClosed);
  if (settingsError) return res.status(400).json({ error: settingsError });
  db.prepare("UPDATE posts SET visibility=?,comments_closed=? WHERE id=?").run(visibility, commentsClosed ? 1 : 0, post.id);
  const updated = getPost(post.id, req.user.id);
  if (post.visibility !== "public" && updated.visibility === "public")
    deliverPost(updated, { mentions: mentionedUsers(updated.title + "\n" + plainText(updated.content, updated.format)) });
  res.json({ post: updated });
});
app.post("/api/posts/:id/read", auth, (req, res) => {
  if (!getVisiblePost(req.params.id, req.user.id))
    return res.status(404).json({ error: "讨论不存在。" });
  db.prepare(
    "INSERT INTO history VALUES(?,?,?) ON CONFLICT(user_id,post_id) DO UPDATE SET seen_at=excluded.seen_at",
  ).run(req.user.id, req.params.id, Date.now());
  res.json({ ok: true });
});
app.post("/api/posts", auth, speaking, (req, res) => {
  const {
    title,
    category,
    tags = [],
    kind = "discussion",
    attachments = [],
    visibility = "public",
    comments_closed = false,
    inline_images = false,
  } = req.body;
  const format = postFormat(req.body.format);
  const content = richBody(
    typeof req.body.content === "string" ? req.body.content.trim() : "",
    format,
  );
  const quotes = quotableIds(req.body.quotes ?? []);
  if (!quotes)
    return res.status(400).json({ error: "引用的讨论不存在或未公开。" });
  if (kind === "announcement" && !isOwner(req.user))
    return res.status(403).json({ error: "只有站主可以发布公告。" });
  const board = kind === "announcement" ? announcementCategory : category;
  const range = kind === "announcement" ? "public" : visibility;
  const settingsError = validSettings(range, comments_closed);
  if (settingsError) return res.status(400).json({ error: settingsError });
  if (
    !validText(title, 1, 200) ||
    (kind !== "announcement" && !hasCategory(board)) ||
    !Array.isArray(tags) ||
    tags.length > 5 ||
    tags.some((t) => !validText(t, 1, 20)) ||
    !["discussion", "project", "announcement"].includes(kind)
  )
    return res.status(400).json({
      error: "请填写标题；关键词最多 5 个，每个 1–20 字。",
    });
  if (!validAttachments(attachments))
    return res.status(400).json({ error: "附件信息有误，请重新上传。" });
  const textError = bodyTextError(
    content,
    attachments,
    quotes,
    1,
    200000,
    "请写下正文，或至少添加一个附件或引用。",
  );
  if (textError) return res.status(400).json({ error: textError });
  const silenced = kind === "announcement" ? null : boardMute(board);
  if (silenced) return res.status(403).json({ error: silenced.message });
  const id = randomUUID();
  const excerpt = summarize(content, quotes, attachments, format);
  db.prepare(
    "INSERT INTO posts(id,author_id,category,title,excerpt,content,tags,kind,created_at,pinned,visibility,comments_closed,format) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    req.user.id,
    board,
    title.trim(),
    excerpt,
    content,
    JSON.stringify(cleanKeywords(tags)),
    kind,
    Date.now(),
    kind === "announcement" ? 1 : 0,
    range,
    comments_closed ? 1 : 0,
    format,
  );
  saveAttachments("post", id, req.user.id, attachments, inline_images === true);
  saveQuotes("post", id, quotes);
  if (kind !== "announcement") joinBoard(board, req.user.id);
  const created = getPost(id, req.user.id);
  if (kind === "announcement") announceToEveryone(created, req.user.id);
  else if (range === "public") {
    deliverPost(created, { mentions: mentionedUsers(title + "\n" + plainText(content, format)) });
    notifyQuoted("post", id, quotes, req.user, created);
  }
  res.status(201).json({ post: created });
});
app.patch("/api/posts/:id", auth, speaking, (req, res) => {
  const existing = getPost(req.params.id);
  if (!existing || existing.deleted) return res.status(404).json({ error: "讨论不存在。" });
  if (
    existing.author_id !== req.user.id &&
    !canModerateBoard(req.user, existing.category)
  )
    return res.status(403).json({ error: "你只能编辑自己的讨论。" });
  const {
    title,
    category,
    tags = [],
    kind = "discussion",
    attachments = [],
    visibility = existing.visibility,
    comments_closed = existing.comments_closed,
    inline_images = false,
  } = req.body;
  const format = postFormat(req.body.format ?? existing.format);
  const content = richBody(
    typeof req.body.content === "string" ? req.body.content.trim() : "",
    format,
  );
  const quotes = quotableIds(req.body.quotes ?? []);
  if (!quotes)
    return res.status(400).json({ error: "引用的讨论不存在或未公开。" });
  const nextKind = existing.kind === "announcement" ? "announcement" : kind;
  if (nextKind === "announcement" && !isOwner(req.user))
    return res.status(403).json({ error: "只有站主可以编辑公告。" });
  const board =
    nextKind === "announcement" ? announcementCategory : category;
  const range = nextKind === "announcement" ? "public" : visibility;
  const settingsError = validSettings(range, comments_closed);
  if (settingsError) return res.status(400).json({ error: settingsError });
  if (
    !validText(title, 1, 200) ||
    (nextKind !== "announcement" && !hasCategory(board)) ||
    !Array.isArray(tags) ||
    tags.length > 5 ||
    tags.some((t) => !validText(t, 1, 20)) ||
    !["discussion", "project", "announcement"].includes(nextKind)
  )
    return res.status(400).json({
      error: "请填写标题；关键词最多 5 个，每个 1–20 字。",
    });
  if (!validAttachments(attachments))
    return res.status(400).json({ error: "附件信息有误，请重新上传。" });
  const textError = bodyTextError(
    content,
    attachments,
    quotes,
    1,
    200000,
    "请写下正文，或至少添加一个附件或引用。",
  );
  if (textError) return res.status(400).json({ error: textError });
  const silenced = board !== existing.category ? boardMute(board) : null;
  if (silenced) return res.status(403).json({ error: silenced.message });
  const excerpt = summarize(content, quotes, attachments, format);
  db.prepare(
    "UPDATE posts SET title=?,content=?,excerpt=?,category=?,tags=?,kind=?,visibility=?,comments_closed=?,format=? WHERE id=?",
  ).run(
    title.trim(),
    content,
    excerpt,
    board,
    JSON.stringify(cleanKeywords(tags)),
    nextKind,
    range,
    comments_closed ? 1 : 0,
    format,
    existing.id,
  );
  saveAttachments(
    "post",
    existing.id,
    req.user.id,
    attachments,
    inline_images === true,
  );
  saveQuotes("post", existing.id, quotes);
  const updated = getPost(existing.id, req.user.id);
  if (existing.visibility !== "public" && updated.visibility === "public")
    deliverPost(updated, { mentions: mentionedUsers(updated.title + "\n" + plainText(updated.content, updated.format)) });
  if (existing.author_id !== req.user.id && nextKind !== "announcement") {
    const actorTitle = moderatorTitle(req.user, existing.category);
    const moved = existing.category !== updated.category;
    const closedChanged = existing.comments_closed !== updated.comments_closed;
    const boardName = (id) =>
      db.prepare("SELECT name FROM categories WHERE id=?").get(id)?.name || id;
    moderate(req.user, {
      action: moved ? "move_post" : closedChanged ? (updated.comments_closed ? "close_comments" : "open_comments") : "edit_post",
      post: existing,
      before: moved ? boardName(existing.category) : closedChanged ? (existing.comments_closed ? "评论已关闭" : "评论开放") : "原内容",
      after: moved ? boardName(updated.category) : closedChanged ? (updated.comments_closed ? "评论已关闭" : "评论开放") : "已编辑",
      summary: moved
        ? `把讨论「${updated.title}」移动到了「${boardName(updated.category)}」`
        : closedChanged
          ? `${updated.comments_closed ? "关闭" : "重新开放"}了讨论「${updated.title}」的评论`
          : `编辑了讨论「${updated.title}」`,
      logDetail: moved
        ? `${existing.title} · ${boardName(existing.category)} → ${boardName(updated.category)}`
        : existing.title,
      pinned: false,
      text: moved
        ? `${actorTitle}将你的讨论「${updated.title}」从「${boardName(existing.category)}」移动到了「${boardName(updated.category)}」。`
        : closedChanged
          ? `${actorTitle}${updated.comments_closed ? "关闭" : "重新开放"}了你的讨论「${updated.title}」的评论区。`
          : `${actorTitle}编辑了你的讨论「${updated.title}」。\n如有疑问，可以回复这条消息询问。`,
    });
  }
  res.json({ post: updated });
});
app.delete("/api/posts/:id", auth, handle((req) => {
  requestOrRemove(req.user, "post", req.params.id, { reason: req.body?.reason || "" });
  return { ok: true };
}));
app.post("/api/posts/:id/like", auth, (req, res) => {
  const post = getVisiblePost(req.params.id, req.user.id);
  if (!post) return res.status(404).json({ error: "讨论不存在。" });
  const exists = db
    .prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?")
    .get(req.user.id, post.id);
  if (exists)
    db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(req.user.id, post.id);
  else
    db.prepare("INSERT INTO likes(user_id,post_id,created_at) VALUES(?,?,?)").run(
      req.user.id,
      post.id,
      Date.now(),
    );
  if (!exists)
    notify(post.author_id, {
      kind: "like",
      text: `${req.user.name} 赞同了你的讨论「${post.title}」`,
      actorId: req.user.id,
      postId: post.id,
      dedupeKey: `like:${post.id}:${req.user.id}`,
      meta: { reasons: ["like"] },
    });
  res.json({ post: getPost(post.id, req.user.id) });
});
app.post("/api/posts/:id/comments", auth, speaking, (req, res) => {
  const { parent_id = null, attachments = [], inline_images = false } = req.body;
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!validAttachments(attachments))
    return res.status(400).json({ error: "附件信息有误，请重新上传。" });
  const quotes = quotableIds(req.body.quotes ?? []);
  if (!quotes)
    return res.status(400).json({ error: "引用的讨论不存在或未公开。" });
  const textError = bodyTextError(
    content,
    attachments,
    quotes,
    2,
    5000,
    "回复需为 2–5000 字，或至少添加一个附件或引用。",
  );
  if (textError) return res.status(400).json({ error: textError });
  const post = getVisiblePost(req.params.id, req.user.id);
  if (!post) return res.status(404).json({ error: "讨论不存在。" });
  if (post.comments_closed)
    return res.status(403).json({ error: "作者已关闭这篇讨论的评论。" });
  if (post.locked) return res.status(403).json({ error: lockMessage(post) });
  const silenced = boardMute(post.category);
  if (silenced) return res.status(403).json({ error: silenced.message });
  let parent = null;
  if (parent_id != null) {
    parent = db
      .prepare("SELECT * FROM comments WHERE id=? AND post_id=?")
      .get(parent_id, post.id);
    if (!parent || parent.deleted) return res.status(404).json({ error: "要回复的评论不存在。" });
    if (commentDepth(parent.id) >= 12)
      return res
        .status(400)
        .json({ error: "回复层级过深，请回到上层评论继续讨论。" });
  }
  const id = randomUUID();
  db.prepare(
    "INSERT INTO comments(id,post_id,author_id,content,created_at,parent_id) VALUES(?,?,?,?,?,?)",
  ).run(id, post.id, req.user.id, content, Date.now(), parent?.id ?? null);
  saveAttachments(
    "comment",
    id,
    req.user.id,
    attachments,
    inline_images === true,
  );
  saveQuotes("comment", id, quotes);
  joinBoard(post.category, req.user.id);
  const replied = parent && !parent.deleted ? parent.author_id : post.author_id;
  const preview = Array.from(stripMarkup(content)).slice(0, 80).join("");
  const mentioned = post.visibility === "public" ? mentionedUsers(content) : [];
  if (replied !== req.user.id)
    notify(replied, {
      kind: "reply",
      text: parent
        ? `${req.user.name} 回复了你在「${post.title}」下的评论`
        : `${req.user.name} 回复了你的讨论「${post.title}」`,
      actorId: req.user.id,
      postId: post.id,
      dedupeKey: "comment:" + id,
      meta: { reasons: mentioned.includes(replied) ? ["reply", "mention"] : ["reply"], preview },
    });
  if (post.author_id !== replied && post.author_id !== req.user.id)
    notify(post.author_id, {
      kind: "reply",
      text: `${req.user.name} 在你的讨论「${post.title}」下发表了回复`,
      actorId: req.user.id,
      postId: post.id,
      dedupeKey: "comment:" + id,
      meta: { reasons: mentioned.includes(post.author_id) ? ["reply", "mention"] : ["reply"], preview },
    });
  for (const person of mentioned)
    notify(person, {
      kind: "mention",
      text: `${req.user.name} 在「${post.title}」的回复中提到了你`,
      actorId: req.user.id,
      postId: post.id,
      dedupeKey: "comment:" + id,
      meta: { reasons: ["mention"], preview },
    });
  const reached = new Set([req.user.id, replied, post.author_id, ...mentioned]);
  for (const { user_id } of db.prepare("SELECT user_id FROM post_follows WHERE post_id=?").all(post.id))
    if (!reached.has(user_id))
      notify(user_id, {
        kind: "reply",
        text: `${req.user.name} 在你关注的讨论「${post.title}」下发表了回复`,
        actorId: req.user.id,
        postId: post.id,
        dedupeKey: "comment:" + id,
        meta: { reasons: ["reply"], preview },
      });
  if (post.visibility === "public")
    notifyQuoted("comment", id, quotes, req.user, post);
  res.status(201).json({
    comment: getComment(id, req.user.id),
    post: getPost(post.id, req.user.id),
  });
});
app.post("/api/comments/:id/vote", auth, (req, res) => {
  const value = Number(req.body?.value);
  if (![1, -1, 0].includes(value))
    return res.status(400).json({ error: "无效的操作。" });
  const c = db
    .prepare(
      "SELECT c.id,c.deleted,c.author_id,c.content,c.post_id,p.title FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?",
    )
    .get(req.params.id);
  if (!c || c.deleted)
    return res.status(404).json({ error: "回复不存在。" });
  const previousVote = db
    .prepare("SELECT value FROM comment_votes WHERE user_id=? AND comment_id=?")
    .get(req.user.id, c.id)?.value;
  if (value === 0)
    db.prepare("DELETE FROM comment_votes WHERE user_id=? AND comment_id=?").run(
      req.user.id,
      c.id,
    );
  else
    db.prepare(
      "INSERT INTO comment_votes(user_id,comment_id,value,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,comment_id) DO UPDATE SET value=excluded.value,created_at=excluded.created_at",
    ).run(req.user.id, c.id, value, Date.now());
  if (value !== 0 && value !== previousVote)
    notify(c.author_id, {
      kind: "vote",
      text: `${req.user.name} ${value === 1 ? "赞同" : "不赞同"}你在「${c.title}」下的评论`,
      actorId: req.user.id,
      postId: c.post_id,
      dedupeKey: `vote:${c.id}:${req.user.id}:${value}`,
      meta: {
        reasons: [value === 1 ? "like" : "dislike"],
        preview: Array.from(stripMarkup(c.content)).slice(0, 80).join(""),
      },
    });
  res.json({ comment: getComment(c.id, req.user.id) });
});
app.delete("/api/comments/:id", auth, handle((req) => {
  const c = db.prepare("SELECT post_id FROM comments WHERE id=?").get(req.params.id);
  requestOrRemove(req.user, "comment", req.params.id, { reason: req.body?.reason || "" });
  return { ok: true, post: getPost(c.post_id, req.user.id) };
}));
function notificationGroups(userId) {
  const rows = db
    .prepare(
      `SELECT n.*, u.name AS actor_name, u.initials AS actor_initials, u.avatar AS actor_avatar
       FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
       WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 200`,
    )
    .all(userId);
  const groups = [];
  const byKey = new Map();
  for (const r of rows) {
    const notice = formatNotice(r);
    const item = {
      id: r.id,
      post_id: r.post_id,
      text: tidyNotice(r.text),
      seen: r.seen,
      kind: r.kind,
      pinned: r.pinned,
      saved: r.saved,
      created_at: r.created_at,
      board: notice.board,
      topic: notice.topic,
      reasons: notice.reasons,
      preview: notice.preview,
      important: notice.important,
      ref_type: notice.ref_type,
      ref_id: notice.ref_id,
      state: notice.state,
      detail: notice.detail,
      result: notice.result,
    };
    const base = {
      kind: r.kind,
      actor_id: r.actor_id,
      actor_name: r.actor_name || "Naimakes",
      actor_initials: r.actor_initials || "NMK",
      actor_avatar: r.actor_avatar || "",
      board: notice.board,
      topic: notice.topic,
    };
    if (r.kind === "announcement" || governanceKinds.includes(r.kind) || !r.actor_id) {
      groups.push({ ...base, key: r.id, items: [item] });
      continue;
    }
    const key =
      r.kind === "board_post" && notice.board
        ? "board-" + notice.board.id
        : r.kind === "topic_post" && notice.topic
          ? `topic-${notice.topic.kind}:${notice.topic.value}`
          : r.kind === "author_post"
            ? "posts-" + r.actor_id
            : "actor-" + r.actor_id;
    let group = byKey.get(key);
    if (!group) {
      group = { ...base, key, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups
    .map((g) => ({
      ...g,
      unread: g.items.filter((i) => !i.seen).length,
      pinned: g.items.some((i) => i.pinned) ? 1 : 0,
      saved: g.items.some((i) => i.saved) ? 1 : 0,
      urgent: governanceKinds.includes(g.kind) && g.items.some((i) => i.important && (!i.seen || i.state === "pending")) ? 1 : 0,
      latest_at: g.items[0].created_at,
    }))
    .sort((a, b) => b.urgent - a.urgent || b.pinned - a.pinned || b.latest_at - a.latest_at);
}
function adminChannels(user) {
  if (!isStaff(user)) return null;
  const count = (where) =>
    db
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(seen=0),0) AS unread FROM notifications WHERE user_id=? AND ${where}`)
      .get(user.id);
  return {
    requests: count("kind='admin_request' AND state='pending'"),
    appeals: count("kind='appeal' AND state='pending'"),
    actions: count("kind='admin_action'"),
    system: count("kind='system_event'"),
    handled: count("state='handled' AND kind IN ('admin_request','appeal')"),
  };
}
app.get("/api/notifications", auth, (req, res) =>
  res.json({ groups: notificationGroups(req.user.id), channels: adminChannels(req.user) }),
);
app.patch("/api/notifications", auth, (req, res) => {
  db.prepare("UPDATE notifications SET seen=1 WHERE user_id=?").run(
    req.user.id,
  );
  res.json({ ok: true });
});
app.post("/api/notifications/batch", auth, (req, res) => {
  const { ids, action, all } = req.body;
  if (!["pin", "unpin", "save", "unsave", "delete"].includes(action))
    return res.status(400).json({ error: "无效的操作。" });
  const statement = {
    pin: "UPDATE notifications SET pinned=1",
    unpin: "UPDATE notifications SET pinned=0",
    save: "UPDATE notifications SET saved=1",
    unsave: "UPDATE notifications SET saved=0",
    delete: "DELETE FROM notifications",
  }[action];
  const keepPending = action === "delete" ? " AND state<>'pending'" : "";
  if (all === true) db.prepare(`${statement} WHERE user_id=?${keepPending}`).run(req.user.id);
  else {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== "string")
    )
      return res.status(400).json({ error: "无效的操作。" });
    db.prepare(
      `${statement} WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})${keepPending}`,
    ).run(req.user.id, ...ids);
  }
  res.json({ groups: notificationGroups(req.user.id), channels: adminChannels(req.user) });
});
const messageColumns = `SELECT m.*, u.name AS sender_name, u.initials AS sender_initials, u.avatar AS sender_avatar
  FROM messages m JOIN users u ON u.id=m.sender_id`;
const threadState = (userId, peerId) =>
  db
    .prepare("SELECT * FROM message_threads WHERE user_id=? AND peer_id=?")
    .get(userId, peerId) || { pinned: 0, saved: 0, cleared_at: 0 };
const formatMessages = (rows, userId) => {
  const ids = rows.map((r) => r.id);
  const files = groupAttachments("message", ids);
  const quotes = groupQuotes("message", ids);
  return rows.map((r) => ({
    ...r,
    mine: r.sender_id === userId,
    attachments: files.get(r.id) || [],
    quotes: quotes.get(r.id) || [],
    share: shareCard(r.share, userId),
  }));
};
app.get("/api/messages", auth, (req, res) => {
  const me = req.user.id;
  const peers = db
    .prepare(
      `SELECT peer, MAX(created_at) AS latest_at FROM (
         SELECT recipient_id AS peer, created_at FROM messages WHERE sender_id=?
         UNION ALL
         SELECT sender_id AS peer, created_at FROM messages WHERE recipient_id=?
       ) GROUP BY peer`,
    )
    .all(me, me);
  for (const t of db
    .prepare("SELECT * FROM message_threads WHERE user_id=?")
    .all(me))
    if (!peers.some((p) => p.peer === t.peer_id) && (t.pinned || t.saved))
      peers.push({ peer: t.peer_id, latest_at: 0 });
  const threads = peers
    .map(({ peer }) => {
      const person = db
        .prepare("SELECT id,name,initials,avatar FROM users WHERE id=?")
        .get(peer);
      if (!person) return null;
      const state = threadState(me, peer);
      const last = db
        .prepare(
          `${messageColumns} WHERE ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))
           AND m.created_at>? ORDER BY m.created_at DESC LIMIT 1`,
        )
        .get(me, peer, peer, me, state.cleared_at);
      return {
        peer: person,
        pinned: state.pinned,
        saved: state.saved,
        last: last ? formatMessages([last], me)[0] : null,
        unread: db
          .prepare(
            "SELECT COUNT(*) AS n FROM messages WHERE recipient_id=? AND sender_id=? AND read_at IS NULL AND created_at>?",
          )
          .get(me, peer, state.cleared_at).n,
        latest_at: last?.created_at ?? 0,
      };
    })
    .filter((t) => t && (t.last || t.pinned || t.saved))
    .sort((a, b) => b.pinned - a.pinned || b.latest_at - a.latest_at);
  res.json({ threads });
});
app.get("/api/messages/:peer", auth, (req, res) => {
  const me = req.user.id;
  const person = db
    .prepare("SELECT id,name,initials,avatar,bio FROM users WHERE id=?")
    .get(req.params.peer);
  if (!person) return res.status(404).json({ error: "这位成员不存在。" });
  const state = threadState(me, person.id);
  const rows = db
    .prepare(
      `${messageColumns} WHERE ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))
       AND m.created_at>? ORDER BY m.created_at LIMIT 300`,
    )
    .all(me, person.id, person.id, me, state.cleared_at);
  db.prepare(
    "UPDATE messages SET read_at=? WHERE recipient_id=? AND sender_id=? AND read_at IS NULL",
  ).run(Date.now(), me, person.id);
  res.json({
    peer: person,
    pinned: state.pinned,
    saved: state.saved,
    messages: formatMessages(rows, me),
  });
});
app.post("/api/messages/:peer", auth, speaking, (req, res) => {
  const { attachments = [], inline_images = false } = req.body;
  const content =
    typeof req.body.content === "string" ? req.body.content.trim() : "";
  const person = db
    .prepare("SELECT id,name FROM users WHERE id=? AND status='active'")
    .get(req.params.peer);
  if (!person) return res.status(404).json({ error: "这位成员不存在。" });
  if (person.id === req.user.id)
    return res.status(400).json({ error: "不能给自己发送私信。" });
  if (!validAttachments(attachments))
    return res.status(400).json({ error: "附件信息有误，请重新上传。" });
  const quotes = quotableIds(req.body.quotes ?? []);
  if (!quotes)
    return res.status(400).json({ error: "引用的讨论不存在或未公开。" });
  const shared = prepareShare(req.user, req.body.share);
  if (shared.error) return res.status(400).json({ error: shared.error });
  const textError = bodyTextError(
    content,
    attachments,
    shared.stored ? [...quotes, shared.stored] : quotes,
    1,
    5000,
    "请输入内容，或至少添加一个附件或引用（最多 5000 字）。",
  );
  if (textError) return res.status(400).json({ error: textError });
  const id = randomUUID();
  db.prepare(
    "INSERT INTO messages(id,sender_id,recipient_id,content,created_at,share) VALUES(?,?,?,?,?,?)",
  ).run(id, req.user.id, person.id, content, Date.now(), shared.stored);
  saveAttachments(
    "message",
    id,
    req.user.id,
    attachments,
    inline_images === true,
  );
  saveQuotes("message", id, quotes);
  if (quotes.length || shared.stored) rememberRecent(req.user.id, "share", person.id, person.name);
  db.prepare(
    "UPDATE message_threads SET cleared_at=0 WHERE user_id=? AND peer_id=?",
  ).run(person.id, req.user.id);
  const row = db.prepare(messageColumns + " WHERE m.id=?").get(id);
  publishMessage(row, req.user);
  res.status(201).json({ message: formatMessages([row], req.user.id)[0] });
});
app.post("/api/messages/:peer/state", auth, (req, res) => {
  const { pinned, saved } = req.body;
  if (
    (pinned !== undefined && typeof pinned !== "boolean") ||
    (saved !== undefined && typeof saved !== "boolean")
  )
    return res.status(400).json({ error: "无效的操作。" });
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(req.params.peer))
    return res.status(404).json({ error: "这位成员不存在。" });
  const state = threadState(req.user.id, req.params.peer);
  db.prepare(
    `INSERT INTO message_threads(user_id,peer_id,pinned,saved,cleared_at) VALUES(?,?,?,?,?)
     ON CONFLICT(user_id,peer_id) DO UPDATE SET pinned=excluded.pinned,saved=excluded.saved`,
  ).run(
    req.user.id,
    req.params.peer,
    (pinned ?? !!state.pinned) ? 1 : 0,
    (saved ?? !!state.saved) ? 1 : 0,
    state.cleared_at,
  );
  res.json({ ok: true });
});
app.delete("/api/messages", auth, (req, res) => {
  const { peers, all } = req.body || {};
  const targets =
    all === true
      ? db
          .prepare(
            `SELECT DISTINCT peer FROM (
               SELECT recipient_id AS peer FROM messages WHERE sender_id=?
               UNION SELECT sender_id AS peer FROM messages WHERE recipient_id=?
               UNION SELECT peer_id AS peer FROM message_threads WHERE user_id=?)`,
          )
          .all(req.user.id, req.user.id, req.user.id)
          .map((r) => r.peer)
      : peers;
  if (
    !Array.isArray(targets) ||
    targets.length > 500 ||
    targets.some((id) => typeof id !== "string")
  )
    return res.status(400).json({ error: "请先选择要删除的对话。" });
  const clear = db.prepare(
    `INSERT INTO message_threads(user_id,peer_id,cleared_at) VALUES(?,?,?)
     ON CONFLICT(user_id,peer_id) DO UPDATE SET cleared_at=excluded.cleared_at,pinned=0,saved=0`,
  );
  const now = Date.now();
  for (const peer of new Set(targets)) clear.run(req.user.id, peer, now);
  res.json({ ok: true });
});
app.delete("/api/messages/:peer", auth, (req, res) => {
  db.prepare(
    `INSERT INTO message_threads(user_id,peer_id,cleared_at) VALUES(?,?,?)
     ON CONFLICT(user_id,peer_id) DO UPDATE SET cleared_at=excluded.cleared_at,pinned=0,saved=0`,
  ).run(req.user.id, req.params.peer, Date.now());
  res.json({ ok: true });
});
app.delete("/api/messages/item/:id", auth, (req, res) => {
  const m = db.prepare("SELECT * FROM messages WHERE id=?").get(req.params.id);
  if (!m) return res.status(404).json({ error: "这条私信不存在。" });
  if (m.sender_id !== req.user.id && !isStaff(req.user))
    return res.status(403).json({ error: "你只能删除自己发送的私信。" });
  dropAttachments("message", [m.id]);
  dropQuotes("message", [m.id]);
  db.prepare("DELETE FROM messages WHERE id=?").run(m.id);
  res.json({ ok: true });
});
const legacyComplaint = (type) =>
  handle((req) => {
    const { category = "other", detail, reason } = req.body || {};
    const text = typeof detail === "string" ? detail : typeof reason === "string" ? reason : "";
    if (category === "other" && !validText(text, 2, 1000))
      throw new GovernanceError(400, "请填写 2–1000 字投诉原因。");
    fileComplaint(req.user, type, req.params.id, { category, detail: text });
    return { ok: true };
  });
app.post("/api/posts/:id/report", auth, legacyComplaint("post"));
app.post("/api/comments/:id/report", auth, legacyComplaint("comment"));
app.post("/api/me/mute-appeal", auth, handle((req, res) => {
  const appeal = fileAppeal(req.user, "user", req.user.id, req.body?.reason);
  res.status(201).json({ appeal });
}));
app.patch("/api/admin/posts/:id/lock", auth, (req, res) => {
  const { locked, reason = "" } = req.body;
  if (typeof locked !== "boolean")
    return res.status(400).json({ error: "请选择禁言还是解除这篇帖子的禁言。" });
  if (typeof reason !== "string" || reason.length > 200)
    return res.status(400).json({ error: "处理说明最多 200 字。" });
  const post = getPost(req.params.id);
  if (!post || post.deleted) return res.status(404).json({ error: "讨论不存在。" });
  if (!canModerateBoard(req.user, post.category))
    return res.status(403).json({ error: "需要本版块的管理权限。" });
  if (isAdmin(req.user) && !boardRoleOf(req.user.id, post.category)) {
    const conflict = conflictOf(req.user, loadTarget("post", post.id));
    if (conflict) return res.status(403).json({ error: conflict });
  }
  const note = reason.trim();
  db.prepare("UPDATE posts SET locked=?,lock_reason=? WHERE id=?").run(
    locked ? 1 : 0,
    locked ? note : "",
    post.id,
  );
  moderate(req.user, {
    action: locked ? "lock_post" : "unlock_post",
    post,
    before: post.locked ? "帖子禁言" : "正常",
    after: locked ? "帖子禁言" : "正常",
    reason: note,
    summary: `${locked ? "禁言了" : "解除了"}讨论「${post.title}」${locked ? "" : "的禁言"}`,
    logDetail: post.title + (locked && note ? " · " + note : ""),
    text: locked
      ? `${moderatorTitle(req.user, post.category)}对你的讨论「${post.title}」设置了禁言。` +
        noteLine("原因", note) +
        "\n这篇讨论暂停接收新评论，已有内容保持不变；你在其他讨论下的发言不受影响。"
      : `${moderatorTitle(req.user, post.category)}解除了你的讨论「${post.title}」的禁言，现在可以继续评论了。`,
  });
  res.json({ post: getPost(post.id, req.user.id) });
});
app.post(
  "/api/uploads",
  auth,
  rateLimit({
    windowMs: 3600000,
    limit: 200,
    message: { error: "上传次数过多，请稍后再试。" },
  }),
  (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer?.length)
      return res.status(400).json({ error: "没有收到文件内容。" });
    if (buffer.length > uploadLimit)
      return res.status(400).json({ error: "单个文件不能大于 25MB。" });
    const mime = (req.get("content-type") || "").split(";")[0].trim();
    let name = "";
    try {
      name = decodeURIComponent(req.get("x-file-name") || "");
    } catch {
      name = "";
    }
    name = name.replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 200);
    const known = uploadTypes[mime];
    const head = buffer.subarray(0, 12).toString("hex");
    const signatures = {
      png: head.startsWith("89504e470d0a1a0a"),
      jpeg: head.startsWith("ffd8ff"),
      gif: /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1")),
      webp:
        buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
        buffer.subarray(8, 12).toString("latin1") === "WEBP",
    };
    if (known in signatures && !signatures[known])
      return res.status(400).json({ error: "图片格式与文件内容不一致。" });
    const file = randomUUID() + "." + (known || "bin");
    writeFileSync(resolve(uploadDir, file), buffer);
    res.status(201).json({
      url: "/uploads/" + file,
      name: name || "附件." + (known || "bin"),
      mime: known ? mime : "application/octet-stream",
      size: buffer.length,
    });
  },
);
app.use(
  "/uploads",
  express.static(uploadDir, {
    maxAge: "1y",
    immutable: true,
    dotfiles: "deny",
    setHeaders(res, path) {
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (path.endsWith(".bin"))
        res.setHeader("Content-Type", "application/octet-stream");
    },
  }),
);
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在。" }));
const distDir = fromRoot("dist");
const hasProductionBuild = existsSync(resolve(distDir, "index.html"));
if (production && !hasProductionBuild)
  throw new Error("Production build is missing. Run npm run build before npm start.");
if (hasProductionBuild) {
  const hashedAsset = /[.-][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;
  const cacheHeaders = (res, file) => {
    if (/(?:index\.html|landing\.html|loading-screen\.js)$/.test(file))
      res.setHeader("Cache-Control", "no-cache");
    else if (production && hashedAsset.test(file))
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  };
  app.use(
    express.static(distDir, {
      maxAge: production ? "1h" : 0,
      setHeaders: cacheHeaders,
    }),
  );
  app.use(["/assets", "/uploads", "/loading-screen.js", "/favicon.svg"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.status(404).type("text/plain").send("Resource not found.");
  });
  app.get("/{*splat}", (req, res) => {
    if (/\.[a-z0-9]{1,8}$/i.test(req.path))
      return res.status(404).set("Cache-Control", "no-cache").type("text/plain").send("Resource not found.");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(resolve(distDir, "index.html"));
  });
}
app.use((err, _req, res, _next) => {
  if (err.type === "entity.too.large")
    return res
      .status(413)
      .json({ error: "提交内容过大，单个文件请控制在 25MB 以内。" });
  if (err instanceof SyntaxError)
    return res.status(400).json({ error: "请求格式不正确。" });
  console.error(err);
  res.status(500).json({ error: "暂时无法完成操作，请稍后重试。" });
});
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, process.env.HOST || "0.0.0.0", (error) => {
  if (error) {
    console.error(error.code === "EADDRINUSE"
      ? `Cannot start Naimakes: port ${port} is already in use. Stop the existing service or choose another PORT.`
      : `Cannot start Naimakes: ${error.message}`);
    db.close();
    process.exitCode = 1;
    return;
  }
  console.log(`Naimakes server ready: http://localhost:${server.address().port}`);
});
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  closeAllStreams();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  }, 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
