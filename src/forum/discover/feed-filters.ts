import type { LucideIcon } from "lucide-react";
import {
  ArrowUpNarrowWide,
  Clock3,
  Eye,
  Flame,
  Hourglass,
  MessagesSquare,
} from "lucide-react";

export const feedSorts: {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  { id: "hot", label: "为你推荐", hint: "综合互动与时间", icon: Flame },
  { id: "new", label: "最新发布", hint: "发布时间由新到旧", icon: Clock3 },
  {
    id: "old",
    label: "最早发布",
    hint: "发布时间由旧到新",
    icon: ArrowUpNarrowWide,
  },
  { id: "views", label: "阅读最多", hint: "阅读人数由多到少", icon: Eye },
  {
    id: "comments",
    label: "最热讨论",
    hint: "评论区回复数由多到少",
    icon: MessagesSquare,
  },
  { id: "unanswered", label: "等待回应", hint: "还没有人回复", icon: Hourglass },
];

export const feedRanges: { id: string; label: string; days?: number }[] = [
  { id: "all", label: "全部日期" },
  { id: "1d", label: "最近一天", days: 1 },
  { id: "7d", label: "最近一周", days: 7 },
  { id: "30d", label: "最近一月", days: 30 },
  { id: "180d", label: "最近半年", days: 180 },
  { id: "custom", label: "自定义时间" },
];

export const feedCommentFilters: { id: string; label: string; min: number }[] = [
  { id: "any", label: "不限留言数", min: 0 },
  { id: "1", label: "至少 1 条留言", min: 1 },
  { id: "5", label: "至少 5 条留言", min: 5 },
  { id: "20", label: "至少 20 条留言", min: 20 },
  { id: "50", label: "至少 50 条留言", min: 50 },
];

export type FeedFilters = {
  sort: string;
  range: string;
  from: string;
  to: string;
  comments: string;
};

export const defaultFeedFilters: FeedFilters = {
  sort: "hot",
  range: "all",
  from: "",
  to: "",
  comments: "any",
};

const sortLabel = (id: string) =>
  feedSorts.find((s) => s.id === id)?.label || feedSorts[0].label;

const stamp = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

function resolveWindow(filters: FeedFilters) {
  if (filters.range === "custom")
    return { from: stamp(filters.from), to: stamp(filters.to) };
  const days = feedRanges.find((r) => r.id === filters.range)?.days;
  return { from: days ? Date.now() - days * 86400000 : null, to: null };
}

export const windowInvalid = (filters: FeedFilters) => {
  const { from, to } = resolveWindow(filters);
  return filters.range === "custom" && from !== null && to !== null && from > to;
};

const minComments = (filters: FeedFilters) =>
  feedCommentFilters.find((c) => c.id === filters.comments)?.min || 0;

function hasWindow(filters: FeedFilters) {
  const { from, to } = resolveWindow(filters);
  return from !== null || to !== null;
}

export function activeFilterCount(filters: FeedFilters) {
  return (hasWindow(filters) ? 1 : 0) + (minComments(filters) > 0 ? 1 : 0);
}

export function applyFeedFilters(params: URLSearchParams, filters: FeedFilters) {
  params.set("sort", feedSorts.some((item) => item.id === filters.sort) ? filters.sort : "hot");
  const { from, to } = resolveWindow(filters);
  if (from !== null) params.set("from", String(from));
  if (to !== null) params.set("to", String(to));
  const min = minComments(filters);
  if (min > 0) params.set("minComments", String(min));
  return params;
}

const short = (value: string) =>
  value ? value.replace("T", " ").slice(0, 16) : "";

function rangeSummary(filters: FeedFilters) {
  if (filters.range !== "custom")
    return feedRanges.find((r) => r.id === filters.range)?.label || "全部日期";
  if (!filters.from && !filters.to) return "全部日期";
  if (filters.from && filters.to)
    return short(filters.from) + " 至 " + short(filters.to);
  return filters.from ? short(filters.from) + " 之后" : short(filters.to) + " 之前";
}

export function filtersSummary(filters: FeedFilters) {
  const parts = [sortLabel(filters.sort)];
  if (hasWindow(filters)) parts.push(rangeSummary(filters));
  const min = minComments(filters);
  if (min > 0) parts.push("留言 ≥ " + min);
  return parts.join(" · ");
}
