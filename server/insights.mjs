import { db } from "./database.mjs";
import { canModerateBoard, getBoard } from "./boards.mjs";

const POINTS = 48;
const ranges = { "1d": 1, "7d": 7, "30d": 30, all: 0 };
const postMetrics = ["views", "likes", "bookmarks", "comments", "followers"];
const boardMetrics = ["views", "likes", "bookmarks", "followers"];

function eventSql(metric, scope) {
  switch (metric) {
    case "views":
      return `SELECT v.viewed_at AS t FROM post_views v JOIN posts p ON p.id=v.post_id WHERE ${scope}`;
    case "likes":
      return `SELECT MAX(l.created_at,p.created_at) AS t FROM likes l JOIN posts p ON p.id=l.post_id WHERE ${scope}`;
    case "bookmarks":
      return `SELECT MIN(MAX(i.added_at,p.created_at)) AS t FROM collection_items i
        JOIN collections c ON c.id=i.collection_id JOIN posts p ON p.id=i.post_id
        WHERE ${scope} GROUP BY i.post_id,c.user_id`;
    case "comments":
      return `SELECT m.created_at AS t FROM comments m JOIN posts p ON p.id=m.post_id WHERE m.deleted=0 AND ${scope}`;
    case "followers":
      return `SELECT f.created_at AS t FROM post_follows f JOIN posts p ON p.id=f.post_id WHERE ${scope}`;
  }
}

function series(sources, origin, range) {
  const now = Date.now();
  const events = Object.fromEntries(
    Object.entries(sources).map(([metric, rows]) => [metric, rows.map((r) => r.t || origin).sort((a, b) => a - b)]),
  );
  const first = Math.min(origin, ...Object.values(events).map((list) => list[0] ?? origin));
  const days = ranges[range] ?? 0;
  const from = days ? now - days * 86400000 : Math.min(first, now - 3600000);
  const times = Array.from({ length: POINTS + 1 }, (_, i) => Math.round(from + ((now - from) * i) / POINTS));
  const values = {};
  const totals = {};
  for (const [metric, list] of Object.entries(events)) {
    let k = 0;
    values[metric] = times.map((time) => {
      while (k < list.length && list[k] <= time) k++;
      return k;
    });
    totals[metric] = list.length;
  }
  return { times, series: values, totals, range: days ? range : "all", updated_at: now };
}

export function installInsights(app, { auth, liveClause }) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const rangeOf = (req) => (typeof req.query.range === "string" && req.query.range in ranges ? req.query.range : "all");
  const countOf = (metric, scope, args) =>
    db.prepare(`SELECT COUNT(*) AS n FROM (${eventSql(metric, scope)})`).get(...args).n;
  const livePost = `${liveClause} AND p.id=?`;
  const boardScope = `${liveClause} AND p.category=? AND p.visibility='public'`;
  const boardFollowers = (id) =>
    db.prepare("SELECT MAX(f.created_at,c.created_at) AS t FROM follows f JOIN categories c ON c.id=f.category WHERE f.category=?").all(id);
  const boardSummary = (board, user) => ({
    id: board.id,
    name: board.name,
    en: board.en,
    icon: board.icon,
    description: board.description,
    created_at: board.created_at,
    posts: db.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${boardScope}`).get(board.id).n,
    views: countOf("views", boardScope, [board.id]),
    likes: countOf("likes", boardScope, [board.id]),
    bookmarks: countOf("bookmarks", boardScope, [board.id]),
    followers: boardFollowers(board.id).length,
    can_moderate: canModerateBoard(user, board.id),
  });

  app.get("/api/insights/posts", auth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id,p.title,p.excerpt,p.category,p.kind,p.created_at,p.visibility,p.comments_closed,p.locked,p.lock_reason,p.demo
         FROM posts p WHERE p.author_id=? AND ${liveClause} ORDER BY p.created_at DESC, p.rowid DESC LIMIT 500`,
      )
      .all(req.user.id);
    res.json({
      posts: rows.map((p) => ({
        ...p,
        comments_closed: !!p.comments_closed,
        locked: !!p.locked,
        can_lock: p.kind !== "announcement" && canModerateBoard(req.user, p.category),
        ...Object.fromEntries(postMetrics.map((metric) => [metric, countOf(metric, livePost, [p.id])])),
      })),
    });
  });
  app.get("/api/insights/posts/:id", auth, (req, res) => {
    const post = db.prepare(`SELECT p.* FROM posts p WHERE ${livePost}`).get(req.params.id);
    if (!post) return fail(res, 404, "讨论不存在。");
    if (post.author_id !== req.user.id && !canModerateBoard(req.user, post.category))
      return fail(res, 403, "只有作者或本版块的管理成员可以查看这些数据。");
    const sources = Object.fromEntries(
      postMetrics.map((metric) => [metric, db.prepare(eventSql(metric, livePost)).all(post.id)]),
    );
    res.set("Cache-Control", "no-store");
    res.json(series(sources, post.created_at, rangeOf(req)));
  });
  app.get("/api/insights/boards", auth, (req, res) => {
    const boards = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY builtin DESC, position, created_at")
      .all()
      .filter((board) => canModerateBoard(req.user, board.id))
      .map((board) => boardSummary(board, req.user))
      .sort((a, b) => b.views - a.views);
    res.json({ boards });
  });
  app.get("/api/insights/boards/:id", auth, (req, res) => {
    const board = getBoard(req.params.id);
    if (!board) return fail(res, 404, "版块不存在。");
    if (!canModerateBoard(req.user, board.id)) return fail(res, 403, "只有本版块的管理成员可以查看这些数据。");
    const sources = Object.fromEntries(
      boardMetrics.map((metric) => [
        metric,
        metric === "followers" ? boardFollowers(board.id) : db.prepare(eventSql(metric, boardScope)).all(board.id),
      ]),
    );
    res.set("Cache-Control", "no-store");
    res.json({ ...series(sources, board.created_at, rangeOf(req)), board: boardSummary(board, req.user) });
  });
}
