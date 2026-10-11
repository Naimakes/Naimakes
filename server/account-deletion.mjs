import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { db, dataDir } from "./database.mjs";
import { record, forgetUser, isOwner, isAdmin, configureGovernance } from "./governance.mjs";

const ownPosts = "SELECT id FROM posts WHERE author_id=$user";
const removedComments = `SELECT id FROM comments WHERE author_id=$user OR post_id IN (${ownPosts})`;
const removedMessages = "SELECT id FROM messages WHERE sender_id=$user OR recipient_id=$user";
const removedContent = `(owner_type='post' AND owner_id IN (${ownPosts}))
  OR (owner_type='comment' AND owner_id IN (${removedComments}))
  OR (owner_type='message' AND owner_id IN (${removedMessages}))`;
const count = (sql, id) => db.prepare(sql).get({ $user: id }).n;

function deletionCounts(id) {
  return {
    posts: count("SELECT COUNT(*) AS n FROM posts WHERE author_id=$user", id),
    comments: count(`SELECT COUNT(*) AS n FROM comments WHERE id IN (${removedComments})`, id),
    attachments: count(`SELECT COUNT(*) AS n FROM attachments WHERE ${removedContent}`, id),
    messages: count(`SELECT COUNT(*) AS n FROM messages WHERE id IN (${removedMessages})`, id),
    collections: count("SELECT COUNT(*) AS n FROM collections WHERE user_id=$user", id),
    boards: count("SELECT COUNT(*) AS n FROM category_moderators WHERE user_id=$user AND role='lead'", id),
    boards_created: count("SELECT COUNT(*) AS n FROM categories WHERE created_by=$user", id),
  };
}

const uploadPattern = /\/uploads\/[a-f0-9-]{36}\.[a-z0-9]{1,4}\b/g;
function fileCandidates(user) {
  const rows = db.prepare(`
    SELECT url AS value FROM attachments WHERE ${removedContent}
    UNION SELECT avatar FROM users WHERE id=$user
    UNION SELECT banner FROM profiles WHERE user_id=$user
    UNION SELECT banner_mobile FROM profiles WHERE user_id=$user
    UNION SELECT cover FROM collections WHERE user_id=$user
    UNION SELECT content FROM posts WHERE author_id=$user
    UNION SELECT content FROM comments WHERE id IN (${removedComments})
    UNION SELECT content FROM messages WHERE id IN (${removedMessages})
  `).all({ $user: user });
  return new Set(rows.flatMap((r) => String(r.value || "").match(uploadPattern) || []));
}

const fileStillUsed = db.prepare(`
  SELECT 1 FROM attachments WHERE url=$url
  UNION ALL SELECT 1 FROM users WHERE avatar=$url OR instr(bio,$url)>0
  UNION ALL SELECT 1 FROM profiles WHERE banner=$url OR banner_mobile=$url
  UNION ALL SELECT 1 FROM collections WHERE cover=$url OR instr(description,$url)>0
  UNION ALL SELECT 1 FROM posts WHERE instr(content,$url)>0 OR instr(excerpt,$url)>0
  UNION ALL SELECT 1 FROM comments WHERE instr(content,$url)>0
  UNION ALL SELECT 1 FROM messages WHERE instr(content,$url)>0
  UNION ALL SELECT 1 FROM categories WHERE instr(description,$url)>0
  LIMIT 1
`);

