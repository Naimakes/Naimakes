import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, MessageSquare, Play, Plus, Trash2, X } from "lucide-react";
import { api } from "../forum/api";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { LiquidSwitch } from "../forum/ui/LiquidSwitch";
import "./assistant-details.css";
import "./assistant-manage.css";

type Repeat = "once" | "daily" | "weekdays" | "weekly";
type Task = {
  id: string;
  title: string;
  prompt: string;
  repeat: Repeat;
  schedule: string;
  allow_actions: boolean;
  enabled: boolean;
  next_run_at: number | null;
  last_run_at: number | null;
  last_status: "ok" | "failed" | "skipped" | null;
  last_result: string;
  last_chat_id: string | null;
};

const repeats: { id: Repeat; label: string }[] = [
  { id: "daily", label: "每天" },
  { id: "weekdays", label: "工作日" },
  { id: "weekly", label: "每周" },
  { id: "once", label: "仅一次" },
];
const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const when = (time: number) => new Date(time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const statusText = { ok: "已完成", failed: "没有成功", skipped: "错过了，已跳过" };
const pad = (n: number) => String(n).padStart(2, "0");
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function AssistantTasks({ signedIn, onBack, onClose, onOpenChat }: { signedIn: boolean; onBack: () => void; onClose: () => void; onOpenChat: (id: string) => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [max, setMax] = useState(10);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ title: "", prompt: "", repeat: "daily" as Repeat, time: "09:00", date: todayKey(), weekday: 1, allow_actions: false });
  const watch = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api<{ tasks: Task[]; max: number }>("/assistant/tasks");
      setTasks(r.tasks);
      setMax(r.max);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);
  useEffect(() => () => clearInterval(watch.current), []);

  const create = async () => {
    setBusy("create");
    setError("");
    try {
      const body = {
        title: form.title,
        prompt: form.prompt,
        repeat: form.repeat,
        time: form.time,
        allow_actions: form.allow_actions,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(form.repeat === "once" ? { date: form.date } : {}),
        ...(form.repeat === "weekly" ? { weekday: form.weekday } : {}),
      };
      const r = await api<{ task: Task }>("/assistant/tasks", { method: "POST", body: JSON.stringify(body) });
      setTasks((list) => [...(list ?? []), r.task]);
      setForm((f) => ({ ...f, title: "", prompt: "" }));
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const toggle = async (task: Task) => {
    setError("");
    try {
      const r = await api<{ task: Task }>("/assistant/tasks/" + task.id, { method: "PATCH", body: JSON.stringify({ enabled: !task.enabled }) });
      setTasks((list) => list && list.map((t) => (t.id === task.id ? r.task : t)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (task: Task) => {
    if (!confirm(`删除定时任务「${task.title}」？`)) return;
    try {
      await api("/assistant/tasks/" + task.id, { method: "DELETE" });
      setTasks((list) => list && list.filter((t) => t.id !== task.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const run = async (task: Task) => {
    setBusy(task.id);
    setError("");
    try {
      await api("/assistant/tasks/" + task.id + "/run", { method: "POST" });
      // 任务在后台运行，几秒后刷新一下看结果。
      clearInterval(watch.current);
      let tries = 0;
      watch.current = window.setInterval(() => {
        void load();
        if (++tries >= 12) clearInterval(watch.current);
      }, 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const valid = form.title.trim() && form.prompt.trim().length >= 2 && /^\d{2}:\d{2}$/.test(form.time) && (form.repeat !== "once" || form.date);

  return (
    <div className="assistant-view assistant-manage" role="region" aria-label="定时任务">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>定时任务</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>
      <div className="assistant-scroll">
        {!signedIn ? (
          <p className="assistant-history-note">登录后，可以让我在固定的时间自动做事，比如每天早上推荐几篇讨论。</p>
        ) : (
          <>
            <p className="assistant-manage-intro">
              <CalendarClock size={14} aria-hidden="true" /> 到了设定的时间，我会按你写的指令自动执行，把结果放进一段新对话并通知你。也可以直接对我说：「每天早上 9 点帮我推荐三篇讨论」。
            </p>

            {adding ? (
              <form
                className="assistant-card assistant-task-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (valid) void create();
                }}
              >
                <label>
                  <span>名称</span>
                  <input value={form.title} maxLength={40} placeholder="比如：晨读推荐" onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label>
                  <span>到时间要做什么</span>
                  <textarea value={form.prompt} rows={3} maxLength={1000} placeholder="写成能独立完成的指令，比如：推荐三篇最近值得读的人工智能讨论，每篇附一句理由。" onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
                </label>
                <div className="assistant-task-row">
                  <label>
                    <span>重复</span>
                    <select value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as Repeat })}>
                      {repeats.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.repeat === "weekly" && (
                    <label>
                      <span>星期</span>
                      <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
                        {weekdays.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {form.repeat === "once" && (
                    <label>
                      <span>日期</span>
                      <input type="date" value={form.date} min={todayKey()} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    </label>
                  )}
                  <label>
                    <span>时间</span>
                    <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                  </label>
                </div>
                <label className="assistant-task-check">
                  <input type="checkbox" checked={form.allow_actions} onChange={(e) => setForm({ ...form, allow_actions: e.target.checked })} />
                  <span>
                    允许到时自动执行需要确认的操作
                    <small>勾选后，发帖、评论、私信等会直接执行，不再等你确认；不勾选时只会汇报。</small>
                  </span>
                </label>
                <div className="assistant-edit-buttons">
                  <LiquidButton type="button" className="assistant-chip is-compact" onClick={() => setAdding(false)}>
                    取消
                  </LiquidButton>
                  <LiquidButton type="submit" className="assistant-chip is-compact is-primary" disabled={!valid || busy === "create"}>
                    保存任务
                  </LiquidButton>
                </div>
              </form>
            ) : (
              <LiquidButton type="button" className="assistant-chip" disabled={!!tasks && tasks.length >= max} onClick={() => setAdding(true)}>
                <Plus size={14} />
                新建定时任务
              </LiquidButton>
            )}

            {error && (
              <p className="assistant-history-note" role="alert">
                {error}
              </p>
            )}
            {tasks === null ? (
              !error && <p className="assistant-history-note">正在加载…</p>
            ) : tasks.length === 0 ? (
              !adding && <p className="assistant-history-note">还没有定时任务。</p>
            ) : (
              <ul className="assistant-task-list">
                {tasks.map((task) => (
                  <li key={task.id} className={"assistant-card assistant-task" + (task.enabled ? "" : " is-off")}>
                    <div className="assistant-task-head">
                      <span className="assistant-row-text">
                        <strong>{task.title}</strong>
                        <small>
                          {task.schedule}
                          {task.allow_actions ? " · 自动执行操作" : ""}
                        </small>
                      </span>
                      <LiquidSwitch checked={task.enabled} label={(task.enabled ? "暂停：" : "启用：") + task.title} onChange={() => void toggle(task)} />
                    </div>
                    <p className="assistant-task-prompt">{task.prompt}</p>
                    <small className="assistant-task-meta">
                      {task.enabled && task.next_run_at ? `下次运行：${when(task.next_run_at)}` : task.last_status && task.repeat === "once" ? "已执行" : "已暂停"}
                      {task.last_run_at && task.last_status ? ` · 上次 ${when(task.last_run_at)} ${statusText[task.last_status]}` : ""}
                    </small>
                    {task.last_result && task.last_status !== "skipped" && <p className="assistant-task-result">{task.last_result}</p>}
                    <div className="assistant-task-actions">
                      {task.last_chat_id && (
                        <LiquidButton type="button" className="assistant-chip is-compact" onClick={() => onOpenChat(task.last_chat_id!)}>
                          <MessageSquare size={13} />
                          查看结果
                        </LiquidButton>
                      )}
                      <LiquidButton type="button" className="assistant-chip is-compact" disabled={busy === task.id} onClick={() => void run(task)}>
                        <Play size={13} />
                        立即运行
                      </LiquidButton>
                      <LiquidButton type="button" className="icon-button assistant-icon" aria-label={"删除：" + task.title} title="删除" onClick={() => void remove(task)}>
                        <Trash2 size={14} />
                      </LiquidButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
