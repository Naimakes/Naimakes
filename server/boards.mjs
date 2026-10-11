import { randomUUID } from "node:crypto";
import { db } from "./database.mjs";
import {
  act,
  actorRole,
  handle,
  penaltyView,
  person,
  TRASH_DAYS,
  requestOrRemove,
} from "./governance.mjs";

const boardIcons = [
  "BrainCircuit",
  "Orbit",
  "Dna",
  "Zap",
  "Fingerprint",
  "Box",
  "Atom",
  "Compass",
  "Cpu",
  "Globe",
  "Leaf",
  "Lightbulb",
  "Microscope",
  "Music",
  "Palette",
  "Rocket",
  "Telescope",
  "Waves",
  "Wrench",
  "BookOpen",
  "Camera",
  "Code2",
  "FlaskConical",
  "Gamepad2",
  "Film",
  "Sprout",
  "Mountain",
  "Hash",
];
const reservedIds = new Set(["all", "announcement", "new", "api"]);
const boardsPerMember = 5;

export const getBoard = (id) =>
  typeof id === "string"
    ? db.prepare("SELECT * FROM categories WHERE id=? AND deleted_at IS NULL").get(id)
    : undefined;
export const hasCategory = (id) => !!getBoard(id);
const listBoards = () =>
  db
    .prepare(
      "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY builtin DESC, position, created_at",
    )
    .all();
const siteOwner = () =>
  db
    .prepare(
      "SELECT id,name,initials FROM users WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1",
    )
    .get() || null;
const moderatorRows = (categoryId) =>
  db
    .prepare(
      `SELECT m.user_id,m.role,m.created_at,u.name,u.initials,u.avatar,u.status
       FROM category_moderators m JOIN users u ON u.id=m.user_id
       WHERE m.category_id=? ORDER BY m.role='lead' DESC, m.created_at`,
    )
    .all(categoryId);
const usable = (row) => row.status === "active";
const asPerson = (row) => ({
  id: row.user_id,
  name: row.name,
  initials: row.initials,
  avatar: row.avatar || "",
  role: row.role,
  since: row.created_at,
});

export function boardModeration(categoryId) {
  const rows = moderatorRows(categoryId);
  const leadRow = rows.find((r) => r.role === "lead");
  const lead = leadRow && usable(leadRow) ? leadRow : null;
  return {
    rows,
    hasLeadRow: !!leadRow,
    lead: lead ? asPerson(lead) : null,
    assistants: rows
      .filter((r) => r.role === "assistant" && usable(r))
      .map(asPerson),
    acting: lead ? null : siteOwner(),
  };
}
const isSiteOwner = (user) => user?.role === "owner";
const isSiteStaff = (user) => ["owner", "admin"].includes(user?.role);
export function canModerateBoard(user, categoryId) {
  if (!user || user.status !== "active") return false;
  if (categoryId !== "announcement" && !getBoard(categoryId)) return false;
  if (isSiteStaff(user)) return true;
  const { lead, assistants } = boardModeration(categoryId);
  return lead?.id === user.id || assistants.some((a) => a.id === user.id);
}
export const isBoardLead = (user, categoryId) =>
  !!user && boardModeration(categoryId).lead?.id === user.id;
const canLeadBoard = (user, categoryId) =>
  isSiteOwner(user) || isBoardLead(user, categoryId);
const moderatedBoards = (userId) =>
  db
    .prepare(
      "SELECT m.category_id FROM category_moderators m JOIN categories c ON c.id=m.category_id WHERE m.user_id=? AND c.deleted_at IS NULL",
    )
    .all(userId)
    .map((r) => r.category_id);

function boardAction(actor, board, { action, detail, notices = [], summary = "", before = "", after = "" }) {
  act(actor, {
    action,
    role: actorRole(actor, board.id),
    target: { type: "board", id: board.id, label: board.name },
    before,
    after,
    summary,
    logDetail: detail,
    notices: notices.map(([userId, text]) => ({ userId, text })),
  });
}
export function joinBoard(categoryId, userId, source = "posted") {
  if (!getBoard(categoryId) || !userId) return;
  db.prepare(
    `INSERT INTO category_members(category_id,user_id,source,created_at) VALUES(?,?,?,?)
     ON CONFLICT(category_id,user_id) DO UPDATE SET source=excluded.source
     WHERE category_members.source='left'`,
  ).run(categoryId, userId, source, Date.now());
  db.prepare(
    "UPDATE board_member_removals SET status='rejoined',resolved_at=? WHERE category_id=? AND user_id=? AND status='pending'",
  ).run(Date.now(), categoryId, userId);
}
const leaveBoard = (categoryId, userId) =>
  db
    .prepare(
      `INSERT INTO category_members(category_id,user_id,source,created_at) VALUES(?,?,'left',?)
       ON CONFLICT(category_id,user_id) DO UPDATE SET source='left'`,
    )
    .run(categoryId, userId, Date.now());
