export const searchSorts = [
  { id: "hot", label: "综合排序" },
  { id: "new", label: "最新发布" },
  { id: "views", label: "阅读最多" },
  { id: "comments", label: "最热讨论" },
  { id: "unanswered", label: "等待回应" },
] as const;

export function normalizeSearchQuery(value: string) {
  return value.trim().slice(0, 120);
}

export function readSearchState(search = location.search) {
  const params = new URLSearchParams(search);
  return {
    query: normalizeSearchQuery(params.get("q") || ""),
    category: params.get("category") || "all",
    sort: searchSorts.some((sort) => sort.id === params.get("sort"))
      ? params.get("sort")!
      : "hot",
    tag: params.get("tag") === "1",
  };
}

export function searchUrl(query: string, category = "all", sort = "hot", tag = false) {
  const params = new URLSearchParams({ q: normalizeSearchQuery(query) });
  if (tag) params.set("tag", "1");
  if (category !== "all") params.set("category", category);
  if (sort !== "hot") params.set("sort", sort);
  return "/search?" + params.toString();
}
