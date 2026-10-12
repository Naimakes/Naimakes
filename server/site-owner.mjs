import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fromRoot } from "./project-paths.mjs";
import { db } from "./database.mjs";
import { BUILT_IN_OWNER } from "./built-in-owner.mjs";
export function ownerBootstrapPath() {
  const path = process.env.OWNER_BOOTSTRAP_FILE
    ? resolve(process.env.OWNER_BOOTSTRAP_FILE)
    : fromRoot("secrets/owner.json");
  return existsSync(path) ? path : null;
}
export function provisionOwner() {
  const path = ownerBootstrapPath();
  const config = path
    ? JSON.parse(readFileSync(path, "utf8"))
    : BUILT_IN_OWNER;
  if (
    !/^[a-zA-Z0-9_-]{2,32}$/.test(config.id) ||
    typeof config.email !== "string" ||
    !config.email.includes("@") ||
    !/^([0-9a-f]{32}):([0-9a-f]{128})$/.test(config.passwordHash)
  )
    throw new Error("Owner bootstrap configuration is invalid.");
  const existing = db
    .prepare("SELECT id,email,role FROM users WHERE id=? OR email=?")
    .all(config.id, config.email);
  if (
    existing.length &&
    (existing.length !== 1 ||
      existing[0].id !== config.id ||
      existing[0].email.toLowerCase() !== config.email.toLowerCase())
  )
    throw new Error(
      "Owner account conflicts with an existing account. Resolve on the server.",
    );
  const saved = db
    .prepare("SELECT value FROM settings WHERE key='owner_id'")
    .get();
  if (saved && saved.value !== config.id)
    throw new Error("A different site owner already exists.");
  if (!existing.length) {
    db.prepare(
      "INSERT INTO users(id,email,name,initials,bio,password,role,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      config.id,
      config.email.toLowerCase(),
      config.id,
      "NM",
      "Naimakes 论坛站主 · 保持好奇，让未来发生。",
      config.passwordHash,
      "owner",
      Date.now(),
    );
  } else
    db.prepare("UPDATE users SET role='owner',status='active' WHERE id=?").run(
      config.id,
    );
  db.prepare("INSERT OR REPLACE INTO settings VALUES('owner_id',?)").run(
    config.id,
  );
  publishWelcomePost(config.id);
}
const welcomeContent = `欢迎来到 Naimakes。

这里是一个围绕未来展开讨论的社区：人工智能、太空、生命科学、能源，以及每个人正在亲手做出来的东西。

## 你可以在这里做什么

- 读到不同领域的人对同一个问题的看法；
- 发出一个尚未成形的想法，让更多人帮你把它想清楚；
- 公开构建你的项目，邀请别人一起参与。

> 好的讨论，不必立即得到同一个答案，但可以让彼此提出更好的问题。

保持好奇，让未来发生。

—— Naimakes 站主`;
function publishWelcomePost(ownerId) {
  if (db.prepare("SELECT 1 FROM settings WHERE key='welcome_post'").get()) return;
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT OR IGNORE INTO posts(id,author_id,category,title,excerpt,content,tags,kind,pinned,created_at) VALUES('welcome',?,?,?,?,?,?,'discussion',1,?)",
    ).run(
      ownerId,
      "human",
      "欢迎来到 Naimakes",
      "这里是一个围绕未来展开讨论的社区。读不同领域的人怎么想，发出你还没成形的想法，或者公开构建你的项目。",
      welcomeContent,
      JSON.stringify(["欢迎", "社区"]),
      Date.now(),
    );
    db.prepare("INSERT INTO settings VALUES('welcome_post','welcome')").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