function recordRemoval(categoryId, userId, removedBy, previous = "joined") {
  const t = Date.now();
  db.prepare(
    "UPDATE board_member_removals SET status='replaced',resolved_at=? WHERE category_id=? AND user_id=? AND status='pending'",
  ).run(t, categoryId, userId);
  db.prepare(
    "INSERT INTO board_member_removals(id,category_id,user_id,removed_by,previous_source,created_at) VALUES(?,?,?,?,?,?)",
  ).run(randomUUID(), categoryId, userId, removedBy, previous || "joined", t);
}
const isBoardMember = (categoryId, userId) =>
  !!userId &&
  !!db
    .prepare(
      "SELECT 1 FROM category_members WHERE category_id=? AND user_id=? AND source<>'left'",
    )
    .get(categoryId, userId);
const memberCount = (categoryId) =>
  db
    .prepare(
      "SELECT COUNT(*) AS n FROM category_members WHERE category_id=? AND source<>'left'",
    )
    .get(categoryId).n;
const memberRows = (categoryId, search = "%", limit = 12) =>
  db
    .prepare(
      `SELECT u.id,u.name,u.initials,u.avatar,u.bio,m.source,m.created_at
         FROM category_members m JOIN users u ON u.id=m.user_id
        WHERE m.category_id=? AND m.source<>'left' AND u.status='active'
          AND (u.name LIKE ? OR u.id LIKE ?)
        ORDER BY u.name LIMIT ?`,
    )
    .all(categoryId, search, search, limit)
    .map((r) => ({ ...r, avatar: r.avatar || "" }));
