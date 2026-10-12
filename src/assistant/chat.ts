import { useSyncExternalStore } from "react";
import { adoptPrefs, getPrefs, type AssistantPrefs } from "./prefs";
import { info, type Attachment, type FileInfo } from "./attachments";

export type Source = { type: string; id: string; title: string; url: string; board: string; excerpt: string };
export type ActionStatus = "pending" | "running" | "done" | "failed" | "cancelled" | "expired";
export type AgentAction = {
  id: string;
  name: string;
  title: string;
  status: ActionStatus;
  summary?: string;
  url?: string;
  error?: string;
  preview?: { heading: string; fields: { label: string; value: string }[]; body: string };
  effect?: { look?: Partial<AssistantPrefs>; updated_at?: number };
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  actions?: AgentAction[];
  error?: string;
  offline?: boolean;
  files?: FileInfo[];
  at: number;
};
export type Phase = "idle" | "searching" | "writing";
type ChatState = { messages: ChatMessage[]; phase: Phase; unread: boolean; activity: string };

const LIMIT = 40;
let owner = "guest";
let state: ChatState = { messages: load(owner), phase: "idle", unread: false, activity: "" };
let controller: AbortController | null = null;
const sent = new Map<string, Attachment[]>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const keyOf = (id: string) => "nmk-assistant-chat:" + id;

function load(id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(keyOf(id));
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    if (!Array.isArray(list)) return [];
    // A confirmation still in flight when the page closed can be pressed again; the server answers with its real state.
    const settle = (a: AgentAction) => (a.status === "running" ? { ...a, status: "pending" as const } : a);
    return list
      .filter((m) => m && typeof m.content === "string")
      .slice(-LIMIT)
      .map((m) => (m.actions ? { ...m, actions: m.actions.map(settle) } : m));
  } catch {
    return [];
  }
}

