import { useSyncExternalStore } from "react";
import { adoptPrefs, getPrefs, type AssistantPrefs } from "./prefs";
import { info, wire, type Attachment, type FileInfo } from "./attachments";
import { BUILTIN_AGENT, MAX_GROUP, agentOrGone, agentsLoaded, findAgent, mainAgentId, refreshAgents, subscribeAgents } from "./agents";

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
  effect?: { look?: Partial<AssistantPrefs>; updated_at?: number; agent?: { id: string; kind: "created" | "updated" } };
};
// 智能体向用户提的选择题。picked 是用户点了哪一项；没点、直接打字回答的就是被忽略了。
export type Choices = { id?: string; question: string; options: string[]; picked?: number };
// 重新生成会留下回答的多个版本；顶层的 content 等字段始终是当前显示的那一个，versions[vi] 在切换和结束时同步。
export type AnswerVersion = { content: string; sources?: Source[]; actions?: AgentAction[]; error?: string; offline?: boolean; at: number };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  actions?: AgentAction[];
  error?: string;
  offline?: boolean;
  files?: FileInfo[];
  versions?: AnswerVersion[];
  vi?: number;
  branch?: boolean;
  agent?: string;
  choices?: Choices;
  at: number;
};
export type Phase = "idle" | "searching" | "writing";
export type HistoryItem = { id: string; title: string; updated_at: number; pinned: boolean; favorite: boolean; hidden: boolean; shared: boolean; count: number; agents: string[] };
export type SharedAgent = { id: string; name: string; shape: string; color: string };
export type SharedChat = { title: string; messages: ChatMessage[]; agents?: SharedAgent[]; shared_at: number; author: string; mine: boolean; chat_id: string | null };
type ChatState = {
  messages: ChatMessage[];
  phase: Phase;
  unread: boolean;
  title: string;
  id: string;
  signedIn: boolean;
  history: HistoryItem[] | null;
  historyError: string;
  activity: string;
  // 这一轮正在调用的站内工具名，助手据此换动作；没在调用工具时为空。
  tool: string;
  branching: boolean;
  // 这段对话里的智能体：一个是单聊，两三个是群聊。auto 表示还没人专门挑过，跟随主智能体。
  agents: string[];
  auto: boolean;
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

function loadId(id: string): string {
  try {
    const stored = localStorage.getItem(keyOf(id) + ":id");
    if (stored && /^[a-z0-9]{6,40}$/.test(stored)) return stored;
  } catch {}
  return uid();
}

function loadAgents(id: string): string[] | null {
  try {
    const raw = localStorage.getItem(keyOf(id) + ":agents");
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    const ids = Array.isArray(list) ? list.filter((a): a is string => typeof a === "string").slice(0, MAX_GROUP) : [];
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

function fresh(id: string): ChatState {
  const messages = load(id);
  // 有记录的老对话没存过智能体，就是 Naimakes；空对话跟随主智能体。
  const stored = loadAgents(id);
  const agents = stored ?? (messages.length ? [BUILTIN_AGENT] : [mainAgentId()]);
  return { messages, phase: "idle", unread: false, title: loadTitle(id), id: loadId(id), signedIn: id !== "guest", history: null, historyError: "", activity: "", tool: "", branching: false, agents, auto: !stored && !messages.length };
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
      localStorage.setItem(keyOf(owner) + ":agents", JSON.stringify(state.agents));
      if (state.title) localStorage.setItem(keyOf(owner) + ":title", state.title);
      else localStorage.removeItem(keyOf(owner) + ":title");
    } catch {}
  listeners.forEach((fn) => fn());
}

async function summarize(forOwner: string) {
  const first = state.messages.find((m) => m.role === "user");
  const answer = state.messages.find((m) => m.role === "assistant" && !m.error && m.content.trim());
  if (!first && state.title && answer) return push(forOwner);
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
    const { id, title, agents } = state;
    const messages = state.messages
      .filter((m) => m.content.trim() || m.choices)
      .slice(-LIMIT)
      .map(({ error: _error, files, versions, ...m }) => ({
        ...m,
        ...(files?.length ? { files: files.map(({ name, kind, id }) => ({ name, kind, ...(id ? { id } : {}) })) } : {}),
        ...(versions && versions.length > 1 ? { versions: versions.map(({ content, sources, offline, at }) => ({ content, sources, offline, at })) } : {}),
      }));
    if (!messages.length) return;
    try {
      const response = await fetch("/api/assistant/chats/" + id, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, messages, agents }),
      });
      if (!response.ok || owner !== forOwner) return;
      const { updated_at } = (await response.json()) as { updated_at: number };
      if (state.history) {
        const before = state.history.find((h) => h.id === id);
        const entry: HistoryItem = { pinned: false, favorite: false, hidden: false, shared: false, ...before, id, title, updated_at, count: messages.length, agents };
        set({ history: sortHistory([entry, ...state.history.filter((h) => h.id !== id)]) });
      }
    } catch {}
  });
}

