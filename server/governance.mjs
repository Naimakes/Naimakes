import { randomUUID } from "node:crypto";
import { db } from "./database.mjs";
import { plainText } from "./rich-text.mjs";
import { notify, settleNotices, closeUserStreams, clause, noteLine } from "./notifications.mjs";

const DAY = 86400000;
const APPEAL_COOLDOWN = DAY;
const MAX_SPAN = 3650 * DAY;
const now = () => Date.now();
const pad = (n) => String(n).padStart(2, "0");
const dateText = (time) => {
  const d = new Date(time);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const spanText = (end) => (end ? `至 ${dateText(end)}` : "永久");
const clip = (text, n = 120) =>
  Array.from(
    String(text || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/[#*`>]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, n)
    .join("");
const readJson = (text, fallback) => {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch {
    return fallback;
  }
};
const validText = (v, min, max) =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const placeholders = (list) => list.map(() => "?").join(",");

export class GovernanceError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => {
  throw new GovernanceError(status, message, extra);
};
const requestRequired = () =>
  fail(403, "无此权限，请向站主申请", { code: "request_required" });

export const isOwner = (u) => u?.role === "owner";
export const isAdmin = (u) => u?.role === "admin";
export const isStaff = (u) => isOwner(u) || isAdmin(u);
const ownerIds = () =>
  db
    .prepare("SELECT id FROM users WHERE role='owner' AND status='active'")
    .all()
    .map((r) => r.id);
export const boardRoleOf = (userId, boardId) =>
  userId && boardId
    ? db
        .prepare(
          `SELECT m.role FROM category_moderators m JOIN users u ON u.id=m.user_id
           WHERE m.category_id=? AND m.user_id=? AND u.status='active'`,
        )
        .get(boardId, userId)?.role || null
    : null;
const boardLeadId = (boardId) =>
  db
    .prepare(
      `SELECT m.user_id FROM category_moderators m JOIN users u ON u.id=m.user_id
       WHERE m.category_id=? AND m.role='lead' AND u.status='active'`,
    )
    .get(boardId)?.user_id || null;
const boardKeepers = (boardId) =>
  db
    .prepare(
      `SELECT m.user_id FROM category_moderators m JOIN users u ON u.id=m.user_id
       WHERE m.category_id=? AND u.status='active' ORDER BY m.role='lead' DESC`,
    )
    .all(boardId)
    .map((r) => r.user_id);
export function actorRole(actor, boardId = null) {
  if (!actor) return "system";
  if (isOwner(actor)) return "owner";
  if (isAdmin(actor)) return "admin";
  return boardRoleOf(actor.id, boardId) || "member";
}
const roleTitle = (role) =>
  ({ owner: "站主", admin: "管理员", lead: "版主", assistant: "协管", member: "成员", system: "系统" })[role] ||
  "管理员";
export const person = (id) => {
  const u = id
    ? db.prepare("SELECT id,name,initials,avatar,role,status,muted,muted_until FROM users WHERE id=?").get(id)
    : null;
  return u
    ? {
        id: u.id,
        name: u.name,
        initials: u.initials,
        avatar: u.avatar || "",
        role: u.role,
        status: u.status,
        muted: u.muted ? 1 : 0,
        muted_until: u.muted_until ?? null,
      }
    : null;
};
const boardCard = (id) => {
  const b = id ? db.prepare("SELECT id,name,icon,deleted_at FROM categories WHERE id=?").get(id) : null;
  return b ? { id: b.id, name: b.name, icon: b.icon, deleted: !!b.deleted_at } : null;
};

const insertLog = db.prepare(
  `INSERT INTO moderation_log(id,actor_id,action,target_id,detail,created_at,actor_role,target_type,target_label,
     before_state,after_state,reason,needs_approval,approver_id,approval_result,notified,ref_id)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
export function record({
  actorId = null,
  role = "system",
  action,
  targetType = "",
  targetId = "",
  label = "",
  before = "",
  after = "",
  reason = "",
  needsApproval = false,
  approverId = null,
  approvalResult = "",
  notified = false,
  refId = null,
  detail = null,
}) {
  const id = randomUUID();
  insertLog.run(
    id,
    actorId,
    action,
    targetId || "",
    detail ?? [label, reason].filter(Boolean).join(" · "),
    now(),
    role,
    targetType,
    label,
    before,
    after,
    reason,
    needsApproval ? 1 : 0,
    approverId,
    approvalResult,
    notified ? 1 : 0,
    refId,
  );
  return id;
}

const detailOf = ({ title, lines = [], result = "", next = "" }) => ({
  title,
  lines: lines
    .filter((line) => line && line[1] !== undefined && line[1] !== null && String(line[1]).trim())
    .map(([label, value]) => ({ label, value: String(value) })),
  result,
  next,
});
function tell(userId, { text, detail = null, actorId = null, postId = null, important = true, kind = "moderation", refType = "", refId = "", state = "", quiet = false, allowSelf = false, meta = {} }) {
  if (!userId) return null;
  return notify(userId, {
    kind,
    text,
    actorId,
    postId,
    pinned: important,
    important,
    refType,
    refId,
    state,
    quiet,
    allowSelf,
    meta: { ...meta, ...(detail ? { detail } : {}) },
  });
}
function mirrorToOwners(actor, role, summary, detail, refType = "", refId = "") {
  if (!actor || role === "owner" || role === "system" || !summary) return;
  for (const id of ownerIds())
    tell(id, {
      kind: "admin_action",
      text: `${roleTitle(role)} ${actor.name} ${summary}`,
      detail,
      actorId: actor.id,
      important: false,
      quiet: true,
      refType,
      refId,
    });
}
function systemEvent(summary, detail, refType = "", refId = "") {
  for (const id of ownerIds())
    tell(id, { kind: "system_event", text: summary, detail, important: false, quiet: true, refType, refId });
}
export function act(actor, { action, role, target = null, before = "", after = "", reason = "", notices = [], summary = "", detail = null, needsApproval = false, approverId = null, approvalResult = "", refId = null, refType = "", mirror = true, logDetail = null }) {
  let sent = 0;
  for (const n of notices) if (tell(n.userId, { actorId: actor?.id ?? null, ...n })) sent++;
  if (mirror) mirrorToOwners(actor, role, summary, detail, refType, refId || "");
  return record({
    actorId: actor?.id ?? null,
    role,
    action,
    targetType: target?.type || "",
    targetId: target?.id || "",
    label: target?.label || "",
    before,
    after,
    reason,
    needsApproval,
    approverId,
    approvalResult,
    notified: sent > 0,
    refId,
    detail: logDetail,
  });
}

const targetNouns = { user: "用户", post: "帖子", comment: "评论", board: "版块" };
const targetTypes = Object.keys(targetNouns);
const boardDeleted = (id) => !!db.prepare("SELECT 1 FROM categories WHERE id=? AND deleted_at IS NOT NULL").get(id);
export function loadTarget(type, id) {
  if (typeof id !== "string" || !id) return null;
  if (type === "user") {
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    return row && { type, id, row, label: row.name, noun: "用户", subjectId: row.id, boardId: null, postId: null, deleted: row.status === "deleted" };
  }
  if (type === "post") {
    const row = db.prepare("SELECT * FROM posts WHERE id=?").get(id);
    return row && { type, id, row, label: row.title, noun: row.kind === "announcement" ? "公告" : "帖子", subjectId: row.author_id, boardId: row.category, postId: row.id, deleted: !!row.deleted_at };
  }
  if (type === "comment") {
    const row = db
      .prepare(
        `SELECT c.*, p.title AS post_title, p.category, p.deleted_at AS post_deleted_at, p.visibility, p.author_id AS post_author
         FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?`,
      )
      .get(id);
    const noun = row?.parent_id ? "回复" : "评论";
    return row && { type, id, row, label: `「${row.post_title}」下的${noun}`, noun, subjectId: row.author_id, boardId: row.category, postId: row.post_id, deleted: !!row.deleted };
  }
  if (type === "board") {
    const row = db.prepare("SELECT * FROM categories WHERE id=?").get(id);
    return row && { type, id, row, label: row.name, noun: "版块", subjectId: boardLeadId(row.id), boardId: row.id, postId: null, deleted: !!row.deleted_at };
  }
  return null;
}
const mustLoad = (type, id) => {
  if (!targetTypes.includes(type)) fail(400, "对象类型无效。");
  const target = loadTarget(type, id);
  if (!target) fail(404, "该内容不存在或已被永久删除。");
  return target;
};
function describeTarget(target) {
  if (!target) return null;
  const r = target.row;
  if (target.type === "user")
    return { name: r.name, id: r.id, initials: r.initials, avatar: r.avatar || "", bio: r.bio || "", role: r.role, created_at: r.created_at };
  if (target.type === "post")
    return {
      title: r.title,
      content: r.format === "html" ? plainText(r.content, "html") : r.content,
      author: person(r.author_id),
      board: r.kind === "announcement" ? { id: "announcement", name: "全站公告", icon: "Megaphone" } : boardCard(r.category),
      post: { id: r.id, title: r.title },
      visibility: r.visibility,
      created_at: r.created_at,
    };
  if (target.type === "comment") {
    const parent = r.parent_id ? db.prepare("SELECT author_id FROM comments WHERE id=?").get(r.parent_id) : null;
    return {
      content: r.content,
      author: person(r.author_id),
      post: { id: r.post_id, title: r.post_title },
      board: boardCard(r.category),
      reply: !!r.parent_id,
      reply_to: parent ? person(parent.author_id) : null,
      created_at: r.created_at,
    };
  }
  return {
    name: r.name,
    en: r.en,
    description: r.description,
    icon: r.icon,
    builtin: !!r.builtin,
    lead: person(target.subjectId),
    created_at: r.created_at,
  };
}
const snapshotOf = (target) => ({ ...describeTarget(target), captured_at: now() });
function visibleTo(target, viewerId) {
  if (target.deleted) return false;
  if (target.type === "user") return target.row.status === "active";
  if (target.type === "board") return true;
  if (boardDeleted(target.boardId)) return false;
  if (target.type === "post")
    return target.row.visibility === "public" || target.row.author_id === viewerId;
  return !target.row.post_deleted_at && (target.row.visibility === "public" || target.row.post_author === viewerId);
}

export function conflictOf(actor, target) {
  if (!actor || isOwner(actor) || !target) return "";
  if (target.subjectId === actor.id || (target.type === "user" && target.id === actor.id))
    return "该事项与你本人直接相关，需由站主处理。";
  if (target.type === "board" && boardRoleOf(actor.id, target.id)) return "你是该版块的管理成员，需由站主处理。";
  const subject = person(target.subjectId);
  if (subject && subject.role !== "member") return "涉及管理员的事项由站主处理。";
  return "";
}
function deletionMode(actor, target) {
  if (!actor || !target) return null;
  if (target.type === "user") {
    const u = target.row;
    if (u.role === "owner" || u.id === actor.id || u.demo) return null;
    if (isOwner(actor)) return "direct";
    return isAdmin(actor) && u.role === "member" ? "request" : null;
  }
  if (target.type === "board") {
    if (isOwner(actor)) return "direct";
    return isAdmin(actor) && !conflictOf(actor, target) ? "request" : null;
  }
  if (isOwner(actor) || target.subjectId === actor.id) return "direct";
  if (target.type === "post" && target.row.kind === "announcement") return isAdmin(actor) ? "request" : null;
  if (boardRoleOf(actor.id, target.boardId)) return "direct";
  return isAdmin(actor) ? "request" : null;
}
function canMute(actor, target) {
  if (!actor || !target || target.deleted || !isStaff(actor)) return false;
  if (target.type === "user") {
    const u = target.row;
    return !u.demo && u.id !== actor.id && u.role !== "owner" && u.status !== "deleted" && (isOwner(actor) || u.role === "member");
  }
  if (target.type === "board") return isOwner(actor) || !conflictOf(actor, target);
  return false;
}
function caseAccess(viewer, kase) {
  if (!viewer) return { view: false };
  if (isOwner(viewer)) return { view: true, handle: true, reporters: true, conflict: "" };
  const target = loadTarget(kase.target_type, kase.target_id) || {
    type: kase.target_type,
    id: kase.target_id,
    subjectId: kase.subject_id,
    boardId: kase.board_id,
  };
  if (isAdmin(viewer)) {
    const conflict = conflictOf(viewer, target);
    return { view: true, handle: !conflict, reporters: true, conflict };
  }
  if (["post", "comment"].includes(kase.target_type) && boardRoleOf(viewer.id, kase.board_id)) {
    const conflict = kase.subject_id === viewer.id ? "该事项与你本人直接相关，需由站主处理。" : "";
    return { view: true, handle: !conflict, reporters: false, conflict };
  }
  return { view: false };
}
const moderatedBoardIds = (userId) =>
  db
    .prepare(
      `SELECT m.category_id FROM category_moderators m JOIN categories c ON c.id=m.category_id
       WHERE m.user_id=? AND c.deleted_at IS NULL`,
    )
    .all(userId)
    .map((r) => r.category_id);
const canReview = (user) => isStaff(user) || moderatedBoardIds(user?.id).length > 0;

const activePenalty = (type, id) =>
  db.prepare("SELECT * FROM penalties WHERE target_type=? AND target_id=? AND status='active'").get(type, id);
function setMirror(type, id, penalty) {
  const table = type === "user" ? "users" : "categories";
  db.prepare(`UPDATE ${table} SET muted=?,muted_until=?,mute_reason=? WHERE id=?`).run(
    penalty ? 1 : 0,
    penalty?.ends_at ?? null,
    penalty ? penalty.reason || "" : "",
    id,
  );
}
function appealState(penaltyId) {
  const pending = db
    .prepare("SELECT id,reason,created_at FROM appeals WHERE penalty_id=? AND status='pending'")
    .get(penaltyId);
  const rejected = db
    .prepare(
      "SELECT resolved_at,resolve_note FROM appeals WHERE penalty_id=? AND status='rejected' ORDER BY resolved_at DESC LIMIT 1",
    )
    .get(penaltyId);
  const cooldown = rejected && rejected.resolved_at + APPEAL_COOLDOWN > now() ? rejected.resolved_at + APPEAL_COOLDOWN : null;
  return {
    pending: pending || null,
    cooldown_until: cooldown,
    rejected: rejected ? { at: rejected.resolved_at, note: rejected.resolve_note } : null,
  };
}
export function penaltyView(type, id, { privileged = false } = {}) {
  expireIfDue(type, id);
  const p = activePenalty(type, id);
  if (!p) return null;
  const appeal = appealState(p.id);
  return {
    id: p.id,
    starts_at: p.starts_at,
    until: p.ends_at ?? null,
    reason: privileged ? p.reason : "",
    appeal_pending: privileged ? !!appeal.pending : false,
    appeal_at: privileged ? appeal.pending?.created_at ?? null : null,
    cooldown_until: privileged ? appeal.cooldown_until : null,
  };
}
function parseDuration(input) {
  if (Number.isInteger(input)) {
    if (input < 0 || input > 3650) fail(400, "禁言时长需为 0–3650 天，0 表示永久禁言。");
    return input === 0 ? { mode: "permanent" } : { mode: "days", days: input };
  }
  if (!input || typeof input !== "object") fail(400, "请选择禁言期限。");
  if (input.mode === "permanent") return { mode: "permanent" };
  if (input.mode === "days") {
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > 3650) fail(400, "禁言天数需为 1–3650 天。");
    return { mode: "days", days: input.days };
  }
  if (input.mode === "until") {
    const until = Number(input.until);
    if (!Number.isFinite(until) || until <= now() + 60000 || until > now() + MAX_SPAN)
      fail(400, "自定义截止时间需晚于现在，且不超过十年。");
    return { mode: "until", until: Math.round(until) };
  }
  fail(400, "请选择禁言期限。");
}
const targetPhrase = (target) => (target.type === "user" ? "你的账号" : `「${target.label}」版块`);
const muteOf = (target) => (target.type === "user" ? "你账号的禁言" : `「${target.label}」版块的禁言`);
const muteEffect = (target) =>
  target.type === "user"
    ? "禁言期间无法发帖、评论、回复或发送私信，浏览与收藏不受影响。"
    : "禁言期间版块内无法发布新帖、评论和回复，已有内容仍可正常浏览。";
const appealHint = (target) =>
  target.type === "user" ? "如有异议，可在个人主页点击禁言标记向站主申诉。" : "版主可以点击版块上的禁言标记向站主申诉。";
const affectedBy = (target) => (target.type === "user" ? [target.id] : boardKeepers(target.id));
function mute(actor, target, { duration, reason = "", caseId = null, strategy = "extend", context = "", role = actorRole(actor) }) {
  if (!canMute(actor, target)) fail(403, target.type === "user" ? "你不能禁言这位用户。" : "你不能禁言这个版块。");
  const spec = parseDuration(duration);
  const type = target.type;
  const note = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  const t = now();
  const existing = activePenalty(type, target.id);
  let endsAt;
  let action;
  let headline;
  if (!existing) {
    endsAt = spec.mode === "permanent" ? null : spec.mode === "days" ? t + spec.days * DAY : spec.until;
    db.prepare(
      `INSERT INTO penalties(id,target_type,target_id,reason,starts_at,ends_at,status,actor_id,case_id,created_at)
       VALUES(?,?,?,?,?,?,'active',?,?,?)`,
    ).run(randomUUID(), type, target.id, note, t, endsAt, actor.id, caseId, t);
    action = `mute_${type === "user" ? "user" : "board"}`;
    headline = `${targetPhrase(target)}已被禁言（${spanText(endsAt)}）`;
  } else {
    if (spec.mode === "permanent") endsAt = null;
    else if (spec.mode === "until") endsAt = spec.until;
    else if (strategy === "replace") endsAt = t + spec.days * DAY;
    else if (existing.ends_at === null) fail(400, "当前已是永久禁言，可改为自定义截止时间。");
    else endsAt = existing.ends_at + spec.days * DAY;
    if (endsAt !== null && endsAt - t > MAX_SPAN) fail(400, "禁言期限不能超过十年。");
    if (endsAt === existing.ends_at && !note) fail(400, "新的期限与当前相同。");
    const changes = readJson(existing.changes, []);
    changes.push({ at: t, by: actor.id, from: existing.ends_at, to: endsAt, reason: note });
    db.prepare("UPDATE penalties SET ends_at=?,reason=?,case_id=COALESCE(?,case_id),changes=? WHERE id=?").run(
      endsAt,
      note || existing.reason,
      caseId,
      JSON.stringify(changes),
      existing.id,
    );
    const kind =
      endsAt === null ? "escalate" : existing.ends_at === null || endsAt < existing.ends_at ? "modify" : "extend";
    action = `${kind}_mute_${type === "user" ? "user" : "board"}`;
    headline =
      kind === "escalate"
        ? `${targetPhrase(target)}的禁言已升级为永久禁言`
        : kind === "extend"
          ? `${targetPhrase(target)}的禁言已延长（${spanText(endsAt)}）`
          : `${targetPhrase(target)}的禁言期限已调整（${spanText(endsAt)}）`;
  }
  const penalty = activePenalty(type, target.id);
  setMirror(type, target.id, penalty);
  const who = roleTitle(role);
  const detail = detailOf({
    title: headline,
    lines: [
      ["处理人", who],
      ["对象", type === "user" ? "你的账号" : `「${target.label}」版块`],
      ["原因", penalty.reason],
      ["相关内容", context],
      ["期限", spanText(endsAt)],
      ["时间", dateText(t)],
    ],
    result: endsAt ? `禁言中，${dateText(endsAt)} 自动解除` : "永久禁言",
    next: appealHint(target),
  });
  const until = endsAt ? `将于 ${dateText(endsAt)} 自动解除` : "";
  const headlineText = !existing
    ? endsAt
      ? `${who}对${targetPhrase(target)}设置了禁言，${until}。`
      : `${who}对${targetPhrase(target)}设置了永久禁言。`
    : endsAt === null
      ? `${who}将${muteOf(target)}升级为永久禁言。`
      : `${who}${endsAt > (existing.ends_at ?? Infinity) ? "延长" : "调整"}了${muteOf(target)}，${until}。`;
  const text =
    headlineText +
    (context ? `\n起因：${context}收到投诉。` : "") +
    noteLine("原因", penalty.reason) +
    `\n${muteEffect(target)}` +
    `\n${appealHint(target)}`;
  act(actor, {
    action,
    role,
    target,
    before: existing ? `禁言 ${spanText(existing.ends_at)}` : "正常",
    after: `禁言 ${spanText(endsAt)}`,
    reason: penalty.reason,
    refId: caseId,
    summary: `${existing ? "调整了" : "禁言了"}${targetNouns[type]}「${target.label}」（${spanText(endsAt)}）`,
    detail,
    logDetail: JSON.stringify({ until: endsAt ? dateText(endsAt) : "永久", note: penalty.reason, ...(context ? { context } : {}) }),
    notices: affectedBy(target).map((userId) => ({ userId, text, detail })),
  });
  return penalty;
}
function endPenalty(actor, penalty, { status = "lifted", reason = "", role = actorRole(actor), text = null, detail = null, action = null }) {
  const t = now();
  const changed = db
    .prepare("UPDATE penalties SET status=?,ended_at=?,ended_by=?,end_reason=? WHERE id=? AND status='active'")
    .run(status, t, actor?.id ?? null, reason, penalty.id).changes;
  if (!changed) return false;
  const target = loadTarget(penalty.target_type, penalty.target_id);
  setMirror(penalty.target_type, penalty.target_id, null);
  for (const a of db.prepare("SELECT id FROM appeals WHERE penalty_id=? AND status='pending'").all(penalty.id)) {
    db.prepare("UPDATE appeals SET status='closed',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(
      t,
      actor?.id ?? null,
      status === "expired" ? "禁言已到期，申诉自动关闭" : "禁言已解除，申诉自动关闭",
      a.id,
    );
    settleNotices("appeal", a.id, status === "expired" ? "禁言已到期自动解除，申诉自动关闭" : "禁言已解除，申诉自动关闭", "已关闭");
  }
  if (!target) return true;
  const kind = penalty.target_type === "user" ? "user" : "board";
  const expired = status === "expired";
  const who = roleTitle(role);
  const finalDetail =
    detail ||
    detailOf({
      title: expired ? `${targetPhrase(target)}的禁言已到期解除` : `${targetPhrase(target)}的禁言已解除`,
      lines: [
        ["处理人", expired ? "系统" : who],
        ["原处罚", `禁言 ${spanText(penalty.ends_at)}`],
        ["原因", reason],
        ["时间", dateText(t)],
      ],
      result: "已恢复正常",
      next: kind === "user" ? "现在可以正常发帖、评论和发送私信。" : "版块现在可以正常发布内容。",
    });
  const recovered =
    kind === "user" ? "\n现在可以正常发帖、评论、回复和发送私信了。" : "\n版块已恢复正常，可以继续发布内容。";
  const finalText =
    text ||
    (expired
      ? `${kind === "user" ? "你的禁言" : `「${target.label}」版块的禁言`}已到期自动解除。${recovered}`
      : `${who}解除了${muteOf(target)}。${noteLine("说明", reason)}${recovered}`);
  act(actor, {
    action: action || `${expired ? "expire" : "un"}${expired ? "_mute_" : "mute_"}${kind}`,
    role,
    target,
    before: `禁言 ${spanText(penalty.ends_at)}`,
    after: "正常",
    reason,
    refId: penalty.id,
    summary: `解除了${targetNouns[penalty.target_type]}「${target.label}」的禁言`,
    detail: finalDetail,
    logDetail: expired ? "禁言到期自动解除" : "已解除禁言",
    notices: target.deleted ? [] : affectedBy(target).map((userId) => ({ userId, text: finalText, detail: finalDetail })),
  });
  if (expired)
    systemEvent(`${targetNouns[penalty.target_type]}「${target.label}」的禁言已到期自动解除`, finalDetail);
  return true;
}
function unmute(actor, target, { reason = "", role = actorRole(actor) } = {}) {
  if (!isStaff(actor) || (!isOwner(actor) && conflictOf(actor, target)))
    fail(403, target.type === "user" ? "你不能解除这位用户的禁言。" : "你不能解除这个版块的禁言。");
  const p = activePenalty(target.type, target.id);
  if (!p) fail(409, "该对象当前没有禁言，可能已被其他管理员解除。");
  endPenalty(actor, p, { reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "", role });
}
function expireIfDue(type, id) {
  const p = activePenalty(type, id);
  if (p && p.ends_at !== null && p.ends_at <= now()) endPenalty(null, p, { status: "expired" });
}
function sweepExpired() {
  for (const p of db
    .prepare("SELECT * FROM penalties WHERE status='active' AND ends_at IS NOT NULL AND ends_at<=?")
    .all(now()))
    endPenalty(null, p, { status: "expired" });
}
export function userMute(user) {
  if (!user?.muted) return null;
  expireIfDue("user", user.id);
  const p = activePenalty("user", user.id);
  if (!p) {
    Object.assign(user, { muted: 0, muted_until: null, mute_reason: "" });
    return null;
  }
  return { until: p.ends_at ?? null, reason: p.reason || "", starts_at: p.starts_at, id: p.id };
}
export function boardMute(boardId) {
  if (!boardId) return null;
  expireIfDue("board", boardId);
  const p = activePenalty("board", boardId);
  if (!p) return null;
  const name = db.prepare("SELECT name FROM categories WHERE id=?").get(boardId)?.name || "该";
  return {
    until: p.ends_at ?? null,
    message: `「${name}」版块已被禁言${p.ends_at ? "，" + dateText(p.ends_at) + " 自动解除" : ""}，暂时无法发布新的帖子、评论或回复。`,
  };
}

function appealTarget(applicant, type, id) {
  if (type === "user") {
    if (id !== applicant.id) fail(403, "只能为自己的账号申诉。");
    return mustLoad("user", id);
  }
  if (type === "board") {
    const target = mustLoad("board", id);
    if (target.deleted) fail(404, "该版块已被删除。");
    if (boardRoleOf(applicant.id, id) !== "lead") fail(403, "只有版主可以为版块申诉。");
    return target;
  }
  fail(400, "申诉对象无效。");
}
export function fileAppeal(applicant, type, id, reason) {
  const target = appealTarget(applicant, type, id);
  expireIfDue(type, id);
  const p = activePenalty(type, id);
  if (!p) fail(400, type === "user" ? "你当前没有被禁言，无需申诉。" : "该版块当前没有被禁言，无需申诉。");
  if (!validText(reason, 2, 2000)) fail(400, "请填写 2–2000 字申诉理由。");
  const state = appealState(p.id);
  if (state.pending) fail(409, "申诉正在处理中", { code: "appeal_pending" });
  if (state.cooldown_until)
    fail(429, `上次申诉已被驳回，${dateText(state.cooldown_until)} 之后可以再次申诉。`, {
      code: "appeal_cooldown",
      cooldown_until: state.cooldown_until,
    });
  const appeal = { id: randomUUID(), reason: reason.trim(), created_at: now() };
  db.prepare(
    "INSERT INTO appeals(id,penalty_id,target_type,target_id,applicant_id,reason,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(appeal.id, p.id, type, id, applicant.id, appeal.reason, appeal.created_at);
  const object = type === "user" ? "本人账号的禁言" : `「${target.label}」版块的禁言`;
  const detail = detailOf({
    title: "新的禁言申诉",
    lines: [
      ["申请人", `${applicant.name}（ID ${applicant.id}）`],
      ["身份", type === "user" ? "被禁言用户" : "版主"],
      ["申诉对象", object],
      ["原处罚", `禁言 ${spanText(p.ends_at)}`],
      ["处罚原因", p.reason],
      ["提交时间", dateText(appeal.created_at)],
      ["申诉理由", clip(appeal.reason, 80)],
    ],
    result: "待处理",
    next: "点击即可打开申诉详情，选择同意或驳回。",
  });
  const role = type === "user" ? "member" : "lead";
  for (const ownerId of ownerIds())
    tell(ownerId, {
      kind: "appeal",
      text: `${applicant.name} 对${object}提出了申诉，等待你处理。`,
      detail,
      actorId: applicant.id,
      refType: "appeal",
      refId: appeal.id,
      state: "pending",
    });
  record({
    actorId: applicant.id,
    role,
    action: "file_appeal",
    targetType: type,
    targetId: id,
    label: target.label,
    before: `禁言 ${spanText(p.ends_at)}`,
    after: "申诉中",
    reason: clip(appeal.reason, 200),
    needsApproval: true,
    notified: true,
    refId: appeal.id,
  });
  return appeal;
}
const appealRow = (id) => db.prepare("SELECT * FROM appeals WHERE id=?").get(id);
const resolutionText = { approved: "已同意", rejected: "已驳回", closed: "已关闭", pending: "待处理" };
function appealDetail(viewer, id) {
  if (!isStaff(viewer)) fail(403, "需要管理权限。");
  const a = appealRow(id);
  if (!a) fail(404, "该申诉不存在。");
  const p = db.prepare("SELECT * FROM penalties WHERE id=?").get(a.penalty_id);
  const target = loadTarget(a.target_type, a.target_id);
  return {
    id: a.id,
    status: a.status,
    status_label: resolutionText[a.status],
    reason: a.reason,
    created_at: a.created_at,
    resolved_at: a.resolved_at,
    resolve_note: a.resolve_note,
    resolver: person(a.resolver_id),
    target_type: a.target_type,
    target: target
      ? { id: target.id, label: target.label, deleted: target.deleted, ...(a.target_type === "board" ? { icon: target.row.icon } : {}) }
      : { id: a.target_id, label: "已删除的对象", deleted: true },
    applicant: person(a.applicant_id),
    penalty: p
      ? { id: p.id, reason: p.reason, starts_at: p.starts_at, until: p.ends_at, status: p.status, actor: person(p.actor_id) }
      : null,
    can_decide: isOwner(viewer) && a.status === "pending",
  };
}
function listAppeals(viewer, { status = "pending" } = {}) {
  if (!isStaff(viewer)) fail(403, "需要管理权限。");
  const rows = db
    .prepare(
      `SELECT id FROM appeals ${status === "all" ? "" : "WHERE status=?"} ORDER BY status='pending' DESC, created_at DESC LIMIT 100`,
    )
    .all(...(status === "all" ? [] : [status]));
  return rows.map((r) => appealDetail(viewer, r.id));
}
function decideAppeal(owner, id, { decision, reason = "" }) {
  if (!isOwner(owner)) fail(403, "只有站主可以处理禁言申诉。");
  if (!["approve", "reject"].includes(decision)) fail(400, "请选择同意或驳回。");
  if (typeof reason !== "string" || reason.length > 500) fail(400, "处理说明最多 500 字。");
  const a = appealRow(id);
  if (!a) fail(404, "该申诉不存在。");
  if (a.status !== "pending")
    fail(409, `该申诉已处理（${resolutionText[a.status]}）`, { code: "already_handled", appeal: appealDetail(owner, id) });
  const note = reason.trim();
  const p = db.prepare("SELECT * FROM penalties WHERE id=?").get(a.penalty_id);
  const target = loadTarget(a.target_type, a.target_id);
  const t = now();
  const object = a.target_type === "user" ? "账号禁言" : `「${target?.label || "版块"}」版块禁言`;
  if (decision === "approve") {
    db.prepare("UPDATE appeals SET status='approved',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(t, owner.id, note, a.id);
    const detail = detailOf({
      title: "申诉已通过",
      lines: [
        ["处理人", "站主"],
        ["申诉对象", object],
        ["原处罚", p ? `禁言 ${spanText(p.ends_at)}` : ""],
        ["说明", note],
        ["时间", dateText(t)],
      ],
      result: "禁言已解除",
      next: a.target_type === "user" ? "现在可以正常发帖、评论和发送私信。" : "版块现在可以正常发布内容。",
    });
    const text =
      `站主同意了你对${object}的申诉，禁言已解除。` +
      noteLine("说明", note) +
      (a.target_type === "user" ? "\n现在可以正常发帖、评论、回复和发送私信了。" : "\n版块已恢复正常，可以继续发布内容。");
    if (p?.status === "active")
      endPenalty(owner, p, { reason: note || "申诉通过", role: "owner", text, detail, action: "approve_appeal" });
    else
      act(owner, {
        action: "approve_appeal",
        role: "owner",
        target,
        reason: note,
        refId: a.id,
        notices: [{ userId: a.applicant_id, text, detail }],
      });
  } else {
    db.prepare("UPDATE appeals SET status='rejected',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(t, owner.id, note, a.id);
    const detail = detailOf({
      title: "申诉未通过",
      lines: [
        ["处理人", "站主"],
        ["申诉对象", object],
        ["驳回理由", note],
        ["当前处罚", p ? `禁言 ${spanText(p.ends_at)}` : ""],
        ["时间", dateText(t)],
      ],
      result: "原处罚保持不变",
      next: `${dateText(t + APPEAL_COOLDOWN)} 之后可以再次申诉。`,
    });
    act(owner, {
      action: "reject_appeal",
      role: "owner",
      target,
      before: "申诉中",
      after: "原处罚保持",
      reason: note,
      refId: a.id,
      notices: [
        {
          userId: a.applicant_id,
          text: `站主驳回了你对${object}的申诉，原处罚保持不变。${noteLine("驳回理由", note)}\n${dateText(t + APPEAL_COOLDOWN)} 之后可以再次申诉。`,
          detail,
        },
      ],
    });
  }
  settleNotices(
    "appeal",
    a.id,
    `${decision === "approve" ? "已同意，禁言已解除" : "已驳回，原处罚保持不变"}${note ? `；说明：${clause(note)}` : ""}`,
    decision === "approve" ? "已同意" : "已驳回",
  );
  return appealDetail(owner, id);
}

let hooks = { purgePost: null, purgeComment: null, purgeUser: null };
export const configureGovernance = (next) => {
  hooks = { ...hooks, ...next };
};
function voidRequests(target, actor, exceptId, note) {
  for (const r of db
    .prepare("SELECT * FROM delete_requests WHERE target_type=? AND target_id=? AND status='pending'")
    .all(target.type, target.id)) {
    if (r.id === exceptId) continue;
    db.prepare("UPDATE delete_requests SET status='void',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(
      now(),
      actor?.id ?? null,
      note,
      r.id,
    );
    if (r.case_id) db.prepare("UPDATE complaint_cases SET request_id=NULL WHERE id=? AND request_id=?").run(r.case_id, r.id);
    settleNotices("delete_request", r.id, `申请已关闭：${clause(note)}`, "已关闭");
    tell(r.requester_id, {
      text: `你提交的删除${targetNouns[r.target_type]}「${target.label}」的申请已关闭。${noteLine("原因", note)}`,
      detail: detailOf({
        title: "删除申请已关闭",
        lines: [["对象", `${targetNouns[r.target_type]}「${target.label}」`], ["原因", note], ["时间", dateText(now())]],
        result: "无需再审批",
      }),
      refType: "delete_request",
      refId: r.id,
      state: "handled",
    });
  }
}
const deletionText = (target, who, context, reason) => {
  const head = {
    post: `${who}删除了你的讨论「${target.label}」。`,
    comment: `${who}删除了你在「${target.row?.post_title}」下的${target.noun}。`,
    board: `${who}删除了「${target.label}」版块，版块入口已关闭，内容不再公开显示。`,
    user: `${who}删除了你的账号。`,
  }[target.type];
  const subject = { post: "这篇讨论", comment: `这条${target.noun}`, board: "该版块", user: "你的账号" }[target.type];
  const cause = context ? `\n起因：${context === "收到投诉" ? subject + "收到投诉" : context}。` : "";
  const ask = ["post", "comment"].includes(target.type) ? "\n如有疑问，可以回复这条消息询问。" : "";
  return head + cause + noteLine("原因", reason) + ask;
};
function removeTarget(actor, target, { reason = "", context = "", role = actorRole(actor, target.boardId), approverId = null, requestId = null, caseId = null } = {}) {
  if (target.deleted) fail(409, "该内容已被删除。", { code: "already_deleted" });
  const t = now();
  const by = actor?.id ?? null;
  const note = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (target.type === "post")
    db.prepare("UPDATE posts SET deleted_at=?,deleted_by=?,delete_reason=? WHERE id=? AND deleted_at IS NULL").run(t, by, note, target.id);
  else if (target.type === "comment")
    db.prepare("UPDATE comments SET deleted=1,deleted_at=?,deleted_by=?,delete_reason=? WHERE id=? AND deleted=0").run(t, by, note, target.id);
  else if (target.type === "board")
    db.prepare("UPDATE categories SET deleted_at=?,deleted_by=?,delete_reason=? WHERE id=? AND deleted_at IS NULL").run(t, by, note, target.id);
  else {
    db.prepare("UPDATE users SET status='deleted',deleted_at=?,deleted_by=?,delete_reason=? WHERE id=?").run(t, by, note, target.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
    closeUserStreams(target.id);
  }
  voidRequests(target, actor, requestId, "对象已被删除");
  const own = actor && target.type !== "board" && target.subjectId === actor.id;
  if (own) return { mode: "own" };
  const who = roleTitle(role);
  const detail = detailOf({
    title: `${target.noun}已被删除`,
    lines: [
      ["处理人", who],
      ["对象", target.type === "comment" ? target.label : `${target.noun}「${target.label}」`],
      ["原因", note],
      ["相关投诉", context ? "是" : ""],
      ["时间", dateText(t)],
    ],
    result: "前台已不再显示，后台保留原始记录",
    next: target.type === "user" ? "" : "如有疑问，可以回复这条消息询问。",
  });
  const recipients =
    target.type === "board" ? boardKeepers(target.id) : target.subjectId ? [target.subjectId] : [];
  act(actor, {
    action: { post: "delete_post", comment: "delete_comment", board: "delete_category", user: "remove_user" }[target.type],
    role,
    target,
    before: "正常",
    after: "已删除（可恢复）",
    reason: note,
    approverId,
    approvalResult: approverId ? "approved" : "",
    needsApproval: !!approverId,
    refId: requestId || caseId,
    summary: `删除了${target.noun}「${target.label}」`,
    detail,
    logDetail: target.label + (note ? " · " + note : ""),
    notices: recipients.map((userId) => ({
      userId,
      text: deletionText(target, who, context, note),
      detail,
      postId: target.type === "comment" ? target.postId : null,
    })),
  });
  return { mode: "direct" };
}
export function requestOrRemove(actor, type, id, { reason = "" } = {}) {
  const target = mustLoad(type, id);
  if (target.deleted) fail(404, "该内容已被删除。", { deleted: true });
  const mode = deletionMode(actor, target);
  if (mode === "request") requestRequired();
  if (mode !== "direct") fail(403, type === "post" ? "你只能删除自己的讨论。" : type === "comment" ? "你只能删除自己的回复。" : "你没有删除权限。");
  return removeTarget(actor, target, { reason });
}
export const TRASH_DAYS = 30;
const trashCutoff = () => now() - TRASH_DAYS * DAY;
const trashTables = {
  post: { table: "posts", alias: "x", deleted: "x.deleted_at IS NOT NULL" },
  comment: { table: "comments", alias: "x", deleted: "x.deleted=1 AND x.content<>''" },
  board: { table: "categories", alias: "x", deleted: "x.deleted_at IS NOT NULL" },
  user: { table: "users", alias: "x", deleted: "x.status='deleted'" },
};
const approvedBy = (type) =>
  `EXISTS (SELECT 1 FROM delete_requests r WHERE r.target_type='${type}' AND r.target_id=x.id AND r.requester_id=?
     AND r.status='approved' AND r.resolved_at BETWEEN x.deleted_at - 60000 AND x.deleted_at + 60000)`;
function trashScope(viewer, type) {
  const source = trashTables[type];
  const conditions = [source.deleted, "x.deleted_at >= ?"];
  const args = [trashCutoff()];
  if (!isOwner(viewer)) {
    conditions.push(approvedBy(type));
    args.push(viewer.id);
  }
  return { from: `${source.table} x`, where: conditions.join(" AND "), args };
}
function canRestore(actor, target) {
  if (isOwner(actor)) return true;
  if (!isAdmin(actor) || !target.deleted || !target.row.deleted_at || target.row.deleted_at < trashCutoff()) return false;
  const scope = trashScope(actor, target.type);
  return !!db.prepare(`SELECT 1 FROM ${scope.from} WHERE x.id=? AND ${scope.where}`).get(target.id, ...scope.args);
}
function sweepTrash() {
  const cutoff = trashCutoff();
  let purged = 0;
  const run = (type, sql) => {
    for (const { id } of db.prepare(sql).all(cutoff)) {
      const target = loadTarget(type, id);
      if (!target?.deleted) continue;
      try {
        purgeNow(null, target);
        purged++;
      } catch (error) {
        console.error(`Trash sweep failed for ${type} ${id}:`, error.message);
      }
    }
  };
  run("comment", "SELECT id FROM comments WHERE deleted=1 AND content<>'' AND deleted_at < ?");
  run("post", "SELECT id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < ?");
  run("board", "SELECT id FROM categories WHERE deleted_at IS NOT NULL AND deleted_at < ?");
  if (hooks.purgeUser) run("user", "SELECT id FROM users WHERE status='deleted' AND deleted_at IS NOT NULL AND deleted_at < ? AND role<>'owner'");
  return purged;
}

function restoreTarget(actor, type, id, reason = "") {
  if (!isStaff(actor)) fail(403, "只有站主和管理员可以恢复已删除的内容。");
  const target = mustLoad(type, id);
  if (!target.deleted) fail(409, "该内容没有被删除。");
  if (!canRestore(actor, target)) fail(403, "你只能恢复自己申请、经站主批准后删除的内容。");
  const role = actorRole(actor);
  const who = roleTitle(role);
  const note = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  if (type === "post") db.prepare("UPDATE posts SET deleted_at=NULL,deleted_by=NULL,delete_reason='' WHERE id=?").run(id);
  else if (type === "comment") {
    const files = db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner_type='comment' AND owner_id=?").get(id).n;
    if (!target.row.content && !files) fail(400, "这条评论的原文在旧版本中已被清空，无法恢复。");
    if (target.row.post_deleted_at) fail(400, "所在帖子已被删除，请先恢复帖子。");
    db.prepare("UPDATE comments SET deleted=0,deleted_at=NULL,deleted_by=NULL,delete_reason='' WHERE id=?").run(id);
  } else if (type === "board") {
    if (db.prepare("SELECT 1 FROM categories WHERE name=? COLLATE NOCASE AND id<>? AND deleted_at IS NULL").get(target.row.name, id))
      fail(409, "已经有同名版块，请先修改其中一个的名称。");
    db.prepare("UPDATE categories SET deleted_at=NULL,deleted_by=NULL,delete_reason='' WHERE id=?").run(id);
  } else db.prepare("UPDATE users SET status='active',deleted_at=NULL,deleted_by=NULL,delete_reason='' WHERE id=?").run(id);
  const detail = detailOf({
    title: `${target.noun}已恢复`,
    lines: [
      ["处理人", who],
      ["对象", target.type === "comment" ? target.label : `${target.noun}「${target.label}」`],
      ["说明", note],
      ["时间", dateText(now())],
    ],
    result: "已恢复正常显示",
  });
  const text = {
    post: `${who}恢复了你的讨论「${target.label}」，其他人可以重新看到它。`,
    comment: `${who}恢复了你在${target.label.replace(/下的.*$/, "")}下的${target.noun}。`,
    board: `${who}恢复了「${target.label}」版块，版块入口已重新开放。`,
    user: `${who}恢复了你的账号，欢迎回来。`,
  }[type] + noteLine("说明", note);
  const recipients = type === "board" ? boardKeepers(id) : target.subjectId ? [target.subjectId] : [];
  act(actor, {
    action: { post: "restore_post", comment: "restore_comment", board: "restore_category", user: "restore_user" }[type],
    role,
    summary: `恢复了${target.type === "comment" ? target.label : `${target.noun}「${target.label}」`}`,
    target,
    before: "已删除",
    after: "正常",
    reason: note,
    detail,
    notices: recipients.map((userId) => ({ userId, text, detail, postId: type === "board" || type === "user" ? null : target.postId })),
  });
}
function purgeTarget(actor, type, id) {
  if (!isOwner(actor)) fail(403, "只有站主可以永久删除。");
  const target = mustLoad(type, id);
  if (type === "user") fail(400, "永久删除用户请使用账号删除流程。");
  if (!target.deleted) fail(400, "请先删除，再从回收站永久删除。");
  return purgeNow(actor, target);
}
function purgeNow(actor, target) {
  const { type, id } = target;
  if (type === "user") {
    hooks.purgeUser(target.row);
    return { posts: 0 };
  }
  const expired = !actor;
  const who = expired ? "系统（回收站保留期已满）" : "站主";
  const recipients = type === "board" ? boardKeepers(id) : target.subjectId ? [target.subjectId] : [];
  let posts = 0;
  if (type === "post") hooks.purgePost(target.row);
  else if (type === "comment") hooks.purgeComment(target.row);
  else {
    for (const p of db.prepare("SELECT * FROM posts WHERE category=?").all(id)) {
      hooks.purgePost(p);
      posts++;
    }
    db.prepare("DELETE FROM follows WHERE category=?").run(id);
    db.prepare("DELETE FROM notify_subscriptions WHERE kind='board' AND target_id=?").run(id);
    db.prepare("DELETE FROM topic_tracks WHERE kind='category' AND value=?").run(id);
    db.prepare("DELETE FROM categories WHERE id=?").run(id);
  }
  const detail = detailOf({
    title: `${target.noun}已被永久删除`,
    lines: [
      ["处理人", who],
      ["对象", target.type === "comment" ? target.label : `${target.noun}「${target.label}」`],
      ["连带帖子", posts ? `${posts} 篇` : ""],
      ["时间", dateText(now())],
    ],
    result: "已无法恢复",
  });
  act(actor, {
    action: `purge_${type === "board" ? "category" : type}`,
    role: expired ? "system" : "owner",
    target,
    before: "已删除（可恢复）",
    after: "永久删除",
    detail,
    logDetail: target.label + (posts ? ` · 连带 ${posts} 篇帖子` : ""),
    notices: recipients.map((userId) => ({
      userId,
      text: `${target.type === "comment" ? `你在${target.label}` : `你的${target.noun}「${target.label}」`}${expired ? "在回收站保留期满后被系统" : "已被站主"}永久删除，无法再恢复。`,
      detail,
    })),
  });
  return { posts };
}
export function forgetUser(userId, label = "已删除用户") {
  const t = now();
  db.prepare("UPDATE penalties SET status='lifted',ended_at=?,end_reason='账号已删除' WHERE target_type='user' AND target_id=? AND status='active'").run(t, userId);
  for (const a of db.prepare("SELECT id FROM appeals WHERE target_type='user' AND target_id=? AND status='pending'").all(userId)) {
    db.prepare("UPDATE appeals SET status='closed',resolved_at=?,resolve_note='账号已删除' WHERE id=?").run(t, a.id);
    settleNotices("appeal", a.id, "账号已删除，申诉自动关闭", "已关闭");
  }
  voidRequests({ type: "user", id: userId, label }, null, null, "账号已被永久删除");
}

function fileDeleteRequest(actor, type, id, { reason, detail = "", caseId = null }) {
  if (!isAdmin(actor)) fail(403, isOwner(actor) ? "站主可以直接删除。" : "只有管理员可以提交删除申请。");
  const target = mustLoad(type, id);
  if (target.deleted) fail(409, "该内容已被删除。", { code: "already_deleted" });
  const mode = deletionMode(actor, target);
  if (mode === "direct") fail(400, "你可以直接删除这个对象。");
  if (mode !== "request") fail(403, conflictOf(actor, target) || "这个对象不能申请删除。");
  if (!validText(reason, 2, 200)) fail(400, "请填写 2–200 字申请理由。");
  if (typeof detail !== "string" || detail.length > 2000) fail(400, "补充说明最多 2000 字。");
  if (db.prepare("SELECT 1 FROM delete_requests WHERE target_type=? AND target_id=? AND status='pending'").get(type, id))
    fail(409, "删除申请正在处理中", { code: "request_pending" });
  if (caseId) {
    const kase = db.prepare("SELECT * FROM complaint_cases WHERE id=?").get(caseId);
    if (!kase || kase.target_type !== type || kase.target_id !== id) caseId = null;
  }
  const request = { id: randomUUID(), created_at: now() };
  db.prepare(
    `INSERT INTO delete_requests(id,requester_id,target_type,target_id,case_id,snapshot,reason,detail,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(request.id, actor.id, type, id, caseId, JSON.stringify(snapshotOf(target)), reason.trim(), detail.trim(), request.created_at);
  if (caseId) db.prepare("UPDATE complaint_cases SET request_id=?,updated_at=? WHERE id=?").run(request.id, request.created_at, caseId);
  const object = target.type === "comment" ? target.label : `${target.noun}「${target.label}」`;
  const info = detailOf({
    title: "新的删除申请",
    lines: [
      ["申请人", `管理员 ${actor.name}（ID ${actor.id}）`],
      ["申请删除", object],
      ["申请时间", dateText(request.created_at)],
      ["理由", clip(reason, 80)],
      ["来自投诉", caseId ? "是" : ""],
    ],
    result: "待审批",
    next: "点击即可打开申请详情，选择同意或驳回。",
  });
  for (const ownerId of ownerIds())
    tell(ownerId, {
      kind: "admin_request",
      text: `管理员 ${actor.name} 申请删除${object}`,
      detail: info,
      actorId: actor.id,
      refType: "delete_request",
      refId: request.id,
      state: "pending",
    });
  record({
    actorId: actor.id,
    role: "admin",
    action: "request_delete",
    targetType: type,
    targetId: id,
    label: target.label,
    before: "正常",
    after: "申请删除",
    reason: reason.trim(),
    needsApproval: true,
    notified: true,
    refId: request.id,
  });
  return request;
}
const requestRow = (id) => db.prepare("SELECT * FROM delete_requests WHERE id=?").get(id);
const requestStatus = { pending: "待审批", approved: "已同意", rejected: "已驳回", void: "已关闭" };
function requestDetail(viewer, id) {
  if (!isStaff(viewer)) fail(403, "需要管理权限。");
  const r = requestRow(id);
  if (!r) fail(404, "该申请不存在。");
  const target = loadTarget(r.target_type, r.target_id);
  return {
    id: r.id,
    status: r.status,
    status_label: requestStatus[r.status],
    target_type: r.target_type,
    target_id: r.target_id,
    target_label: target?.label || readJson(r.snapshot, {}).title || readJson(r.snapshot, {}).name || "已永久删除的对象",
    target_state: !target ? "已永久删除" : target.deleted ? "已删除" : "正常",
    snapshot: readJson(r.snapshot, {}),
    reason: r.reason,
    detail: r.detail,
    case_id: r.case_id,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    resolve_note: r.resolve_note,
    resolver: person(r.resolver_id),
    requester: person(r.requester_id),
    can_decide: isOwner(viewer) && r.status === "pending",
  };
}
function listRequests(viewer, { status = "pending" } = {}) {
  if (!isStaff(viewer)) fail(403, "需要管理权限。");
  return db
    .prepare(
      `SELECT id FROM delete_requests ${status === "all" ? "" : "WHERE status=?"}
       ${isOwner(viewer) ? "" : status === "all" ? "WHERE requester_id=?" : "AND requester_id=?"}
       ORDER BY status='pending' DESC, created_at DESC LIMIT 100`,
    )
    .all(...(status === "all" ? [] : [status]), ...(isOwner(viewer) ? [] : [viewer.id]))
    .map((r) => requestDetail(viewer, r.id));
}
function decideRequest(owner, id, { decision, reason = "" }) {
  if (!isOwner(owner)) fail(403, "只有站主可以审批删除申请。");
  if (!["approve", "reject"].includes(decision)) fail(400, "请选择同意或驳回。");
  if (typeof reason !== "string" || reason.length > 500) fail(400, "处理说明最多 500 字。");
  const r = requestRow(id);
  if (!r) fail(404, "该申请不存在。");
  if (r.status !== "pending")
    fail(409, `该申请已处理（${requestStatus[r.status]}）`, { code: "already_handled", request: requestDetail(owner, id) });
  const note = reason.trim();
  const t = now();
  const target = loadTarget(r.target_type, r.target_id);
  const object = target
    ? target.type === "comment"
      ? target.label
      : `${target.noun}「${target.label}」`
    : `${targetNouns[r.target_type]}（已永久删除）`;
  if (decision === "approve" && (!target || target.deleted)) {
    db.prepare("UPDATE delete_requests SET status='void',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(t, owner.id, "对象已被删除", id);
    settleNotices("delete_request", id, "对象已被删除，申请关闭", "已关闭");
    act(owner, {
      action: "void_delete_request",
      role: "owner",
      target: target || { type: r.target_type, id: r.target_id, label: object },
      reason: "对象已被删除",
      refId: id,
      notices: [{ userId: r.requester_id, text: `你申请删除的${object}已被删除，申请自动关闭。`, refType: "delete_request", refId: id, state: "handled" }],
    });
    return requestDetail(owner, id);
  }
  if (decision === "approve") {
    db.prepare("UPDATE delete_requests SET status='approved',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(t, owner.id, note, id);
    const kase = r.case_id ? db.prepare("SELECT * FROM complaint_cases WHERE id=? AND status='pending'").get(r.case_id) : null;
    removeTarget(owner, target, {
      reason: r.reason,
      context: kase ? "收到投诉" : "",
      role: "owner",
      approverId: owner.id,
      requestId: id,
      caseId: r.case_id,
    });
    if (kase) closeCase(owner, kase, { status: "resolved", action: "delete", note: r.reason, role: "owner" });
  } else {
    db.prepare("UPDATE delete_requests SET status='rejected',resolved_at=?,resolver_id=?,resolve_note=? WHERE id=?").run(t, owner.id, note, id);
    if (r.case_id) db.prepare("UPDATE complaint_cases SET request_id=NULL,updated_at=? WHERE id=? AND request_id=?").run(t, r.case_id, id);
  }
  const approved = decision === "approve";
  const detail = detailOf({
    title: approved ? "删除申请已通过" : "删除申请未通过",
    lines: [
      ["审批人", "站主"],
      ["申请对象", object],
      ["你的理由", clip(r.reason, 80)],
      ["审批说明", note],
      ["时间", dateText(t)],
    ],
    result: approved ? "已按申请删除该对象（仅此一次）" : "对象保持不变",
    next: approved ? "" : "如需进一步处理，可在投诉处理中选择其他方式。",
  });
  act(owner, {
    action: approved ? "approve_delete_request" : "reject_delete_request",
    role: "owner",
    target: target || { type: r.target_type, id: r.target_id, label: object },
    before: "申请删除",
    after: approved ? "已删除" : "已驳回",
    reason: note,
    needsApproval: true,
    approverId: owner.id,
    approvalResult: approved ? "approved" : "rejected",
    refId: id,
    notices: [
      {
        userId: r.requester_id,
        text: `站主${approved ? "同意了你删除" + object + "的申请，该内容已删除" : "驳回了你删除" + object + "的申请，该内容保持不变"}。${noteLine("说明", note)}`,
        detail,
        refType: "delete_request",
        refId: id,
        state: "handled",
      },
    ],
  });
  settleNotices(
    "delete_request",
    id,
    `${approved ? "已同意，并已删除该对象" : "已驳回，对象保持不变"}${note ? `；说明：${clause(note)}` : ""}`,
    approved ? "已同意" : "已驳回",
  );
  return requestDetail(owner, id);
}

const complaintCategories = [
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
const categoryLabel = Object.fromEntries(complaintCategories.map((c) => [c.id, c.label]));
export function fileComplaint(reporter, type, id, { category = "other", detail = "" } = {}) {
  if (!targetTypes.includes(type)) fail(400, "投诉对象无效。");
  if (!categoryLabel[category]) fail(400, "请选择投诉类型。");
  if (typeof detail !== "string" || detail.trim().length > 1000) fail(400, "补充说明最多 1000 字。");
  if (category === "other" && detail.trim().length < 2) fail(400, "选择「其他」时，请写明具体原因。");
  const target = loadTarget(type, id);
  if (!target || !visibleTo(target, reporter.id))
    fail(404, type === "comment" ? "这条评论不存在或已被删除。" : type === "post" ? "讨论不存在。" : "该内容不存在或已被删除。");
  if (target.subjectId === reporter.id || (type === "user" && id === reporter.id))
    fail(400, type === "comment" ? "不能投诉自己的评论。" : type === "board" ? "不能投诉自己管理的版块。" : "不能投诉自己的内容。");
  const t = now();
  const snapshot = JSON.stringify(snapshotOf(target));
  let kase = db
    .prepare("SELECT * FROM complaint_cases WHERE target_type=? AND target_id=? AND status='pending'")
    .get(type, id);
  if (!kase) {
    kase = { id: randomUUID() };
    db.prepare(
      `INSERT INTO complaint_cases(id,target_type,target_id,post_id,board_id,subject_id,snapshot,opened_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(kase.id, type, id, target.postId, target.boardId, target.subjectId, snapshot, t, t);
  } else if (db.prepare("SELECT 1 FROM complaints WHERE case_id=? AND reporter_id=?").get(kase.id, reporter.id))
    fail(409, "该内容已投诉，正在处理中", { code: "complaint_pending" });
  const complaint = { id: randomUUID(), case_id: kase.id, category, created_at: t };
  db.prepare(
    "INSERT INTO complaints(id,case_id,reporter_id,category,detail,snapshot,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(complaint.id, kase.id, reporter.id, category, detail.trim(), snapshot, t);
  db.prepare("UPDATE complaint_cases SET updated_at=? WHERE id=?").run(t, kase.id);
  return complaint;
}
function closeCase(actor, kase, { status, action, note = "", role = actorRole(actor, kase.board_id) }) {
  const t = now();
  const changed = db
    .prepare(
      "UPDATE complaint_cases SET status=?,action=?,note=?,resolved_at=?,resolver_id=?,updated_at=?,request_id=NULL WHERE id=? AND status='pending'",
    )
    .run(status, action, note, t, actor?.id ?? null, t, kase.id).changes;
  if (!changed) return 0;
  const snap = readJson(kase.snapshot, {});
  const label =
    kase.target_type === "user"
      ? `用户「${snap.name || kase.target_id}」`
      : kase.target_type === "board"
        ? `版块「${snap.name || kase.target_id}」`
        : kase.target_type === "post"
          ? `讨论「${snap.title || ""}」`
          : `「${snap.post?.title || ""}」下的${snap.reply ? "回复" : "评论"}`;
  const outcome = {
    dismiss: "经核实暂不处理",
    mute: "被投诉者已被禁言",
    mute_board: "该版块已被禁言",
    delete: kase.target_type === "user" ? "该账号已被删除" : kase.target_type === "board" ? "该版块已被删除" : "内容已被删除",
  }[action];
  const who = roleTitle(role);
  const reporters = db
    .prepare("SELECT DISTINCT reporter_id FROM complaints WHERE case_id=? AND reporter_id IS NOT NULL")
    .all(kase.id)
    .map((r) => r.reporter_id);
  const detail = detailOf({
    title: status === "dismissed" ? "投诉已驳回" : "投诉已处理",
    lines: [
      ["处理人", who],
      ["投诉对象", label],
      ["处理结果", outcome],
      ["说明", note],
      ["时间", dateText(t)],
    ],
    result: status === "dismissed" ? "已驳回" : "已处理",
    next: "如果之后出现新的问题，可以再次投诉。",
  });
  act(actor, {
    action: status === "dismissed" ? "dismiss_report" : "resolve_report",
    role,
    target: { type: kase.target_type, id: kase.target_id, label },
    before: "待处理",
    after: status === "dismissed" ? "已驳回" : `已处理：${outcome}`,
    reason: note,
    refId: kase.id,
    refType: "complaint_case",
    summary: status === "dismissed" ? `驳回了对${label}的投诉` : "",
    detail,
    mirror: status === "dismissed",
    logDetail: JSON.stringify({ action, target: kase.target_type, title: label, ...(note ? { note } : {}) }),
    notices: reporters.map((userId) => ({
      userId,
      text: `你对${label}的投诉已由${who}审核处理。\n处理结果：${outcome}。${noteLine("说明", note)}\n感谢你帮助维护社区。`,
      detail,
      important: false,
      postId: ["post", "comment"].includes(kase.target_type) && action !== "delete" ? kase.post_id : null,
    })),
  });
  return reporters.length;
}
const caseRow = (id) => db.prepare("SELECT * FROM complaint_cases WHERE id=?").get(id);
function caseSummary(viewer, kase, access) {
  const target = loadTarget(kase.target_type, kase.target_id);
  const snap = readJson(kase.snapshot, {});
  const counts = db
    .prepare("SELECT category, COUNT(*) AS n FROM complaints WHERE case_id=? GROUP BY category ORDER BY n DESC")
    .all(kase.id);
  const latest = db
    .prepare("SELECT category,detail,created_at FROM complaints WHERE case_id=? ORDER BY created_at DESC LIMIT 1")
    .get(kase.id);
  const subject = person(kase.subject_id);
  const penaltyType = kase.target_type === "board" ? "board" : "user";
  const penaltyId = kase.target_type === "board" ? kase.target_id : kase.subject_id;
  if (penaltyId) expireIfDue(penaltyType, penaltyId);
  const penalty = penaltyId ? activePenalty(penaltyType, penaltyId) : null;
  const request = kase.request_id ? requestRow(kase.request_id) : null;
  const title =
    kase.target_type === "user"
      ? target?.row.name || snap.name
      : kase.target_type === "board"
        ? target?.row.name || snap.name
        : kase.target_type === "post"
          ? snap.title
          : snap.post?.title;
  return {
    id: kase.id,
    target_type: kase.target_type,
    target_id: kase.target_id,
    status: kase.status,
    action: kase.action,
    note: kase.note,
    opened_at: kase.opened_at,
    updated_at: kase.updated_at,
    resolved_at: kase.resolved_at,
    resolver: person(kase.resolver_id),
    count: counts.reduce((n, c) => n + c.n, 0),
    categories: counts.map((c) => ({ id: c.category, label: categoryLabel[c.category] || c.category, count: c.n })),
    latest: latest ? { category: categoryLabel[latest.category], detail: clip(latest.detail, 80), created_at: latest.created_at } : null,
    title: title || "",
    excerpt: clip(kase.target_type === "user" ? snap.bio : kase.target_type === "board" ? snap.description : snap.content, 120),
    reply: !!snap.reply,
    exists: !!target,
    deleted: !target || target.deleted,
    subject,
    board: boardCard(kase.board_id),
    post_id: kase.post_id,
    icon: kase.target_type === "board" ? target?.row.icon || snap.icon || "" : "",
    penalty: penalty ? { id: penalty.id, until: penalty.ends_at, starts_at: penalty.starts_at, reason: penalty.reason } : null,
    request: request ? { id: request.id, status: request.status, requester: person(request.requester_id) } : null,
    can_handle: kase.status === "pending" && !!access.handle && !(request && request.status === "pending" && !isOwner(viewer)),
    conflict: access.conflict || "",
  };
}
function quickActions(viewer, kase, summary) {
  if (!summary.can_handle) return [];
  const target = loadTarget(kase.target_type, kase.target_id);
  return caseActions(viewer, kase, target).map(({ id, mode }) => ({ id, mode: mode || "direct" }));
}
function listCases(viewer, { type = "post", status = "pending", q = "", offset = 0, board = "" } = {}) {
  if (!canReview(viewer)) fail(403, "需要管理权限。");
  if (type !== "all" && !targetTypes.includes(type)) fail(400, "投诉分类无效。");
  const conditions = [];
  const args = [];
  if (type !== "all") {
    conditions.push("c.target_type=?");
    args.push(type);
  }
  if (["pending", "resolved", "dismissed"].includes(status)) {
    conditions.push("c.status=?");
    args.push(status);
  }
  if (typeof board === "string" && board) {
    conditions.push("c.board_id=?");
    args.push(board);
  }
  if (!isStaff(viewer)) {
    const boards = moderatedBoardIds(viewer.id);
    if (!["all", "post", "comment"].includes(type) || !boards.length) return { cases: [], total: 0, hasMore: false, counts: {} };
    conditions.push(`c.board_id IN (${placeholders(boards)})`);
    args.push(...boards);
    if (type === "all") conditions.push("c.target_type IN ('post','comment')");
  }
  const query = typeof q === "string" ? q.trim().slice(0, 60) : "";
  if (query) {
    conditions.push(`(instr(lower(c.snapshot),lower(?))>0 OR c.target_id=? OR c.subject_id=?
      OR EXISTS(SELECT 1 FROM users u WHERE u.id=c.subject_id AND instr(lower(u.name),lower(?))>0)
      OR EXISTS(SELECT 1 FROM categories b WHERE b.id=c.board_id AND instr(lower(b.name),lower(?))>0)
      OR EXISTS(SELECT 1 FROM complaints x WHERE x.case_id=c.id AND instr(lower(x.detail),lower(?))>0))`);
    args.push(query, query, query, query, query, query);
  }
  const where = conditions.length ? conditions.join(" AND ") : "1=1";
  const start = Math.max(0, Math.min(100000, Number.parseInt(offset, 10) || 0));
  const total = db.prepare(`SELECT COUNT(*) AS n FROM complaint_cases c WHERE ${where}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT c.* FROM complaint_cases c WHERE ${where}
       ORDER BY c.status='pending' DESC, COALESCE(c.resolved_at,c.updated_at) DESC LIMIT 20 OFFSET ?`,
    )
    .all(...args, start);
  const countScope = isStaff(viewer) ? { sql: "", args: [] } : (() => {
    const boards = moderatedBoardIds(viewer.id);
    return { sql: ` AND target_type IN ('post','comment') AND board_id IN (${placeholders(boards)})`, args: boards };
  })();
  const counts = Object.fromEntries(
    db
      .prepare(`SELECT target_type, COUNT(*) AS n FROM complaint_cases WHERE status='pending'${countScope.sql} GROUP BY target_type`)
      .all(...countScope.args)
      .map((r) => [r.target_type, r.n]),
  );
  return {
    cases: rows.map((kase) => {
      const summary = caseSummary(viewer, kase, caseAccess(viewer, kase));
      return { ...summary, quick: quickActions(viewer, kase, summary) };
    }),
    total,
    hasMore: start + rows.length < total,
    counts,
  };
}
function caseActions(viewer, kase, target) {
  if (kase.status !== "pending" || !target) return [];
  const list = [{ id: "dismiss", label: "驳回", danger: false }];
  const subject = kase.subject_id ? loadTarget("user", kase.subject_id) : null;
  if (kase.target_type === "board") {
    if (canMute(viewer, target)) list.push({ id: "mute_board", label: "禁言版块", danger: true });
  } else if (subject && canMute(viewer, subject))
    list.push({ id: "mute", label: kase.target_type === "user" ? "禁言" : kase.target_type === "post" ? "禁言作者" : "禁言发布者", danger: true });
  if (!target.deleted) {
    const mode = deletionMode(viewer, target);
    if (mode)
      list.push({
        id: "delete",
        label: { board: "删除版块", post: "删除帖子", user: "删除用户" }[kase.target_type] || `删除${target.noun}`,
        danger: true,
        mode,
      });
  }
  return list;
}
function caseDetail(viewer, id) {
  if (!canReview(viewer)) fail(403, "需要管理权限。");
  const kase = caseRow(id);
  if (!kase) fail(404, "该投诉不存在。");
  const access = caseAccess(viewer, kase);
  if (!access.view) fail(403, "你无权查看这条投诉。");
  const target = loadTarget(kase.target_type, kase.target_id);
  const complaints = db
    .prepare("SELECT * FROM complaints WHERE case_id=? ORDER BY created_at DESC")
    .all(kase.id)
    .map((c) => ({
      id: c.id,
      category: c.category,
      label: categoryLabel[c.category] || c.category,
      detail: c.detail,
      created_at: c.created_at,
      reporter: access.reporters ? person(c.reporter_id) || { id: "", name: "已注销用户", initials: "?", avatar: "" } : null,
    }));
  const summary = caseSummary(viewer, kase, access);
  return {
    ...summary,
    snapshot: readJson(kase.snapshot, {}),
    current: target && !target.deleted ? describeTarget(target) : null,
    current_state: !target ? "已永久删除" : target.deleted ? "原内容已删除" : "正常",
    complaints,
    actions: summary.can_handle ? caseActions(viewer, kase, target) : [],
    request: kase.request_id && isStaff(viewer) ? requestDetail(viewer, kase.request_id) : summary.request,
  };
}
function resolveCase(actor, id, { action, note = "", duration = null, strategy = "extend", reason = "", detail = "" } = {}) {
  if (!canReview(actor)) fail(403, "需要管理权限。");
  if (typeof note !== "string" || note.length > 500) fail(400, "处理说明最多 500 字。");
  const kase = caseRow(id);
  if (!kase) fail(404, "该投诉不存在。");
  if (kase.status !== "pending")
    fail(409, "该投诉已经由其他管理员处理", { code: "already_handled", case: caseDetail(actor, id) });
  const access = caseAccess(actor, kase);
  if (!access.handle) fail(403, access.conflict || "你无权处理这条投诉。");
  const pendingRequest = kase.request_id ? requestRow(kase.request_id) : null;
  if (pendingRequest?.status === "pending" && !isOwner(actor)) fail(409, "已提交删除申请，等待站主审批。", { code: "request_pending" });
  const target = loadTarget(kase.target_type, kase.target_id);
  const allowed = caseActions(actor, kase, target);
  const chosen = allowed.find((a) => a.id === action);
  if (!chosen) fail(400, "请选择有效的处理方式。");
  const text = note.trim();
  const role = actorRole(actor, kase.board_id);
  const snap = readJson(kase.snapshot, {});
  const context =
    kase.target_type === "post"
      ? `你的讨论「${snap.title || target?.label || ""}」`
      : kase.target_type === "comment"
        ? `你在「${snap.post?.title || ""}」下的${snap.reply ? "回复" : "评论"}`
        : kase.target_type === "board"
          ? "该版块"
          : "你的账号";
  if (action === "dismiss") {
    closeCase(actor, kase, { status: "dismissed", action, note: text, role });
  } else if (action === "mute" || action === "mute_board") {
    const subject = action === "mute" ? loadTarget("user", kase.subject_id) : target;
    mute(actor, subject, { duration, reason: text, caseId: kase.id, strategy, context, role });
    closeCase(actor, kase, { status: "resolved", action, note: text, role });
  } else if (chosen.mode === "request") {
    const request = fileDeleteRequest(actor, kase.target_type, kase.target_id, { reason: reason || text, detail, caseId: kase.id });
    return { requested: true, request };
  } else {
    removeTarget(actor, target, { reason: text, context: "收到投诉", role, caseId: kase.id });
    closeCase(actor, kase, { status: "resolved", action, note: text, role });
  }
  if (pendingRequest?.status === "pending" && action !== "delete")
    voidRequests(target, actor, null, "投诉已由站主直接处理");
  return { requested: false, case: caseDetail(actor, id) };
}

function setAdmin(owner, userId, grant, reason = "") {
  if (!isOwner(owner)) fail(403, "只有站主可以授予或撤销管理员权限。");
  const target = mustLoad("user", userId);
  const u = target.row;
  if (u.role === "owner" || u.id === owner.id) fail(403, "不能通过此界面变更站主权限。");
  if (u.status !== "active") fail(400, "该账号当前不可用。");
  if (u.demo) fail(400, "示例作者账号不能成为管理员。");
  if (grant === (u.role === "admin")) fail(409, grant ? "该用户已经是管理员。" : "该用户不是管理员。");
  db.prepare("UPDATE users SET role=? WHERE id=?").run(grant ? "admin" : "member", u.id);
  const pending = db.prepare("SELECT COUNT(*) AS n FROM delete_requests WHERE requester_id=? AND status='pending'").get(u.id).n;
  const note = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  const detail = detailOf({
    title: grant ? "你已成为管理员" : "你的管理员权限已被移除",
    lines: [
      ["处理人", "站主"],
      ["说明", note],
      ["时间", dateText(now())],
    ],
    result: grant ? "现在可以进入管理后台，协助处理用户、投诉与版块" : "管理后台中的相应能力已立即失效",
    next: grant ? "删除他人内容需要向站主提交申请。" : pending ? `你之前提交的 ${pending} 份删除申请仍会由站主处理。` : "",
  });
  act(owner, {
    action: grant ? "grant_admin" : "revoke_admin",
    role: "owner",
    target,
    before: grant ? "成员" : "管理员",
    after: grant ? "管理员" : "成员",
    reason: note,
    detail,
    logDetail: JSON.stringify({ role: grant ? "admin" : "member" }),
    notices: [
      {
        userId: u.id,
        text: grant
          ? "站主授予了你管理员权限。\n现在可以协助处理用户、投诉与版块；删除他人内容需要向站主提交申请。"
          : "站主撤销了你的管理员权限，管理后台中的相应功能已立即失效。",
        detail,
      },
    ],
  });
}

export function handle(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      if (error instanceof GovernanceError) return res.status(error.status).json({ error: error.message, ...error.extra });
      throw error;
    }
  };
}
const staffOnly = (req) => {
  if (!isStaff(req.user)) fail(403, "需要管理权限。");
};
const ownerOnly = (req, message = "只有站主可以执行此操作。") => {
  if (!isOwner(req.user)) fail(403, message);
};
const pageOffset = (value) => Math.max(0, Math.min(100000, Number.parseInt(value, 10) || 0));
const likeTerm = (value) => (typeof value === "string" ? value.trim().slice(0, 60) : "");

function userRow(viewer, u) {
  const target = { type: "user", id: u.id, row: u, label: u.name, noun: "用户", subjectId: u.id, deleted: u.status === "deleted" };
  const penalty = u.status === "deleted" ? null : activePenalty("user", u.id);
  const appeal = penalty ? appealState(penalty.id) : null;
  const kase = db
    .prepare("SELECT id,(SELECT COUNT(*) FROM complaints x WHERE x.case_id=c.id) AS n FROM complaint_cases c WHERE target_type='user' AND target_id=? AND status='pending'")
    .get(u.id);
  const request = db.prepare("SELECT id FROM delete_requests WHERE target_type='user' AND target_id=? AND status='pending'").get(u.id);
  const conflict = conflictOf(viewer, target);
  return {
    id: u.id,
    name: u.name,
    initials: u.initials,
    avatar: u.avatar || "",
    email: u.email,
    role: u.role,
    status: u.status,
    demo: u.demo,
    created_at: u.created_at,
    posts: u.posts,
    muted: penalty ? 1 : 0,
    muted_until: penalty?.ends_at ?? null,
    mute_reason: penalty?.reason || "",
    penalty: penalty ? { id: penalty.id, starts_at: penalty.starts_at, until: penalty.ends_at, reason: penalty.reason } : null,
    appeal: appeal?.pending ? { ...appeal.pending } : null,
    case: kase ? { id: kase.id, count: kase.n } : null,
    request: request ? { id: request.id } : null,
    deleted_at: u.deleted_at ?? null,
    delete_reason: u.delete_reason || "",
    can: {
      mute: canMute(viewer, target) && !conflict,
      unmute: !!penalty && isStaff(viewer) && (isOwner(viewer) || !conflict),
      delete: u.status === "deleted" ? null : deletionMode(viewer, target),
      restore: isOwner(viewer) && u.status === "deleted",
      purge: isOwner(viewer) && u.role !== "owner" && u.id !== viewer.id,
      handle_case: !!kase && (isOwner(viewer) || !conflict),
      reactivate: isOwner(viewer) && u.status === "suspended",
    },
    conflict,
  };
}
function boardRow(viewer, b) {
  const target = loadTarget("board", b.id);
  const penalty = b.deleted_at ? null : activePenalty("board", b.id);
  const appeal = penalty ? appealState(penalty.id) : null;
  const kase = db
    .prepare("SELECT id,(SELECT COUNT(*) FROM complaints x WHERE x.case_id=c.id) AS n FROM complaint_cases c WHERE target_type='board' AND target_id=? AND status='pending'")
    .get(b.id);
  const request = db.prepare("SELECT id FROM delete_requests WHERE target_type='board' AND target_id=? AND status='pending'").get(b.id);
  const conflict = conflictOf(viewer, target);
  const keepers = db
    .prepare(
      `SELECT m.user_id,m.role FROM category_moderators m JOIN users u ON u.id=m.user_id
       WHERE m.category_id=? AND u.status='active' ORDER BY m.role='lead' DESC, m.created_at`,
    )
    .all(b.id);
  return {
    id: b.id,
    name: b.name,
    en: b.en,
    description: b.description,
    icon: b.icon,
    builtin: !!b.builtin,
    created_at: b.created_at,
    posts: b.posts,
    lead: person(keepers.find((k) => k.role === "lead")?.user_id),
    assistants: keepers.filter((k) => k.role === "assistant").map((k) => person(k.user_id)),
    penalty: penalty ? { id: penalty.id, starts_at: penalty.starts_at, until: penalty.ends_at, reason: penalty.reason } : null,
    appeal: appeal?.pending ? { ...appeal.pending } : null,
    case: kase ? { id: kase.id, count: kase.n } : null,
    request: request ? { id: request.id } : null,
    deleted_at: b.deleted_at ?? null,
    delete_reason: b.delete_reason || "",
    can: {
      mute: canMute(viewer, target),
      unmute: !!penalty && isStaff(viewer) && (isOwner(viewer) || !conflict),
      delete: b.deleted_at ? null : deletionMode(viewer, target),
      restore: isOwner(viewer) && !!b.deleted_at,
      purge: isOwner(viewer) && !!b.deleted_at,
      handle_case: !!kase && (isOwner(viewer) || !conflict),
    },
    conflict,
  };
}
function postRow(viewer, p) {
  const target = loadTarget("post", p.id);
  const kase = db
    .prepare("SELECT id,(SELECT COUNT(*) FROM complaints x WHERE x.case_id=c.id) AS n FROM complaint_cases c WHERE target_type='post' AND target_id=? AND status='pending'")
    .get(p.id);
  const request = db.prepare("SELECT id FROM delete_requests WHERE target_type='post' AND target_id=? AND status='pending'").get(p.id);
  const conflict = conflictOf(viewer, target);
  const deleted = !!p.deleted_at;
  const mayModerate = !deleted && isStaff(viewer) && (isOwner(viewer) || !conflict);
  return {
    id: p.id,
    title: p.title,
    excerpt: clip(p.format === "html" ? plainText(p.content, "html") : p.excerpt || p.content, 140),
    kind: p.kind,
    visibility: p.visibility,
    created_at: p.created_at,
    comments: p.comments,
    likes: p.likes,
    author: person(p.author_id),
    board: boardCard(p.category),
    demo: p.demo ? 1 : 0,
    pinned: !!p.pinned,
    locked: !!p.locked,
    lock_reason: p.lock_reason || "",
    comments_closed: !!p.comments_closed,
    case: kase ? { id: kase.id, count: kase.n } : null,
    request: request ? { id: request.id } : null,
    deleted_at: p.deleted_at ?? null,
    delete_reason: p.delete_reason || "",
    can: {
      lock: mayModerate && !p.locked,
      unlock: mayModerate && !!p.locked,
      delete: deleted ? null : deletionMode(viewer, target),
      restore: deleted && canRestore(viewer, target),
      purge: isOwner(viewer) && deleted,
      handle_case: !!kase && (isOwner(viewer) || !conflict),
    },
    conflict,
  };
}
function appealFor(type, id) {
  const p = activePenalty(type, id);
  const a = p ? appealState(p.id).pending : null;
  return a?.id || null;
}

export function installGovernance(app, { auth }) {
  sweepExpired();
  setInterval(() => {
    try {
      sweepExpired();
    } catch (error) {
      console.error("Penalty sweep failed:", error);
    }
  }, 30000).unref();
  const trashSweep = () => {
    try {
      sweepTrash();
    } catch (error) {
      console.error("Trash sweep failed:", error);
    }
  };
  setTimeout(trashSweep, 5000).unref();
  setInterval(trashSweep, 3600000).unref();

  app.get("/api/complaints/categories", (_req, res) => res.json({ categories: complaintCategories }));
  app.post("/api/complaints", auth, handle((req, res) => {
    const { target_type, target_id, category, detail } = req.body || {};
    res.status(201).json({ complaint: fileComplaint(req.user, target_type, target_id, { category, detail }) });
  }));
  app.post("/api/appeals", auth, handle((req, res) => {
    const { target_type, target_id, reason } = req.body || {};
    res.status(201).json({ appeal: fileAppeal(req.user, target_type, target_id, reason) });
  }));

  app.get("/api/admin/overview", auth, handle((req) => {
    staffOnly(req);
    sweepExpired();
    const n = (sql, ...args) => db.prepare(sql).get(...args).n;
    return {
      members: n("SELECT COUNT(*) AS n FROM users WHERE demo=0 AND status<>'deleted'"),
      posts: n("SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL"),
      reports: n("SELECT COUNT(*) AS n FROM complaint_cases WHERE status='pending'"),
      appeals: n("SELECT COUNT(*) AS n FROM appeals WHERE status='pending'"),
      requests: n("SELECT COUNT(*) AS n FROM delete_requests WHERE status='pending'"),
      muted: n("SELECT COUNT(*) AS n FROM users WHERE muted=1 AND status<>'deleted'"),
      muted_boards: n("SELECT COUNT(*) AS n FROM categories WHERE muted=1 AND deleted_at IS NULL"),
      suspended: n("SELECT COUNT(*) AS n FROM users WHERE status='suspended'"),
      locked: n("SELECT COUNT(*) AS n FROM posts WHERE locked=1 AND deleted_at IS NULL"),
      trash:
        n("SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NOT NULL") +
        n("SELECT COUNT(*) AS n FROM comments WHERE deleted=1 AND content<>''") +
        n("SELECT COUNT(*) AS n FROM categories WHERE deleted_at IS NOT NULL") +
        n("SELECT COUNT(*) AS n FROM users WHERE status='deleted'") +
        (isOwner(req.user)
          ? n(
              `SELECT COUNT(*) AS n FROM board_member_removals r JOIN categories c ON c.id=r.category_id AND c.deleted_at IS NULL
               JOIN users u ON u.id=r.user_id AND u.status<>'deleted' WHERE r.status='pending' AND r.created_at >= ?`,
              trashCutoff(),
            )
          : 0),
      admins: n("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'"),
    };
  }));

  app.get("/api/admin/users", auth, handle((req) => {
    staffOnly(req);
    sweepExpired();
    const q = likeTerm(req.query.q);
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const conditions = [];
    const args = [];
    if (q) {
      conditions.push("(instr(lower(u.name),lower(?))>0 OR instr(lower(u.id),lower(?))>0 OR instr(lower(u.email),lower(?))>0)");
      args.push(q, q, q);
    }
    const appealing = "EXISTS(SELECT 1 FROM appeals a WHERE a.target_type='user' AND a.target_id=u.id AND a.status='pending')";
    const complained = "EXISTS(SELECT 1 FROM complaint_cases c WHERE c.target_type='user' AND c.target_id=u.id AND c.status='pending')";
    const filters = {
      all: "u.status<>'deleted'",
      active: "u.status='active' AND u.muted=0",
      muted: "u.muted=1 AND u.status<>'deleted'",
      appealing,
      complained,
      suspended: "u.status='suspended'",
      deleted: "u.status='deleted'",
    };
    conditions.push(filters[status] || filters.all);
    const where = conditions.join(" AND ");
    const offset = pageOffset(req.query.offset);
    const rows = db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.author_id=u.id AND p.deleted_at IS NULL) AS posts
         FROM users u WHERE ${where}
         ORDER BY ${appealing} DESC, u.muted DESC, ${complained} DESC, u.demo, u.created_at DESC
         LIMIT 30 OFFSET ?`,
      )
      .all(...args, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`).get(...args).n;
    return { users: rows.map((u) => userRow(req.user, u)), total, hasMore: offset + rows.length < total };
  }));
  app.post("/api/admin/users/:id/mute", auth, handle((req) => {
    staffOnly(req);
    const { duration, reason = "", strategy = "extend" } = req.body || {};
    mute(req.user, mustLoad("user", req.params.id), { duration, reason, strategy });
    return { ok: true };
  }));
  app.delete("/api/admin/users/:id/mute", auth, handle((req) => {
    staffOnly(req);
    unmute(req.user, mustLoad("user", req.params.id), { reason: req.body?.reason || "" });
    return { ok: true };
  }));
  app.post("/api/admin/users/:id/remove", auth, handle((req) => {
    staffOnly(req);
    const target = mustLoad("user", req.params.id);
    const mode = deletionMode(req.user, target);
    if (mode === "request") requestRequired();
    if (mode !== "direct") fail(403, "不能删除这个账号。");
    removeTarget(req.user, target, { reason: req.body?.reason || "" });
    return { ok: true };
  }));
  app.patch("/api/admin/users/:id", auth, handle((req) => {
    staffOnly(req);
    const target = mustLoad("user", req.params.id);
    const u = target.row;
    if (u.role === "owner" || u.id === req.user.id) fail(403, "不能通过此界面停用或变更站主及当前账号的权限。");
    if (u.demo) fail(400, "示例作者账号不可登录，无需更改状态。");
    if (!isOwner(req.user) && u.role === "admin") fail(403, "只有站主可以管理管理员。");
    const { status, role, muted, mute_days: days, reason = "" } = req.body || {};
    if (status !== undefined && !["active", "suspended"].includes(status)) fail(400, "用户状态无效。");
    if (role !== undefined && (!["member", "admin"].includes(role) || !isOwner(req.user)))
      fail(403, "只有站主可以授予或撤销管理员权限。");
    if (muted !== undefined && typeof muted !== "boolean") fail(400, "请选择是禁言还是解除禁言。");
    if (typeof reason !== "string" || reason.length > 200) fail(400, "处理说明最多 200 字。");
    if (status === undefined && role === undefined && muted === undefined)
      fail(400, "请提供需要修改的用户状态、权限或禁言设置。");
    if (role !== undefined && role !== u.role) setAdmin(req.user, u.id, role === "admin", reason);
    if (status !== undefined && status !== u.status) {
      if (u.status === "deleted") fail(400, "该账号已删除，请在回收站中恢复。");
      db.prepare("UPDATE users SET status=? WHERE id=?").run(status, u.id);
      if (status === "suspended") {
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
        closeUserStreams(u.id);
      }
      const role = actorRole(req.user);
      act(req.user, {
        action: "update_user",
        role,
        target,
        before: u.status === "suspended" ? "已停用" : "正常",
        after: status === "suspended" ? "已停用" : "正常",
        reason: reason.trim(),
        summary: `${status === "suspended" ? "停用" : "恢复"}了用户「${u.name}」的账号`,
        logDetail: JSON.stringify({ status, role: u.role }),
        notices: [
          {
            userId: u.id,
            text:
              status === "suspended"
                ? `${roleTitle(role)}停用了你的账号，停用期间无法登录。${noteLine("原因", reason)}`
                : `${roleTitle(role)}已恢复你的账号，欢迎回来。`,
          },
        ],
      });
    }
    if (muted === true) mute(req.user, loadTarget("user", u.id), { duration: days ?? 0, reason, strategy: "replace" });
    if (muted === false) unmute(req.user, loadTarget("user", u.id), { reason });
    return { ok: true };
  }));

  app.get("/api/admin/boards", auth, handle((req) => {
    staffOnly(req);
    sweepExpired();
    const q = likeTerm(req.query.q);
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const conditions = [];
    const args = [];
    if (q) {
      conditions.push(`(instr(lower(b.name),lower(?))>0 OR instr(lower(b.en),lower(?))>0 OR instr(lower(b.id),lower(?))>0
        OR instr(lower(b.description),lower(?))>0
        OR EXISTS(SELECT 1 FROM category_moderators m JOIN users u ON u.id=m.user_id
                  WHERE m.category_id=b.id AND (instr(lower(u.name),lower(?))>0 OR u.id=?)))`);
      args.push(q, q, q, q, q, q);
    }
    const appealing = "EXISTS(SELECT 1 FROM appeals a WHERE a.target_type='board' AND a.target_id=b.id AND a.status='pending')";
    const complained = "EXISTS(SELECT 1 FROM complaint_cases c WHERE c.target_type='board' AND c.target_id=b.id AND c.status='pending')";
    const filters = {
      all: "b.deleted_at IS NULL",
      active: "b.deleted_at IS NULL AND b.muted=0",
      muted: "b.deleted_at IS NULL AND b.muted=1",
      appealing,
      complained,
      deleted: "b.deleted_at IS NOT NULL",
    };
    conditions.push(filters[status] || filters.all);
    const where = conditions.join(" AND ");
    const offset = pageOffset(req.query.offset);
    const rows = db
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM posts p WHERE p.category=b.id AND p.deleted_at IS NULL) AS posts
         FROM categories b WHERE ${where}
         ORDER BY ${appealing} DESC, b.muted DESC, ${complained} DESC, b.builtin DESC, b.position, b.created_at
         LIMIT 30 OFFSET ?`,
      )
      .all(...args, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM categories b WHERE ${where}`).get(...args).n;
    return { boards: rows.map((b) => boardRow(req.user, b)), total, hasMore: offset + rows.length < total };
  }));
  app.post("/api/admin/boards/:id/mute", auth, handle((req) => {
    staffOnly(req);
    const { duration, reason = "", strategy = "extend" } = req.body || {};
    mute(req.user, mustLoad("board", req.params.id), { duration, reason, strategy });
    return { ok: true };
  }));
  app.delete("/api/admin/boards/:id/mute", auth, handle((req) => {
    staffOnly(req);
    unmute(req.user, mustLoad("board", req.params.id), { reason: req.body?.reason || "" });
    return { ok: true };
  }));

  app.get("/api/admin/posts", auth, handle((req) => {
    staffOnly(req);
    sweepExpired();
    const q = likeTerm(req.query.q);
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const board = typeof req.query.board === "string" ? req.query.board : "all";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "new";
    const conditions = [];
    const args = [];
    if (q) {
      conditions.push(`(instr(lower(p.title),lower(?))>0 OR instr(lower(p.content),lower(?))>0 OR instr(lower(p.tags),lower(?))>0
        OR EXISTS(SELECT 1 FROM users u WHERE u.id=p.author_id AND (instr(lower(u.name),lower(?))>0 OR u.id=?)))`);
      args.push(q, q, q, q, q);
    }
    if (board && board !== "all") {
      conditions.push("p.category=?");
      args.push(board);
    }
    const complained = "EXISTS(SELECT 1 FROM complaint_cases c WHERE c.target_type='post' AND c.target_id=p.id AND c.status='pending')";
    const replies = "(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted=0)";
    const likes = "(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id)";
    const filters = {
      all: "p.deleted_at IS NULL",
      active: "p.deleted_at IS NULL AND p.locked=0",
      locked: "p.deleted_at IS NULL AND p.locked=1",
      complained,
      hidden: "p.deleted_at IS NULL AND p.visibility<>'public'",
      deleted: "p.deleted_at IS NOT NULL",
    };
    conditions.push(filters[status] || filters.all);
    const boundary = (value) => {
      const time = Number.parseInt(value, 10);
      return Number.isFinite(time) && time > 0 ? time : null;
    };
    const from = boundary(req.query.from);
    const to = boundary(req.query.to);
    const minComments = Math.max(0, Math.min(10000, Number.parseInt(req.query.minComments, 10) || 0));
    if (from !== null) {
      conditions.push("p.created_at>=?");
      args.push(from);
    }
    if (to !== null) {
      conditions.push("p.created_at<=?");
      args.push(to);
    }
    if (minComments > 0) {
      conditions.push(`${replies}>=?`);
      args.push(minComments);
    }
    if (sort === "unanswered") conditions.push(`${replies}=0`);
    const where = conditions.join(" AND ");
    const orderings = {
      __proto__: null,
      hot: `(${likes}*3+${replies}*5) DESC,p.created_at DESC,p.rowid DESC`,
      new: "p.created_at DESC,p.rowid DESC",
      old: "p.created_at ASC,p.rowid ASC",
      comments: `${replies} DESC,p.created_at DESC,p.rowid DESC`,
      unanswered: "p.created_at DESC,p.rowid DESC",
    };
    const offset = pageOffset(req.query.offset);
    const rows = db
      .prepare(
        `SELECT p.*, ${replies} AS comments, ${likes} AS likes FROM posts p WHERE ${where}
         ORDER BY ${complained} DESC, ${orderings[sort] || orderings.new}
         LIMIT 20 OFFSET ?`,
      )
      .all(...args, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`).get(...args).n;
    return { posts: rows.map((p) => postRow(req.user, p)), total, hasMore: offset + rows.length < total };
  }));

  app.get("/api/admin/complaints", auth, handle((req) =>
    listCases(req.user, {
      type: req.query.type || "post",
      status: req.query.status || "pending",
      q: req.query.q,
      offset: req.query.offset,
      board: req.query.board,
    }),
  ));
  app.get("/api/admin/complaints/:id", auth, handle((req) => ({ case: caseDetail(req.user, req.params.id) })));
  app.post("/api/admin/complaints/:id/resolve", auth, handle((req) => resolveCase(req.user, req.params.id, req.body || {})));

  app.get("/api/admin/appeals", auth, handle((req) => ({ appeals: listAppeals(req.user, { status: req.query.status || "pending" }) })));
  app.get("/api/admin/appeals/:id", auth, handle((req) => ({ appeal: appealDetail(req.user, req.params.id) })));
  app.post("/api/admin/appeals/:id", auth, handle((req) => ({ ok: true, appeal: decideAppeal(req.user, req.params.id, req.body || {}) })));

  app.post("/api/admin/delete-requests", auth, handle((req, res) => {
    const { target_type, target_id, reason, detail, case_id } = req.body || {};
    res.status(201).json({ request: fileDeleteRequest(req.user, target_type, target_id, { reason, detail, caseId: case_id || null }) });
  }));
  app.get("/api/admin/delete-requests", auth, handle((req) => ({ requests: listRequests(req.user, { status: req.query.status || "pending" }) })));
  app.get("/api/admin/delete-requests/:id", auth, handle((req) => ({ request: requestDetail(req.user, req.params.id) })));
  app.post("/api/admin/delete-requests/:id", auth, handle((req) => ({ ok: true, request: decideRequest(req.user, req.params.id, req.body || {}) })));

  app.get("/api/admin/admins", auth, handle((req) => {
    staffOnly(req);
    const admins = db
      .prepare("SELECT * FROM users WHERE role='admin' AND status<>'deleted' ORDER BY name")
      .all()
      .map((u) => ({
        ...person(u.id),
        email: isOwner(req.user) ? u.email : undefined,
        created_at: u.created_at,
        granted_at:
          db
            .prepare("SELECT created_at FROM moderation_log WHERE action IN ('grant_admin','update_user') AND target_id=? ORDER BY created_at DESC LIMIT 1")
            .get(u.id)?.created_at ?? null,
        pending_requests: db.prepare("SELECT COUNT(*) AS n FROM delete_requests WHERE requester_id=? AND status='pending'").get(u.id).n,
      }));
    return { admins, requests: listRequests(req.user, { status: "all" }) };
  }));
  app.put("/api/admin/admins/:id", auth, handle((req) => {
    ownerOnly(req, "只有站主可以授予或撤销管理员权限。");
    setAdmin(req.user, req.params.id, true, req.body?.reason || "");
    return { ok: true };
  }));
  app.delete("/api/admin/admins/:id", auth, handle((req) => {
    ownerOnly(req, "只有站主可以授予或撤销管理员权限。");
    setAdmin(req.user, req.params.id, false, req.body?.reason || "");
    return { ok: true };
  }));

  app.get("/api/admin/trash", auth, handle((req) => {
    staffOnly(req);
    sweepTrash();
    const wanted = String(req.query.type ?? "");
    const type = wanted === "all" || Object.hasOwn(trashTables, wanted) ? wanted : "user";
    const offset = pageOffset(req.query.offset);
    const columns = {
      post: "x.id, x.title AS label, x.content AS body, x.author_id AS owner, x.deleted_at, x.deleted_by, x.delete_reason, x.category AS board, NULL AS parent_id, NULL AS post_id, NULL AS posts",
      comment: `x.id, (SELECT p.title FROM posts p WHERE p.id=x.post_id) AS label, x.content AS body, x.author_id AS owner,
        x.deleted_at, x.deleted_by, x.delete_reason, (SELECT p.category FROM posts p WHERE p.id=x.post_id) AS board, x.parent_id, x.post_id, NULL AS posts`,
      board: `x.id, x.name AS label, x.description AS body, NULL AS owner, x.deleted_at, x.deleted_by, x.delete_reason, x.id AS board,
        NULL AS parent_id, NULL AS post_id, (SELECT COUNT(*) FROM posts p WHERE p.category=x.id) AS posts`,
      user: "x.id, x.name AS label, x.bio AS body, x.id AS owner, x.deleted_at, x.deleted_by, x.delete_reason, NULL AS board, NULL AS parent_id, NULL AS post_id, NULL AS posts",
    };
    const kinds = type === "all" ? Object.keys(trashTables) : [type];
    const parts = kinds.map((t) => {
      const scope = trashScope(req.user, t);
      return { sql: `SELECT '${t}' AS kind, ${columns[t]} FROM ${scope.from} WHERE ${scope.where}`, args: scope.args };
    });
    const rows = db
      .prepare(`SELECT * FROM (${parts.map((x) => x.sql).join(" UNION ALL ")}) ORDER BY deleted_at DESC LIMIT 20 OFFSET ?`)
      .all(...parts.flatMap((x) => x.args), offset);
    const counts = Object.fromEntries(
      Object.keys(trashTables).map((t) => {
        const s = trashScope(req.user, t);
        return [t, db.prepare(`SELECT COUNT(*) AS n FROM ${s.from} WHERE ${s.where}`).get(...s.args).n];
      }),
    );
    const total = kinds.reduce((n, t) => n + counts[t], 0);
    const owner = isOwner(req.user);
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.kind,
        label: r.kind === "comment" ? `「${r.label}」下的${r.parent_id ? "回复" : "评论"}` : r.label,
        excerpt: clip(r.body, 140),
        owner: person(r.owner),
        board: boardCard(r.board),
        post_id: r.post_id || (r.kind === "post" ? r.id : null),
        posts: r.posts ?? null,
        deleted_at: r.deleted_at,
        expires_at: r.deleted_at + TRASH_DAYS * DAY,
        deleted_by: person(r.deleted_by),
        delete_reason: r.delete_reason || "",
        can_restore: true,
        can_purge: owner,
      })),
      total,
      counts,
      retention_days: TRASH_DAYS,
      hasMore: offset + rows.length < total,
    };
  }));
  app.post("/api/admin/restore", auth, handle((req) => {
    const { target_type, target_id, reason = "" } = req.body || {};
    restoreTarget(req.user, target_type, target_id, reason);
    return { ok: true };
  }));
  app.post("/api/admin/purge", auth, handle((req) => {
    const { target_type, target_id, confirm } = req.body || {};
    if (confirm !== true) fail(400, "永久删除需要再次确认。");
    return { ok: true, ...purgeTarget(req.user, target_type, target_id) };
  }));

  const visibleLogs = "NOT EXISTS (SELECT 1 FROM moderation_log_hidden h WHERE h.user_id=? AND h.log_id=m.id) AND m.created_at > COALESCE((SELECT cleared_at FROM moderation_log_cleared WHERE user_id=?), 0)";
  app.get("/api/admin/logs", auth, handle((req) => {
    staffOnly(req);
    const offset = pageOffset(req.query.offset);
    const me = req.user.id;
    const kind = targetTypes.includes(req.query.type) ? req.query.type : "";
    const scope = kind ? `${visibleLogs} AND m.target_type=?` : visibleLogs;
    const scopeArgs = kind ? [me, me, kind] : [me, me];
    const logs = db
      .prepare(
        `SELECT m.*, COALESCE(u.name,'已注销用户') AS actor, a.name AS approver
         FROM moderation_log m LEFT JOIN users u ON u.id=m.actor_id LEFT JOIN users a ON a.id=m.approver_id
         WHERE ${scope}
         ORDER BY m.created_at DESC, m.rowid DESC LIMIT 50 OFFSET ?`,
      )
      .all(...scopeArgs, offset)
      .map((l) => ({ ...l, actor: l.actor_id ? l.actor : l.actor_role === "system" ? "系统" : l.actor }));
    const total = db.prepare(`SELECT COUNT(*) AS n FROM moderation_log m WHERE ${scope}`).get(...scopeArgs).n;
    return { logs, total, hasMore: offset + logs.length < total };
  }));
  app.post("/api/admin/logs/hide", auth, handle((req) => {
    staffOnly(req);
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => typeof id === "string" && id.length <= 64))
      fail(400, "请选择要删除的记录。");
    const hide = db.prepare(
      "INSERT OR IGNORE INTO moderation_log_hidden(user_id,log_id,hidden_at) SELECT ?,id,? FROM moderation_log WHERE id=?",
    );
    const t = now();
    let removed = 0;
    for (const id of new Set(ids)) removed += hide.run(req.user.id, t, id).changes;
    return { ok: true, removed };
  }));
  app.post("/api/admin/logs/clear", auth, handle((req) => {
    staffOnly(req);
    const t = now();
    db.prepare(
      "INSERT INTO moderation_log_cleared(user_id,cleared_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET cleared_at=excluded.cleared_at",
    ).run(req.user.id, t);
    db.prepare("DELETE FROM moderation_log_hidden WHERE user_id=?").run(req.user.id);
    return { ok: true };
  }));

  app.get("/api/penalties/:type/:id", auth, handle((req) => {
    const type = req.params.type;
    if (!["user", "board"].includes(type)) fail(400, "对象类型无效。");
    const privileged =
      isStaff(req.user) ||
      (type === "user" ? req.params.id === req.user.id : boardRoleOf(req.user.id, req.params.id) === "lead");
    return { penalty: penaltyView(type, req.params.id, { privileged }), appeal_id: privileged ? appealFor(type, req.params.id) : null };
  }));
}
