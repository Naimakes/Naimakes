export function installFeedPrefs(app, { db, auth, hasCategory }) {
  db.exec(`
CREATE TABLE IF NOT EXISTS board_layouts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  board_order TEXT,
  hidden TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hidden_announcements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
`);
  const parse = (text, fallback) => {
    try {
      const value = JSON.parse(text);
      return Array.isArray(value) ? value.filter((id) => typeof id === "string") : fallback;
    } catch {
      return fallback;
    }
  };
  const layoutOf = (userId) => {
    const row = db.prepare("SELECT board_order,hidden FROM board_layouts WHERE user_id=?").get(userId);
    return {
      order: row?.board_order ? parse(row.board_order, null) : null,
      hidden: row ? parse(row.hidden, []) : [],
    };
  };
  const cleanIds = (value) =>
    Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string" && hasCategory(id)))].slice(0, 500) : null;

  app.get("/api/me/board-layout", auth, (req, res) => res.json(layoutOf(req.user.id)));
  app.put("/api/me/board-layout", auth, (req, res) => {
    const { order = null, hidden = [] } = req.body || {};
    const nextOrder = order === null ? null : cleanIds(order);
    const nextHidden = cleanIds(hidden);
    if ((order !== null && !nextOrder) || !nextHidden) return res.status(400).json({ error: "版块排列格式不正确。" });
    db.prepare(
      `INSERT INTO board_layouts(user_id,board_order,hidden,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET board_order=excluded.board_order,hidden=excluded.hidden,updated_at=excluded.updated_at`,
    ).run(req.user.id, nextOrder && JSON.stringify(nextOrder), JSON.stringify(nextHidden), Date.now());
    res.json(layoutOf(req.user.id));
  });

  const announcement = (id) => db.prepare("SELECT id FROM posts WHERE id=? AND kind='announcement' AND deleted_at IS NULL").get(id);
  app.post("/api/posts/:id/hide-announcement", auth, (req, res) => {
    if (!announcement(req.params.id)) return res.status(404).json({ error: "这条公告不存在。" });
    db.prepare("INSERT OR IGNORE INTO hidden_announcements(user_id,post_id,hidden_at) VALUES(?,?,?)").run(req.user.id, req.params.id, Date.now());
    res.json({ hidden: true });
  });
  app.delete("/api/posts/:id/hide-announcement", auth, (req, res) => {
    db.prepare("DELETE FROM hidden_announcements WHERE user_id=? AND post_id=?").run(req.user.id, req.params.id);
    res.json({ hidden: false });
  });
}
