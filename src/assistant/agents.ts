import { useMemo, useSyncExternalStore } from "react";
import { getPrefs, usePrefs } from "./prefs";

// 智能体：内置的 Naimakes（外观取自 prefs）加上用户自己创建的。其中一个是主智能体，就是常驻屏幕的小球。
export const BUILTIN_AGENT = "naimakes";
export const MAX_GROUP = 3;
export const MAX_NAME = 20;
export const MAX_INSTRUCTIONS = 2000;

export type Agent = { id: string; name: string; instructions: string; shape: string; color: string; builtin?: boolean };
type Custom = Omit<Agent, "builtin">;
type Store = { custom: Custom[]; main: string; loaded: boolean; limit: number; error: string };

let account: string | null = null;
let store: Store = { custom: [], main: BUILTIN_AGENT, loaded: false, limit: 12, error: "" };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const set = (next: Partial<Store>) => {
  store = { ...store, ...next };
  listeners.forEach((fn) => fn());
};
export const subscribeAgents = subscribe;

const builtin = (): Agent => {
  const { shape, color } = getPrefs();
  return { id: BUILTIN_AGENT, name: "Naimakes", instructions: "", shape, color, builtin: true };
};

export const listAll = (): Agent[] => [builtin(), ...store.custom];
export const agentsLoaded = () => store.loaded;
export const mainAgentId = () => (store.main !== BUILTIN_AGENT && store.custom.some((a) => a.id === store.main) ? store.main : BUILTIN_AGENT);
export const findAgent = (id: string): Agent | undefined => listAll().find((a) => a.id === id);

// 对话里记着、但已经被删除的智能体，界面上用一个灰色的占位。
export const goneAgent = (id: string): Agent => ({ id, name: "已删除的智能体", instructions: "", shape: "blob", color: "gray" });
export const agentOrGone = (id: string) => findAgent(id) ?? goneAgent(id);

type Remote = { agents: Custom[]; main: string; limit?: number };
const adopt = (data: Remote) => set({ custom: data.agents, main: data.main || BUILTIN_AGENT, loaded: true, error: "", ...(data.limit ? { limit: data.limit } : {}) });

export async function connectAgents(userId: string | null) {
  if (userId === account) return;
  account = userId;
  set({ custom: [], main: BUILTIN_AGENT, loaded: !userId, error: "" });
  if (userId) await refreshAgents();
}

export async function refreshAgents() {
  const owner = account;
  if (!owner) return;
  try {
    const response = await fetch("/api/assistant/agents", { credentials: "same-origin" });
    if (!response.ok) throw new Error();
    const data = (await response.json()) as Remote;
    if (owner === account) adopt(data);
  } catch {
    if (owner === account) set({ loaded: true, error: "智能体加载失败，请稍后再试。" });
  }
}

async function send(method: string, path: string, body?: unknown): Promise<{ data?: Remote & { agent?: Custom }; error?: string }> {
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Remote & { agent?: Custom; error?: string };
    if (!response.ok) return { error: data.error || "操作没有成功，请稍后再试。" };
    adopt(data);
    return { data };
  } catch {
    return { error: "网络连接失败，请检查网络后重试。" };
  }
}

export type AgentDraft = { name: string; instructions?: string; shape?: string; color?: string; main?: boolean };

export async function createAgent(draft: AgentDraft): Promise<{ agent: Agent } | { error: string }> {
  const { data, error } = await send("POST", "/api/assistant/agents", draft);
  if (!data?.agent) return { error: error || "创建失败，请稍后再试。" };
  return { agent: data.agent };
}

export async function saveAgent(id: string, patch: Partial<Pick<Agent, "name" | "instructions" | "shape" | "color">>): Promise<string> {
  const { error } = await send("PATCH", "/api/assistant/agents/" + id, patch);
  return error || "";
}

export async function removeAgent(id: string): Promise<string> {
  const { error } = await send("DELETE", "/api/assistant/agents/" + id);
  return error || "";
}

export async function chooseMain(id: string): Promise<string> {
  const { error } = await send("PUT", "/api/assistant/main-agent", { id });
  return error || "";
}

export function useAgents() {
  const state = useSyncExternalStore(subscribe, () => store);
  const prefs = usePrefs();
  return useMemo(() => {
    const all: Agent[] = [{ id: BUILTIN_AGENT, name: "Naimakes", instructions: "", shape: prefs.shape, color: prefs.color, builtin: true }, ...state.custom];
    const mainId = state.main !== BUILTIN_AGENT && state.custom.some((a) => a.id === state.main) ? state.main : BUILTIN_AGENT;
    const byId = (id: string) => all.find((a) => a.id === id) ?? goneAgent(id);
    return { agents: all, main: all.find((a) => a.id === mainId)!, mainId, byId, loaded: state.loaded, limit: state.limit, error: state.error, full: state.custom.length >= state.limit };
  }, [state, prefs.shape, prefs.color]);
}
