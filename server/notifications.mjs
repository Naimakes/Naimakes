import { randomUUID, createHash } from "node:crypto";
import { db } from "./database.mjs";
import { shareCard, sharePreview } from "./sharing.mjs";

const notificationOptions = [
  { id: "letters", label: "私信提醒", hint: "有人给你发私信时实时提醒；关闭后私信照常送达，只是不再弹窗", popupOnly: true },
  { id: "author", label: "作者新帖提醒", hint: "你用铃铛订阅的作者发布新帖时通知你" },
  { id: "board", label: "版块新帖提醒", hint: "你用铃铛订阅的版块出现新帖时通知你" },
  { id: "topic", label: "追踪话题提醒", hint: "你追踪的关键词或版块出现新帖时通知你" },
  { id: "reply", label: "评论 / 回复提醒", hint: "有人评论你的讨论、回复你的评论，或在你的讨论下回复他人时通知你" },
  { id: "mention", label: "@提及提醒", hint: "有人在讨论或回复里 @ 你时通知你" },
  { id: "interaction", label: "互动提醒", hint: "有人关注你、赞同你的讨论，或赞同 / 不赞同你的评论时通知你" },
  { id: "announcement", label: "系统公告", hint: "站主发布的全站公告；关闭后仍保存在消息中心，只是不再弹窗", popupOnly: true },
  { id: "moderation", label: "管理操作通知", hint: "禁言、内容处理、权限与账号变动、举报结果等重要站务，无法关闭", locked: true },
  { id: "other", label: "其他站内通知", hint: "例如你的讨论被站内其他讨论引用" },
];
const optionById = new Map(notificationOptions.map((o) => [o.id, o]));
const defaultPrefs = Object.fromEntries(notificationOptions.map((o) => [o.id, true]));
const kindCategory = {
  __proto__: null,
  message: "letters",
  author_post: "author",
  board_post: "board",
  topic_post: "topic",
  reply: "reply",
  mention: "mention",
  follow: "interaction",
  like: "interaction",
  vote: "interaction",
  announcement: "announcement",
  moderation: "moderation",
  appeal: "moderation",
  admin_request: "moderation",
  admin_action: "moderation",
  system_event: "moderation",
  quote: "other",
};
export const governanceKinds = ["moderation", "appeal", "admin_request", "admin_action", "system_event"];
const categoryOf = (kind) => kindCategory[kind] || "other";
const postReasons = ["mention", "author", "board", "topic"];
const reasonKind = { mention: "mention", author: "author_post", board: "board_post", topic: "topic_post" };

const trailing = /[\s。．.，,、；;：:！!？?]+$/u;
export const clause = (text) => String(text ?? "").trim().replace(trailing, "");
export const sentence = (text) => {
  const body = clause(text);
  if (!body) return "";
  const end = String(text).trim().match(/[！？!?]$/u)?.[0];
  return body + (end ? end.replace("!", "！").replace("?", "？") : "。");
};
export const noteLine = (label, text) => (clause(text) ? `\n${label}：${sentence(text)}` : "");
export function tidyNotice(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/([。，、；：！？])\1+/gu, "$1")
    .replace(/[，、；：]+([。！？])/gu, "$1")
    .replace(/([。！？])[，、；。]+/gu, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const readJson = (text, fallback) => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
};
function prefsOf(userId) {
  const row = db.prepare("SELECT prefs FROM notification_settings WHERE user_id=?").get(userId);
  const saved = readJson(row?.prefs, {});
  const prefs = { ...defaultPrefs };
  for (const option of notificationOptions)
    if (typeof saved[option.id] === "boolean" && !option.locked) prefs[option.id] = saved[option.id];
  return prefs;
}
const enabledFor = (prefs, category) => optionById.get(category)?.locked || prefs[category] !== false;

export function unreadCount(userId) {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND seen=0").get(userId).n +
    db.prepare(
      `SELECT COUNT(*) AS n FROM messages m WHERE m.recipient_id=? AND m.read_at IS NULL
       AND m.created_at > COALESCE((SELECT cleared_at FROM message_threads t WHERE t.user_id=m.recipient_id AND t.peer_id=m.sender_id),0)`,
    ).get(userId).n
  );
}

