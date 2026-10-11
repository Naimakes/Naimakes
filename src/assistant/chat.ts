import { useSyncExternalStore } from "react";
import { info, type Attachment, type FileInfo } from "./attachments";

export type Source = { type: string; id: string; title: string; url: string; board: string; excerpt: string };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: string;
  offline?: boolean;
  files?: FileInfo[];
  at: number;
};
export type Phase = "idle" | "searching" | "writing";
export type HistoryItem = { id: string; title: string; updated_at: number };
type ChatState = {
  messages: ChatMessage[];
  phase: Phase;
  unread: boolean;
  title: string;
  id: string;
  signedIn: boolean;
  history: HistoryItem[] | null;
  historyError: string;
};

const LIMIT = 40;
let owner = "guest";
const keyOf = (id: string) => "nmk-assistant-chat:" + id;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let state: ChatState = fresh(owner);
let controller: AbortController | null = null;
const sent = new Map<string, Attachment[]>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function load(id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(keyOf(id));
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.content === "string").slice(-LIMIT) : [];
  } catch {
    return [];
  }
}

function loadId(id: string): string {
  try {
    const stored = localStorage.getItem(keyOf(id) + ":id");
    if (stored && /^[a-z0-9]{6,40}$/.test(stored)) return stored;
  } catch {}
  return uid();
}

function fresh(id: string): ChatState {
  return { messages: load(id), phase: "idle", unread: false, title: loadTitle(id), id: loadId(id), signedIn: id !== "guest", history: null, historyError: "" };
}

function loadTitle(id: string): string {
  try {
    return localStorage.getItem(keyOf(id) + ":title") || "";
  } catch {
    return "";
  }
}

function set(next: Partial<ChatState>, save = false) {
  state = { ...state, ...next };
  if (save)
    try {
      localStorage.setItem(keyOf(owner), JSON.stringify(state.messages.slice(-LIMIT)));
      localStorage.setItem(keyOf(owner) + ":id", state.id);
      if (state.title) localStorage.setItem(keyOf(owner) + ":title", state.title);
      else localStorage.removeItem(keyOf(owner) + ":title");
    } catch {}
  listeners.forEach((fn) => fn());
}

async function summarize(forOwner: string) {
  const first = state.messages.find((m) => m.role === "user");
  const answer = state.messages.find((m) => m.role === "assistant" && !m.error && m.content.trim());
  if (!first || !answer) return;
  if (state.title) return push(forOwner);
  const fallback = first.content.trim().replace(/\s+/g, " ");
  set({ title: fallback.length > 14 ? fallback.slice(0, 14) + "…" : fallback }, true);
  push(forOwner);
  try {
    const response = await fetch("/api/assistant/title", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: first.content, answer: answer.content }),
    });
    if (!response.ok) return;
    const { title } = (await response.json()) as { title?: string };
    if (title && owner === forOwner && state.messages.includes(first)) {
      set({ title }, true);
      push(forOwner);
    }
  } catch {}
}

let pushing: Promise<void> = Promise.resolve();
function push(forOwner: string) {
  pushing = pushing.then(async () => {
    if (forOwner === "guest" || forOwner !== owner || !state.messages.length) return;
    const { id, title } = state;
    const messages = state.messages
      .filter((m) => m.content.trim())
      .slice(-LIMIT)
      .map(({ error: _error, files, ...m }) => ({ ...m, ...(files?.length ? { files: files.map(({ name, kind }) => ({ name, kind })) } : {}) }));
    if (!messages.length) return;
    try {
      const response = await fetch("/api/assistant/chats/" + id, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, messages }),
      });
      if (!response.ok || owner !== forOwner) return;
      const { updated_at } = (await response.json()) as { updated_at: number };
      if (state.history) set({ history: [{ id, title, updated_at }, ...state.history.filter((h) => h.id !== id)] });
    } catch {}
  });
}

export async function loadHistory() {
  if (!state.signedIn) return;
  const forOwner = owner;
  set({ historyError: "" });
  try {
    const response = await fetch("/api/assistant/chats", { credentials: "same-origin" });
    if (!response.ok) throw new Error();
    const { chats } = (await response.json()) as { chats: HistoryItem[] };
    if (owner === forOwner) set({ history: chats });
  } catch {
    if (owner === forOwner) set({ historyError: "历史对话加载失败，请稍后再试。" });
  }
}

export async function openChat(id: string) {
  if (id === state.id) return true;
  const forOwner = owner;
  try {
    const response = await fetch("/api/assistant/chats/" + id, { credentials: "same-origin" });
    if (!response.ok) throw new Error();
    const data = (await response.json()) as { id: string; title: string; messages: ChatMessage[] };
    if (owner !== forOwner) return false;
    controller?.abort();
    sent.clear();
    const messages = Array.isArray(data.messages) ? data.messages.filter((m) => m && typeof m.content === "string").slice(-LIMIT) : [];
    set({ messages, id: data.id, title: data.title || "", phase: "idle", unread: false }, true);
    return true;
  } catch {
    set({ historyError: "这段对话打开失败，请稍后再试。" });
    return false;
  }
}

export async function removeChat(id: string) {
  try {
    const response = await fetch("/api/assistant/chats/" + id, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error();
  } catch {
    set({ historyError: "删除失败，请稍后再试。" });
    return;
  }
  set({ history: state.history ? state.history.filter((h) => h.id !== id) : state.history, historyError: "" });
  if (id === state.id) clearChat();
}

export function useChat() {
  return useSyncExternalStore(subscribe, () => state);
}

export function switchOwner(id: string | null) {
  const next = id || "guest";
  if (next === owner) return;
  controller?.abort();
  sent.clear();
  owner = next;
  set(fresh(owner));
}

export function clearChat() {
  controller?.abort();
  sent.clear();
  set({ messages: [], phase: "idle", unread: false, title: "", id: uid() }, true);
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

export async function ask(question: string, page: { path: string; title: string; recent?: string }, { visible }: { visible: () => boolean }, files: Attachment[] = []) {
  const text = question.trim() || (files.length ? "请看看我附上的文件。" : "");
  if (!text || state.phase !== "idle") return;
  controller?.abort();
  const abort = new AbortController();
  controller = abort;
  const history = state.messages
    .filter((m) => !m.error && m.content.trim())
    .slice(-11)
    .map((m) => ({ role: m.role, content: m.content }));
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
        else if (event === "delta") {
          if ((state.phase as Phase) !== "writing") set({ phase: "writing" });
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
    set({ phase: "idle", unread: !visible() }, true);
    if (abort.signal.aborted) push(owner);
    else void summarize(owner);
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
