import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function installLibrary(
  app,
  {
    db,
    dataDir,
    auth,
    getPost,
    visibleClause,
    libraryClause,
    selectPost,
    formatPost,
    hasCategory,
  },
) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const transaction = (fn) => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const ensureDefault = (user) => {
    db.prepare(
      "INSERT OR IGNORE INTO collections(id,user_id,name,is_default,created_at) VALUES(?,?,?,1,?)",
    ).run("default-" + user, user, "默认收藏夹", Date.now());
    return db
      .prepare("SELECT * FROM collections WHERE user_id=? AND is_default=1")
      .get(user);
  };
  const syncBookmarks = (user) => {
    db.prepare("DELETE FROM bookmarks WHERE user_id=?").run(user);
    db.prepare(
      "INSERT INTO bookmarks SELECT DISTINCT ?,i.post_id FROM collection_items i JOIN collections c ON c.id=i.collection_id WHERE c.user_id=?",
    ).run(user, user);
  };
  const findCollection = (id) =>
    db
      .prepare(
        `SELECT c.*,u.name AS owner_name,
    (SELECT COUNT(*) FROM collection_items WHERE collection_id=c.id) AS count
    FROM collections c JOIN users u ON u.id=c.user_id WHERE c.id=?`,
      )
      .get(id);
  const visibleCollection = (req, res) => {
    const folder = findCollection(req.params.id);
    if (!folder || (!folder.is_public && folder.user_id !== req.user?.id)) {
      fail(res, 404, "收藏夹不存在或未公开。");
      return null;
    }
    return folder;
  };
  const ownedCollection = (req, res) => {
    const folder = findCollection(req.params.id);
    if (!folder || folder.user_id !== req.user.id) {
      fail(res, 404, "收藏夹不存在。");
      return null;
    }
    return folder;
  };
  const validateFolder = (body) => {
    const { name, description = "", cover = "", is_public } = body;
    if (typeof name !== "string" || !name.trim() || name.length > 20)
      return "名称需为 1–20 个字符。";
    if (typeof description !== "string" || description.length > 200)
      return "简介不能超过 200 个字符。";
    if (typeof is_public !== "boolean") return "请选择收藏夹是否公开。";
    if (
      typeof cover !== "string" ||
      (cover &&
        (!/^\/uploads\/[a-f0-9-]+\.(png|jpeg|webp|gif)$/.test(cover) ||
          !existsSync(resolve(dataDir, cover.slice(1)))))
    )
      return "请先上传有效的封面图片。";
    return null;
  };
  const pagePosts = (
    req,
    res,
    where,
    params,
    order = "p.created_at DESC",
    orderParams = [],
    keepRemoved = false,
  ) => {
    const user = req.user?.id || "";
    const offset = Math.max(
      0,
      Math.min(100000, parseInt(req.query.offset) || 0),
    );
    const q =
      typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    if (q) {
      where +=
        " AND (instr(lower(p.title),lower(?))>0 OR instr(lower(p.content),lower(?))>0 OR instr(lower(u.name),lower(?))>0)";
      params.push(q, q, q);
    }
    where += " AND " + (keepRemoved && !q ? libraryClause : visibleClause);
    params.push(user);
    const from = " FROM posts p JOIN users u ON u.id=p.author_id ";
    const total = db
      .prepare("SELECT COUNT(*) AS n" + from + " WHERE " + where)
      .get(...params).n;
    const posts = db
      .prepare(
        selectPost +
          " WHERE " +
          where +
          " ORDER BY " +
          order +
          " LIMIT 12 OFFSET ?",
      )
      .all(user, user, ...params, ...orderParams, offset)
      .map((p) => formatPost(p, user));
    res.json({ posts, total, hasMore: offset + posts.length < total });
  };

  app.get("/api/collections", auth, (req, res) => {
    ensureDefault(req.user.id);
    const collections = db
      .prepare(
        `SELECT c.*,
      (SELECT COUNT(*) FROM collection_items WHERE collection_id=c.id) AS count
      FROM collections c WHERE c.user_id=? ORDER BY c.is_default DESC,c.created_at DESC`,
      )
      .all(req.user.id);
    const later = db
      .prepare(
        "SELECT COUNT(*) AS total,COUNT(completed_at) AS completed FROM read_later WHERE user_id=?",
      )
      .get(req.user.id);
    res.json({ collections, later });
  });
  app.post("/api/collections", auth, (req, res) => {
    const error = validateFolder(req.body || {});
    if (error) return fail(res, 400, error);
    const id = randomUUID(),
      { name, description = "", cover = "", is_public } = req.body;
    db.prepare(
      "INSERT INTO collections(id,user_id,name,description,cover,is_public,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      req.user.id,
      name.trim(),
      description.trim(),
      cover,
      +is_public,
      Date.now(),
    );
    res.status(201).json({ collection: findCollection(id) });
  });
  app.get("/api/collections/:id", (req, res) => {
    const folder = visibleCollection(req, res);
    if (folder) res.json({ collection: folder });
  });
  app.patch("/api/collections/:id", auth, (req, res) => {
    const folder = ownedCollection(req, res);
    if (!folder) return;
    const body = { ...folder, is_public: !!folder.is_public, ...req.body };
    const error = validateFolder(body);
    if (error) return fail(res, 400, error);
    db.prepare(
      "UPDATE collections SET name=?,description=?,cover=?,is_public=? WHERE id=?",
    ).run(
      body.name.trim(),
      body.description.trim(),
      body.cover,
      +body.is_public,
      folder.id,
    );
    res.json({ collection: findCollection(folder.id) });
  });
  app.delete("/api/collections/:id", auth, (req, res) => {
    const folder = ownedCollection(req, res);
    if (!folder) return;
    if (folder.is_default) return fail(res, 400, "默认收藏夹不能删除。");
    transaction(() => {
      db.prepare("DELETE FROM collections WHERE id=?").run(folder.id);
      syncBookmarks(req.user.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/collections/:id/posts", (req, res) => {
    const folder = visibleCollection(req, res);
    if (!folder) return;
    pagePosts(
      req,
      res,
      "EXISTS(SELECT 1 FROM collection_items i WHERE i.collection_id=? AND i.post_id=p.id)",
      [folder.id],
      req.query.sort === "published"
        ? "p.created_at DESC"
        : req.query.sort === "popular"
          ? "likes DESC,p.created_at DESC"
          : "(SELECT added_at FROM collection_items WHERE collection_id=? AND post_id=p.id) DESC,p.id",
      ["published", "popular"].includes(req.query.sort) ? [] : [folder.id],
      true,
    );
  });
  app.patch("/api/collections/:id/items", auth, (req, res) => {
    const folder = ownedCollection(req, res);
    if (!folder) return;
    const { target_id, all } = req.body || {};
    const ids =
      all === true
        ? db
            .prepare("SELECT post_id FROM collection_items WHERE collection_id=?")
            .all(folder.id)
            .map((i) => i.post_id)
        : req.body?.ids;
    if (all === true && !ids.length) return res.json({ ok: true });
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 5000 ||
      ids.some((id) => typeof id !== "string")
    )
      return fail(res, 400, "请先选择文章。");
    if (
      target_id &&
      (target_id === folder.id ||
        !db
          .prepare("SELECT 1 FROM collections WHERE id=? AND user_id=?")
          .get(target_id, req.user.id))
    )
      return fail(res, 400, "请选择其他收藏夹。");
    transaction(() => {
      for (const id of new Set(ids)) {
        if (target_id)
          db.prepare(
            "INSERT OR IGNORE INTO collection_items SELECT ?,post_id,added_at FROM collection_items WHERE collection_id=? AND post_id=?",
          ).run(target_id, folder.id, id);
        db.prepare(
          "DELETE FROM collection_items WHERE collection_id=? AND post_id=?",
        ).run(folder.id, id);
      }
      syncBookmarks(req.user.id);
    });
    res.json({ ok: true });
  });
  app.put("/api/posts/:id/collections", auth, (req, res) => {
    if (!getPost(req.params.id, req.user.id)) return fail(res, 404, "讨论不存在。");
    const ids = req.body?.collection_ids;
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string")
    )
      return fail(res, 400, "请选择有效的收藏夹。");
    if (
      ids.some(
        (id) =>
          !db
            .prepare("SELECT 1 FROM collections WHERE id=? AND user_id=?")
            .get(id, req.user.id),
      )
    )
      return fail(res, 404, "收藏夹不存在。");
    transaction(() => {
      const existing = db
        .prepare(
          "SELECT i.collection_id FROM collection_items i JOIN collections c ON c.id=i.collection_id WHERE c.user_id=? AND i.post_id=?",
        )
        .all(req.user.id, req.params.id);
      existing
        .filter((i) => !ids.includes(i.collection_id))
        .forEach((i) =>
          db
            .prepare(
              "DELETE FROM collection_items WHERE collection_id=? AND post_id=?",
            )
            .run(i.collection_id, req.params.id),
        );
      for (const id of new Set(ids))
        db.prepare("INSERT OR IGNORE INTO collection_items VALUES(?,?,?)").run(
          id,
          req.params.id,
          Date.now(),
        );
      syncBookmarks(req.user.id);
    });
    res.json({ post: getPost(req.params.id, req.user.id) });
  });
  app.post("/api/posts/:id/bookmark", auth, (req, res) => {
    const p = getPost(req.params.id, req.user.id);
    if (!p) return fail(res, 404, "讨论不存在。");
    transaction(() => {
      const folder = ensureDefault(req.user.id);
      if (p.bookmarked)
        db.prepare(
          "DELETE FROM collection_items WHERE post_id=? AND collection_id IN (SELECT id FROM collections WHERE user_id=?)",
        ).run(p.id, req.user.id);
      else
        db.prepare("INSERT OR IGNORE INTO collection_items VALUES(?,?,?)").run(
          folder.id,
          p.id,
          Date.now(),
        );
      syncBookmarks(req.user.id);
    });
    res.json({ post: getPost(p.id, req.user.id) });
  });

  app.put("/api/posts/:id/later", auth, (req, res) => {
    if (!getPost(req.params.id, req.user.id)) return fail(res, 404, "讨论不存在。");
    db.prepare(
      "INSERT OR IGNORE INTO read_later(user_id,post_id,added_at) VALUES(?,?,?)",
    ).run(req.user.id, req.params.id, Date.now());
    res.json({ post: getPost(req.params.id, req.user.id) });
  });
  app.delete("/api/posts/:id/later", auth, (req, res) => {
    db.prepare("DELETE FROM read_later WHERE user_id=? AND post_id=?").run(
      req.user.id,
      req.params.id,
    );
    res.json({ post: getPost(req.params.id, req.user.id) });
  });
  app.get("/api/read-later", auth, (req, res) => {
    const params = [req.user.id];
    let inner = "r.user_id=? AND r.post_id=p.id";
    if (req.query.progress === "unread") inner += " AND r.completed_at IS NULL";
    if (req.query.progress === "read")
      inner += " AND r.completed_at IS NOT NULL";
    for (const [key, op] of [
      ["from", ">="],
      ["to", "<"],
    ]) {
      if (req.query[key] !== undefined) {
        const time = Number(req.query[key]);
        if (!Number.isFinite(time) || time < 0)
          return fail(res, 400, "请选择有效的日期。");
        inner += ` AND r.added_at${op}?`;
        params.push(time);
      }
    }
    let where = `EXISTS(SELECT 1 FROM read_later r WHERE ${inner})`;
    const minutes = "MAX(1,CAST((length(p.content)+399)/400 AS INTEGER))";
    const durations = {
      short: `${minutes}<10`,
      medium: `${minutes}>=10 AND ${minutes}<30`,
      long: `${minutes}>=30 AND ${minutes}<60`,
      extended: `${minutes}>=60`,
    };
    if (Object.hasOwn(durations, req.query.duration))
      where += " AND " + durations[req.query.duration];
    const added =
      "(SELECT added_at FROM read_later WHERE user_id=? AND post_id=p.id)";
    const order =
      req.query.sort === "oldest"
        ? added + " ASC,p.id"
        : req.query.sort === "duration"
          ? minutes + " ASC,p.id"
          : added + " DESC,p.id";
    pagePosts(
      req,
      res,
      where,
      params,
      order,
      req.query.sort === "duration" ? [] : [req.user.id],
      true,
    );
  });
  app.patch("/api/read-later", auth, (req, res) => {
    const { action, ids } = req.body || {};
    if (!["read", "unread", "remove", "clear_read", "clear_all"].includes(action))
      return fail(res, 400, "操作无效。");
    if (action === "clear_read" || action === "clear_all") {
      db.prepare(
        "DELETE FROM read_later WHERE user_id=?" +
          (action === "clear_read" ? " AND completed_at IS NOT NULL" : ""),
      ).run(req.user.id);
    } else {
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 500 ||
        ids.some((id) => typeof id !== "string")
      )
        return fail(res, 400, "请先选择文章。");
      transaction(() => {
        for (const id of new Set(ids)) {
          if (action === "remove")
            db.prepare(
              "DELETE FROM read_later WHERE user_id=? AND post_id=?",
            ).run(req.user.id, id);
          else
            db.prepare(
              "UPDATE read_later SET completed_at=? WHERE user_id=? AND post_id=?",
            ).run(action === "read" ? Date.now() : null, req.user.id, id);
        }
      });
    }
    res.json({ ok: true });
  });

  const topicWhere = (track) =>
    track.kind === "category"
      ? { sql: "p.category=?", args: [track.value] }
      : {
          sql: "(instr(lower(p.title),lower(?))>0 OR instr(lower(p.content),lower(?))>0 OR instr(lower(p.tags),lower(?))>0)",
          args: [track.value, track.value, track.value],
        };
  app.get("/api/topic-tracks", auth, (req, res) => {
    const tracks = db
      .prepare(
        "SELECT * FROM topic_tracks WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(req.user.id)
      .map((track) => {
        const condition = topicWhere(track);
        const stats = db
          .prepare(
            "SELECT COUNT(*) AS count,MAX(p.created_at) AS latest_at FROM posts p WHERE " +
              condition.sql +
              " AND " +
              visibleClause,
          )
          .get(...condition.args, req.user.id);
        return { ...track, ...stats };
      });
    res.json({ tracks });
  });
  app.post("/api/topic-tracks", auth, (req, res) => {
    const { kind = "keyword", value } = req.body || {};
    if (
      !["keyword", "category"].includes(kind) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 40 ||
      (kind === "category" && !hasCategory(value))
    )
      return fail(res, 400, "请输入 1–40 个字符的话题关键词或选择版块。");
    db.prepare("INSERT OR IGNORE INTO topic_tracks VALUES(?,?,?,?,?)").run(
      randomUUID(),
      req.user.id,
      kind,
      value.trim(),
      Date.now(),
    );
    res.status(201).json({
      track: db
        .prepare(
          "SELECT * FROM topic_tracks WHERE user_id=? AND kind=? AND value=?",
        )
        .get(req.user.id, kind, value.trim()),
    });
  });
  app.get("/api/topic-tracks/:id/posts", auth, (req, res) => {
    const track = db
      .prepare("SELECT * FROM topic_tracks WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
    if (!track) return fail(res, 404, "跟踪的话题不存在。");
    const condition = topicWhere(track);
    pagePosts(req, res, condition.sql, condition.args);
  });
  app.delete("/api/topic-tracks/:id", auth, (req, res) => {
    db.prepare("DELETE FROM topic_tracks WHERE id=? AND user_id=?").run(
      req.params.id,
      req.user.id,
    );
    res.json({ ok: true });
  });
}
