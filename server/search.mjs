import { plainText } from "./rich-text.mjs";

const pageSize = 12;
const candidateLimit = 600;

const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().trim();
const splitter = /[\s,，。、;；:：!！?？()（）[\]【】「」『』"'“”‘’#/\\|<>《》·\-_+=~`@]+/;

function searchTerms(query) {
  const base = normalize(query);
  const words = base.split(splitter).filter(Boolean);
  const terms = new Set();
  for (const word of words) {
    if (words.length > 1) terms.add(word);
    for (const run of word.match(/[㐀-鿿豈-﫿]+/g) || []) {
      if (run.length <= 2) terms.add(run);
      else for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
    }
    for (const latin of word.match(/[a-z0-9]+/g) || []) if (latin.length >= 2) terms.add(latin);
  }
  terms.delete(base);
  return [...terms].slice(0, 16);
}

const count = (haystack, needle) => {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0 && n < 20; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
};

function scorePost(post, query, { tag = false, terms = searchTerms(query) } = {}) {
  const base = normalize(query);
  const title = normalize(post.title);
  const content = normalize(plainText(post.content, post.format));
  const tags = (Array.isArray(post.tags) ? post.tags : JSON.parse(post.tags || "[]")).map(normalize);
  const tagEqual = tags.includes(base);
  const tagContains = tags.some((t) => t !== base && t.includes(base));
  const inTitle = title.includes(base);
  const inContent = content.includes(base);
  if (tag ? tagEqual : tagEqual || tagContains || inTitle || inContent) {
    const score =
      (tagEqual ? 100 : 0) + (tagContains ? 60 : 0) + (inTitle ? 50 : 0) + Math.min(5, count(content, base)) * 4;
    return { match: "exact", score };
  }
  let score = 0;
  if (tag) score += (inTitle ? 50 : 0) + (inContent ? 30 : 0) + (tagContains ? 40 : 0);
  if (tags.some((t) => t.length >= 2 && t !== base && (t.includes(base) || base.includes(t)))) score += 24;
  let matched = 0,
    strong = false;
  for (const term of terms) {
    const inTags = tags.some((t) => t.includes(term));
    const hitTitle = title.includes(term);
    const hitContent = content.includes(term);
    if (inTags || hitTitle || hitContent) matched++;
    if (inTags || hitTitle) strong = true;
    score += (inTags ? 6 : 0) + (hitTitle ? 4 : 0) + (hitContent ? Math.min(3, count(content, term)) : 0);
  }
  const coverage = terms.length ? matched / terms.length : 0;
  score += coverage * 20;
  const related = score > 0 && (strong || coverage >= 0.5 || (tag && (inTitle || inContent)));
  return related ? { match: "related", score: Math.round(score * 10) / 10 } : null;
}

export function installSearch(app, { db, selectPost, formatPost, visibleClause, hasCategory }) {
  app.get("/api/search", (req, res) => {
    const user = req.user?.id || "";
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    const tag = req.query.tag === "1";
    const sort = ["hot", "new", "unanswered", "comments", "views"].includes(req.query.sort) ? req.query.sort : "hot";
    const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
    if (!query) return res.json({ posts: [], total: 0, exactTotal: 0, relatedTotal: 0, hasMore: false });
    const terms = searchTerms(query);
    const conditions = [visibleClause];
    const args = [user, user, user];
    if (typeof req.query.category === "string" && hasCategory(req.query.category)) {
      conditions.push("p.category=?");
      args.push(req.query.category);
    }
    if (sort === "unanswered") conditions.push("NOT EXISTS(SELECT 1 FROM comments c WHERE c.post_id=p.id)");
    const needles = [query, ...terms];
    conditions.push(
      "(" + needles.map(() => "(instr(lower(p.title),?)>0 OR instr(lower(p.content),?)>0 OR instr(lower(p.tags),?)>0)").join(" OR ") + ")",
    );
    for (const needle of needles) {
      const lowered = normalize(needle);
      args.push(lowered, lowered, lowered);
    }
    const rows = db
      .prepare(`${selectPost} WHERE ${conditions.join(" AND ")} ORDER BY p.created_at DESC LIMIT ${candidateLimit}`)
      .all(...args);
    const hot = (p) => p.likes * 3 + p.comments * 5;
    const scored = [];
    for (const row of rows) {
      const result = scorePost(row, query, { tag, terms });
      if (result) scored.push({ row, ...result });
    }
    const exact = scored.filter((s) => s.match === "exact");
    const related = scored.filter((s) => s.match === "related");
    const byNew = (a, b) => b.row.created_at - a.row.created_at;
    exact.sort(
      sort === "new" || sort === "unanswered"
        ? byNew
        : sort === "comments"
          ? (a, b) => b.row.comments - a.row.comments || byNew(a, b)
          : sort === "views"
            ? (a, b) => b.row.views - a.row.views || byNew(a, b)
            : (a, b) => b.score - a.score || hot(b.row) - hot(a.row) || byNew(a, b),
    );
    related.sort(
      (a, b) =>
        b.score - a.score ||
        (sort === "comments" ? b.row.comments - a.row.comments : 0) ||
        (sort === "views" ? b.row.views - a.row.views : 0) ||
        (sort === "hot" ? hot(b.row) - hot(a.row) : 0) ||
        byNew(a, b),
    );
    const ordered = [...exact, ...related];
    const page = ordered.slice(offset, offset + pageSize);
    res.json({
      posts: page.map((s) => ({ ...formatPost(s.row, user), match: s.match, relevance: s.score })),
      total: ordered.length,
      exactTotal: exact.length,
      relatedTotal: related.length,
      hasMore: offset + page.length < ordered.length,
    });
  });
}

const personalScopes = ["mine", "saved", "following", "later", "history"];
export function installPersonalSearch(app, { db, auth, selectPost, formatPost, visibleClause, libraryClause }) {
  const like = "instr(lower(?1),lower(?2))>0";
  const plain = (text) =>
    Array.from(
      String(text || "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/[#*`>]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  const excerpt = (text, query) => {
    const chars = plain(text);
    const at = chars.join("").toLowerCase().indexOf(query.toLowerCase());
    const start = Math.max(0, (at < 0 ? 0 : Array.from(chars.join("").slice(0, at)).length) - 30);
    return (start > 0 ? "…" : "") + chars.slice(start, start + 120).join("") + (chars.length > start + 120 ? "…" : "");
  };
  const personCard = (u) => ({ id: u.id, name: u.name, initials: u.initials, avatar: u.avatar || "", bio: u.bio || "", role: u.role });
  app.get("/api/me/search", auth, (req, res) => {
    const scope = personalScopes.includes(req.query.scope) ? req.query.scope : "";
    if (!scope) return res.status(400).json({ error: "搜索范围无效。" });
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    if (!q) return res.json({ posts: [], comments: [], people: [], total: 0 });
    const me = req.user.id;
    const postMatch = `(${like.replaceAll("?1", "p.title").replaceAll("?2", "?")} OR ${like
      .replaceAll("?1", "p.content")
      .replaceAll("?2", "?")} OR ${like.replaceAll("?1", "u.name").replaceAll("?2", "?")})`;
    const source = {
      mine: { sql: "p.author_id=?", args: [me] },
      saved: { sql: "EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id=p.id AND b.user_id=?)", args: [me] },
      later: { sql: "EXISTS(SELECT 1 FROM read_later r WHERE r.post_id=p.id AND r.user_id=?)", args: [me] },
      history: { sql: "EXISTS(SELECT 1 FROM history h WHERE h.post_id=p.id AND h.user_id=?)", args: [me] },
    }[scope];
    let posts = [];
    if (source) {
      const order =
        scope === "history"
          ? "(SELECT seen_at FROM history WHERE post_id=p.id AND user_id=?) DESC"
          : scope === "later"
            ? "(SELECT added_at FROM read_later WHERE post_id=p.id AND user_id=?) DESC"
            : "p.created_at DESC";
      posts = db
        .prepare(
          `${selectPost} WHERE ${source.sql} AND ${visibleClause} AND ${postMatch}
           ORDER BY ${order}, p.rowid DESC LIMIT 30`,
        )
        .all(me, me, ...source.args, me, q, q, q, ...(scope === "history" || scope === "later" ? [me] : []))
        .map((p) => ({ ...formatPost(p, me), snippet: excerpt(plainText(p.content, p.format), q) }));
    }
    const comments =
      scope === "mine"
        ? db
            .prepare(
              `SELECT c.id,c.post_id,c.parent_id,c.content,c.created_at,p.title AS post_title,p.category,
                 pu.name AS parent_author
               FROM comments c JOIN posts p ON p.id=c.post_id JOIN users u ON u.id=p.author_id
               LEFT JOIN comments pc ON pc.id=c.parent_id LEFT JOIN users pu ON pu.id=pc.author_id
               WHERE c.author_id=? AND c.deleted=0 AND ${visibleClause}
                 AND (${like.replaceAll("?1", "c.content").replaceAll("?2", "?")} OR ${like
                   .replaceAll("?1", "p.title")
                   .replaceAll("?2", "?")})
               ORDER BY c.created_at DESC LIMIT 30`,
            )
            .all(me, me, q, q)
            .map((c) => ({
              id: c.id,
              post_id: c.post_id,
              post_title: c.post_title,
              category: c.category,
              reply: !!c.parent_id,
              reply_to: c.parent_author || "",
              snippet: excerpt(c.content, q),
              created_at: c.created_at,
            }))
        : [];
    const personMatch = `(${like.replaceAll("?1", "u.name").replaceAll("?2", "?")} OR ${like
      .replaceAll("?1", "u.id")
      .replaceAll("?2", "?")})`;
    const peopleSource = {
      following: { sql: "EXISTS(SELECT 1 FROM user_follows f WHERE f.target_id=u.id AND f.follower_id=?)", args: [me] },
      saved: {
        sql: `EXISTS(SELECT 1 FROM bookmarks b JOIN posts p ON p.id=b.post_id WHERE b.user_id=? AND p.author_id=u.id AND ${libraryClause})`,
        args: [me, me],
      },
      later: {
        sql: `EXISTS(SELECT 1 FROM read_later r JOIN posts p ON p.id=r.post_id WHERE r.user_id=? AND p.author_id=u.id AND ${libraryClause})`,
        args: [me, me],
      },
      history: {
        sql: `(EXISTS(SELECT 1 FROM profile_visits v WHERE v.owner_id=u.id AND v.visitor_id=?)
          OR EXISTS(SELECT 1 FROM history h JOIN posts p ON p.id=h.post_id WHERE h.user_id=? AND p.author_id=u.id AND ${libraryClause}))`,
        args: [me, me, me],
      },
    }[scope];
    const people = peopleSource
      ? db
          .prepare(
            `SELECT u.id,u.name,u.initials,u.avatar,u.bio,u.role FROM users u
             WHERE u.status='active' AND u.id<>? AND ${peopleSource.sql} AND ${personMatch}
             ORDER BY (lower(u.name)=lower(?)) DESC, u.name LIMIT 24`,
          )
          .all(me, ...peopleSource.args, q, q, q)
          .map(personCard)
      : [];
    res.json({ posts, comments, people, total: posts.length + comments.length + people.length });
  });
}
