import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, cpSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const source = process.argv[2] && resolve(process.argv[2]);
const target = process.argv[3] && resolve(process.argv[3]);
if (!source || !target || source === target)
  throw new Error("Usage: node scripts/import-data.mjs /path/to/source-data /path/to/empty-target-data");
if (!existsSync(join(source, "naimakes.sqlite")))
  throw new Error("Source naimakes.sqlite is missing.");
if (existsSync(join(target, "naimakes.sqlite")) || (existsSync(join(target, "uploads")) && readdirSync(join(target, "uploads")).length))
  throw new Error("Target already contains data; refusing to overwrite it. Use the documented backup/restore procedure for an existing server.");

mkdirSync(target, { recursive: true });
const staging = mkdtempSync(join(target, ".import-"));
try {
  const database = new DatabaseSync(join(source, "naimakes.sqlite"), { readOnly: true });
  try {
    const result = database.prepare("PRAGMA quick_check").get();
    if (result?.quick_check !== "ok") throw new Error("Source database integrity check failed.");
    await backup(database, join(staging, "naimakes.sqlite"));
  } finally {
    database.close();
  }
  const sourceUploads = join(source, "uploads");
  if (existsSync(sourceUploads)) cpSync(sourceUploads, join(staging, "uploads"), { recursive: true });
  else mkdirSync(join(staging, "uploads"));
  if (existsSync(join(target, "uploads"))) rmdirSync(join(target, "uploads"));
  renameSync(join(staging, "uploads"), join(target, "uploads"));
  renameSync(join(staging, "naimakes.sqlite"), join(target, "naimakes.sqlite"));
  console.log("Initial data import complete. Existing accounts, posts and uploads were preserved.");
} finally {
  rmSync(staging, { recursive: true, force: true });
}
