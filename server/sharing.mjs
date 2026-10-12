import { randomBytes } from "node:crypto";
import { db } from "./database.mjs";
import { boardModeration, getBoard } from "./boards.mjs";

const kinds = ["collection", "board", "message", "notice", "assistant"];
const clip = (text, limit) => {
  const chars = Array.from(String(text || "").replace(/\s+/g, " ").trim());
  return chars.length > limit ? chars.slice(0, limit).join("").trimEnd() + "…" : chars.join("");
};
const stripImages = (text) => String(text || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
const person = (row, prefix = "") =>
  row && row[prefix + "id"]
    ? {
        id: row[prefix + "id"],
        name: row[prefix + "name"],
        initials: row[prefix + "initials"],
        avatar: row[prefix + "avatar"] || "",
      }
    : null;

// Publish (or refresh) the read-only snapshot of one of the user's assistant chats and return its link token.
export function shareAssistantChat(userId, chatId) {
  const row = db.prepare("SELECT title,messages,share_token FROM assistant_chats WHERE id=? AND user_id=?").get(chatId, userId);
  if (!row) return null;
  let count = 0;
  try {
    count = JSON.parse(row.messages).length;
  } catch {}
  const token = row.share_token || randomBytes(12).toString("base64url");
  const now = Date.now();
  db.prepare("UPDATE assistant_chats SET share_token=?,share_title=?,share_messages=?,shared_at=? WHERE id=? AND user_id=?").run(
    token,
    row.title,
    row.messages,
    now,
    chatId,
    userId,
  );
  return { token, shared_at: now, title: row.title, count };
}

export function prepareShare(user, share) {
  if (share === undefined || share === null || share === "") return { stored: "" };
  if (
    typeof share !== "object" ||
    !kinds.includes(share.type) ||
    typeof share.id !== "string" ||
    !share.id ||
    share.id.length > 160
  )
    return { error: "分享的内容不存在。" };
  if (share.type === "assistant") {
    const shared = shareAssistantChat(user.id, share.id);
    if (!shared) return { error: "这段对话不存在。" };
    return { stored: JSON.stringify({ type: "assistant", id: shared.token, snapshot: { title: clip(shared.title, 60), count: shared.count } }) };
  }
  if (share.type === "collection") {
    const folder = db.prepare("SELECT id,user_id,is_public FROM collections WHERE id=?").get(share.id);
    if (!folder || (!folder.is_public && folder.user_id !== user.id))
      return { error: "收藏夹不存在或未公开。" };
    if (!folder.is_public)
      return { error: "私密收藏夹只有你自己能看到，公开后才能分享。" };
    return { stored: JSON.stringify({ type: "collection", id: folder.id }) };
  }
  if (share.type === "board") {
    if (!getBoard(share.id)) return { error: "版块不存在或已被删除。" };
    return { stored: JSON.stringify({ type: "board", id: share.id }) };
  }
  if (share.type === "message") {
    const message = db.prepare("SELECT * FROM messages WHERE id=?").get(share.id);
    if (!message || (message.sender_id !== user.id && message.recipient_id !== user.id))
      return { error: "这条私信不存在或你无法查看。" };
    const peer = message.sender_id === user.id ? message.recipient_id : message.sender_id;
    const cleared =
      db.prepare("SELECT cleared_at FROM message_threads WHERE user_id=? AND peer_id=?").get(user.id, peer)
        ?.cleared_at || 0;
    if (message.created_at <= cleared) return { error: "这条私信不存在或你无法查看。" };
    const files = db
      .prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner_type='message' AND owner_id=?")
      .get(message.id).n;
    const quote = db
      .prepare(
        `SELECT p.title FROM quotes q JOIN posts p ON p.id=q.post_id
         WHERE q.owner_type='message' AND q.owner_id=? AND p.visibility='public' AND p.deleted_at IS NULL
         ORDER BY q.position LIMIT 1`,
      )
      .get(message.id);
    const text = clip(stripImages(message.content), 500);
    if (!text && !files && !quote) return { error: "这条私信没有可以分享的文字。" };
    return {
      stored: JSON.stringify({
        type: "message",
        id: message.id,
        snapshot: {
          text,
          files,
          quote: quote?.title || "",
          mine: message.sender_id === user.id,
          created_at: message.created_at,
        },
      }),
    };
  }
  const notice = db.prepare("SELECT * FROM notifications WHERE id=? AND user_id=?").get(share.id, user.id);
  if (!notice) return { error: "这条通知不存在。" };
  let meta = {};
  try {
    meta = JSON.parse(notice.meta || "{}");
  } catch {}
  return {
    stored: JSON.stringify({
      type: "notice",
      id: notice.id,
      snapshot: {
        kind: notice.kind,
        text: clip(notice.text, 300),
        preview: clip(typeof meta.preview === "string" ? meta.preview : "", 200),
        created_at: notice.created_at,
      },
    }),
  };
}

export function shareCard(stored, viewer) {
  if (!stored) return null;
  let share;
  try {
    share = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!share || !kinds.includes(share.type)) return null;
  if (share.type === "message" || share.type === "notice")
    return { type: share.type, id: share.id, ...(share.snapshot || {}) };
  if (share.type === "assistant") {
    const row = db
      .prepare(
        `SELECT c.shared_at,c.share_title,u.id,u.name,u.initials,u.avatar,u.status
         FROM assistant_chats c JOIN users u ON u.id=c.user_id WHERE c.share_token=?`,
      )
      .get(String(share.id));
    if (!row || row.status === "deleted") return { type: "assistant", id: share.id, unavailable: "这段对话已取消分享" };
    return { type: "assistant", id: share.id, title: row.share_title || share.snapshot?.title || "", count: share.snapshot?.count || 0, shared_at: row.shared_at, owner: person(row) };
  }
  if (share.type === "collection") {
    const folder = db
      .prepare(
        `SELECT c.*, u.id AS owner_id, u.name AS owner_name, u.initials AS owner_initials, u.avatar AS owner_avatar,
           u.status AS owner_status,
           (SELECT COUNT(*) FROM collection_items WHERE collection_id=c.id) AS count
         FROM collections c JOIN users u ON u.id=c.user_id WHERE c.id=?`,
      )
      .get(share.id);
    if (!folder || folder.owner_status === "deleted")
      return { type: "collection", id: share.id, unavailable: "这个收藏夹已被删除" };
    if (!folder.is_public && folder.user_id !== viewer)
      return { type: "collection", id: share.id, unavailable: "这个收藏夹已设为私密" };
    const previews = db
      .prepare(
        `SELECT p.id,p.title FROM collection_items i JOIN posts p ON p.id=i.post_id
         WHERE i.collection_id=? AND p.visibility='public' AND p.deleted_at IS NULL
         ORDER BY i.added_at DESC LIMIT 3`,
      )
      .all(folder.id);
    return {
      type: "collection",
      id: folder.id,
      name: folder.name,
      description: folder.description,
      cover: folder.cover,
      count: folder.count,
      created_at: folder.created_at,
      owner: person(folder, "owner_"),
      previews,
    };
  }
  const board = getBoard(share.id);
  if (!board) return { type: "board", id: share.id, unavailable: "这个版块已被删除" };
  const { lead, acting } = boardModeration(board.id);
  const count = (sql) => db.prepare(sql).get(board.id).n;
  const creator = board.created_by
    ? db.prepare("SELECT id,name,initials,avatar FROM users WHERE id=? AND status<>'deleted'").get(board.created_by)
    : null;
  return {
    type: "board",
    id: board.id,
    name: board.name,
    en: board.en,
    description: board.description,
    icon: board.icon,
    builtin: !!board.builtin,
    posts: count(
      "SELECT COUNT(*) AS n FROM posts WHERE category=? AND visibility='public' AND deleted_at IS NULL",
    ),
    followers: count("SELECT COUNT(*) AS n FROM follows WHERE category=?"),
    members: count("SELECT COUNT(*) AS n FROM category_members WHERE category_id=?"),
    lead: lead ? { id: lead.id, name: lead.name, initials: lead.initials, avatar: lead.avatar } : null,
    acting_owner: acting ? { id: acting.id, name: acting.name, initials: acting.initials } : null,
    creator: creator ? { ...creator, avatar: creator.avatar || "" } : null,
  };
}

const typeNames = { collection: "收藏夹", board: "版块", message: "私信", notice: "通知", assistant: "对话" };
export function sharePreview(card) {
  if (!card) return "";
  if (card.unavailable) return `分享了一个${typeNames[card.type]}`;
  if (card.type === "collection" || card.type === "board")
    return `分享了${typeNames[card.type]}「${card.name}」`;
  if (card.type === "assistant") return `分享了对话「${card.title || "未命名对话"}」`;
  return `转发了一条${typeNames[card.type]}`;
}
