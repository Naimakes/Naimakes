import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { dirFromEnv } from "./project-paths.mjs";
import { seed, builtinCategories } from "./demo-seed.mjs";
export const dataDir = dirFromEnv(process.env.DATA_DIR, "data");
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(resolve(dataDir, "naimakes.sqlite"));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL, initials TEXT NOT NULL, bio TEXT DEFAULT '', password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', demo INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', kind TEXT NOT NULL DEFAULT 'discussion', demo INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_category_created ON posts(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at);
CREATE TABLE IF NOT EXISTS likes (user_id TEXT REFERENCES users(id) ON DELETE CASCADE, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(user_id, post_id));
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE TABLE IF NOT EXISTS bookmarks (user_id TEXT REFERENCES users(id) ON DELETE CASCADE, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS follows (user_id TEXT REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL, PRIMARY KEY(user_id, category));
CREATE TABLE IF NOT EXISTS history (user_id TEXT REFERENCES users(id) ON DELETE CASCADE, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, seen_at INTEGER NOT NULL, PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, text TEXT NOT NULL, seen INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, reason TEXT NOT NULL, created_at INTEGER NOT NULL, comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE);

PRAGMA optimize;
`);
if (
  !db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === "status")
)
  db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
db.exec(
  "CREATE TABLE IF NOT EXISTS moderation_log (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL);",
);
if (db.prepare("PRAGMA table_info(moderation_log)").all().find((c) => c.name === "actor_id")?.notnull) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE moderation_log_next (
      id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
    );
    INSERT INTO moderation_log_next SELECT * FROM moderation_log;
    DROP TABLE moderation_log;
    ALTER TABLE moderation_log_next RENAME TO moderation_log;
    COMMIT;
  `);
}
db.exec(`
CREATE TABLE IF NOT EXISTS deleted_accounts (
  id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE,
  password TEXT NOT NULL, deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_email ON deleted_accounts(email, deleted_at DESC);
`);
if (!db.prepare("PRAGMA table_info(deleted_accounts)").all().some((c) => c.name === "name"))
  db.exec("ALTER TABLE deleted_accounts ADD COLUMN name TEXT NOT NULL DEFAULT ''");
if (process.env.SEED_DEMO === "true") seed(db);
db.exec(`
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_default_collection ON collections(user_id) WHERE is_default=1;
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, added_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_post ON collection_items(post_id);
CREATE TABLE IF NOT EXISTS read_later (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL, completed_at INTEGER,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS topic_tracks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('keyword','category')), value TEXT NOT NULL,
  created_at INTEGER NOT NULL, UNIQUE(user_id, kind, value)
);
`);
if (!db.prepare("SELECT 1 FROM settings WHERE key='library_migrated'").get()) {
  db.exec(`BEGIN;
    INSERT OR IGNORE INTO collections(id,user_id,name,is_default,created_at)
      SELECT 'default-' || user_id,user_id,'默认收藏夹',1,CAST(strftime('%s','now') AS INTEGER)*1000 FROM bookmarks GROUP BY user_id;
    INSERT OR IGNORE INTO collection_items
      SELECT c.id,b.post_id,c.created_at FROM bookmarks b JOIN collections c ON c.user_id=b.user_id AND c.is_default=1;
    INSERT INTO settings VALUES('library_migrated','1');
    COMMIT;
  `);
}
db.exec(`
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('post','comment','message')),
  owner_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  url TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type,owner_id,position);
CREATE TABLE IF NOT EXISTS comment_votes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK(value IN (-1,1)),
  PRIMARY KEY(user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_votes_comment ON comment_votes(comment_id);
/* 引用：一条讨论、回复或私信可以带上站内文章的简介卡片。被引用的文章删除后，
   引用随之消失，卡片不会留下指向空白的入口。 */
CREATE TABLE IF NOT EXISTS quotes (
  owner_type TEXT NOT NULL CHECK(owner_type IN ('post','comment','message')),
  owner_id TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_type, owner_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_quotes_owner ON quotes(owner_type,owner_id,position);
/* 最近搜索与最近分享的人：每个人一份，可以逐条、批量或整组清空。 */
CREATE TABLE IF NOT EXISTS recents (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, scope, value)
);
CREATE INDEX IF NOT EXISTS idx_recents_user ON recents(user_id,scope,updated_at DESC);
`);
if (
  !db
    .prepare("PRAGMA table_info(attachments)")
    .all()
    .some((c) => c.name === "inline")
)
  db.exec(
    "ALTER TABLE attachments ADD COLUMN inline INTEGER NOT NULL DEFAULT 0",
  );
