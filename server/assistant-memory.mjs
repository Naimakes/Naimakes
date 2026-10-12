import { randomUUID } from "node:crypto";
import express from "express";
import { db } from "./database.mjs";

// 助手的记忆：用户对写作风格、执行操作、回答内容的要求，以及用户让助手记住的信息。
// 来源有两种：source="user" 是用户明确要求记住的；source="auto" 是助手从对话里整理出来的。

db.exec(`
CREATE TABLE IF NOT EXISTS assistant_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_memories_user ON assistant_memories(user_id, updated_at DESC);
`);
if (!db.prepare("PRAGMA table_info(assistant_prefs)").all().some((c) => c.name === "memory_auto"))
  db.exec("ALTER TABLE assistant_prefs ADD COLUMN memory_auto INTEGER NOT NULL DEFAULT 1");

export const memoryKinds = ["style", "action", "answer", "fact"];
export const kindLabels = { style: "写作风格", action: "执行操作", answer: "回答要求", fact: "个人信息" };
export const MAX_MEMORIES = 60;
const MAX_LENGTH = 200;

const normalize = (text) => String(text).toLowerCase().replace(/[\s，。,.！!？?；;：:、"'“”‘’「」]/g, "");
const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);

export const autoEnabled = (userId) => {
  const row = db.prepare("SELECT memory_auto FROM assistant_prefs WHERE user_id=?").get(userId);
  return row ? !!row.memory_auto : true;
};

export function listMemories(userId) {
  return db
    .prepare("SELECT id,kind,content,source,enabled,created_at,updated_at FROM assistant_memories WHERE user_id=? ORDER BY updated_at DESC")
    .all(userId)
    .map((row) => ({ ...row, enabled: !!row.enabled }));
}

/** 加一条记忆；内容相同的只刷新时间。返回 { memory, created }，内容无效返回 null。 */
export function addMemory(userId, { content, kind = "fact", source = "auto" }) {
  const text = clean(content);
  if (text.length < 2) return null;
  const type = memoryKinds.includes(kind) ? kind : "fact";
  const key = normalize(text);
  const now = Date.now();
  for (const row of db.prepare("SELECT id,content,source FROM assistant_memories WHERE user_id=?").all(userId)) {
    if (normalize(row.content) === key) {
      db.prepare("UPDATE assistant_memories SET updated_at=?, enabled=1, source=CASE WHEN ?='user' THEN 'user' ELSE source END WHERE id=?").run(now, source, row.id);
      return { memory: { id: row.id, kind: type, content: row.content }, created: false };
    }
  }
  const id = randomUUID();
  db.prepare("INSERT INTO assistant_memories(id,user_id,kind,content,source,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)").run(
    id,
    userId,
    type,
    text,
    source === "user" ? "user" : "auto",
    now,
    now,
  );
  // 超过上限时，先淘汰最久没用到的自动整理条目，用户亲自要求记住的尽量保留。
  const over = db.prepare("SELECT COUNT(*) AS n FROM assistant_memories WHERE user_id=?").get(userId).n - MAX_MEMORIES;
  if (over > 0)
    db.prepare(
      `DELETE FROM assistant_memories WHERE id IN (
         SELECT id FROM assistant_memories WHERE user_id=? AND id<>? ORDER BY (source='user'), updated_at LIMIT ?)`,
    ).run(userId, id, over);
  return { memory: { id, kind: type, content: text }, created: true };
}

export function forgetMemory(userId, id) {
  return db.prepare("DELETE FROM assistant_memories WHERE user_id=? AND id=?").run(userId, id).changes > 0;
}

/** 放进提示词的记忆块；没有可用记忆时返回空字符串。 */
export function memoryBlock(userId) {
  if (!userId) return "";
  const rows = db
    .prepare("SELECT kind,content FROM assistant_memories WHERE user_id=? AND enabled=1 ORDER BY (source='user') DESC, updated_at DESC LIMIT 40")
    .all(userId);
  if (!rows.length) return "";
  let total = 0;
  const lines = [];
  for (const row of rows) {
    const line = `- [${kindLabels[row.kind] || "其他"}] ${row.content.replace(/[<>]/g, "")}`;
    total += line.length;
    if (total > 3000) break;
    lines.push(line);
  }
  return `<user_memory>\n${lines.join("\n")}\n</user_memory>\n`;
}

export function installMemory(app, { auth }) {
  const json = express.json({ limit: "16kb" });
  const shown = (row) => ({ ...row, enabled: !!row.enabled });

  app.get("/api/assistant/memories", auth, (req, res) => {
    res.json({ memories: listMemories(req.user.id), auto: autoEnabled(req.user.id), kinds: kindLabels, max: MAX_MEMORIES });
  });

  app.post("/api/assistant/memories", auth, json, (req, res) => {
    const added = addMemory(req.user.id, { content: req.body?.content, kind: req.body?.kind, source: "user" });
    if (!added) return res.status(400).json({ error: "请输入要记住的内容（至少 2 个字）。" });
    res.status(201).json({ memories: listMemories(req.user.id) });
  });

  app.patch("/api/assistant/memories/:id", auth, json, (req, res) => {
    const row = db.prepare("SELECT * FROM assistant_memories WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: "没有找到这条记忆。" });
    const sets = [];
    const values = [];
    if (req.body?.content !== undefined) {
      const text = clean(req.body.content);
      if (text.length < 2) return res.status(400).json({ error: "记忆内容至少 2 个字。" });
      sets.push("content=?", "source='user'");
      values.push(text);
    }
    if (typeof req.body?.enabled === "boolean") {
      sets.push("enabled=?");
      values.push(req.body.enabled ? 1 : 0);
    }
    if (memoryKinds.includes(req.body?.kind)) {
      sets.push("kind=?");
      values.push(req.body.kind);
    }
    if (!sets.length) return res.status(400).json({ error: "没有需要修改的内容。" });
    db.prepare(`UPDATE assistant_memories SET ${sets.join(",")},updated_at=? WHERE id=?`).run(...values, Date.now(), row.id);
    res.json({ memory: shown(db.prepare("SELECT id,kind,content,source,enabled,created_at,updated_at FROM assistant_memories WHERE id=?").get(row.id)) });
  });

  app.delete("/api/assistant/memories/:id", auth, (req, res) => {
    if (!forgetMemory(req.user.id, req.params.id)) return res.status(404).json({ error: "没有找到这条记忆。" });
    res.json({ ok: true });
  });

  app.delete("/api/assistant/memories", auth, (req, res) => {
    db.prepare("DELETE FROM assistant_memories WHERE user_id=?").run(req.user.id);
    res.json({ ok: true });
  });

  app.put("/api/assistant/memory-auto", auth, json, (req, res) => {
    if (typeof req.body?.auto !== "boolean") return res.status(400).json({ error: "设置无效。" });
    db.prepare(
      `INSERT INTO assistant_prefs(user_id,prefs,updated_at,memory_auto) VALUES(?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET memory_auto=excluded.memory_auto`,
    ).run(req.user.id, "{}", 0, req.body.auto ? 1 : 0);
    res.json({ auto: req.body.auto });
  });
}
