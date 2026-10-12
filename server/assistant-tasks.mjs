import { randomUUID } from "node:crypto";
import express from "express";
import { db } from "./database.mjs";

// 定时任务：到了固定的时间，Naimakes 以用户的身份自动执行一段提示词（可以查找内容、整理收藏、发帖等），
// 结果写成一段新的助手对话并发通知。调度器在 assistant.mjs 里，这里只管数据、时间计算和接口。

db.exec(`
CREATE TABLE IF NOT EXISTS assistant_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  repeat TEXT NOT NULL,
  time TEXT NOT NULL,
  date TEXT,
  weekday INTEGER,
  tz TEXT NOT NULL,
  allow_actions INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  last_result TEXT NOT NULL DEFAULT '',
  last_chat_id TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_tasks_due ON assistant_tasks(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS assistant_tasks_user ON assistant_tasks(user_id, created_at);
`);

export const MAX_TASKS = 10;
export const repeats = ["once", "daily", "weekdays", "weekly"];
export const repeatLabels = { once: "仅一次", daily: "每天", weekdays: "工作日", weekly: "每周" };
const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
const DEFAULT_TZ = "Asia/Shanghai";

export function validZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const partsOf = (time, tz) => {
  const out = {};
  for (const part of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(time)))
    if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
};
const offsetOf = (time, tz) => {
  const p = partsOf(time, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(time / 1000) * 1000;
};
/** 某个时区里的「年月日时分」对应的毫秒时间戳。 */
function zoned(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetOf(guess, tz);
  return guess - offsetOf(first, tz);
}

/** 任务在 after 之后的下一次运行时间（毫秒）；已经没有下一次时返回 null。 */
export function nextRun(task, after = Date.now()) {
  const [hour, minute] = task.time.split(":").map(Number);
  if (task.repeat === "once") {
    const [y, m, d] = String(task.date).split("-").map(Number);
    const at = zoned(y, m, d, hour, minute, task.tz);
    return at > after ? at : null;
  }
  const today = partsOf(after, task.tz);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    const weekday = day.getUTCDay();
    if (task.repeat === "weekdays" && (weekday === 0 || weekday === 6)) continue;
    if (task.repeat === "weekly" && weekday !== task.weekday) continue;
    const at = zoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, task.tz);
    if (at > after) return at;
  }
  return null;
}

export function describeSchedule(task) {
  const clock = task.time;
  if (task.repeat === "once") return `${task.date} ${clock}`;
  if (task.repeat === "weekly") return `每周${weekdayNames[task.weekday]} ${clock}`;
  return `${repeatLabels[task.repeat]} ${clock}`;
}

/** 校验并整理输入；失败时抛出带用户可读信息的 Error。 */
export function cleanTask(input, { tz = DEFAULT_TZ, partial = false } = {}) {
  const out = {};
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  const has = (key) => input[key] !== undefined;
  if (!partial || has("title")) {
    const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
    if (title.length < 1 || title.length > 40) fail("任务名称需为 1–40 个字符。");
    out.title = title;
  }
  if (!partial || has("prompt")) {
    const prompt = String(input.prompt ?? "").trim();
    if (prompt.length < 2 || prompt.length > 1000) fail("任务内容需为 2–1000 个字符。");
    out.prompt = prompt;
  }
  if (!partial || has("repeat")) {
    if (!repeats.includes(input.repeat)) fail("请选择重复方式：仅一次、每天、工作日或每周。");
    out.repeat = input.repeat;
  }
  if (!partial || has("time")) {
    if (typeof input.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail("时间格式应为 HH:MM，例如 08:30。");
    out.time = input.time;
  }
  if (has("date")) {
    if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) fail("日期格式应为 YYYY-MM-DD。");
    out.date = input.date;
  }
  if (has("weekday")) {
    if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) fail("星期应为 0（周日）到 6（周六）。");
    out.weekday = input.weekday;
  }
  if (has("allow_actions")) out.allow_actions = input.allow_actions === true ? 1 : 0;
  if (has("tz") || !partial) out.tz = validZone(input.tz ?? tz);
  return out;
}

const publicTask = (row) => ({
  id: row.id,
  title: row.title,
  prompt: row.prompt,
  repeat: row.repeat,
  time: row.time,
  date: row.date,
  weekday: row.weekday,
  tz: row.tz,
  schedule: describeSchedule(row),
  allow_actions: !!row.allow_actions,
  enabled: !!row.enabled,
  next_run_at: row.next_run_at,
  last_run_at: row.last_run_at,
  last_status: row.last_status,
  last_result: row.last_result,
  last_chat_id: row.last_chat_id,
  runs: row.runs,
  created_at: row.created_at,
});

export const listTasks = (userId) =>
  db.prepare("SELECT * FROM assistant_tasks WHERE user_id=? ORDER BY created_at").all(userId).map(publicTask);
