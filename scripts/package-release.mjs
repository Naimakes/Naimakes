import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { verifyProductionBuild } from "./verify-build.mjs";
import { BUILT_IN_OWNER } from "../server/built-in-owner.mjs";

const requiredFiles = [
  "package.json", "package-lock.json", "index.html", "landing.html",
  "tsconfig.json", "vite.config.ts", "Dockerfile", "compose.yaml", "Caddyfile",
  ".env.example", ".gitignore", ".dockerignore",
];
const requiredDirectories = ["src", "public", "server", "scripts", "dist"];
const excluded = (name) => name === ".DS_Store" || name.startsWith("._") ||
  (name.startsWith(".env") && name !== ".env.example") ||
  ["node_modules", ".git", ".openai", ".claude", "secrets", "backups"].includes(name) ||
  /\.(?:sqlite(?:-wal|-shm)?|db|zip|tsbuildinfo|log)$/i.test(name);

function copyTree(source, target, filter = true) {
  if (filter && excluded(basename(source))) return;
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Release files must not be symbolic links: ${source}`);
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: 0o755 });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name), filter);
  } else if (stat.isFile()) {
    copyFileSync(source, target);
    chmodSync(target, 0o644);
  } else throw new Error(`Unsupported release file: ${source}`);
}

function tableCounts(database) {
  return Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, database.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count]));
}

function verifyUploadedReferences(database, uploads) {
  const referenced = new Set();
  for (const { name } of database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const row of database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).iterate()) {
      for (const value of Object.values(row)) {
        if (typeof value !== "string" || !value.includes("/uploads/")) continue;
        for (const match of value.matchAll(/\/uploads\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/g)) referenced.add(match[1]);
      }
    }
  }
  const missing = [...referenced].filter((file) => !existsSync(join(uploads, file)));
  if (missing.length) throw new Error(`Data references ${missing.length} missing upload(s): ${missing.join(", ")}`);
  return referenced.size;
}

async function snapshotData(source, destination, ownerFile) {
  if (!existsSync(join(source, "naimakes.sqlite"))) throw new Error("--with-data requires an existing naimakes.sqlite database.");
  const hasOwnerFile = existsSync(ownerFile);
  const owner = hasOwnerFile ? JSON.parse(readFileSync(ownerFile, "utf8")) : BUILT_IN_OWNER;
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(owner.id) || typeof owner.email !== "string" || !owner.email.includes("@") || !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(owner.passwordHash))
    throw new Error("The private owner bootstrap file is invalid.");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const sourceDatabase = new DatabaseSync(join(source, "naimakes.sqlite"), { readOnly: true });
  let sourceCounts;
  try {
    if (sourceDatabase.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error("Source database integrity check failed.");
    sourceCounts = tableCounts(sourceDatabase);
    await backup(sourceDatabase, join(destination, "naimakes.sqlite"));
  } finally { sourceDatabase.close(); }
  const uploadSource = join(source, "uploads");
  const uploadTarget = join(destination, "uploads");
  if (existsSync(uploadSource)) copyTree(uploadSource, uploadTarget, false);
  else mkdirSync(uploadTarget);
  const snapshot = new DatabaseSync(join(destination, "naimakes.sqlite"));
  let snapshotCounts, referencedUploads;
  try {
    if (snapshot.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database contains broken references; repair before delivery.");
    const savedOwner = snapshot.prepare("SELECT id,email,role FROM users WHERE id=?").get(owner.id);
    if (!savedOwner || savedOwner.email.toLowerCase() !== owner.email.toLowerCase() || savedOwner.role !== "owner")
      throw new Error("Owner initialization does not match the existing site owner.");
    if (sourceCounts.sessions !== undefined) snapshot.exec("DELETE FROM sessions");
    referencedUploads = verifyUploadedReferences(snapshot, uploadTarget);
    snapshot.exec("PRAGMA journal_mode=DELETE; VACUUM;");
    if (snapshot.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error("Release snapshot integrity check failed.");
    snapshotCounts = tableCounts(snapshot);
  } finally { snapshot.close(); }
  chmodSync(join(destination, "naimakes.sqlite"), 0o600);
  if (hasOwnerFile) {
    const secretDirectory = join(dirname(destination), "secrets");
    mkdirSync(secretDirectory, { mode: 0o700 });
    copyFileSync(ownerFile, join(secretDirectory, "owner.json"));
    chmodSync(join(secretDirectory, "owner.json"), 0o644);
  }
  return { sourceCounts, snapshotCounts, referencedUploads, browserSessionsRemovedFromCopy: sourceCounts.sessions || 0 };
}

async function packageRelease({ projectRoot = process.cwd(), output, includeData = false, dataDirectory, ownerFile } = {}) {
  const root = resolve(projectRoot);
  const archive = resolve(output || join(root, "releases", `Naimakes-${new Date().toISOString().slice(0, 10)}${includeData ? "-private" : "-source"}.zip`));
  if (!archive.endsWith(".zip")) throw new Error("Release output must end with .zip.");
  if (existsSync(archive)) throw new Error(`Release already exists; choose another output filename: ${archive}`);
  if (spawnSync("zip", ["-v"], { stdio: "ignore" }).status !== 0)
    throw new Error("The zip command is required. Install zip on Linux or use the built-in macOS command.");
  const build = verifyProductionBuild(root);
  if (build.errors.length) throw new Error(build.errors.join("\n"));
  for (const file of [...requiredFiles, ...requiredDirectories])
    if (!existsSync(join(root, file))) throw new Error(`Complete project file is missing: ${file}`);
  const staging = mkdtempSync(join(tmpdir(), "naimakes-release-"));
  const packageRoot = join(staging, "Naimakes");
  mkdirSync(packageRoot);
  let temporaryArchive;
  try {
    for (const file of requiredFiles) copyTree(join(root, file), join(packageRoot, file));
    for (const directory of requiredDirectories)
      if (existsSync(join(root, directory))) copyTree(join(root, directory), join(packageRoot, directory));
    let data;
    if (includeData)
      data = await snapshotData(resolve(dataDirectory || join(root, "data")), join(packageRoot, "data"), resolve(ownerFile || join(root, "secrets/owner.json")));
    const fileChecksums = {};
    const checksumFiles = (directory) => {
      for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name);
        if (lstatSync(path).isDirectory()) checksumFiles(path);
        else fileChecksums[relative(packageRoot, path).replaceAll("\\", "/")] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    };
    checksumFiles(packageRoot);
    const manifest = { createdAt: new Date().toISOString(), node: process.versions.node, privateDataIncluded: includeData, data, sha256: fileChecksums };
    writeFileSync(join(packageRoot, "RELEASE_MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
    mkdirSync(dirname(archive), { recursive: true });
    temporaryArchive = join(dirname(archive), `.${basename(archive)}.${process.pid}.tmp.zip`);
    const zipped = spawnSync("zip", ["-q", "-X", "-r", temporaryArchive, "Naimakes"], { cwd: staging, encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
    if (zipped.status !== 0) throw new Error(`ZIP creation failed: ${zipped.stderr || zipped.error?.message || zipped.status}`);
    const verified = spawnSync("unzip", ["-tq", temporaryArchive], { encoding: "utf8" });
    if (verified.error?.code === "ENOENT") throw new Error("The unzip command is required to verify the release archive.");
    if (verified.status !== 0) throw new Error(`ZIP integrity check failed: ${verified.stdout} ${verified.stderr}`);
    if (includeData) chmodSync(temporaryArchive, 0o600);
    renameSync(temporaryArchive, archive);
    return { archive, sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"), files: Object.keys(fileChecksums).length + 1, data };
  } finally {
    rmSync(staging, { recursive: true, force: true });
    if (temporaryArchive) rmSync(temporaryArchive, { force: true });
  }
}

try {
  const options = { dataDirectory: process.env.DATA_DIR, ownerFile: process.env.OWNER_BOOTSTRAP_FILE };
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--with-data") options.includeData = true;
    else if (args[i] === "--output" && args[i + 1]) options.output = args[++i];
    else throw new Error("Usage: npm run package:release -- [--with-data] [--output /path/to/release.zip]");
  }
  console.log(JSON.stringify(await packageRelease(options), null, 2));
} catch (error) {
  console.error(`Release not created: ${error.message}`);
  process.exitCode = 1;
}