const streams = new Map();
const streamLimit = 6;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const write = (res, event, data) => {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
};
function publish(userId, notice, { silent = false, update = false } = {}) {
  const set = streams.get(userId);
  if (!set?.size) return;
  const payload = { notice, silent, update, unread: unreadCount(userId) };
  for (const stream of set) write(stream.res, "notice", payload);
}
export function closeUserStreams(userId) {
  for (const stream of streams.get(userId) || []) stream.res.end();
}
export function closeAllStreams() {
  for (const set of streams.values()) for (const stream of set) stream.res.end();
}
const sessionAlive = db.prepare(
  "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.status='active'",
);
setInterval(() => {
  for (const set of streams.values())
    for (const stream of set) {
      if (!sessionAlive.get(stream.token, Date.now())) stream.res.end();
      else
        try {
          stream.res.write(": ping\n\n");
        } catch {}
    }
}, 25000).unref();

const selectNotice = `SELECT n.*, u.name AS actor_name, u.initials AS actor_initials, u.avatar AS actor_avatar,
  p.title AS post_title, p.category AS post_category, p.deleted_at AS post_deleted_at
  FROM notifications n LEFT JOIN users u ON u.id=n.actor_id LEFT JOIN posts p ON p.id=n.post_id`;
const boardCard = (id) => {
  if (!id) return null;
  const board = db.prepare("SELECT id,name,icon FROM categories WHERE id=?").get(id);
  return board || null;
};
export function formatNotice(row) {
  const meta = readJson(row.meta, {});
  return {
    id: row.id,
    kind: row.kind,
    text: tidyNotice(row.text),
    created_at: row.created_at,
    seen: row.seen,
    pinned: row.pinned,
    saved: row.saved,
    post_id: row.post_id,
    actor: row.actor_id && row.actor_name
      ? { id: row.actor_id, name: row.actor_name, initials: row.actor_initials, avatar: row.actor_avatar || "" }
      : null,
    post: row.post_id && row.post_title && !row.post_deleted_at ? { id: row.post_id, title: row.post_title, category: row.post_category } : null,
    board: boardCard(meta.board),
    topic: meta.topic || null,
    reasons: Array.isArray(meta.reasons) ? meta.reasons : [],
    preview: typeof meta.preview === "string" ? meta.preview : "",
    ...governanceFields(row, meta),
  };
}
function governanceFields(row, meta = readJson(row.meta, {})) {
  return {
    important: row.important ? 1 : 0,
    ref_type: row.ref_type || "",
    ref_id: row.ref_id || "",
    state: row.state || "",
    detail: meta.detail && typeof meta.detail === "object" ? meta.detail : null,
    result: typeof meta.result === "string" ? meta.result : "",
  };
}
const noticeById = (id) => {
  const row = db.prepare(selectNotice + " WHERE n.id=?").get(id);
  return row ? formatNotice(row) : null;
};

