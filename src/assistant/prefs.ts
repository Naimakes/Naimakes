import { useSyncExternalStore } from "react";

export type AssistantPrefs = {
  shape: string;
  color: string;
  thinking: Thinking;
};

export type Thinking = "fast" | "balanced" | "deep";
export const thinkingModes: { id: Thinking; label: string; hint: string }[] = [
  { id: "fast", label: "快速", hint: "回答最快，适合简单问题" },
  { id: "balanced", label: "均衡", hint: "速度与思考深度兼顾" },
  { id: "deep", label: "深入", hint: "思考更久，适合复杂问题，回答较慢" },
];

export type SyncState = { state: "busy" | "done" | "error"; at: number } | null;

export const defaultPrefs: AssistantPrefs = { shape: "blob", color: "black", thinking: "fast" };

export const shapeNames: Record<string, string> = {
  blob: "团子",
  pebble: "卵石",
  bean: "豆豆",
  egg: "蛋形",
  squircle: "圆角方",
  tablet: "药片",
  capsule: "胶囊",
  cylinder: "圆柱",
  hex: "六边形",
  gem: "宝石",
  crystal: "水晶",
  wedge: "楔形",
  shield: "盾牌",
  dome: "穹顶",
  arch: "拱门",
  cloud: "云朵",
  teardrop: "水滴",
  leaf: "叶片",
  square: "方块",
  sparkle: "星光",
  clover: "四叶草",
  flower: "花朵",
  heart: "爱心",
  house: "小屋",
  star: "星星",
};

export const colorNames: Record<string, string> = {
  black: "墨黑",
  brown: "可可",
  red: "番茄",
  orange: "橘子",
  yellow: "向日葵",
  green: "薄荷",
  cyan: "湖水",
  blue: "天空",
  violet: "薰衣草",
  magenta: "莓果",
  gray: "雾灰",
};

export const shapes = Object.entries(shapeNames).map(([id, label]) => ({ id, label }));
export const swatches: Record<string, string> = {
  black: "#000000",
  brown: "#936439",
  red: "#FF263C",
  orange: "#FF6700",
  yellow: "#FF9800",
  green: "#00C972",
  cyan: "#00BCA6",
  blue: "#1084FE",
  violet: "#9159FE",
  magenta: "#FF309B",
  gray: "#777777",
};
export const colorIds = Object.keys(swatches);
export const swatchOf = (color: string) => swatches[color] || swatches.black;

const PREFS_KEY = "nmk-assistant-prefs";
const POSITION_KEY = "nmk-assistant-position";

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export function clean(input: unknown): Partial<AssistantPrefs> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const out: Partial<AssistantPrefs> = {};
  if (typeof source.shape === "string" && source.shape in shapeNames) out.shape = source.shape;
  if (typeof source.color === "string" && source.color in swatches) out.color = source.color;
  if (source.thinking === "fast" || source.thinking === "balanced" || source.thinking === "deep") out.thinking = source.thinking;
  return out;
}

type Stored = { prefs: Partial<AssistantPrefs>; updatedAt: number };
const stored = read<Stored>(PREFS_KEY);
let prefs: AssistantPrefs = { ...defaultPrefs, ...clean(stored?.prefs) };
let updatedAt = stored?.updatedAt || 0;
let account: string | null = null;
let sync: SyncState = null;
let pushTimer = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function persist() {
  write(PREFS_KEY, { prefs, updatedAt });
}

async function push() {
  if (!account) return;
  const owner = account;
  sync = { state: "busy", at: Date.now() };
  emit();
  try {
    const response = await fetch("/api/me/assistant", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs }),
    });
    if (!response.ok) throw new Error();
    if (owner === account) sync = { state: "done", at: Date.now() };
  } catch {
    if (owner === account) sync = { state: "error", at: Date.now() };
  }
  emit();
}

export function updatePrefs(patch: Partial<AssistantPrefs>) {
  prefs = { ...prefs, ...clean(patch) };
  updatedAt = Date.now();
  persist();
  if (account) {
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(push, 450);
    sync = { state: "busy", at: Date.now() };
  } else sync = { state: "done", at: Date.now() };
  emit();
}

// Takes prefs the server already saved (e.g. changed by Naimakes) without pushing them back.
export function adoptPrefs(next: Partial<AssistantPrefs>, at: number) {
  clearTimeout(pushTimer);
  prefs = { ...prefs, ...clean(next) };
  updatedAt = at;
  sync = { state: "done", at: Date.now() };
  persist();
  emit();
}

export function resetPrefs() {
  updatePrefs({ ...defaultPrefs });
}

export async function connectAccount(userId: string | null) {
  if (userId === account) return;
  account = userId;
  clearTimeout(pushTimer);
  if (!userId) return;
  try {
    const response = await fetch("/api/me/assistant", { credentials: "same-origin" });
    if (!response.ok || account !== userId) return;
    const data = (await response.json()) as { prefs: Partial<AssistantPrefs> | null; updated_at: number };
    if (account !== userId) return;
    if (data.prefs && data.updated_at >= updatedAt) {
      prefs = { ...defaultPrefs, ...clean(data.prefs) };
      updatedAt = data.updated_at;
      persist();
      emit();
    } else if (updatedAt > (data.updated_at || 0)) push();
  } catch {}
}

export const getPrefs = () => prefs;
export const getSync = () => sync;
export const usePrefs = () => useSyncExternalStore(subscribe, getPrefs);
export const useSync = () => useSyncExternalStore(subscribe, getSync);

export type DockPosition = { x: number; y: number };
export const readPosition = () => {
  const value = read<DockPosition>(POSITION_KEY);
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
};
export const savePosition = (value: DockPosition) => write(POSITION_KEY, value);
export const clearPosition = () => {
  try {
    localStorage.removeItem(POSITION_KEY);
  } catch {}
  window.dispatchEvent(new Event("nmk-assistant-position"));
};

const NOTIFY_KEY = "nmk-assistant-notify";
let notify = read<boolean>(NOTIFY_KEY) !== false;
export const getNotify = () => notify;
export const useNotify = () => useSyncExternalStore(subscribe, getNotify);
export function setNotify(value: boolean) {
  notify = value;
  write(NOTIFY_KEY, value);
  emit();
}
