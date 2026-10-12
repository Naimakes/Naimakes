import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileStillUsed } from "./account-deletion.mjs";

export const TRASH_DAYS = 30;
const TRASH_MS = TRASH_DAYS * 86400000;
const MAX_PER_USER = 2000;
const MAX_BATCH = 200;
const actions = new Set(["favorite", "unfavorite", "pin", "unpin", "hide", "unhide", "delete", "restore", "purge"]);
const columns = "id,url,name,mime,size,source,favorite,pinned,pinned_at,hidden,deleted_at,created_at";
const sources = new Set(["upload", "assistant", "post", "comment", "message"]);

const cleanName = (value, fallback) => {
  const name = String(value ?? "").replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 200);
  return name || fallback;
};
const format = (row) => ({ ...row, favorite: !!row.favorite, pinned: !!row.pinned, hidden: !!row.hidden });

/**
 * 图书馆：用户上传过的文件。文件本体仍在 uploads 目录里，这里只记录归属与整理状态。
 * 返回给其他模块使用的 register / saveBuffer / purgeExpired。
 */
export function installFileLibrary(app, { db, auth, uploadDir, uploadTypes, uploadPath, uploadLimit }) {
  const mimeByExtension = new Map(Object.entries(uploadTypes).map(([mime, extension]) => [extension, mime]));
  const fileOn = (url) => resolve(uploadDir, url.slice("/uploads/".length));
  const count = db.prepare("SELECT COUNT(*) AS n FROM library_files WHERE user_id=?");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO library_files(id,user_id,url,name,mime,size,source,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  const byUrl = db.prepare(`SELECT ${columns} FROM library_files WHERE user_id=? AND url=?`);
  const byHash = db.prepare(`SELECT ${columns} FROM library_files WHERE user_id=? AND hash=? AND deleted_at IS NULL`);

  /** 登记一个已经在 uploads 里的文件；已登记过（包括在“已删除”里）就原样保留。 */
  function register(userId, { url, name, mime, size, hash = null }, source = "upload") {
    if (!userId || typeof url !== "string" || !uploadPath.test(url)) return null;
    const existing = byUrl.get(userId, url);
    if (existing) return format(existing);
    if (count.get(userId).n >= MAX_PER_USER) return null;
    insert.run(
      randomUUID(),
      userId,
      url,
      cleanName(name, "文件"),
      String(mime || "application/octet-stream").slice(0, 120),
      size,
      sources.has(source) ? source : "upload",
      hash,
      Date.now(),
    );
    return format(byUrl.get(userId, url));
  }

  /** 助手对话里附上的文件没有经过 /api/uploads，这里把内容落盘后再登记。同一份内容不重复保存。 */
  function saveBuffer(userId, { buffer, name, mime }, source = "assistant") {
    if (!userId || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > uploadLimit) return null;
    const hash = createHash("sha256").update(buffer).digest("hex");
    const same = byHash.get(userId, hash);
    if (same && existsSync(fileOn(same.url))) return format(same);
    if (count.get(userId).n >= MAX_PER_USER) return null;
    let type = uploadTypes[mime] ? mime : "";
    if (!type) {
      const extension = String(name).split(".").pop()?.toLowerCase();
      type = mimeByExtension.get(extension) || "text/plain";
    }
    if (type === "text/plain") {
      const extension = String(name).split(".").pop()?.toLowerCase();
      if (["md", "markdown"].includes(extension)) type = "text/markdown";
      else if (extension === "csv") type = "text/csv";
      else if (extension === "json") type = "application/json";
    }
    const url = "/uploads/" + randomUUID() + "." + uploadTypes[type];
    writeFileSync(fileOn(url), buffer);
    return register(userId, { url, name, mime: type, size: buffer.length, hash }, source);
  }

  /** 行已删除后，没有任何地方还在引用的文件才真正从磁盘移除。 */
  function removeFiles(urls) {
    let removed = 0;
    for (const url of new Set(urls)) {
      if (!uploadPath.test(url) || fileStillUsed.get({ $url: url })) continue;
      try {
        unlinkSync(fileOn(url));
        removed++;
      } catch (error) {
        if (error.code !== "ENOENT") console.error("Library file cleanup failed:", error.code);
      }
    }
    return removed;
  }

  function purgeExpired(now = Date.now()) {
    const rows = db.prepare("SELECT id,url FROM library_files WHERE deleted_at IS NOT NULL AND deleted_at<=?").all(now - TRASH_MS);
    if (!rows.length) return 0;
    const remove = db.prepare("DELETE FROM library_files WHERE id=?");
    db.exec("BEGIN");
    try {
      rows.forEach((row) => remove.run(row.id));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    removeFiles(rows.map((row) => row.url));
    return rows.length;
  }

  const sweep = () => {
    try {
      purgeExpired();
    } catch (error) {
      console.error("Library trash cleanup failed:", error?.message || error);
    }
  };
  sweep();
  setInterval(sweep, 3600000).unref();

  app.get("/api/library/files", auth, (req, res) => {
    sweep();
    const rows = db
      .prepare(
        `SELECT ${columns} FROM library_files WHERE user_id=?
         ORDER BY pinned DESC, pinned_at DESC, created_at DESC, id LIMIT ?`,
      )
      .all(req.user.id, MAX_PER_USER);
    res.json({ files: rows.map(format), trash_days: TRASH_DAYS });
  });

  app.post("/api/library/files", auth, (req, res) => {
    const { url, name } = req.body ?? {};
    if (typeof url !== "string" || !uploadPath.test(url) || !existsSync(fileOn(url)))
      return res.status(400).json({ error: "请先上传有效的文件。" });
    if (!byUrl.get(req.user.id, url) && count.get(req.user.id).n >= MAX_PER_USER)
      return res.status(400).json({ error: `图书馆最多保存 ${MAX_PER_USER} 个文件，请先彻底删除一些。` });
    const extension = url.split(".").pop();
    const file = register(
      req.user.id,
      {
        url,
        name: cleanName(name, "文件." + extension),
        mime: mimeByExtension.get(extension) || "application/octet-stream",
        size: statSync(fileOn(url)).size,
      },
      "upload",
    );
    res.status(201).json({ file });
  });

  app.post("/api/library/files/action", auth, (req, res) => {
    const { ids, action } = req.body ?? {};
    if (!actions.has(action)) return res.status(400).json({ error: "不支持这个操作。" });
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH || !ids.every((id) => typeof id === "string"))
      return res.status(400).json({ error: "请先选择文件。" });
    const user = req.user.id;
    const now = Date.now();
    const marks = ids.map(() => "?").join(",");
    const purging = [];
    db.exec("BEGIN");
    try {
      const rows = db
        .prepare(`SELECT id,url,deleted_at FROM library_files WHERE user_id=? AND id IN (${marks})`)
        .all(user, ...ids);
      const live = rows.filter((row) => row.deleted_at === null).map((row) => row.id);
      const trashed = rows.filter((row) => row.deleted_at !== null);
      const update = (sql, targets, ...values) => {
        if (targets.length) db.prepare(`UPDATE library_files SET ${sql} WHERE user_id=? AND id IN (${targets.map(() => "?").join(",")})`).run(...values, user, ...targets);
      };
      if (action === "favorite") update("favorite=1", live);
      else if (action === "unfavorite") update("favorite=0", live);
      else if (action === "pin") update("pinned=1,pinned_at=?", live, now);
      else if (action === "unpin") update("pinned=0,pinned_at=NULL", live);
      else if (action === "hide") update("hidden=1", live);
      else if (action === "unhide") update("hidden=0", live);
      else if (action === "delete") update("deleted_at=?", live, now);
      else if (action === "restore") update("deleted_at=NULL", trashed.map((row) => row.id));
      else if (action === "purge") {
        const remove = db.prepare("DELETE FROM library_files WHERE user_id=? AND id=?");
        for (const row of trashed) {
          remove.run(user, row.id);
          purging.push(row.url);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    removeFiles(purging);
    res.json({ ok: true });
  });

  app.delete("/api/library/trash", auth, (req, res) => {
    const rows = db.prepare("SELECT url FROM library_files WHERE user_id=? AND deleted_at IS NOT NULL").all(req.user.id);
    db.prepare("DELETE FROM library_files WHERE user_id=? AND deleted_at IS NOT NULL").run(req.user.id);
    removeFiles(rows.map((row) => row.url));
    res.json({ ok: true, removed: rows.length });
  });

  return { register, saveBuffer, purgeExpired };
}
