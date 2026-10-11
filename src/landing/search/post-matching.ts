import type { ArchiveRecord } from "../data/archive-data";

export const SUGGESTION_LIMIT = 5;
export const EXTRACTION_LIMIT = 6;

const splitter = /[\s,，。、;；:：!！?？()（）[\]【】「」『』"'“”‘’#/\\|<>《》·\-_+=~`@]+/;
const normalize = (value: string) => String(value || "").normalize("NFKC").toLowerCase().trim();

export function normalizeQuery(value: string) {
  return value.replace(/^#+/, "").trim().slice(0, 120);
}

type Indexed = { index: number; record: ArchiveRecord; title: string; content: string; tags: string[]; views: number };

const cache = new WeakMap<ArchiveRecord[], Indexed[]>();
function indexed(records: ArchiveRecord[]) {
  let list = cache.get(records);
  if (!list) {
    list = records
      .map((record, index) => ({
        index,
        record,
        title: normalize(record.title),
        content: normalize(record.body.join(" ") || record.abstract),
        tags: record.tags.map(normalize),
        views: record.views || 0,
      }))
      .filter((item) => item.record.postId);
    cache.set(records, list);
  }
  return list;
}

function searchTerms(query: string) {
  const base = normalize(query);
  const words = base.split(splitter).filter(Boolean);
  const terms = new Set<string>();
  for (const word of words) {
    if (words.length > 1) terms.add(word);
    for (const run of word.match(/[㐀-鿿豈-﫿]+/g) || []) {
      if (run.length <= 2) terms.add(run);
      else for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
    }
    for (const latin of word.match(/[a-z0-9]+/g) || []) if (latin.length >= 2) terms.add(latin);
  }
  terms.delete(base);
  return [...terms].slice(0, 16);
}

function count(haystack: string, needle: string) {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0 && n < 20; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

function score(item: Indexed, base: string, terms: string[]) {
  const { title, content, tags } = item;
  const tagEqual = tags.includes(base);
  const tagContains = tags.some((tag) => tag !== base && tag.includes(base));
  const inTitle = title.includes(base);
  const inContent = content.includes(base);
  if (tagEqual || tagContains || inTitle || inContent)
    return { exact: true, score: (tagEqual ? 100 : 0) + (tagContains ? 60 : 0) + (inTitle ? 50 : 0) + Math.min(5, count(content, base)) * 4 };
  let value = 0;
  if (tags.some((tag) => tag.length >= 2 && tag !== base && (tag.includes(base) || base.includes(tag)))) value += 24;
  let matched = 0;
  let strong = false;
  for (const term of terms) {
    const inTags = tags.some((tag) => tag.includes(term));
    const hitTitle = title.includes(term);
    const hitContent = content.includes(term);
    if (inTags || hitTitle || hitContent) matched++;
    if (inTags || hitTitle) strong = true;
    value += (inTags ? 6 : 0) + (hitTitle ? 4 : 0) + (hitContent ? Math.min(3, count(content, term)) : 0);
  }
  const coverage = terms.length ? matched / terms.length : 0;
  value += coverage * 20;
  return value > 0 && (strong || coverage >= 0.5) ? { exact: false, score: Math.round(value * 10) / 10 } : null;
}

const byNew = (a: Indexed, b: Indexed) => b.record.createdAt - a.record.createdAt || a.index - b.index;

export function suggestPosts(records: ArchiveRecord[], query: string, limit = SUGGESTION_LIMIT) {
  const needle = normalize(query.slice(0, 120));
  return indexed(records)
    .filter((item) => !needle || item.title.includes(needle) || item.content.includes(needle) || item.tags.some((tag) => tag.includes(needle)))
    .sort((a, b) => b.views - a.views || byNew(a, b))
    .slice(0, limit)
    .map((item) => item.index);
}

export function searchPosts(records: ArchiveRecord[], query: string, limit = EXTRACTION_LIMIT) {
  const base = normalize(normalizeQuery(query));
  if (!base) return { indices: [] as number[], total: 0, exact: 0 };
  const terms = searchTerms(base);
  const exact: { item: Indexed; score: number }[] = [];
  const related: { item: Indexed; score: number }[] = [];
  for (const item of indexed(records)) {
    const result = score(item, base, terms);
    if (result) (result.exact ? exact : related).push({ item, score: result.score });
  }
  const ranked = [...exact.map((entry) => ({ ...entry, exact: 1 })), ...related.map((entry) => ({ ...entry, exact: 0 }))].sort(
    (a, b) => b.item.views - a.item.views || b.exact - a.exact || b.score - a.score || byNew(a.item, b.item),
  );
  return { indices: ranked.slice(0, limit).map((entry) => entry.item.index), total: ranked.length, exact: exact.length };
}
