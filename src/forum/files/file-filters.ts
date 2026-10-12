import { useEffect, useState } from "react";
import { api } from "../api";

export type TimeRange = "all" | "today" | "week" | "month" | "custom";
export const timeRanges: { id: TimeRange; label: string }[] = [
  { id: "all", label: "全部时间" },
  { id: "today", label: "今天" },
  { id: "week", label: "近 7 天" },
  { id: "month", label: "近 30 天" },
  { id: "custom", label: "自定义" },
];

const DAY = 86400000;
const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const parseDay = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : NaN;
};

/** 文件的上传时间是否落在所选范围里。custom 的 from / to 是 YYYY-MM-DD，含当天。 */
export function inTimeRange(time: number, range: TimeRange, from = "", to = "") {
  if (range === "all") return true;
  const today = startOfDay(Date.now());
  if (range === "today") return time >= today;
  if (range === "week") return time >= today - 6 * DAY;
  if (range === "month") return time >= today - 29 * DAY;
  const start = from ? parseDay(from) : -Infinity;
  const end = to ? parseDay(to) + DAY : Infinity;
  return time >= (Number.isNaN(start) ? -Infinity : start) && time < (Number.isNaN(end) ? Infinity : end);
}

export type Via = { chat_id: string; title: string } | null;

/**
 * 按关键词搜索图书馆：文件名，以及聊天记录里提到过的、当时附上的文件。
 * 没有关键词时返回 null（表示不过滤）。
 */
export function useFileMatches(query: string, enabled = true) {
  const [found, setFound] = useState<{ query: string; matches: Map<string, Via> } | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (!q || !enabled) {
      setFound(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api<{ matches: { id: string; via: Via }[] }>("/library/search?q=" + encodeURIComponent(q))
        .then((r) => active && setFound({ query: q, matches: new Map(r.matches.map((m) => [m.id, m.via])) }))
        .catch(() => active && setFound({ query: q, matches: new Map() }));
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, enabled]);
  return {
    matches: q && enabled ? (found?.query === q ? found.matches : undefined) : null,
    searching: !!q && enabled && found?.query !== q,
  };
}