export const getTask = (userId, id) => db.prepare("SELECT * FROM assistant_tasks WHERE user_id=? AND id=?").get(userId, id);

export function createTask(userId, input, options) {
  const data = cleanTask(input, options);
  if (data.repeat === "once" && !data.date) throw Object.assign(new Error("单次任务需要指定日期。"), { status: 400 });
  if (data.repeat === "weekly" && !Number.isInteger(data.weekday)) throw Object.assign(new Error("每周任务需要指定星期几。"), { status: 400 });
  if (data.repeat !== "once") data.date = null;
  if (data.repeat !== "weekly") data.weekday = null;
  const next = nextRun(data);
  if (next === null) throw Object.assign(new Error("这个时间已经过去了，请选择之后的时间。"), { status: 400 });
  if (db.prepare("SELECT COUNT(*) AS n FROM assistant_tasks WHERE user_id=?").get(userId).n >= MAX_TASKS)
    throw Object.assign(new Error(`最多设置 ${MAX_TASKS} 个定时任务，请先删除不用的。`), { status: 400 });
  if (options?.dryRun)
    return publicTask({ id: "", ...data, allow_actions: data.allow_actions ?? 0, enabled: 1, next_run_at: next, runs: 0, last_result: "", created_at: Date.now() });
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO assistant_tasks(id,user_id,title,prompt,repeat,time,date,weekday,tz,allow_actions,enabled,next_run_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
  ).run(id, userId, data.title, data.prompt, data.repeat, data.time, data.date ?? null, data.weekday ?? null, data.tz, data.allow_actions ?? 0, next, now, now);
  return publicTask(getTask(userId, id));
}

export function updateTask(userId, id, input) {
  const row = getTask(userId, id);
  if (!row) throw Object.assign(new Error("没有找到这个定时任务。"), { status: 404 });
  const data = cleanTask(input, { partial: true });
  const merged = { ...row, ...data };
  if (merged.repeat !== "once") merged.date = null;
  if (merged.repeat !== "weekly") merged.weekday = null;
  if (merged.repeat === "once" && !merged.date) throw Object.assign(new Error("单次任务需要指定日期。"), { status: 400 });
  if (merged.repeat === "weekly" && !Number.isInteger(merged.weekday)) throw Object.assign(new Error("每周任务需要指定星期几。"), { status: 400 });
  const enabled = typeof input.enabled === "boolean" ? (input.enabled ? 1 : 0) : row.enabled;
  const rescheduled = enabled && (!row.enabled || ["repeat", "time", "date", "weekday", "tz"].some((key) => data[key] !== undefined));
  let next = rescheduled ? nextRun(merged) : row.next_run_at;
  if (enabled && next === null) throw Object.assign(new Error("这个时间已经过去了，请选择之后的时间。"), { status: 400 });
  if (!enabled) next = null;
  db.prepare(
    `UPDATE assistant_tasks SET title=?,prompt=?,repeat=?,time=?,date=?,weekday=?,tz=?,allow_actions=?,enabled=?,next_run_at=?,updated_at=? WHERE id=? AND user_id=?`,
  ).run(merged.title, merged.prompt, merged.repeat, merged.time, merged.date, merged.weekday, merged.tz, merged.allow_actions, enabled, next, Date.now(), id, userId);
  return publicTask(getTask(userId, id));
}

export const deleteTask = (userId, id) => db.prepare("DELETE FROM assistant_tasks WHERE id=? AND user_id=?").run(id, userId).changes > 0;

export function installTasks(app, { auth, runNow }) {
  const json = express.json({ limit: "32kb" });
  const guard = (handler) => (req, res) => {
    try {
      handler(req, res);
    } catch (error) {
      if (!error.status) throw error;
      res.status(error.status).json({ error: error.message });
    }
  };

  app.get("/api/assistant/tasks", auth, (req, res) => res.json({ tasks: listTasks(req.user.id), max: MAX_TASKS }));
  app.post("/api/assistant/tasks", auth, json, guard((req, res) => res.status(201).json({ task: createTask(req.user.id, req.body ?? {}) })));
  app.patch("/api/assistant/tasks/:id", auth, json, guard((req, res) => res.json({ task: updateTask(req.user.id, req.params.id, req.body ?? {}) })));
  app.delete("/api/assistant/tasks/:id", auth, (req, res) => {
    if (!deleteTask(req.user.id, req.params.id)) return res.status(404).json({ error: "没有找到这个定时任务。" });
    res.json({ ok: true });
  });
  app.post("/api/assistant/tasks/:id/run", auth, (req, res) => {
    const row = getTask(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "没有找到这个定时任务。" });
    if (!runNow(row)) return res.status(409).json({ error: "这个任务正在运行，请稍后再试。" });
    res.status(202).json({ ok: true });
  });
}
