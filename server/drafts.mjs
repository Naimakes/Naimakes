import { randomUUID } from "node:crypto";

const DRAFT_LIMIT = 50;

export function installDrafts(app, { db, auth, validText, validAttachments, quotableIds, quoteCards, summarize, postFormat }) {
  db.exec(`
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'html',
  excerpt TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'discussion',
  tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  comments_closed INTEGER NOT NULL DEFAULT 0,
  inline_images INTEGER NOT NULL DEFAULT 1,
  attachments TEXT NOT NULL DEFAULT '[]',
  quotes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, updated_at DESC);
`);
  const parseList = (text) => {
    try {
      const value = JSON.parse(text);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const asDraft = (row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    format: row.format === "html" ? "html" : "markdown",
    excerpt: row.excerpt,
    category: row.category,
    kind: row.kind,
    tags: parseList(row.tags).filter((t) => typeof t === "string"),
    visibility: row.visibility === "private" ? "private" : "public",
    comments_closed: !!row.comments_closed,
    inline_images: !!row.inline_images,
    attachments: parseList(row.attachments),
    quotes: quoteCards(parseList(row.quotes).filter((id) => typeof id === "string")),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  const listDrafts = (userId) =>
    db
      .prepare("SELECT * FROM drafts WHERE user_id=? ORDER BY updated_at DESC")
      .all(userId)
      .map(asDraft);
  const getDraft = (id, userId) => {
    const row = db.prepare("SELECT * FROM drafts WHERE id=? AND user_id=?").get(id, userId);
    return row ? asDraft(row) : null;
  };

  function readDraft(body) {
    const format = postFormat(body.format);
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (content.length > 200000) return { error: "草稿正文太长了，先删减一些再保存。" };
    const attachments = body.attachments ?? [];
    if (!validAttachments(attachments)) return { error: "附件信息有误，请重新上传。" };
    const quotes = quotableIds(body.quotes ?? []);
    if (!quotes) return { error: "引用的讨论不存在或未公开。" };
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t) => validText(t, 1, 20)).map((t) => t.trim()).slice(0, 5)
      : [];
    if (!title && !content.trim() && !attachments.length && !quotes.length)
      return { error: "草稿还是空的，先写点什么再保存。" };
    return {
      draft: {
        title,
        content,
        format,
        excerpt: summarize(content, quotes, attachments, format),
        category: typeof body.category === "string" ? body.category.slice(0, 80) : "",
        kind: ["discussion", "project", "announcement"].includes(body.kind) ? body.kind : "discussion",
        tags: JSON.stringify(tags),
        visibility: body.visibility === "private" ? "private" : "public",
        comments_closed: body.comments_closed === true ? 1 : 0,
        inline_images: body.inline_images === false ? 0 : 1,
        attachments: JSON.stringify(
          attachments.map((f) => ({
            url: f.url,
            name: f.name.trim().slice(0, 200),
            mime: f.mime.trim(),
            size: f.size,
            inline: f.inline === true,
          })),
        ),
        quotes: JSON.stringify(quotes),
      },
    };
  }

  app.get("/api/drafts", auth, (req, res) => res.json({ drafts: listDrafts(req.user.id) }));

  app.post("/api/drafts", auth, (req, res) => {
    const read = readDraft(req.body || {});
    if (read.error) return res.status(400).json({ error: read.error });
    const count = db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE user_id=?").get(req.user.id).n;
    if (count >= DRAFT_LIMIT)
      return res.status(400).json({
        error: `草稿最多保存 ${DRAFT_LIMIT} 篇，请先清理一些再保存。`,
      });
    const id = randomUUID();
    const now = Date.now();
    const d = read.draft;
    db.prepare(
      `INSERT INTO drafts(id,user_id,title,content,format,excerpt,category,kind,tags,visibility,comments_closed,inline_images,attachments,quotes,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, req.user.id, d.title, d.content, d.format, d.excerpt, d.category, d.kind,
      d.tags, d.visibility, d.comments_closed, d.inline_images, d.attachments, d.quotes, now, now,
    );
    res.status(201).json({ draft: getDraft(id, req.user.id), drafts: listDrafts(req.user.id) });
  });

  app.patch("/api/drafts/:id", auth, (req, res) => {
    if (!db.prepare("SELECT 1 FROM drafts WHERE id=? AND user_id=?").get(req.params.id, req.user.id))
      return res.status(404).json({ error: "这份草稿不在了，可能已经被清除。" });
    const read = readDraft(req.body || {});
    if (read.error) return res.status(400).json({ error: read.error });
    const d = read.draft;
    db.prepare(
      `UPDATE drafts SET title=?,content=?,format=?,excerpt=?,category=?,kind=?,tags=?,visibility=?,
       comments_closed=?,inline_images=?,attachments=?,quotes=?,updated_at=? WHERE id=? AND user_id=?`,
    ).run(
      d.title, d.content, d.format, d.excerpt, d.category, d.kind, d.tags, d.visibility,
      d.comments_closed, d.inline_images, d.attachments, d.quotes, Date.now(), req.params.id, req.user.id,
    );
    res.json({ draft: getDraft(req.params.id, req.user.id), drafts: listDrafts(req.user.id) });
  });

  app.delete("/api/drafts", auth, (req, res) => {
    const { ids, all } = req.body || {};
    if (all === true) db.prepare("DELETE FROM drafts WHERE user_id=?").run(req.user.id);
    else {
      const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
      if (!list.length) return res.status(400).json({ error: "请选择要删除的草稿。" });
      db.prepare(
        `DELETE FROM drafts WHERE user_id=? AND id IN (${list.map(() => "?").join(",")})`,
      ).run(req.user.id, ...list);
    }
    res.json({ drafts: listDrafts(req.user.id) });
  });
}
