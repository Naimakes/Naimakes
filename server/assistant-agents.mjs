import { randomBytes } from "node:crypto";
import express from "express";
import { db } from "./database.mjs";
import { colors, shapes } from "./assistant-actions.mjs";

// 智能体：用户可以创建多个不同分工的 Naimakes 分身，每个有自己的名字、外观和一段「指令」。
// 内置的 Naimakes 是每个人都有的默认智能体（id 固定为 naimakes），不存进表里，外观沿用 assistant_prefs。
// 其中一个是「主智能体」，也就是常驻屏幕上的那个小球。

db.exec(`
CREATE TABLE IF NOT EXISTS assistant_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  shape TEXT NOT NULL DEFAULT 'blob',
  color TEXT NOT NULL DEFAULT 'black',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_agents_user ON assistant_agents(user_id, created_at);
`);
if (!db.prepare("PRAGMA table_info(assistant_prefs)").all().some((c) => c.name === "main_agent"))
  db.exec("ALTER TABLE assistant_prefs ADD COLUMN main_agent TEXT");

export const BUILTIN_AGENT = "naimakes";
export const MAX_AGENTS = 12;
export const MAX_GROUP = 3;
export const MAX_NAME = 20;
export const MAX_INSTRUCTIONS = 2000;

const AGENT_ID = /^[a-z0-9]{6,40}$/;

class AgentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const publicAgent = (row) => ({ id: row.id, name: row.name, instructions: row.instructions, shape: row.shape, color: row.color, created_at: row.created_at, updated_at: row.updated_at });

export const listAgents = (userId) => db.prepare("SELECT * FROM assistant_agents WHERE user_id=? ORDER BY created_at, id").all(userId).map(publicAgent);

export function getAgent(userId, id) {
  if (typeof id !== "string" || !AGENT_ID.test(id)) return null;
  const row = db.prepare("SELECT * FROM assistant_agents WHERE id=? AND user_id=?").get(id, userId);
  return row ? publicAgent(row) : null;
}

/** 内置 Naimakes 返回 null；其他 id 必须是这位用户自己的智能体，否则也返回 null。 */
export const agentFor = (userId, id) => (userId ? getAgent(userId, id) : null);

/** 对话里记下的智能体：保留内置和仍然存在的，最多 3 个，至少有一个。 */
export function cleanAgentIds(userId, input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const id of list) {
    if (typeof id !== "string" || out.includes(id)) continue;
    if (id === BUILTIN_AGENT || getAgent(userId, id)) out.push(id);
    if (out.length >= MAX_GROUP) break;
  }
  return out.length ? out : [BUILTIN_AGENT];
}

export function mainAgentId(userId) {
  const row = db.prepare("SELECT main_agent FROM assistant_prefs WHERE user_id=?").get(userId);
  const id = row?.main_agent;
  return id && id !== BUILTIN_AGENT && getAgent(userId, id) ? id : BUILTIN_AGENT;
}