function set(next: Partial<ChatState>, save = false) {
  state = { ...state, ...next };
  if (save)
    try {
      localStorage.setItem(keyOf(owner), JSON.stringify(state.messages.slice(-LIMIT)));
    } catch {}
  listeners.forEach((fn) => fn());
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function useChat() {
  return useSyncExternalStore(subscribe, () => state);
}

export function switchOwner(id: string | null) {
  const next = id || "guest";
  if (next === owner) return;
  controller?.abort();
  sent.clear();
  owner = next;
  set({ messages: load(owner), phase: "idle", unread: false, activity: "" });
}

export function clearChat() {
  controller?.abort();
  sent.clear();
  set({ messages: [], phase: "idle", unread: false, activity: "" }, true);
}

export function markRead() {
  if (state.unread) set({ unread: false });
}

export function stopReply() {
  controller?.abort();
}

function patchLast(update: (message: ChatMessage) => ChatMessage, save = false) {
  const messages = state.messages.slice();
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return;
  messages[messages.length - 1] = update(last);
  set({ messages }, save);
}

const actionLabel: Record<ActionStatus, string> = {
  pending: "等待确认",
  running: "正在执行",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
  expired: "已超时",
};

// Lets the model see what happened to the actions it took in earlier turns.
function withRecords(message: ChatMessage) {
  const lines = (message.actions || []).map(
    (a) => `[操作记录] ${a.preview?.heading || a.title}：${actionLabel[a.status]}${a.summary && a.status === "done" ? "，" + a.summary : ""}${a.error ? "，" + a.error : ""}`,
  );
  return [message.content, ...lines].filter(Boolean).join("\n\n");
}

function applied(action: AgentAction) {
  if (action.status !== "done") return;
  if (action.effect?.look) adoptPrefs(action.effect.look, action.effect.updated_at || Date.now());
  window.dispatchEvent(new CustomEvent("nmk-assistant-action", { detail: action }));
}

function upsertAction(message: ChatMessage, action: AgentAction): ChatMessage {
  const list = message.actions || [];
  const at = list.findIndex((a) => a.id === action.id);
  return { ...message, actions: at < 0 ? [...list, action] : list.map((a, i) => (i === at ? { ...a, ...action } : a)) };
}

function patchAction(id: string, patch: Partial<AgentAction>) {
  const messages = state.messages.map((m) => (m.actions?.some((a) => a.id === id) ? upsertAction(m, { ...m.actions.find((a) => a.id === id)!, ...patch }) : m));
  set({ messages }, true);
}

const deciding = new Set<string>();

async function decide(action: AgentAction, verb: "confirm" | "cancel") {
  if (action.status !== "pending" || deciding.has(action.id)) return;
  deciding.add(action.id);
  patchAction(action.id, { status: "running", error: undefined });
  try {
    const response = await fetch(`/api/assistant/actions/${encodeURIComponent(action.id)}/${verb}`, { method: "POST", credentials: "same-origin" });
    const data = (await response.json().catch(() => ({}))) as { action?: AgentAction; error?: string };
    if (data.action) {
      patchAction(action.id, { ...data.action, error: data.action.error || (response.ok ? undefined : data.error) });
      applied(data.action);
    } else patchAction(action.id, { status: "pending", error: data.error || "暂时无法完成，请稍后再试。" });
  } catch {
    patchAction(action.id, { status: "pending", error: "网络连接失败，请检查网络后重试。" });
  } finally {
    deciding.delete(action.id);
  }
}

export const confirmAction = (action: AgentAction) => decide(action, "confirm");
export const cancelAction = (action: AgentAction) => decide(action, "cancel");

export async function ask(question: string, page: { path: string; title: string; recent?: string }, { visible }: { visible: () => boolean }, files: Attachment[] = []) {
  const text = question.trim() || (files.length ? "请看看我附上的文件。" : "");
  if (!text || state.phase !== "idle") return;
  controller?.abort();
  const abort = new AbortController();
  controller = abort;
  const history = state.messages
    .filter((m) => !m.error && (m.content.trim() || m.actions?.length))
    .slice(-11)
    .map((m) => ({ role: m.role, content: m.role === "assistant" ? withRecords(m) : m.content }));
  const reply: ChatMessage = { id: uid(), role: "assistant", content: "", at: Date.now() };
  const asked: ChatMessage = { id: uid(), role: "user", content: text, at: Date.now(), ...(files.length ? { files: info(files) } : {}) };
  if (files.length) sent.set(asked.id, files);
  set(
    {
      messages: [...state.messages, asked, reply].slice(-LIMIT),
      phase: "searching",
    },
    true,
  );
  try {
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [...history, { role: "user", content: text }],
        page,
        thinking: getPrefs().thinking,
        ...(files.length ? { attachments: files.map(({ name, kind, mime, data }) => ({ name, kind, mime, data })) } : {}),
      }),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || "Naimakes 暂时没有回应，请稍后再试。");
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        const event = block.match(/^event: (.+)$/m)?.[1];
        const raw = block.match(/^data: (.*)$/m)?.[1];
        if (!event || raw === undefined) continue;
        const data = JSON.parse(raw);
        if (event === "sources") patchLast((m) => ({ ...m, sources: data as Source[] }));
        else if (event === "status") set({ activity: (data as { text: string }).text });
        else if (event === "action") {
          patchLast((m) => upsertAction(m, data as AgentAction), true);
          applied(data as AgentAction);
        } else if (event === "delta") {
          if ((state.phase as Phase) !== "writing" || state.activity) set({ phase: "writing", activity: "" });
          patchLast((m) => ({ ...m, content: m.content + (data as { text: string }).text }));
        } else if (event === "error") {
          patchLast((m) => ({ ...m, error: (data as { message: string }).message }));
          finished = true;
        } else if (event === "done") {
          if ((data as { offline?: boolean }).offline) patchLast((m) => ({ ...m, offline: true }));
          finished = true;
        }
      }
    }
    if (!finished && !abort.signal.aborted) patchLast((m) => ({ ...m, error: m.content ? "回答被意外中断了。" : "连接中断了，请重试。" }));
  } catch (error) {
    if (abort.signal.aborted) patchLast((m) => (m.content ? m : { ...m, error: "已停止回答。" }));
    else
      patchLast((m) => ({
        ...m,
        error: (error as Error).name === "TypeError" ? "网络连接失败，请检查网络后重试。" : (error as Error).message,
      }));
  } finally {
    if (controller === abort) controller = null;
    set({ phase: "idle", unread: !visible(), activity: "" }, true);
  }
}

export function retryLast(page: { path: string; title: string; recent?: string }, options: { visible: () => boolean }) {
  const messages = state.messages.slice();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return;
  const at = messages.lastIndexOf(lastUser);
  set({ messages: messages.slice(0, at) }, true);
  const files = sent.get(lastUser.id) || [];
  sent.delete(lastUser.id);
  return ask(lastUser.content, page, options, files);
}
