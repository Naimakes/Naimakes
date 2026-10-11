import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { dirFromEnv } from "../server/project-paths.mjs";
const data = dirFromEnv(process.env.DATA_DIR, "data");
const target = resolve(
  dirFromEnv(process.env.BACKUP_DIR, "backups"),
  new Date().toISOString().replace(/[:.]/g, "-"),
);
if (!existsSync(resolve(data, "naimakes.sqlite")))
  throw new Error("No Naimakes database exists at " + data);
mkdirSync(target, { recursive: true });
const db = new DatabaseSync(resolve(data, "naimakes.sqlite"));
await backup(db, resolve(target, "naimakes.sqlite"));
db.close();
if (existsSync(resolve(data, "uploads")))
  cpSync(resolve(data, "uploads"), resolve(target, "uploads"), {
    recursive: true,
  });
console.log("Backup complete: " + target);