/* 图书馆：每个人上传过的文件（发帖、评论、私信附件与助手对话里的文件）。
   它独立于帖子和聊天记录：删掉帖子或对话，文件仍留在这里。
   删除是软删除：deleted_at 有值即在“已删除”里，30 天后由服务端清理。 */
db.exec(`
CREATE TABLE IF NOT EXISTS library_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',
  hash TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, url)
);
CREATE INDEX IF NOT EXISTS idx_library_files_user ON library_files(user_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_files_hash ON library_files(user_id, hash) WHERE hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_files_deleted ON library_files(deleted_at) WHERE deleted_at IS NOT NULL;
`);
if (!db.prepare("SELECT 1 FROM settings WHERE key='file_library_backfilled'").get()) {
  db.exec(`BEGIN IMMEDIATE;
    INSERT OR IGNORE INTO library_files(id,user_id,url,name,mime,size,source,created_at)
      SELECT lower(hex(randomblob(16))),user_id,url,name,mime,size,owner_type,MIN(created_at)
      FROM attachments WHERE user_id IS NOT NULL GROUP BY user_id,url;
    INSERT INTO settings VALUES('file_library_backfilled','1');
    COMMIT;
  `);
}
if (
  !db
    .prepare("PRAGMA table_info(recents)")
    .all()
    .some((c) => c.name === "pinned")
)
  db.exec("ALTER TABLE recents ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
for (const table of ["likes", "comment_votes", "follows"])
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === "created_at"))
    db.exec(`ALTER TABLE ${table} ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`);
const commentColumns = db.prepare("PRAGMA table_info(comments)").all();
if (!commentColumns.some((c) => c.name === "parent_id"))
  db.exec(
    "ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE",
  );
