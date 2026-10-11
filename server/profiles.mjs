import { db } from "./database.mjs";
import { notify } from "./notifications.mjs";
import { penaltyView, isStaff } from "./governance.mjs";

const privacyOptions = [
  { id: "collections", label: "公开我的收藏夹", value: true },
  { id: "boards", label: "公开我的关注版块", value: true },
  { id: "history", label: "公开最近浏览", value: false },
  { id: "likes", label: "公开最近点赞", value: true },
  { id: "following", label: "公开我的关注列表", value: true },
  { id: "followers", label: "公开我的粉丝列表", value: true },
  { id: "tags", label: "公开个人标签", value: true },
  { id: "later", label: "公开稍后再看", value: false },
  { id: "topics", label: "公开跟踪的话题", value: false },
  { id: "moderating", label: "公开我管理的版块", value: true },
  { id: "letters", label: "允许未关注的人私信我", value: true },
  { id: "visitors", label: "记录来访的新访客", value: true },
];
const privacyIds = new Set(privacyOptions.map((o) => o.id));
const defaultPrivacy = Object.fromEntries(
  privacyOptions.map((o) => [o.id, o.value]),
);

const profileModules = [
  { id: "posts", label: "我的讨论" },
  { id: "collections", label: "我的收藏夹" },
  { id: "boards", label: "关注的版块" },
  { id: "topics", label: "跟踪的话题" },
  { id: "likes", label: "最近点赞的讨论" },
  { id: "projects", label: "我的共创项目" },
  { id: "later", label: "稍后再看" },
  { id: "history", label: "最近浏览" },
  { id: "tags", label: "个人标签" },
  { id: "moderating", label: "我管理的版块" },
  { id: "announcements", label: "站内公告" },
  { id: "intro", label: "个人资料" },
];
const moduleIds = new Set(profileModules.map((m) => m.id));
const defaultModuleOrder = profileModules.map((m) => m.id);

const tagLimit = 12;
const tagLength = 12;

const readJson = (text, fallback) => {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch {
    return fallback;
  }
};
const normalizeOrder = (saved) => {
  const kept = (Array.isArray(saved) ? saved : []).filter(
    (id, i, list) => moduleIds.has(id) && list.indexOf(id) === i,
  );
  return kept.concat(defaultModuleOrder.filter((id) => !kept.includes(id)));
};
const readProfile = (userId) => {
  const row = db.prepare("SELECT * FROM profiles WHERE user_id=?").get(userId);
  return {
    banner: row?.banner || "",
    banner_mobile: row?.banner_mobile || "",
    privacy: { ...defaultPrivacy, ...readJson(row?.privacy, {}) },
    modules: normalizeOrder(readJson(row?.modules, [])),
    tags: (readJson(row?.tags, []) || []).filter((t) => typeof t === "string"),
  };
};
export const profileOf = readProfile;

const saveProfile = (userId, next) =>
  db
    .prepare(
      `INSERT INTO profiles(user_id,banner,banner_mobile,privacy,modules,tags,updated_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET banner=excluded.banner,
         banner_mobile=excluded.banner_mobile,privacy=excluded.privacy,
         modules=excluded.modules,tags=excluded.tags,updated_at=excluded.updated_at`,
    )
    .run(
      userId,
      next.banner,
      next.banner_mobile,
      JSON.stringify(next.privacy),
      JSON.stringify(next.modules),
      JSON.stringify(next.tags),
      Date.now(),
    );

const card = (u) => ({
  id: u.id,
  name: u.name,
  initials: u.initials,
  avatar: u.avatar || "",
  bio: u.bio || "",
  role: u.role,
  lead_boards: db
    .prepare(
      `SELECT c.id,c.name FROM category_moderators m JOIN categories c ON c.id=m.category_id
       WHERE m.user_id=? AND m.role='lead' AND c.deleted_at IS NULL ORDER BY m.created_at`,
    )
    .all(u.id),
  created_at: u.created_at,
});

