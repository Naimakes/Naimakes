// 联网搜索：助手的 web_search 工具在我们自己的服务器上调用搜索 API，
// 所以 DeepSeek（Anthropic 兼容接口里没有 Claude 的服务端联网搜索）和 Claude 都能用。
// 用 WEB_SEARCH_PROVIDER 选择服务商；只配了 WEB_SEARCH_API_KEY 时默认用博查，只配了 WEB_SEARCH_URL 时默认用 SearXNG。

const clip = (text, length) => {
  const chars = Array.from(String(text || "").replace(/\s+/g, " ").trim());
  return chars.length > length ? chars.slice(0, length).join("") + "…" : chars.join("");
};
const day = (value) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined;
};
const siteOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// recency：day / week / month / year / any
const providers = {
  // 博查 Web Search API（https://open.bochaai.com），国内可直接访问，常和 DeepSeek 搭配使用。
  bocha: {
    needsKey: true,
    async search({ query, recency, count }, key) {
      const freshness = { day: "oneDay", week: "oneWeek", month: "oneMonth", year: "oneYear" }[recency] || "noLimit";
      const data = await request(process.env.WEB_SEARCH_URL || "https://api.bochaai.com/v1/web-search", {
        method: "POST",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: JSON.stringify({ query, freshness, summary: true, count }),
      });
      return (data?.data?.webPages?.value || []).map((r) => ({
        title: r.name,
        url: r.url,
        site: r.siteName,
        published: r.datePublished,
        snippet: r.summary || r.snippet,
      }));
    },
  },
  // Tavily（https://tavily.com），为 AI 搜索设计，返回的正文摘录较长。
  tavily: {
    needsKey: true,
    async search({ query, recency, count }, key) {
      const data = await request(process.env.WEB_SEARCH_URL || "https://api.tavily.com/search", {
        method: "POST",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: JSON.stringify({ query, max_results: count, search_depth: "basic", ...(recency !== "any" ? { time_range: recency } : {}) }),
      });
      return (data?.results || []).map((r) => ({ title: r.title, url: r.url, published: r.published_date, snippet: r.content }));
    },
  },
  // Brave Search API（https://brave.com/search/api/）。
  brave: {
    needsKey: true,
    async search({ query, recency, count }, key) {
      const params = new URLSearchParams({ q: query, count: String(count) });
      const freshness = { day: "pd", week: "pw", month: "pm", year: "py" }[recency];
      if (freshness) params.set("freshness", freshness);
      const data = await request((process.env.WEB_SEARCH_URL || "https://api.search.brave.com/res/v1/web/search") + "?" + params, {
        headers: { "x-subscription-token": key, accept: "application/json" },
      });
      return (data?.web?.results || []).map((r) => ({ title: r.title, url: r.url, published: r.page_age, snippet: r.description }));
    },
  },
  // 自建的 SearXNG：WEB_SEARCH_URL 填实例地址，并在实例的 settings.yml 里打开 json 格式。
  searxng: {
    needsKey: false,
    async search({ query, recency, count }, key) {
      const base = String(process.env.WEB_SEARCH_URL || "").replace(/\/+$/, "");
      const params = new URLSearchParams({ q: query, format: "json" });
      if (recency !== "any") params.set("time_range", recency);
      const data = await request(base + "/search?" + params, { headers: { accept: "application/json", ...(key ? { authorization: "Bearer " + key } : {}) } });
      return (data?.results || []).slice(0, count).map((r) => ({ title: r.title, url: r.url, published: r.publishedDate, snippet: r.content }));
    },
  },
};

export class WebSearchError extends Error {}

async function request(url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new WebSearchError("联网搜索暂时没有响应，请稍后再试。");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || (typeof data?.code === "number" && data.code !== 200)) {
    console.error("Web search failed:", response.status, clip(data?.msg || data?.message || data?.detail || data?.error || "", 200));
    throw new WebSearchError(response.status === 429 ? "联网搜索的次数暂时用完了，请稍后再试。" : "联网搜索暂时不可用，请稍后再试。");
  }
  return data;
}

const key = process.env.WEB_SEARCH_API_KEY || "";
const providerName = (process.env.WEB_SEARCH_PROVIDER || (key ? "bocha" : process.env.WEB_SEARCH_URL ? "searxng" : "")).trim().toLowerCase();
const provider = providers[providerName];

export const webSearch = {
  provider: provider ? providerName : "",
  enabled: !!provider && (provider.needsKey ? !!key : !!process.env.WEB_SEARCH_URL),
  // 一次回答里最多搜几次，避免模型来回搜把额度用光。
  perAnswer: Math.max(1, Number(process.env.WEB_SEARCH_PER_ANSWER) || 5),
  async search({ query, recency = "any", count = 6 }) {
    if (!this.enabled) throw new WebSearchError("站点没有开启联网搜索。");
    const seen = new Set();
    const results = [];
    for (const r of await provider.search({ query, recency, count }, key)) {
      if (!r || typeof r.url !== "string" || !/^https?:\/\//i.test(r.url) || seen.has(r.url)) continue;
      seen.add(r.url);
      results.push({
        title: clip(r.title || siteOf(r.url), 120),
        url: r.url.slice(0, 300),
        site: clip(r.site || siteOf(r.url), 40),
        ...(day(r.published) ? { published: day(r.published) } : {}),
        snippet: clip(r.snippet, 600),
      });
      if (results.length >= count) break;
    }
    return results;
  },
};

if (process.env.WEB_SEARCH_PROVIDER && !provider)
  console.warn(`WEB_SEARCH_PROVIDER=${process.env.WEB_SEARCH_PROVIDER} 不受支持，可选：${Object.keys(providers).join(" / ")}。联网搜索未开启。`);