if (!commentColumns.some((c) => c.name === "deleted"))
  db.exec("ALTER TABLE comments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)",
);
const postColumns = db.prepare("PRAGMA table_info(posts)").all();
if (!postColumns.some((c) => c.name === "pinned"))
  db.exec("ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
for (const [column, definition] of [
  ["locked", "INTEGER NOT NULL DEFAULT 0"],
  ["lock_reason", "TEXT NOT NULL DEFAULT ''"],
])
  if (!postColumns.some((c) => c.name === column))
    db.exec(`ALTER TABLE posts ADD COLUMN ${column} ${definition}`);
const userColumns = db.prepare("PRAGMA table_info(users)").all();
for (const [column, definition] of [
  ["muted", "INTEGER NOT NULL DEFAULT 0"],
  ["muted_until", "INTEGER"],
  ["mute_reason", "TEXT NOT NULL DEFAULT ''"],
  ["avatar", "TEXT NOT NULL DEFAULT ''"],
])
  if (!userColumns.some((c) => c.name === column))
    db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
if (!postColumns.some((c) => c.name === "visibility"))
  db.exec(
    "ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
  );
if (!postColumns.some((c) => c.name === "comments_closed"))
  db.exec(
    "ALTER TABLE posts ADD COLUMN comments_closed INTEGER NOT NULL DEFAULT 0",
  );
const notificationColumns = db.prepare("PRAGMA table_info(notifications)").all();
for (const [column, definition] of [
  ["kind", "TEXT NOT NULL DEFAULT 'reply'"],
  ["actor_id", "TEXT"],
  ["pinned", "INTEGER NOT NULL DEFAULT 0"],
  ["saved", "INTEGER NOT NULL DEFAULT 0"],
])
  if (!notificationColumns.some((c) => c.name === column))
    db.exec(`ALTER TABLE notifications ADD COLUMN ${column} ${definition}`);
db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id,recipient_id,created_at);
CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(recipient_id,read_at);
/* Pin, save and "delete for me" are per-person views of a shared conversation. */
CREATE TABLE IF NOT EXISTS message_threads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  cleared_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, peer_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(user_id,actor_id);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'Orbit',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS category_moderators (
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('lead','assistant')),
  appointed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(category_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_lead ON category_moderators(category_id) WHERE role='lead';
/* 版块成员。在版块里发过帖或留过言的人自动入列，其他人也可以主动加入、随时退出。 */
CREATE TABLE IF NOT EXISTS category_members (
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'joined',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(category_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_category_members_user ON category_members(user_id);
/* 被版主或站主移出版块的记录，进入站主的回收站，站主可以撤回或忽略。
   status: pending 待处理 / undone 已撤回 / ignored 已忽略 / rejoined 本人已重新加入 / replaced 有更新的一条 */
CREATE TABLE IF NOT EXISTS board_member_removals (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  removed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  previous_source TEXT NOT NULL DEFAULT 'joined',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_member_removals_pending ON board_member_removals(status, created_at);
`);
if (!db.prepare("SELECT 1 FROM settings WHERE key='builtin_boards_seeded'").get()) {
  const insert = db.prepare(
    "INSERT INTO categories(id,name,en,description,icon,builtin,position,created_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET builtin=1,position=excluded.position",
  );
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    builtinCategories.forEach((c, i) =>
      insert.run(c.id, c.name, c.en, c.description, c.icon, i, now),
    );
    db.prepare("INSERT INTO settings(key,value) VALUES('builtin_boards_seeded','1')").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
db.exec(`
INSERT OR IGNORE INTO category_members(category_id,user_id,source,created_at)
  SELECT p.category,p.author_id,'posted',MIN(p.created_at)
    FROM posts p JOIN categories c ON c.id=p.category
    GROUP BY p.category,p.author_id;
INSERT OR IGNORE INTO category_members(category_id,user_id,source,created_at)
  SELECT p.category,m.author_id,'posted',MIN(m.created_at)
    FROM comments m JOIN posts p ON p.id=m.post_id JOIN categories c ON c.id=p.category
    WHERE m.deleted=0
    GROUP BY p.category,m.author_id;
`);
db.exec(`
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(follower_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_target ON user_follows(target_id, created_at DESC);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  banner TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT '{}',
  modules TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
/* 新访客：谁来看过我的主页。一个人只留最近的一次，所以这张表不会随浏览次数长大。 */
CREATE TABLE IF NOT EXISTS profile_visits (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_visits ON profile_visits(owner_id, visited_at DESC);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS notify_subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('author','board')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_notify_subscriptions_target ON notify_subscriptions(kind, target_id);
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
`);
for (const [column, definition] of [
  ["dedupe_key", "TEXT"],
  ["meta", "TEXT NOT NULL DEFAULT '{}'"],
])
  if (!db.prepare("PRAGMA table_info(notifications)").all().some((c) => c.name === column))
    db.exec(`ALTER TABLE notifications ADD COLUMN ${column} ${definition}`);
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL",
);
if (!db.prepare("PRAGMA table_info(reports)").all().some((c) => c.name === "comment_id")) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE reports_next (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE
    );
    INSERT INTO reports_next(id,user_id,post_id,reason,created_at) SELECT id,user_id,post_id,reason,created_at FROM reports;
    DROP TABLE reports;
    ALTER TABLE reports_next RENAME TO reports;
    COMMIT;
  `);
}
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_target ON reports(user_id, post_id, IFNULL(comment_id,''));
CREATE INDEX IF NOT EXISTS idx_reports_comment ON reports(comment_id) WHERE comment_id IS NOT NULL;
/* 禁言申诉：被禁言的人写给站主的一封信。同一时间只保留一封待处理的。 */
CREATE TABLE IF NOT EXISTS mute_appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','closed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolver_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mute_appeals_pending ON mute_appeals(user_id) WHERE status='pending';
`);
const addColumns = (table, columns) => {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [column, definition] of columns)
    if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};
const softDelete = [
  ["deleted_at", "INTEGER"],
  ["deleted_by", "TEXT"],
  ["delete_reason", "TEXT NOT NULL DEFAULT ''"],
];
addColumns("posts", softDelete);
addColumns("comments", softDelete);
addColumns("users", softDelete);
addColumns("categories", [
  ...softDelete,
  ["muted", "INTEGER NOT NULL DEFAULT 0"],
  ["muted_until", "INTEGER"],
  ["mute_reason", "TEXT NOT NULL DEFAULT ''"],
]);
db.exec(`
UPDATE comments SET deleted_at=COALESCE(deleted_at, created_at) WHERE deleted=1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id, created_at DESC);

/* 处罚记录。users / categories 上的 muted 字段只是当前状态的镜像，来龙去脉都在这里。
   同一对象同一时间只有一条生效中的禁言：延长、改期、升级为永久都是改这一条。 */
CREATE TABLE IF NOT EXISTS penalties (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('user','board')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','lifted')),
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  case_id TEXT,
  ended_at INTEGER,
  ended_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  end_reason TEXT NOT NULL DEFAULT '',
  changes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_penalties_active ON penalties(target_type, target_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_penalties_expiry ON penalties(ends_at) WHERE status='active' AND ends_at IS NOT NULL;

/* 申诉：用户针对自己的禁言、版主针对版块的禁言。一次处罚同一时间只有一封待处理的申诉。 */
CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  penalty_id TEXT NOT NULL REFERENCES penalties(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('user','board')),
  target_id TEXT NOT NULL,
  applicant_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','closed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolve_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appeals_pending ON appeals(penalty_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_appeals_target ON appeals(target_type, target_id, created_at DESC);

/* 投诉。同一对象未处理的投诉归入同一个案件，处理一次，全部结案；
   案件和每一条投诉都存下提交当时的内容快照，原内容被改、被删都不影响审核。 */
CREATE TABLE IF NOT EXISTS complaint_cases (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('user','post','comment','board')),
  target_id TEXT NOT NULL,
  post_id TEXT,
  board_id TEXT,
  subject_id TEXT,
  snapshot TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  action TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolver_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaint_cases_open ON complaint_cases(target_type, target_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_complaint_cases_list ON complaint_cases(target_type, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES complaint_cases(id) ON DELETE CASCADE,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_once ON complaints(case_id, reporter_id);

/* 管理员删除申请：一次申请只对应一个对象、一次删除。 */
CREATE TABLE IF NOT EXISTS delete_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('user','post','comment','board')),
  target_id TEXT NOT NULL,
  case_id TEXT,
  snapshot TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','void')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolve_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delete_requests_pending ON delete_requests(target_type, target_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_delete_requests_list ON delete_requests(status, created_at DESC);
`);
addColumns("moderation_log", [
  ["actor_role", "TEXT NOT NULL DEFAULT ''"],
  ["target_type", "TEXT NOT NULL DEFAULT ''"],
  ["target_label", "TEXT NOT NULL DEFAULT ''"],
  ["before_state", "TEXT NOT NULL DEFAULT ''"],
  ["after_state", "TEXT NOT NULL DEFAULT ''"],
  ["reason", "TEXT NOT NULL DEFAULT ''"],
  ["needs_approval", "INTEGER NOT NULL DEFAULT 0"],
  ["approver_id", "TEXT"],
  ["approval_result", "TEXT NOT NULL DEFAULT ''"],
  ["notified", "INTEGER NOT NULL DEFAULT 0"],
  ["ref_id", "TEXT"],
]);
db.exec(`
CREATE INDEX IF NOT EXISTS idx_moderation_log_created ON moderation_log(created_at DESC);
CREATE TRIGGER IF NOT EXISTS moderation_log_append_only_delete BEFORE DELETE ON moderation_log
BEGIN SELECT RAISE(ABORT, 'moderation log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS moderation_log_append_only_update BEFORE UPDATE ON moderation_log
WHEN NEW.id IS NOT OLD.id OR NEW.action IS NOT OLD.action OR NEW.target_id IS NOT OLD.target_id
  OR NEW.detail IS NOT OLD.detail OR NEW.created_at IS NOT OLD.created_at
  OR NEW.actor_role IS NOT OLD.actor_role OR NEW.target_type IS NOT OLD.target_type
  OR NEW.target_label IS NOT OLD.target_label OR NEW.before_state IS NOT OLD.before_state
  OR NEW.after_state IS NOT OLD.after_state OR NEW.reason IS NOT OLD.reason
  OR NEW.needs_approval IS NOT OLD.needs_approval OR NEW.approver_id IS NOT OLD.approver_id
  OR NEW.approval_result IS NOT OLD.approval_result OR NEW.notified IS NOT OLD.notified
  OR NEW.ref_id IS NOT OLD.ref_id
  OR (NEW.actor_id IS NOT OLD.actor_id AND NEW.actor_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'moderation log is append-only'); END;

/* 操作记录的「删除」与「清空」只作用于查看者自己的列表，原始日志不受影响。 */
CREATE TABLE IF NOT EXISTS moderation_log_hidden (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_id TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, log_id)
);
CREATE TABLE IF NOT EXISTS moderation_log_cleared (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cleared_at INTEGER NOT NULL
);
`);
addColumns("notifications", [
  ["important", "INTEGER NOT NULL DEFAULT 0"],
  ["ref_type", "TEXT NOT NULL DEFAULT ''"],
  ["ref_id", "TEXT NOT NULL DEFAULT ''"],
  ["state", "TEXT NOT NULL DEFAULT ''"],
]);
db.exec(`
UPDATE notifications SET important=1 WHERE kind='moderation' AND important=0 AND pinned=1;
CREATE INDEX IF NOT EXISTS idx_notifications_ref ON notifications(ref_type, ref_id) WHERE ref_id<>'';
`);
if (!db.prepare("SELECT 1 FROM settings WHERE key='governance_migrated'").get()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = Date.now();
    for (const u of db.prepare("SELECT id,muted_until,mute_reason FROM users WHERE muted=1").all()) {
      const id = "legacy-" + u.id;
      db.prepare(
        "INSERT OR IGNORE INTO penalties(id,target_type,target_id,reason,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,'active',?)",
      ).run(id, "user", u.id, u.mute_reason || "", now, u.muted_until ?? null, now);
      for (const a of db.prepare("SELECT * FROM mute_appeals WHERE user_id=? AND status='pending'").all(u.id))
        db.prepare(
          "INSERT OR IGNORE INTO appeals(id,penalty_id,target_type,target_id,applicant_id,reason,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)",
        ).run(a.id, id, "user", u.id, u.id, a.reason, a.created_at);
    }
    const legacy = db
      .prepare(
        `SELECT r.*,p.title,p.excerpt,p.content AS post_content,p.category,p.author_id AS post_author,
           c.content AS comment_content,c.author_id AS comment_author,c.parent_id
         FROM reports r JOIN posts p ON p.id=r.post_id LEFT JOIN comments c ON c.id=r.comment_id
         ORDER BY r.created_at`,
      )
      .all();
    for (const r of legacy) {
      const type = r.comment_id ? "comment" : "post";
      const target = r.comment_id || r.post_id;
      const subject = r.comment_id ? r.comment_author : r.post_author;
      const author = db.prepare("SELECT id,name FROM users WHERE id=?").get(subject);
      const board = db.prepare("SELECT id,name FROM categories WHERE id=?").get(r.category);
      const snapshot = JSON.stringify({
        title: r.title,
        content: r.comment_id ? r.comment_content || "" : r.post_content,
        author: author ? { id: author.id, name: author.name } : null,
        board: board ? { id: board.id, name: board.name } : null,
        post: { id: r.post_id, title: r.title },
        reply: !!r.parent_id,
        captured_at: r.created_at,
      });
      let kase = db
        .prepare("SELECT id FROM complaint_cases WHERE target_type=? AND target_id=? AND status='pending'")
        .get(type, target);
      if (!kase) {
        kase = { id: "legacy-" + r.id };
        db.prepare(
          `INSERT INTO complaint_cases(id,target_type,target_id,post_id,board_id,subject_id,snapshot,opened_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        ).run(kase.id, type, target, r.post_id, r.category, subject, snapshot, r.created_at, r.created_at);
      }
      db.prepare(
        "INSERT OR IGNORE INTO complaints(id,case_id,reporter_id,category,detail,snapshot,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(r.id, kase.id, r.user_id, "other", r.reason, snapshot, r.created_at);
    }
    db.exec("DELETE FROM reports");
    db.prepare("INSERT INTO settings VALUES('governance_migrated','1')").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
addColumns("posts", [["format", "TEXT NOT NULL DEFAULT 'markdown'"]]);
addColumns("messages", [["share", "TEXT NOT NULL DEFAULT ''"]]);
addColumns("profiles", [["banner_mobile", "TEXT NOT NULL DEFAULT ''"]]);
db.exec(`
CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY(post_id, viewer)
);
CREATE INDEX IF NOT EXISTS idx_post_views_time ON post_views(post_id, viewed_at);
CREATE TABLE IF NOT EXISTS post_follows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_post_follows_post ON post_follows(post_id, created_at);
`);
if (!db.prepare("SELECT 1 FROM settings WHERE key='post_views_backfilled'").get()) {
  db.exec(`BEGIN IMMEDIATE;
    INSERT OR IGNORE INTO post_views(post_id,viewer,viewed_at)
      SELECT h.post_id,'u:' || h.user_id,h.seen_at FROM history h JOIN posts p ON p.id=h.post_id;
    INSERT OR IGNORE INTO post_views(post_id,viewer,viewed_at)
      SELECT l.post_id,'u:' || l.user_id,MAX(p.created_at,l.created_at) FROM likes l JOIN posts p ON p.id=l.post_id;
    INSERT OR IGNORE INTO post_views(post_id,viewer,viewed_at)
      SELECT c.post_id,'u:' || c.author_id,MIN(c.created_at) FROM comments c GROUP BY c.post_id,c.author_id;
    INSERT OR IGNORE INTO post_views(post_id,viewer,viewed_at)
      SELECT i.post_id,'u:' || c.user_id,MIN(i.added_at) FROM collection_items i JOIN collections c ON c.id=i.collection_id GROUP BY i.post_id,c.user_id;
    DELETE FROM post_views WHERE viewer IN (SELECT 'u:' || author_id FROM posts p WHERE p.id=post_views.post_id);
    INSERT INTO settings VALUES('post_views_backfilled','1');
    COMMIT;
  `);
}
db.exec("PRAGMA user_version=16");