const statsOf = (id) => ({
  following: db
    .prepare("SELECT COUNT(*) AS n FROM user_follows WHERE follower_id=?")
    .get(id).n,
  followers: db
    .prepare("SELECT COUNT(*) AS n FROM user_follows WHERE target_id=?")
    .get(id).n,
  likes:
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.author_id=? AND p.visibility='public' AND p.deleted_at IS NULL",
      )
      .get(id).n +
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM comment_votes v JOIN comments c ON c.id=v.comment_id WHERE c.author_id=? AND v.value=1 AND c.deleted=0",
      )
      .get(id).n,
  views: db
    .prepare(
      "SELECT COUNT(*) AS n FROM history h JOIN posts p ON p.id=h.post_id WHERE p.author_id=? AND p.visibility='public' AND p.deleted_at IS NULL",
    )
    .get(id).n,
  posts: db
    .prepare(
      "SELECT COUNT(*) AS n FROM posts WHERE author_id=? AND visibility='public' AND deleted_at IS NULL",
    )
    .get(id).n,
});

export function installProfiles(app, { auth, validText, validUpload }) {
  const getUser = (id) =>
    db
      .prepare("SELECT * FROM users WHERE id=? AND status='active'")
      .get(String(id || ""));
  const following = (a, b) =>
    !!db
      .prepare("SELECT 1 FROM user_follows WHERE follower_id=? AND target_id=?")
      .get(a, b);

  app.get("/api/users", (req, res) => {
    const q =
      typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    if (!q) return res.json({ users: [] });
    const rows = db
      .prepare(
        `SELECT id,name,initials,avatar,bio,role,created_at FROM users
         WHERE status='active' AND (instr(lower(name),lower(?))>0 OR instr(lower(id),lower(?))>0)
         ORDER BY (lower(name)=lower(?)) DESC,name LIMIT 8`,
      )
      .all(q, q, q);
    res.json({
      users: rows.map((u) => ({
        ...card(u),
        stats: { followers: statsOf(u.id).followers },
        followed: req.user ? following(req.user.id, u.id) : false,
      })),
    });
  });

  app.get("/api/users/:id", (req, res) => {
    const target = getUser(req.params.id);
    if (!target) {
      const removed = db.prepare("SELECT 1 FROM users WHERE id=? AND status='deleted'").get(String(req.params.id || ""));
      return removed
        ? res.status(404).json({ error: "该用户已被删除", deleted: true })
        : res.status(404).json({ error: "这位成员不存在。" });
    }
    const self = req.user?.id === target.id;
    const profile = readProfile(target.id);
    if (req.user && !self && profile.privacy.visitors)
      db.prepare(
        `INSERT INTO profile_visits(owner_id,visitor_id,visited_at) VALUES(?,?,?)
         ON CONFLICT(owner_id,visitor_id) DO UPDATE SET visited_at=excluded.visited_at`,
      ).run(target.id, req.user.id, Date.now());
    res.json({
      user: card(target),
      banner: profile.banner,
      banner_mobile: profile.banner_mobile,
      tags: self || profile.privacy.tags ? profile.tags : [],
      stats: statsOf(target.id),
      mute: penaltyView("user", target.id, { privileged: self || isStaff(req.user) }),
      can_report: !!req.user && !self,
      privacy: self ? profile.privacy : null,
      modules: self ? profile.modules : null,
      relation: {
        self,
        followed: req.user ? following(req.user.id, target.id) : false,
        follows_me: req.user ? following(target.id, req.user.id) : false,
      },
      visible: self
        ? Object.fromEntries(privacyOptions.map((o) => [o.id, true]))
        : profile.privacy,
    });
  });

  app.patch("/api/me/profile", auth, (req, res) => {
    const current = readProfile(req.user.id);
    const { banner, banner_mobile: bannerMobile, privacy, modules, tags } = req.body || {};
    const next = { ...current };
    if (banner !== undefined) {
      if (typeof banner !== "string" || (banner && !validUpload(banner)))
        return res.status(400).json({ error: "头图无效，请重新上传。" });
      next.banner = banner;
    }
    if (bannerMobile !== undefined) {
      if (typeof bannerMobile !== "string" || (bannerMobile && !validUpload(bannerMobile)))
        return res.status(400).json({ error: "头图无效，请重新上传。" });
      next.banner_mobile = bannerMobile;
    }
    if (privacy !== undefined) {
      if (!privacy || typeof privacy !== "object")
        return res.status(400).json({ error: "隐私设置无效。" });
      for (const [key, value] of Object.entries(privacy)) {
        if (!privacyIds.has(key) || typeof value !== "boolean")
          return res.status(400).json({ error: "隐私设置无效。" });
        next.privacy = { ...next.privacy, [key]: value };
      }
    }
    if (modules !== undefined) {
      if (!Array.isArray(modules) || modules.some((m) => !moduleIds.has(m)))
        return res.status(400).json({ error: "排序设置无效。" });
      next.modules = normalizeOrder(modules);
    }
    if (tags !== undefined) {
      if (
        !Array.isArray(tags) ||
        tags.length > tagLimit ||
        tags.some((t) => !validText(t, 1, tagLength))
      )
        return res.status(400).json({
          error: `个人标签最多 ${tagLimit} 个，每个 1–${tagLength} 字。`,
        });
      const cleaned = [];
      for (const tag of tags.map((t) => t.trim()))
        if (!cleaned.includes(tag)) cleaned.push(tag);
      next.tags = cleaned;
    }
    saveProfile(req.user.id, next);
    res.json({ profile: next });
  });

  app.post("/api/users/:id/follow", auth, (req, res) => {
    const target = getUser(req.params.id);
    if (!target) return res.status(404).json({ error: "这位成员不存在。" });
    if (target.id === req.user.id)
      return res.status(400).json({ error: "不能关注自己。" });
    const already = following(req.user.id, target.id);
    if (already)
      db.prepare(
        "DELETE FROM user_follows WHERE follower_id=? AND target_id=?",
      ).run(req.user.id, target.id);
    else {
      db.prepare(
        "INSERT INTO user_follows(follower_id,target_id,created_at) VALUES(?,?,?)",
      ).run(req.user.id, target.id, Date.now());
      notify(target.id, {
        kind: "follow",
        text: `${req.user.name} 关注了你`,
        actorId: req.user.id,
      });
    }
    res.json({ followed: !already, stats: statsOf(target.id) });
  });

  const listPeople = (scope) => (req, res) => {
    const target = getUser(req.params.id);
    if (!target) return res.status(404).json({ error: "这位成员不存在。" });
    const self = req.user?.id === target.id;
    const privacy = readProfile(target.id).privacy;
    if (scope === "visitors" && !self)
      return res.status(403).json({ error: "只有本人能看到自己的访客记录。" });
    if (!self && !privacy[scope])
      return res
        .status(403)
        .json({ error: "这位成员没有公开这份名单。" });
    const offset = Math.max(0, Math.min(10000, parseInt(req.query.offset) || 0));
    const limit = 24;
    const source = {
      followers: {
        count: "SELECT COUNT(*) AS n FROM user_follows WHERE target_id=?",
        rows: `SELECT u.*,f.created_at AS since FROM user_follows f JOIN users u ON u.id=f.follower_id
               WHERE f.target_id=? AND u.status='active' ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
      },
      following: {
        count: "SELECT COUNT(*) AS n FROM user_follows WHERE follower_id=?",
        rows: `SELECT u.*,f.created_at AS since FROM user_follows f JOIN users u ON u.id=f.target_id
               WHERE f.follower_id=? AND u.status='active' ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
      },
      visitors: {
        count: "SELECT COUNT(*) AS n FROM profile_visits WHERE owner_id=?",
        rows: `SELECT u.*,v.visited_at AS since FROM profile_visits v JOIN users u ON u.id=v.visitor_id
               WHERE v.owner_id=? AND u.status='active' ORDER BY v.visited_at DESC LIMIT ? OFFSET ?`,
      },
    }[scope];
    const total = db.prepare(source.count).get(target.id).n;
    const rows = db.prepare(source.rows).all(target.id, limit, offset);
    res.json({
      total,
      hasMore: offset + rows.length < total,
      people: rows.map((u) => ({
        ...card(u),
        since: u.since,
        followed: req.user ? following(req.user.id, u.id) : false,
        mine: req.user?.id === u.id,
      })),
    });
  };
  app.get("/api/users/:id/likes-received", (req, res) => {
    const target = getUser(req.params.id);
    if (!target) return res.status(404).json({ error: "这位成员不存在。" });
    const self = req.user?.id === target.id;
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT 'post' AS kind, l.user_id AS liker_id, l.created_at, p.id AS post_id, p.title AS post_title,
                  NULL AS comment_id, NULL AS comment_text
             FROM likes l JOIN posts p ON p.id=l.post_id
            WHERE p.author_id=? AND p.visibility='public' AND p.deleted_at IS NULL
           UNION ALL
           SELECT 'comment', v.user_id, v.created_at, p.id, p.title, c.id, c.content
             FROM comment_votes v JOIN comments c ON c.id=v.comment_id JOIN posts p ON p.id=c.post_id
            WHERE c.author_id=? AND v.value=1 AND c.deleted=0 AND p.visibility='public' AND p.deleted_at IS NULL
         ) ORDER BY created_at DESC LIMIT 400`,
      )
      .all(target.id, target.id);
    const people = new Map();
    const items = [];
    for (const row of rows) {
      if (row.liker_id === target.id) continue;
      if (!people.has(row.liker_id)) {
        const u = getUser(row.liker_id);
        people.set(
          row.liker_id,
          u && u.status === "active" && (self || readProfile(u.id).privacy.likes) ? card(u) : null,
        );
      }
      const liker = people.get(row.liker_id);
      if (!liker) continue;
      items.push({
        kind: row.kind,
        liker,
        post_id: row.post_id,
        post_title: row.post_title,
        comment_id: row.comment_id,
        excerpt: row.comment_text ? row.comment_text.replace(/\s+/g, " ").slice(0, 80) : "",
        created_at: row.created_at || null,
      });
      if (items.length >= 60) break;
    }
    res.json({ items });
  });
  app.get("/api/users/:id/followers", listPeople("followers"));
  app.get("/api/users/:id/following", listPeople("following"));
  app.get("/api/users/:id/visitors", auth, listPeople("visitors"));

  app.get("/api/users/:id/boards", (req, res) => {
    const target = getUser(req.params.id);
    if (!target) return res.status(404).json({ error: "这位成员不存在。" });
    const self = req.user?.id === target.id;
    const privacy = readProfile(target.id).privacy;
    res.json({
      followed:
        self || privacy.boards
          ? db
              .prepare(
                `SELECT c.id,c.name,c.en,c.description,c.icon FROM follows f JOIN categories c ON c.id=f.category
                 WHERE f.user_id=? AND c.deleted_at IS NULL ORDER BY c.position,c.name`,
              )
              .all(target.id)
          : null,
      joined:
        self || privacy.boards
          ? db
              .prepare(
                `SELECT c.id,c.name,c.en,c.description,c.icon,m.created_at AS since FROM category_members m
                 JOIN categories c ON c.id=m.category_id WHERE m.user_id=? AND m.source<>'left' AND c.deleted_at IS NULL
                 ORDER BY m.created_at DESC LIMIT 30`,
              )
              .all(target.id)
          : null,
      moderating:
        self || privacy.moderating
          ? db
              .prepare(
                `SELECT c.id,c.name,c.en,c.description,c.icon,m.role FROM category_moderators m
                 JOIN categories c ON c.id=m.category_id WHERE m.user_id=? AND c.deleted_at IS NULL ORDER BY m.created_at`,
              )
              .all(target.id)
          : null,
    });
  });
  app.get("/api/users/:id/collections", (req, res) => {
    const target = getUser(req.params.id);
    if (!target) return res.status(404).json({ error: "这位成员不存在。" });
    const self = req.user?.id === target.id;
    if (!self && !readProfile(target.id).privacy.collections)
      return res.json({ collections: null });
    res.json({
      collections: db
        .prepare(
          `SELECT c.id,c.name,c.description,c.cover,c.is_public,c.is_default,c.created_at,
             (SELECT COUNT(*) FROM collection_items i JOIN posts p ON p.id=i.post_id
              WHERE i.collection_id=c.id AND p.visibility='public' AND p.deleted_at IS NULL) AS count
           FROM collections c WHERE c.user_id=? ${self ? "" : "AND c.is_public=1"}
           ORDER BY c.is_default DESC,c.created_at DESC`,
        )
        .all(target.id),
    });
  });
}