function makeBoardId(seed) {
  const base = (seed || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const taken = (id) => !!db.prepare("SELECT 1 FROM categories WHERE id=?").get(id);
  if (base && base.length >= 2 && !reservedIds.has(base) && !taken(base))
    return base;
  for (let i = 0; i < 50; i++) {
    const candidate =
      (base ? base.slice(0, 17) + "-" : "b-") + randomUUID().slice(0, 6);
    if (!taken(candidate)) return candidate;
  }
  return "b-" + randomUUID();
}

const likeQuery = (value) =>
  typeof value === "string" && value.trim()
    ? "%" + value.trim().slice(0, 40) + "%"
    : "%";

export function installBoards(app, { auth, validText, speaking }) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const describe = (board, user) => {
    const moderation = boardModeration(board.id);
    return {
      ...board,
      builtin: !!board.builtin,
      posts: db
        .prepare(
          "SELECT COUNT(*) AS n FROM posts WHERE category=? AND visibility='public'",
        )
        .get(board.id).n,
      followers: db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE category=?")
        .get(board.id).n,
      views: db
        .prepare(
          "SELECT COUNT(*) AS n FROM post_views v JOIN posts p ON p.id=v.post_id WHERE p.category=? AND p.visibility='public' AND p.deleted_at IS NULL",
        )
        .get(board.id).n,
      members: memberCount(board.id),
      joined: isBoardMember(board.id, user?.id),
      lead: moderation.lead,
      assistants: moderation.assistants,
      acting_owner: moderation.acting,
      can_moderate: canModerateBoard(user, board.id),
      can_lead: canLeadBoard(user, board.id),
      ...muteOf(board, user, moderation),
    };
  };
  const muteOf = (board, user, moderation) => {
    const lead = moderation.lead?.id === user?.id;
    const privileged = lead || isSiteStaff(user);
    const view = penaltyView("board", board.id, { privileged });
    return {
      muted: view ? 1 : 0,
      muted_until: view?.until ?? null,
      mute_started_at: view?.starts_at ?? null,
      mute_reason: view?.reason || "",
      appeal_pending: view?.appeal_pending ? 1 : 0,
      appeal_cooldown_until: view?.cooldown_until ?? null,
      can_appeal: !!view && lead,
      can_report: !!user && !lead && user.status === "active",
    };
  };
  const loadBoard = (req, res) => {
    const board = getBoard(req.params.id);
    if (!board) {
      const removed = typeof req.params.id === "string" && db.prepare("SELECT 1 FROM categories WHERE id=? AND deleted_at IS NOT NULL").get(req.params.id);
      if (removed) res.status(404).json({ error: "该内容已被删除", deleted: true });
      else fail(res, 404, "版块不存在。");
    }
    return board;
  };
  const loadMember = (res, id) => {
    const target =
      typeof id === "string"
        ? db.prepare("SELECT * FROM users WHERE id=?").get(id)
        : null;
    if (!target) {
      fail(res, 404, "该用户不存在。");
      return null;
    }
    if (target.status !== "active") {
      fail(res, 400, "该账号已停用，无法担任版块管理。");
      return null;
    }
    return target;
  };

  app.get("/api/categories", (req, res) =>
    res.json({
      categories: listBoards().map((c) => describe(c, req.user)),
      icons: boardIcons,
    }),
  );
  app.get("/api/categories/:id", (req, res) => {
    const board = loadBoard(req, res);
    if (board) res.json({ category: describe(board, req.user) });
  });
  app.post("/api/categories", auth, speaking, (req, res) => {
    const { name, en = "", description, icon = boardIcons[0] } = req.body || {};
    if (
      !validText(name, 1, 40) ||
      !validText(description, 1, 300) ||
      typeof en !== "string" ||
      en.trim().length > 40 ||
      (en.trim() && !/^[A-Za-z0-9 &'’.,:+-]+$/.test(en.trim())) ||
      !boardIcons.includes(icon)
    )
      return fail(
        res,
        400,
        "请填写版块名称与简介；英文名可留空，且只能使用英文与常见符号。",
      );
    if (
      db
        .prepare("SELECT 1 FROM categories WHERE name=? COLLATE NOCASE AND deleted_at IS NULL")
        .get(name.trim())
    )
      return fail(res, 409, "已经有同名版块了，换一个名字试试。");
    const mine = db
      .prepare("SELECT COUNT(*) AS n FROM categories WHERE created_by=?")
      .get(req.user.id).n;
    if (mine >= boardsPerMember && !isSiteStaff(req.user))
      return fail(
        res,
        400,
        `每位成员最多创建 ${boardsPerMember} 个版块，先照顾好已有的版块吧。`,
      );
    const id = makeBoardId(en.trim() || name.trim());
    const position =
      (db.prepare("SELECT MAX(position) AS n FROM categories").get().n ?? 0) + 1;
    db.prepare(
      "INSERT INTO categories(id,name,en,description,icon,builtin,position,created_by,created_at) VALUES(?,?,?,?,?,0,?,?,?)",
    ).run(
      id,
      name.trim(),
      en.trim().toUpperCase(),
      description.trim(),
      icon,
      position,
      req.user.id,
      Date.now(),
    );
    db.prepare(
      "INSERT INTO category_moderators VALUES(?,?,'lead',?,?)",
    ).run(id, req.user.id, req.user.id, Date.now());
    joinBoard(id, req.user.id, "created");
    boardAction(req.user, { id, name: name.trim() }, { action: "create_category", detail: name.trim(), after: "已创建" });
    res.status(201).json({ category: describe(getBoard(id), req.user) });
  });
  app.patch("/api/categories/:id", auth, (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    if (!canModerateBoard(req.user, board.id))
      return fail(res, 403, "只有本版块的版主、协管或站主可以修改版块资料。");
    const {
      name = board.name,
      en = board.en,
      description = board.description,
      icon = board.icon,
    } = req.body || {};
    if (
      !validText(name, 1, 40) ||
      !validText(description, 1, 300) ||
      typeof en !== "string" ||
      en.trim().length > 40 ||
      (en.trim() && !/^[A-Za-z0-9 &'’.,:+-]+$/.test(en.trim())) ||
      !boardIcons.includes(icon)
    )
      return fail(
        res,
        400,
        "请填写版块名称与简介；英文名可留空，且只能使用英文与常见符号。",
      );
    if (
      db
        .prepare(
          "SELECT 1 FROM categories WHERE name=? COLLATE NOCASE AND id<>? AND deleted_at IS NULL",
        )
        .get(name.trim(), board.id)
    )
      return fail(res, 409, "已经有同名版块了，换一个名字试试。");
    db.prepare(
      "UPDATE categories SET name=?,en=?,description=?,icon=? WHERE id=?",
    ).run(
      name.trim(),
      en.trim().toUpperCase(),
      description.trim(),
      icon,
      board.id,
    );
    boardAction(req.user, board, {
      action: "update_category",
      detail: name.trim(),
      before: board.name,
      after: name.trim(),
      summary: isSiteStaff(req.user) || !canLeadBoard(req.user, board.id) ? `修改了「${board.name}」版块的资料` : "",
    });
    res.json({ category: describe(getBoard(board.id), req.user) });
  });
  app.delete("/api/categories/:id", auth, (req, res, next) => {
    const board = loadBoard(req, res);
    if (!board) return;
    if (!isSiteStaff(req.user)) return fail(res, 403, "只有站主可以删除版块。");
    handle(() => {
      requestOrRemove(req.user, "board", board.id, { reason: req.body?.reason || "" });
      return { ok: true };
    })(req, res, next);
  });
  app.get("/api/categories/:id/moderators", (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    const moderation = boardModeration(board.id);
    res.json({
      lead: moderation.lead,
      assistants: moderation.assistants,
      acting_owner: moderation.acting,
      can_moderate: canModerateBoard(req.user, board.id),
      can_lead: canLeadBoard(req.user, board.id),
    });
  });
  app.post("/api/categories/:id/moderators", auth, (req, res) =>
    fail(res, 403, "版块内只能任命版主，不能任命管理员。"),
  );
  app.delete("/api/categories/:id/moderators/:userId", auth, (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    const row = db
      .prepare(
        "SELECT * FROM category_moderators WHERE category_id=? AND user_id=?",
      )
      .get(board.id, req.params.userId);
    if (!row) return fail(res, 404, "该用户不是本版块的管理成员。");
    const self = row.user_id === req.user.id;
    const allowed =
      row.role === "lead"
        ? isSiteOwner(req.user) || self
        : isSiteOwner(req.user) ||
          isSiteStaff(req.user) ||
          isBoardLead(req.user, board.id) ||
          self;
    if (!allowed)
      return fail(
        res,
        403,
        row.role === "lead"
          ? "只有站主可以撤销版主，版主也可以主动辞任。"
          : "只有本版块的版主或站主可以解除协管。",
      );
    db.prepare(
      "DELETE FROM category_moderators WHERE category_id=? AND user_id=?",
    ).run(board.id, row.user_id);
    const label = row.role === "lead" ? "版主" : "协管";
    boardAction(req.user, board, {
      action: "remove_moderator",
      detail: `${self ? "辞任" : "撤销"}「${board.name}」${label}`,
      before: label,
      after: "无",
      summary: self ? "" : `撤销了一位「${board.name}」${label}`,
      notices: self ? [] : [[row.user_id, `${req.user.name} 撤销了你在「${board.name}」版块的${label}任命，相应管理权限已失效。`]],
    });
    res.json({ category: describe(getBoard(board.id), req.user) });
  });
  app.post("/api/categories/:id/transfer", auth, (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    if (!canLeadBoard(req.user, board.id))
      return fail(res, 403, "只有本版块的版主或站主可以移交版主权限。");
    const target = loadMember(res, req.body?.user_id);
    if (!target) return;
    const moderation = boardModeration(board.id);
    if (moderation.lead?.id === target.id)
      return fail(res, 400, "该用户已经是本版块的版主。");
    db.exec("BEGIN");
    try {
      db.prepare(
        "DELETE FROM category_moderators WHERE category_id=? AND (role='lead' OR user_id=?)",
      ).run(board.id, target.id);
      db.prepare(
        "INSERT INTO category_moderators VALUES(?,?,'lead',?,?)",
      ).run(board.id, target.id, req.user.id, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    boardAction(req.user, board, {
      action: "transfer_moderator",
      detail: `${target.name} 接任「${board.name}」版主`,
      before: moderation.lead?.name || "站主代管",
      after: target.name,
      summary: `将「${board.name}」的版主移交给 ${target.name}`,
      notices: [
        [target.id, `${req.user.name} 任命你为「${board.name}」版块的版主。`],
        ...(moderation.lead && moderation.lead.id !== req.user.id
          ? [[
              moderation.lead.id,
              `${req.user.name} 解除了你在「${board.name}」版块的版主任命，新任版主为 ${target.name}。`,
            ]]
          : []),
      ],
    });
    res.json({ category: describe(getBoard(board.id), req.user) });
  });
  app.get("/api/categories/:id/members", (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    res.json({
      members: memberRows(board.id, likeQuery(req.query.q), 60),
      total: memberCount(board.id),
      joined: isBoardMember(board.id, req.user?.id),
    });
  });
  app.post("/api/categories/:id/members", auth, (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    joinBoard(board.id, req.user.id, "joined");
    res.status(201).json({ category: describe(board, req.user) });
  });
  app.delete("/api/categories/:id/members/:userId", auth, (req, res) => {
    const board = loadBoard(req, res);
    if (!board) return;
    const self = req.params.userId === req.user.id;
    if (!self && !canLeadBoard(req.user, board.id))
      return fail(res, 403, "只有本版块的版主或站主可以移出成员。");
    if (!isBoardMember(board.id, req.params.userId))
      return fail(res, 404, "该用户不是本版块的成员。");
    if (!self && boardModeration(board.id).lead?.id === req.params.userId)
      return fail(res, 400, "请先移交或撤销版主权限，再移出这位成员。");
    const previous = db
      .prepare("SELECT source FROM category_members WHERE category_id=? AND user_id=?")
      .get(board.id, req.params.userId)?.source;
    leaveBoard(board.id, req.params.userId);
    if (!self) recordRemoval(board.id, req.params.userId, req.user.id, previous);
    if (!self)
      boardAction(req.user, board, {
        action: "remove_member",
        detail: `移出「${board.name}」的一位成员`,
        summary: `将一位成员移出了「${board.name}」`,
        notices: [[req.params.userId, `${req.user.name} 将你移出了「${board.name}」版块。`]],
      });
    res.json({ category: describe(board, req.user) });
  });
  const ownerOnly = (req, res) => {
    if (isSiteOwner(req.user)) return true;
    fail(res, 403, "只有站主可以处理被移出的成员。");
    return false;
  };
  const removalCutoff = () => Date.now() - TRASH_DAYS * 86400000;
  const pendingRemovals = `FROM board_member_removals r
    JOIN categories c ON c.id=r.category_id AND c.deleted_at IS NULL
    JOIN users u ON u.id=r.user_id AND u.status<>'deleted'
    WHERE r.status='pending' AND r.created_at >= ?`;
  app.get("/api/admin/member-removals", auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
    const rows = db
      .prepare(
        `SELECT r.*, c.name AS board_name, c.icon AS board_icon ${pendingRemovals}
         ORDER BY r.created_at DESC LIMIT 20 OFFSET ?`,
      )
      .all(removalCutoff(), offset);
    const total = db.prepare(`SELECT COUNT(*) AS n ${pendingRemovals}`).get(removalCutoff()).n;
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        member: person(r.user_id),
        board: { id: r.category_id, name: r.board_name, icon: r.board_icon },
        removed_by: person(r.removed_by),
        removed_at: r.created_at,
        expires_at: r.created_at + TRASH_DAYS * 86400000,
      })),
      total,
      hasMore: offset + rows.length < total,
    });
  });
  const loadRemoval = (req, res) => {
    if (!ownerOnly(req, res)) return null;
    const row = db
      .prepare(`SELECT r.* ${pendingRemovals} AND r.id=?`)
      .get(removalCutoff(), req.params.id);
    if (!row) fail(res, 404, "这条记录已处理或已过期。");
    return row;
  };
  app.post("/api/admin/member-removals/:id/undo", auth, (req, res) => {
    const row = loadRemoval(req, res);
    if (!row) return;
    const board = getBoard(row.category_id);
    const member = person(row.user_id);
    joinBoard(board.id, row.user_id, row.previous_source === "left" ? "joined" : row.previous_source);
    db.prepare("UPDATE board_member_removals SET status='undone',resolved_at=? WHERE id=?").run(Date.now(), row.id);
    boardAction(req.user, board, {
      action: "undo_remove_member",
      detail: `撤回了「${board.name}」对 ${member.name} 的移出`,
      before: "已移出",
      after: "成员",
      notices: [[row.user_id, `站主撤回了对你的移出操作，你已重新回到「${board.name}」版块。`]],
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/member-removals/:id/ignore", auth, (req, res) => {
    const row = loadRemoval(req, res);
    if (!row) return;
    db.prepare("UPDATE board_member_removals SET status='ignored',resolved_at=? WHERE id=?").run(Date.now(), row.id);
    res.json({ ok: true });
  });
  app.get("/api/moderation/candidates", auth, (req, res) => {
    const boardId = typeof req.query.board === "string" ? req.query.board : "";
    if (
      !isSiteStaff(req.user) &&
      !(boardId ? canLeadBoard(req.user, boardId) : moderatedBoards(req.user.id).length)
    )
      return fail(res, 403, "只有版主或站主可以查找管理人选。");
    const search = likeQuery(req.query.q);
    res.json({
      users: boardId
        ? memberRows(boardId, search)
        : db
            .prepare(
              "SELECT id,name,initials,avatar,bio FROM users WHERE status='active' AND (name LIKE ? OR id LIKE ?) ORDER BY name LIMIT 12",
            )
            .all(search, search)
            .map((u) => ({ ...u, avatar: u.avatar || "" })),
    });
  });
}