const sortHistory = (list: HistoryItem[]) => list.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at);

export async function updateChat(id: string, patch: Partial<Pick<HistoryItem, "pinned" | "favorite" | "hidden">>) {
  const before = state.history;
  if (!before) return;
  set({ historyError: "", history: sortHistory(before.map((h) => (h.id === id ? { ...h, ...patch } : h))) });
  try {
    const response = await fetch("/api/assistant/chats/" + id, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error();
  } catch {
    set({ history: before, historyError: "操作失败，请稍后再试。" });
  }
}

export async function shareChat(id: string): Promise<string | null> {
  try {
    const response = await fetch("/api/assistant/chats/" + id + "/share", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    const { token } = (await response.json()) as { token: string };
    if (state.history) set({ history: state.history.map((h) => (h.id === id ? { ...h, shared: true } : h)) });
    return location.origin + "/?nmk-chat=" + token;
  } catch {
    set({ historyError: "分享失败，请稍后再试。" });
    return null;
  }
}

export async function unshareChat(id: string) {
  try {
    const response = await fetch("/api/assistant/chats/" + id + "/share", { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    if (state.history) set({ history: state.history.map((h) => (h.id === id ? { ...h, shared: false } : h)), historyError: "" });
  } catch {
    set({ historyError: "取消分享失败，请稍后再试。" });
  }
}

export async function fetchShared(token: string): Promise<SharedChat | string> {
  try {
    const response = await fetch("/api/assistant/shared/" + encodeURIComponent(token), { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return (data as { error?: string }).error || "这个分享链接打不开。";
    return data as SharedChat;
  } catch {
    return "网络连接失败，请稍后再试。";
  }
}

export async function saveShared(token: string): Promise<boolean> {
  try {
    const response = await fetch("/api/assistant/shared/" + encodeURIComponent(token) + "/save", { method: "POST", credentials: "same-origin" });
    if (!response.ok) return false;
    const { id } = (await response.json()) as { id: string };
    await loadHistory();
    return openChat(id);
  } catch {
    return false;
  }
}

export async function loadHistory() {
  if (!state.signedIn) return;
  const forOwner = owner;
  set({ historyError: "" });
  try {
    const response = await fetch("/api/assistant/chats", { credentials: "same-origin" });
    if (!response.ok) throw new Error();
    const { chats } = (await response.json()) as { chats: (Omit<HistoryItem, "agents"> & { agents?: string[] })[] };
    if (owner === forOwner) set({ history: sortHistory(chats.map((c) => ({ ...c, agents: c.agents?.length ? c.agents : [BUILTIN_AGENT] }))) });
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
    const data = (await response.json()) as { id: string; title: string; messages: ChatMessage[]; agents?: string[] };
    if (owner !== forOwner) return false;
    halt();
    sent.clear();
    const messages = Array.isArray(data.messages) ? data.messages.filter((m) => m && typeof m.content === "string").slice(-LIMIT) : [];
    set({ messages, id: data.id, title: data.title || "", phase: "idle", unread: false, activity: "", tool: "", agents: usableAgents(data.agents), auto: false }, true);
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
  halt();
  sent.clear();
  owner = next;
  set(fresh(owner));
}

// 新对话：不指定智能体就跟随主智能体；指定了就是用户挑的（一个是单聊，两三个是群聊）。
export function clearChat(agents?: string[]) {
  halt();
  sent.clear();
  const picked = agents?.length ? usableAgents(agents) : null;
  set({ messages: [], phase: "idle", unread: false, title: "", id: uid(), activity: "", tool: "", agents: picked ?? [mainAgentId()], auto: !picked }, true);
}

// 停掉正在进行的回答，并让它之后不再改动界面。
function halt() {
  controller?.abort();
  controller = null;
}

// 只留下还存在的智能体；一个都不剩就用主智能体。智能体列表还没加载好时原样保留。
function usableAgents(ids: string[] | undefined): string[] {
  const list = (ids ?? []).filter((id, i, all) => typeof id === "string" && all.indexOf(id) === i).slice(0, MAX_GROUP);
  const kept = agentsLoaded() ? list.filter((id) => !!findAgent(id)) : list;
  return kept.length ? kept : [agentsLoaded() ? mainAgentId() : BUILTIN_AGENT];
}

// 智能体列表变了（加载完成、新建、删除）：空对话里跟随主智能体，有内容的对话里去掉已被删除的。
function reconcile() {
  if (!agentsLoaded()) return;
  if (!state.messages.length && state.auto) {
    const main = mainAgentId();
    if (state.agents.length !== 1 || state.agents[0] !== main) set({ agents: [main] });
    return;
  }
  const kept = usableAgents(state.agents);
  if (kept.length !== state.agents.length || kept.some((id, i) => id !== state.agents[i])) set({ agents: kept }, true);
}
subscribeAgents(reconcile);

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
  if (message.choices) lines.push(`[向用户提问] ${message.choices.question}（选项：${message.choices.options.join(" / ")}）`);
  return [message.content, ...lines].filter(Boolean).join("\n\n");
}

// 刚在这一轮里新建的智能体：等这一轮回答完，再替用户打开与它的新对话。
let onboard: string | null = null;

function applied(action: AgentAction) {
  if (action.status !== "done") return;
  if (action.effect?.look) adoptPrefs(action.effect.look, action.effect.updated_at || Date.now());
  const agent = action.effect?.agent;
  if (agent) {
    void refreshAgents();
    if (agent.kind === "created") onboard = agent.id;
  }
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

const MAX_VERSIONS = 6;
const snapshot = (m: ChatMessage): AnswerVersion => ({ content: m.content, sources: m.sources, actions: m.actions, error: m.error, offline: m.offline, at: m.at });
const show = (m: ChatMessage, v: AnswerVersion): ChatMessage => ({ ...m, content: v.content, sources: v.sources, actions: v.actions, error: v.error, offline: v.offline, at: v.at });
// Writes what is on screen back into its slot in `versions`.
const synced = (m: ChatMessage): ChatMessage =>
  m.versions && m.versions.length > 1 ? { ...m, versions: m.versions.map((v, i) => (i === (m.vi ?? 0) ? snapshot(m) : v)) } : m;

export const answerCount = (m: ChatMessage) => (m.versions && m.versions.length > 1 ? m.versions.length : 1);

export function switchVersion(id: string, to: number) {
  if (state.phase !== "idle") return;
  const messages = state.messages.map((m) => {
    if (m.id !== id || !m.versions || to < 0 || to >= m.versions.length) return m;
    const base = synced(m);
    return { ...show(base, base.versions![to]), vi: to };
  });
  set({ messages }, true);
  push(owner);
}

// Reduces a failed or stopped regeneration back to the answer it was replacing.
function settleVersions() {
  patchLast((m) => {
    if (!m.versions || m.versions.length < 2) return m;
    if (m.content.trim() || m.actions?.length) return synced(m);
    const all = m.versions;
    const rest = all.filter((_, i) => i !== (m.vi ?? all.length - 1));
    const back = show(m, rest[rest.length - 1]);
    return rest.length > 1 ? { ...back, versions: rest, vi: rest.length - 1 } : { ...back, versions: undefined, vi: undefined };
  }, true);
}


type Page = { path: string; title: string; recent?: string };
type Options = { visible: () => boolean };
type Wire = { role: "user" | "assistant"; content: string };
type Group = { members: string[]; transcript: { who: string; content: string }[] };
type Turn = { text: string; files: Attachment[]; history: Wire[]; userId: string; agent: string; group?: Group; bootstrap?: boolean; learn?: boolean };

// 群聊里只带上自己说过的话；别人的发言通过群聊记录给到，这样每个智能体都保持自己的口吻。
const asHistory = (list: ChatMessage[], self?: string): Wire[] => {
  const usable = list.filter((m) => !m.error && (m.content.trim() || m.actions?.length || m.choices) && (!self || m.role === "user" || m.branch || !m.agent || m.agent === self));
  const recent = usable.slice(-11);
  // The summary a branch starts from always stays in view, however long the new chat gets.
  const head = usable.find((m) => m.branch);
  const kept = head && !recent.includes(head) ? [head, ...recent] : recent;
  const out = kept.map((m) => ({
    role: (m.branch ? "user" : m.role) as "user" | "assistant",
    content: m.branch ? "[此前对话的整理，请基于它继续]\n" + m.content : m.role === "assistant" ? withRecords(m) : m.content,
  }));
  // 智能体先开口的对话以它的话开头；接口要求从用户的话开始。
  if (out.length && out[0].role === "assistant") out.unshift({ role: "user", content: "（对话刚开始，用户还没有说话，是你先开的口。）" });
  return out;
};

const BOOTSTRAP_TEXT = "（系统提示：用户刚刚创建了你并打开了这段对话，还没有说话，请你先开口。）";

const transcriptOf = (list: ChatMessage[], skipId: string) =>
  list
    .filter((m) => m.id !== skipId && !m.error && m.content.trim())
    .slice(-14)
    .map((m) => ({ who: m.role === "user" ? "用户" : agentOrGone(m.agent || state.agents[0]).name, content: m.content }));

// 群聊里用 @名字 点名时只有被点名的回答，否则按顺序每个智能体都回答一次。
function responders(text: string, members: string[]): string[] {
  if (members.length < 2) return members.slice(0, 1);
  const lower = text.toLowerCase();
  const named = members.filter((id) => lower.includes("@" + agentOrGone(id).name.toLowerCase()));
  return named.length ? named : members;
}

// Files of an earlier question, rebuilt for sending again: what is still in memory, or a reference to the library / site.
function filesOf(message: ChatMessage): { files: Attachment[]; missing: number } {
  const kept = sent.get(message.id);
  if (kept) return { files: kept, missing: 0 };
  const files: Attachment[] = [];
  let missing = 0;
  for (const f of message.files || []) {
    const ref = f.id ? { library_id: f.id } : f.post ? f.post : null;
    if (ref) files.push({ id: uid(), name: f.name, kind: f.kind, mime: "", data: "", preview: f.preview, ref });
    else missing++;
  }
  return { files, missing };
}

// 让一个智能体回答，把回答流式写进最后一条消息。这条回答若被别的对话顶替了（切换、新建），之后什么都不再改动。
async function converse(turn: Turn, page: Page, abort: AbortController) {
  const { text, files, history, userId } = turn;
  const live = () => controller === abort;
  const patch = (update: (message: ChatMessage) => ChatMessage, save = false) => {
    if (live()) patchLast(update, save);
  };
  try {
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [...history, { role: "user", content: text }],
        page,
        thinking: getPrefs().thinking,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        agent: turn.agent,
        ...(turn.group ? { group: turn.group } : {}),
        ...(turn.bootstrap ? { bootstrap: true } : {}),
        ...(turn.learn === false ? { learn: false } : {}),
        ...(files.length ? { attachments: files.map(wire) } : {}),
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
      while (cut >= 0 && !finished) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        const event = block.match(/^event: (.+)$/m)?.[1];
        const raw = block.match(/^data: (.*)$/m)?.[1];
        if (!event || raw === undefined) continue;
        if (!live()) {
          finished = true;
          break;
        }
        const data = JSON.parse(raw);
        if (event === "sources") patchLast((m) => ({ ...m, sources: data as Source[] }));
        else if (event === "files") {
          // The server has filed the upload in the library; remember which entry it is so it can be sent by reference later.
          const ids = data as { id: string | null }[];
          if (userId) set({ messages: state.messages.map((m) => (m.id === userId ? { ...m, files: (m.files || []).map((f, i) => (ids[i]?.id ? { ...f, id: ids[i].id! } : f)) } : m)) }, true);
        } else if (event === "status") set({ activity: (data as { text: string }).text, tool: (data as { tool?: string }).tool || "" });
        else if (event === "choices") patchLast((m) => ({ ...m, choices: data as Choices }), true);
        else if (event === "action") {
          patchLast((m) => upsertAction(m, data as AgentAction), true);
          applied(data as AgentAction);
        } else if (event === "delta") {
          if ((state.phase as Phase) !== "writing" || state.activity || state.tool) set({ phase: "writing", activity: "", tool: "" });
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
    if (!finished && !abort.signal.aborted) patch((m) => ({ ...m, error: m.content ? "回答被意外中断了。" : "连接中断了，请重试。" }));
  } catch (error) {
    if (abort.signal.aborted) patch((m) => (m.content || m.choices ? m : { ...m, error: "已停止回答。" }));
    else
      patch((m) => ({
        ...m,
        error: (error as Error).name === "TypeError" ? "网络连接失败，请检查网络后重试。" : (error as Error).message,
      }));
  }
}

function begin() {
  controller?.abort();
  const abort = new AbortController();
  controller = abort;
  return abort;
}

// 一轮结束（或被停止）：整理版本、保存、给对话起标题，再看有没有刚新建、要去打开的智能体。
function finish(abort: AbortController, { visible }: Options) {
  if (controller !== abort) return;
  controller = null;
  settleVersions();
  set({ phase: "idle", unread: !visible(), activity: "", tool: "" }, true);
  if (abort.signal.aborted) {
    push(owner);
    return;
  }
  void summarize(owner);
  if (onboard) {
    const agent = onboard;
    onboard = null;
    // 等刚才的保存先把这段对话存下来，再换成新智能体的对话。
    setTimeout(() => window.dispatchEvent(new CustomEvent("nmk-assistant-onboard", { detail: { agent } })), 60);
  }
}

type Job = {
  text: string;
  note?: string;
  files: Attachment[];
  // 这个问题之前的对话；每个智能体各自从它算出自己看到的历史。
  base: ChatMessage[];
  // 这轮提问的那条用户消息；开场（没有用户消息）时为空。
  askedId: string;
  // 重新生成时，已经放在最后的那条空回答。
  reply?: ChatMessage;
  bootstrap?: boolean;
};

async function round(job: Job, page: Page, options: Options, abort: AbortController) {
  const members = state.agents;
  const order = job.reply ? [job.reply.agent || members[0]] : job.bootstrap ? members.slice(0, 1) : responders(job.text, members);
  const group = members.length > 1;
  try {
    for (let i = 0; i < order.length; i++) {
      if (controller !== abort || abort.signal.aborted) break;
      const agent = order[i];
      const reply: ChatMessage = job.reply && i === 0 ? job.reply : { id: uid(), role: "assistant", content: "", at: Date.now(), agent };
      if (!(job.reply && i === 0)) set({ messages: [...state.messages, reply].slice(-LIMIT) }, true);
      set({ phase: "searching", activity: "", tool: "" });
      const turn: Turn = {
        text: job.bootstrap ? BOOTSTRAP_TEXT : job.text + (job.note || ""),
        files: job.files,
        history: asHistory(job.base, group ? agent : undefined),
        userId: i === 0 ? job.askedId : "",
        agent,
        ...(group ? { group: { members, transcript: transcriptOf(state.messages.filter((m) => m.id !== reply.id), job.askedId) } } : {}),
        ...(job.bootstrap ? { bootstrap: true } : {}),
        ...(i > 0 ? { learn: false } : {}),
      };
      await converse(turn, page, abort);
      if (state.messages[state.messages.length - 1]?.error) break;
    }
  } finally {
    finish(abort, options);
  }
}

const missingNote = (missing: number) => (missing ? `\n（之前附上的 ${missing} 个文件已无法重新附上，请照没有它们的情况回答，必要时请用户再附一次。）` : "");

export async function ask(question: string, page: Page, options: Options, files: Attachment[] = [], missing = 0) {
  const text = question.trim() || (files.length ? "请看看我附上的文件。" : "");
  if (!text || state.phase !== "idle") return;
  const abort = begin();
  const base = state.messages;
  const asked: ChatMessage = { id: uid(), role: "user", content: text, at: Date.now(), ...(files.length ? { files: info(files) } : {}) };
  if (files.length) sent.set(asked.id, files);
  set({ messages: [...base, asked].slice(-LIMIT), phase: "searching", auto: false }, true);
  await round({ text, note: missingNote(missing), files, base, askedId: asked.id }, page, options, abort);
}

// 修改自己发出的某条消息并重新回答：这条消息之后的内容会被替换。
export function editMessage(id: string, text: string, page: Page, options: Options) {
  if (state.phase !== "idle") return;
  const at = state.messages.findIndex((m) => m.id === id && m.role === "user");
  if (at < 0) return;
  const { files, missing } = filesOf(state.messages[at]);
  set({ messages: state.messages.slice(0, at) }, true);
  return ask(text, page, options, files, missing);
}

// 让模型重新回答最后一个问题，之前的回答留作一个版本。
export async function regenerate(page: Page, options: Options) {
  if (state.phase !== "idle") return;
  const at = state.messages.length - 1;
  const reply = state.messages[at];
  if (!reply || reply.role !== "assistant") return;
  const userAt = state.messages.map((m) => m.role).lastIndexOf("user");
  const user = state.messages[userAt];
  if (!user || userAt > at) return;
  const abort = begin();
  const failed = !!reply.error && !reply.content.trim();
  const base = synced(reply);
  const versions = failed ? undefined : [...(base.versions ?? [snapshot(reply)]), { content: "", at: Date.now() }].slice(-MAX_VERSIONS);
  const fresh: ChatMessage = { id: reply.id, role: "assistant", content: "", at: Date.now(), ...(reply.agent ? { agent: reply.agent } : {}), ...(versions ? { versions, vi: versions.length - 1 } : {}) };
  const { files, missing } = filesOf(user);
  set({ messages: [...state.messages.slice(0, at), fresh], phase: "searching" }, true);
  await round({ text: user.content, note: missingNote(missing), files, base: state.messages.slice(0, userAt), askedId: user.id, reply: fresh }, page, options, abort);
}

export function retryLast(page: Page, options: Options) {
  const messages = state.messages.slice();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  // 智能体先开口的对话，开场那一句失败了：重新让它开口。
  if (!lastUser) {
    if (messages.length === 1 && messages[0].role === "assistant" && messages[0].error && state.agents.length === 1) {
      set({ messages: [] });
      return bootstrapRound(page, options);
    }
    return;
  }
  const at = messages.lastIndexOf(lastUser);
  const { files, missing } = filesOf(lastUser);
  set({ messages: messages.slice(0, at) }, true);
  sent.delete(lastUser.id);
  return ask(lastUser.content, page, options, files, missing);
}

// 点了选择卡片上的一项：记下点的是哪一项，再把它当作用户的回答发出去。
export function answerChoice(id: string, index: number, page: Page, options: Options) {
  if (state.phase !== "idle") return;
  const message = state.messages.find((m) => m.id === id);
  const option = message?.choices?.options[index];
  if (!message?.choices || message.choices.picked !== undefined || !option) return;
  set({ messages: state.messages.map((m) => (m.id === id && m.choices ? { ...m, choices: { ...m.choices, picked: index } } : m)) }, true);
  return ask(option, page, options);
}

// 新建智能体后的第一段对话：它先开口，问用户想让自己做什么，之后把了解到的写进自己的指令。
export async function startOnboarding(agentId: string, page: Page, options: Options): Promise<boolean> {
  if (!findAgent(agentId)) await refreshAgents();
  const agent = findAgent(agentId);
  if (!agent) return false;
  clearChat([agentId]);
  set({ title: "新建智能体：" + agent.name }, true);
  await bootstrapRound(page, options);
  return true;
}

function bootstrapRound(page: Page, options: Options) {
  const abort = begin();
  return round({ text: BOOTSTRAP_TEXT, files: [], base: [], askedId: "", bootstrap: true }, page, options, abort);
}

// 新分支：把到这条回答为止的对话交给模型整理压缩，作为一段新对话的开头。
export async function branchFrom(id: string): Promise<boolean> {
  if (state.phase !== "idle" || state.branching) return false;
  const at = state.messages.findIndex((m) => m.id === id);
  if (at < 0) return false;
  const forOwner = owner;
  const source = state.messages.slice(0, at + 1);
  const title = state.title || source.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").slice(0, 14) || "对话";
  set({ branching: true });
  try {
    const response = await fetch("/api/assistant/branch", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: asHistory(source).map(({ role, content }) => ({ role, content })) }),
    });
    const data = (await response.json().catch(() => ({}))) as { summary?: string; error?: string };
    if (!response.ok || !data.summary) throw new Error(data.error || "分支创建失败，请稍后再试。");
    if (owner !== forOwner) return false;
    sent.clear();
    const intro: ChatMessage = {
      id: uid(),
      role: "assistant",
      branch: true,
      content: `这是从「${title}」分出的新分支。下面是原对话的整理，你可以直接接着聊：\n\n${data.summary}`,
      at: Date.now(),
    };
    set({ messages: [intro], id: uid(), title: "分支：" + title.slice(0, 16), phase: "idle", unread: false, branching: false, activity: "", tool: "", auto: false }, true);
    push(forOwner);
    return true;
  } catch (error) {
    set({ branching: false, historyError: (error as Error).message });
    return false;
  }
}