function deleteAccount(target, actorId) {
  let counts, files;
  db.exec("BEGIN IMMEDIATE");
  try {
    counts = deletionCounts(target.id);
    files = fileCandidates(target.id);
    const args = { $user: target.id };

    const deletedParents = new Map(db.prepare(
      "SELECT id,parent_id FROM comments WHERE author_id=?",
    ).all(target.id).map((c) => [c.id, c.parent_id]));
    const children = db.prepare(`SELECT id,parent_id FROM comments
      WHERE author_id<>$user AND parent_id IN (SELECT id FROM comments WHERE author_id=$user)
        AND post_id NOT IN (${ownPosts})`).all(args);
    const reparent = db.prepare("UPDATE comments SET parent_id=? WHERE id=?");
    for (const child of children) {
      let parent = child.parent_id;
      const visited = new Set();
      while (parent && deletedParents.has(parent)) {
        if (visited.has(parent)) { parent = null; break; }
        visited.add(parent);
        parent = deletedParents.get(parent);
      }
      reparent.run(parent ?? null, child.id);
    }

    db.prepare(`DELETE FROM attachments WHERE ${removedContent}`).run(args);
    db.prepare(`DELETE FROM quotes WHERE ${removedContent}`).run(args);
    db.prepare("DELETE FROM comments WHERE author_id=?").run(target.id);
    db.prepare("DELETE FROM posts WHERE author_id=?").run(target.id);
    db.prepare("DELETE FROM recents WHERE scope='share' AND value=?").run(target.id);
    db.prepare("DELETE FROM notify_subscriptions WHERE kind='author' AND target_id=?").run(target.id);
    db.prepare("DELETE FROM notifications WHERE actor_id=? AND kind NOT IN ('moderation','announcement')").run(target.id);
    db.prepare("UPDATE notifications SET actor_id=NULL WHERE actor_id=?").run(target.id);

    db.prepare("INSERT INTO deleted_accounts(id,email,name,password,deleted_at) VALUES(?,?,?,?,?)")
      .run(target.id, target.email.trim().toLowerCase(), target.name, target.password, Date.now());
    record({
      actorId, role: !actorId ? "system" : actorId === target.id ? "member" : "owner",
      action: actorId === target.id ? "delete_own_account" : "delete_user",
      targetType: "user", targetId: target.id, label: target.name,
      before: target.status === "deleted" ? "已删除（可恢复）" : "正常", after: "永久删除",
      detail: JSON.stringify(counts),
    });
    db.prepare("DELETE FROM users WHERE id=?").run(target.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  forgetUser(target.id, target.name);
  let filesRemoved = 0;
  for (const url of files) {
    if (fileStillUsed.get({ $url: url })) continue;
    try {
      unlinkSync(resolve(dataDir, url.slice(1)));
      filesRemoved++;
    } catch (error) {
      if (error.code !== "ENOENT") console.error("Account upload cleanup failed:", error.code);
    }
  }
  return { user_id: target.id, ...counts, files_removed: filesRemoved };
}

configureGovernance({ purgeUser: (row) => deleteAccount(row, null) });

export function installAccountDeletion(app, { auth, authLimiter, checkPassword, secureCookies }) {
  const targetFor = (req, res, self) => {
    if (!self && !isOwner(req.user)) {
      res.status(403).json(isAdmin(req.user)
        ? { error: "无此权限，请向站主申请", code: "request_required" }
        : { error: "只有站主可以删除其他用户。" });
      return null;
    }
    const target = db.prepare("SELECT * FROM users WHERE id=?")
      .get(self ? req.user.id : req.params.id);
    if (!target) {
      res.status(404).json({ error: "用户不存在。" });
      return null;
    }
    const ownerId = db.prepare("SELECT value FROM settings WHERE key='owner_id'").get()?.value;
    if (target.role === "owner" || target.id === ownerId) {
      res.status(403).json({ error: "站主账号不能删除。" });
      return null;
    }
    return target;
  };

  for (const self of [true, false]) {
    const path = self ? "/api/me/account" : "/api/admin/users/:id";
    app.get(path + "/deletion-preview", auth, (req, res) => {
      const target = targetFor(req, res, self);
      if (!target) return;
      res.json({ account: { id: target.id, name: target.name }, counts: deletionCounts(target.id) });
    });
    app.delete(path, auth, authLimiter, async (req, res) => {
      let target = targetFor(req, res, self);
      if (!target) return;
      const { password, confirmation } = req.body || {};
      if ((typeof confirmation === "string" ? confirmation.trim() : confirmation) !== (self ? "删除账号" : target.name))
        return res.status(400).json({ error: "删除确认内容不正确。" });
      if (self) {
        if (typeof password !== "string" || !password.length || password.length > 128)
          return res.status(400).json({ error: "请填写当前密码。" });
        if (!(await checkPassword(password, target.password)))
          return res.status(403).json({ error: "当前密码不正确。" });
        const fresh = db.prepare("SELECT * FROM users WHERE id=?").get(target.id);
        const token = req.headers.cookie?.split(";").map((part) => part.trim())
          .find((part) => part.startsWith("nmk_session="))?.slice(12);
        const session = token && db.prepare("SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?")
          .get(createHash("sha256").update(token).digest("hex"), target.id, Date.now());
        if (!fresh || !session || fresh.password !== target.password || fresh.status !== "active")
          return res.status(409).json({ error: "账号状态已变更，请重新登录后操作。" });
        if (!targetFor(req, res, self)) return;
        target = fresh;
      }
      const deleted = deleteAccount(target, req.user.id);
      if (self) res.clearCookie("nmk_session", {
        path: "/", httpOnly: true, secure: secureCookies, sameSite: "lax",
      });
      res.json({ ok: true, deleted });
    });
  }
}