function setMainAgent(userId, id) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO assistant_prefs(user_id,prefs,updated_at,main_agent) VALUES(?,'{}',?,?)
     ON CONFLICT(user_id) DO UPDATE SET main_agent=excluded.main_agent`,
  ).run(userId, now, id === BUILTIN_AGENT ? null : id);
}

const text = (value, max) => String(value ?? "").replace(/\r/g, "").trim().slice(0, max);

function cleanName(value, userId, exceptId = "") {
  const name = text(value, MAX_NAME + 20).replace(/\s+/g, " ");
  if (!name) throw new AgentError("请给智能体起个名字。");
  if (Array.from(name).length > MAX_NAME) throw new AgentError(`名字最多 ${MAX_NAME} 个字。`);
  if (/[<>"]/.test(name)) throw new AgentError("名字里不能包含 < > \" 这些符号。");
  const key = name.toLowerCase();
  if (key === "naimakes") throw new AgentError("这个名字是内置智能体的，请换一个。");
  const taken = db.prepare("SELECT id,name FROM assistant_agents WHERE user_id=?").all(userId).some((row) => row.id !== exceptId && row.name.toLowerCase() === key);
  if (taken) throw new AgentError("已经有同名的智能体了，请换一个名字。");
  return name;
}

const cleanInstructions = (value) => {
  const out = text(value, MAX_INSTRUCTIONS + 1);
  if (Array.from(out).length > MAX_INSTRUCTIONS) throw new AgentError(`指令最多 ${MAX_INSTRUCTIONS} 个字。`);
  return out;
};

function pick(list, used) {
  const rest = list.filter((item) => !used.includes(item));
  const pool = rest.length ? rest : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createAgent(userId, input = {}) {
  if (db.prepare("SELECT COUNT(*) AS n FROM assistant_agents WHERE user_id=?").get(userId).n >= MAX_AGENTS)
    throw new AgentError(`最多创建 ${MAX_AGENTS} 个智能体，请先删除不用的。`);
  const existing = db.prepare("SELECT shape,color FROM assistant_agents WHERE user_id=?").all(userId);
  const name = cleanName(input.name, userId);
  const instructions = cleanInstructions(input.instructions);
  const shape = shapes.includes(input.shape) ? input.shape : pick(shapes, existing.map((a) => a.shape));
  const color = colors.includes(input.color) ? input.color : pick(colors.filter((c) => c !== "black" && c !== "gray"), existing.map((a) => a.color));
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO assistant_agents(id,user_id,name,instructions,shape,color,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id, userId, name, instructions, shape, color, now, now);
  return getAgent(userId, id);
}

export function updateAgent(userId, id, input = {}) {
  const row = getAgent(userId, id);
  if (!row) throw new AgentError("没有找到这个智能体。", 404);
  const next = { ...row };
  if (input.name !== undefined) next.name = cleanName(input.name, userId, id);
  if (input.instructions !== undefined) next.instructions = cleanInstructions(input.instructions);
  if (input.shape !== undefined) {
    if (!shapes.includes(input.shape)) throw new AgentError("形状无效。");
    next.shape = input.shape;
  }
  if (input.color !== undefined) {
    if (!colors.includes(input.color)) throw new AgentError("颜色无效。");
    next.color = input.color;
  }
  db.prepare("UPDATE assistant_agents SET name=?,instructions=?,shape=?,color=?,updated_at=? WHERE id=? AND user_id=?").run(next.name, next.instructions, next.shape, next.color, Date.now(), id, userId);
  return getAgent(userId, id);
}

export function deleteAgent(userId, id) {
  const result = db.prepare("DELETE FROM assistant_agents WHERE id=? AND user_id=?").run(id, userId);
  return result.changes > 0;
}

const state = (userId) => ({ agents: listAgents(userId), main: mainAgentId(userId) });

export function installAgents(app, { auth, limiter }) {
  const guard = (handler) => (req, res) => {
    try {
      handler(req, res);
    } catch (error) {
      if (!(error instanceof AgentError)) throw error;
      res.status(error.status).json({ error: error.message });
    }
  };

  app.get("/api/assistant/agents", auth, (req, res) => {
    res.json({ ...state(req.user.id), limit: MAX_AGENTS });
  });

  app.post("/api/assistant/agents", auth, limiter, guard((req, res) => {
    const agent = createAgent(req.user.id, req.body ?? {});
    if (req.body?.main === true) setMainAgent(req.user.id, agent.id);
    res.status(201).json({ agent, ...state(req.user.id) });
  }));

  app.patch("/api/assistant/agents/:id", auth, limiter, guard((req, res) => {
    const agent = updateAgent(req.user.id, req.params.id, req.body ?? {});
    res.json({ agent, ...state(req.user.id) });
  }));

  app.delete("/api/assistant/agents/:id", auth, limiter, guard((req, res) => {
    if (!deleteAgent(req.user.id, req.params.id)) throw new AgentError("没有找到这个智能体。", 404);
    res.json(state(req.user.id));
  }));

  app.put("/api/assistant/main-agent", auth, limiter, guard((req, res) => {
    const id = req.body?.id;
    if (id !== BUILTIN_AGENT && !getAgent(req.user.id, id)) throw new AgentError("没有找到这个智能体。", 404);
    setMainAgent(req.user.id, id);
    res.json(state(req.user.id));
  }));
}

export { AgentError };