const insertNotice = db.prepare(
  `INSERT OR IGNORE INTO notifications(id,user_id,post_id,text,created_at,kind,actor_id,pinned,dedupe_key,meta,important,ref_type,ref_id,state)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
export function notify(userId, { kind, text, actorId = null, postId = null, pinned = false, dedupeKey = null, meta = {}, allowSelf = false, important = null, refType = "", refId = "", state = "", quiet = false }) {
  if (!userId || (!allowSelf && actorId && userId === actorId)) return null;
  const category = categoryOf(kind);
  const enabled = enabledFor(prefsOf(userId), category);
  if (!enabled && !optionById.get(category)?.popupOnly) return null;
  const id = randomUUID();
  const weighty = important ?? (kind === "moderation" || kind === "announcement");
  const result = insertNotice.run(
    id, userId, postId, tidyNotice(text), Date.now(), kind, actorId, pinned ? 1 : 0, dedupeKey, JSON.stringify(meta),
    weighty ? 1 : 0, refType, refId, state,
  );
  if (!result.changes) return null;
  const notice = noticeById(id);
  if (notice) publish(userId, notice, { silent: !enabled || quiet });
  return id;
}
export function settleNotices(refType, refId, result, outcome = "已处理") {
  const rows = db
    .prepare("SELECT id,user_id,text,meta FROM notifications WHERE ref_type=? AND ref_id=? AND state='pending'")
    .all(refType, refId);
  for (const row of rows) {
    const meta = readJson(row.meta, {});
    meta.result = result;
    if (meta.detail && typeof meta.detail === "object") meta.detail = { ...meta.detail, result };
    db.prepare("UPDATE notifications SET state='handled',meta=?,text=? WHERE id=?").run(
      JSON.stringify(meta),
      tidyNotice(`${row.text}\n当前状态：${outcome}。`),
      row.id,
    );
    const notice = noticeById(row.id);
    if (notice) publish(row.user_id, notice, { silent: true, update: true });
  }
  return rows.length;
}

function messageNotice(message, sender) {
  const quote = db.prepare(
    "SELECT p.title FROM quotes q JOIN posts p ON p.id=q.post_id WHERE q.owner_type='message' AND q.owner_id=? ORDER BY q.position LIMIT 1",
  ).get(message.id);
  const files = db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner_type='message' AND owner_id=?").get(message.id).n;
  const text = String(message.content || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: "message:" + message.id,
    kind: "message",
    text: `${sender.name} 给你发来私信`,
    created_at: message.created_at,
    seen: 0,
    pinned: 0,
    saved: 0,
    post_id: null,
    important: 0,
    ref_type: "",
    ref_id: "",
    state: "",
    detail: null,
    result: "",
    actor: { id: sender.id, name: sender.name, initials: sender.initials, avatar: sender.avatar || "" },
    post: null,
    board: null,
    topic: null,
    reasons: [],
    peer_id: sender.id,
    preview:
      Array.from(text).slice(0, 80).join("") ||
      (quote ? `分享了「${quote.title}」` : message.share ? sharePreview(shareCard(message.share, message.recipient_id)) : files ? `发来 ${files} 个附件` : ""),
  };
}
export function publishMessage(message, sender) {
  publish(message.recipient_id, messageNotice(message, sender), {
    silent: !enabledFor(prefsOf(message.recipient_id), "letters"),
  });
}

const mentionPattern = /(?<![\p{L}\p{N}_.])@([^\s@，。、,.!！?？:：;；()（）\[\]【】「」《》"'<>]{1,24})/gu;
export function mentionedUsers(text) {
  const names = new Set();
  for (const match of String(text || "").matchAll(mentionPattern)) {
    names.add(match[1]);
    if (names.size >= 10) break;
  }
  const find = db.prepare("SELECT id FROM users WHERE status='active' AND (name=? COLLATE NOCASE OR id=? COLLATE NOCASE)");
  const ids = new Set();
  for (const name of names) {
    const row = find.get(name, name);
    if (row) ids.add(row.id);
  }
  return [...ids];
}

const topicLabel = (track) =>
  track.kind === "category" ? db.prepare("SELECT name FROM categories WHERE id=?").get(track.value)?.name || track.value : track.value;
export function deliverPost(post, { mentions = [] } = {}) {
  if (!post || post.visibility !== "public" || post.kind === "announcement" || post.deleted_at) return 0;
  const recipients = new Map();
  const add = (userId, reason, extra) => {
    if (!userId || userId === post.author_id) return;
    const entry = recipients.get(userId) || { reasons: new Set(), topic: null };
    entry.reasons.add(reason);
    if (extra?.topic && !entry.topic) entry.topic = extra.topic;
    recipients.set(userId, entry);
  };
  for (const row of db.prepare("SELECT user_id FROM notify_subscriptions WHERE kind='author' AND target_id=?").all(post.author_id))
    add(row.user_id, "author");
  for (const row of db.prepare("SELECT user_id FROM notify_subscriptions WHERE kind='board' AND target_id=?").all(post.category))
    add(row.user_id, "board");
  const tags = JSON.stringify(Array.isArray(post.tags) ? post.tags : []);
  for (const track of db.prepare(
    `SELECT user_id,kind,value FROM topic_tracks
     WHERE (kind='category' AND value=?)
        OR (kind='keyword' AND (instr(lower(?),lower(value))>0 OR instr(lower(?),lower(value))>0 OR instr(lower(?),lower(value))>0))
     ORDER BY created_at`,
  ).all(post.category, post.title, post.content, tags))
    add(track.user_id, "topic", { topic: { kind: track.kind, value: track.value, label: topicLabel(track) } });
  for (const id of mentions) add(id, "mention");
  if (!recipients.size) return 0;
  const active = db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'");
  const author = db.prepare("SELECT name FROM users WHERE id=?").get(post.author_id)?.name || "一位成员";
  const board = db.prepare("SELECT name FROM categories WHERE id=?").get(post.category)?.name || "版块";
  const preview = Array.from(post.excerpt || "").slice(0, 80).join("");
  let delivered = 0;
  for (const [userId, entry] of recipients) {
    if (!active.get(userId)) continue;
    const prefs = prefsOf(userId);
    const reasons = postReasons.filter((r) => entry.reasons.has(r) && enabledFor(prefs, r));
    if (!reasons.length) continue;
    const kind = reasonKind[reasons[0]];
    const text = {
      mention: `${author} 在讨论「${post.title}」中提到了你`,
      author_post: `${author} 发布了新帖「${post.title}」`,
      board_post: `「${board}」有新帖：${post.title}`,
      topic_post: `你追踪的话题「${entry.topic?.label || ""}」有新帖：${post.title}`,
    }[kind];
    if (
      notify(userId, {
        kind,
        text,
        actorId: post.author_id,
        postId: post.id,
        dedupeKey: "post:" + post.id,
        meta: { reasons, board: post.category, topic: entry.topic, preview },
      })
    )
      delivered++;
  }
  return delivered;
}

export function subscriptionsOf(userId) {
  const rows = db.prepare("SELECT kind,target_id FROM notify_subscriptions WHERE user_id=? ORDER BY created_at").all(userId);
  return {
    authors: rows.filter((r) => r.kind === "author").map((r) => r.target_id),
    boards: rows.filter((r) => r.kind === "board").map((r) => r.target_id),
  };
}
export function installNotifications(app, { auth }) {
  const fail = (res, status, error) => res.status(status).json({ error });

  app.get("/api/notifications/stream", auth, (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("nmk_session="))
      ?.slice(12);
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    req.socket.setKeepAlive?.(true);
    const set = streams.get(req.user.id) || new Set();
    streams.set(req.user.id, set);
    if (set.size >= streamLimit) set.values().next().value?.res.end();
    const stream = { res, token: digest(token || "") };
    set.add(stream);
    res.write(":" + " ".repeat(2048) + "\n\n");
    write(res, "ready", { unread: unreadCount(req.user.id) });
    const cleanup = () => {
      set.delete(stream);
      if (!set.size) streams.delete(req.user.id);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

  app.get("/api/notifications/live", auth, (req, res) => {
    const floor = Date.now() - 10 * 60000;
    const after = Math.max(floor, Number.parseInt(req.query.after, 10) || floor);
    const prefs = prefsOf(req.user.id);
    const notices = db
      .prepare(selectNotice + " WHERE n.user_id=? AND n.created_at>? ORDER BY n.created_at DESC LIMIT 20")
      .all(req.user.id, after)
      .map((row) => ({
        notice: formatNotice(row),
        silent: !enabledFor(prefs, categoryOf(row.kind)) || ["admin_action", "system_event"].includes(row.kind),
      }));
    const letters = db
      .prepare(
        `SELECT m.*, u.id AS uid, u.name, u.initials, u.avatar FROM messages m JOIN users u ON u.id=m.sender_id
         WHERE m.recipient_id=? AND m.created_at>? AND m.read_at IS NULL ORDER BY m.created_at DESC LIMIT 20`,
      )
      .all(req.user.id, after)
      .map((m) => ({
        notice: messageNotice(m, { id: m.uid, name: m.name, initials: m.initials, avatar: m.avatar }),
        silent: !enabledFor(prefs, "letters"),
      }));
    res.json({
      items: [...notices, ...letters].sort((a, b) => a.notice.created_at - b.notice.created_at),
      unread: unreadCount(req.user.id),
      now: Date.now(),
    });
  });

  app.post("/api/notifications/read", auth, (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string"))
      return fail(res, 400, "无效的操作。");
    if (ids.length)
      db.prepare(`UPDATE notifications SET seen=1 WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`).run(
        req.user.id,
        ...ids,
      );
    res.json({ unread: unreadCount(req.user.id) });
  });

  app.get("/api/me/notification-settings", auth, (req, res) =>
    res.json({ settings: prefsOf(req.user.id), options: notificationOptions }),
  );
  app.patch("/api/me/notification-settings", auth, (req, res) => {
    const patch = req.body?.settings;
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      return fail(res, 400, "通知设置无效。");
    const next = prefsOf(req.user.id);
    for (const [key, value] of Object.entries(patch)) {
      const option = optionById.get(key);
      if (!option || typeof value !== "boolean") return fail(res, 400, "通知设置无效。");
      if (option.locked && !value) return fail(res, 400, "涉及处罚、权限与账号安全的站务通知无法关闭。");
      if (!option.locked) next[key] = value;
    }
    db.prepare(
      `INSERT INTO notification_settings(user_id,prefs,updated_at) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs,updated_at=excluded.updated_at`,
    ).run(req.user.id, JSON.stringify(next), Date.now());
    res.json({ settings: next, options: notificationOptions });
  });

  const targetExists = (kind, id) =>
    kind === "author"
      ? !!db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(id)
      : !!db.prepare("SELECT 1 FROM categories WHERE id=?").get(id);
  app.get("/api/subscriptions", auth, (req, res) => {
    const ids = subscriptionsOf(req.user.id);
    res.json({
      ...ids,
      people: db
        .prepare(
          `SELECT u.id,u.name,u.initials,u.avatar,u.bio,s.created_at AS since FROM notify_subscriptions s
           JOIN users u ON u.id=s.target_id WHERE s.user_id=? AND s.kind='author' AND u.status='active' ORDER BY s.created_at DESC`,
        )
        .all(req.user.id)
        .map((u) => ({ ...u, avatar: u.avatar || "" })),
      categories: db
        .prepare(
          `SELECT c.id,c.name,c.en,c.icon,s.created_at AS since FROM notify_subscriptions s
           JOIN categories c ON c.id=s.target_id WHERE s.user_id=? AND s.kind='board' ORDER BY s.created_at DESC`,
        )
        .all(req.user.id),
    });
  });
  const kinds = { authors: "author", boards: "board" };
  app.put("/api/subscriptions/:kind/:id", auth, (req, res) => {
    const kind = kinds[req.params.kind];
    if (!kind) return fail(res, 404, "没有这种订阅。");
    if (kind === "author" && req.params.id === req.user.id) return fail(res, 400, "不能订阅自己的新帖提醒。");
    if (!targetExists(kind, req.params.id))
      return fail(res, 404, kind === "author" ? "这位成员不存在。" : "版块不存在。");
    db.prepare("INSERT OR IGNORE INTO notify_subscriptions(user_id,kind,target_id,created_at) VALUES(?,?,?,?)").run(
      req.user.id,
      kind,
      req.params.id,
      Date.now(),
    );
    res.json({ subscribed: true, ...subscriptionsOf(req.user.id) });
  });
  app.delete("/api/subscriptions/:kind/:id", auth, (req, res) => {
    const kind = kinds[req.params.kind];
    if (!kind) return fail(res, 404, "没有这种订阅。");
    db.prepare("DELETE FROM notify_subscriptions WHERE user_id=? AND kind=? AND target_id=?").run(
      req.user.id,
      kind,
      req.params.id,
    );
    res.json({ subscribed: false, ...subscriptionsOf(req.user.id) });
  });
}
