import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fromRoot, projectRoot, dirFromEnv } from "../server/project-paths.mjs";
import { BUILT_IN_OWNER } from "../server/built-in-owner.mjs";
import { verifyProductionBuild } from "./verify-build.mjs";

const flag = process.argv.slice(2).find((a) => a.startsWith("--"))?.slice(2);
const mode = ["docker", "proxy"].includes(flag)
  ? flag
  : existsSync(fromRoot("compose.yaml")) && process.env.DOMAIN
    ? "docker"
    : "proxy";

let failed = false;
function check(ok, label, remedy) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && remedy ? ` — ${remedy}` : ""}`);
  if (!ok) failed = true;
}
const warn = (ok, label, remedy) =>
  console.log(`${ok ? "PASS" : "WARN"} ${label}${!ok && remedy ? ` — ${remedy}` : ""}`);

console.log(`Naimakes deployment preflight (${mode} mode)`);
console.log(`Project directory: ${projectRoot}`);

check(
  Number(process.versions.node.split(".")[0]) >= 24,
  `Node.js 24+ (found ${process.versions.node})`,
  "本项目使用 Node 内置的 node:sqlite，请安装 Node.js 24 或更高版本。",
);
let sqliteOk = true;
try {
  await import("node:sqlite");
} catch {
  sqliteOk = false;
}
check(sqliteOk, "node:sqlite is available", "升级到 Node.js 24+；Node 18 / 20 / 22 无法运行本项目。");

for (const file of ["package.json", "server/api-server.mjs", "dist/index.html", "dist/landing.html", "dist/loading-screen.js"])
  check(
    existsSync(fromRoot(file)),
    file,
    file.startsWith("dist/") ? "运行 npm run build 生成生产构建。" : "请在完整的项目目录内运行本命令。",
  );
if (mode === "docker")
  for (const file of ["compose.yaml", "Caddyfile", "Dockerfile"])
    check(existsSync(fromRoot(file)), file, "请在完整的项目目录内运行本命令。");

if (existsSync(fromRoot("dist/index.html"))) {
  const build = verifyProductionBuild(projectRoot);
  check(
    build.errors.length === 0,
    `Production resource references (${build.files.length} files)`,
    build.errors.join("; "),
  );
}

const ownerPath = process.env.OWNER_BOOTSTRAP_FILE
  ? resolve(process.env.OWNER_BOOTSTRAP_FILE)
  : fromRoot("secrets/owner.json");
const ownerFromFile = existsSync(ownerPath);
check(
  ownerFromFile ||
    /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(BUILT_IN_OWNER.passwordHash),
  ownerFromFile ? "Owner bootstrap file exists" : "Built-in site owner is configured",
  "检查 server/site-owner.mjs 里的 BUILT_IN_OWNER。",
);
if (ownerFromFile) {
  try {
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    check(
      /^[a-zA-Z0-9_-]{2,32}$/.test(owner.id) &&
        typeof owner.email === "string" &&
        owner.email.includes("@") &&
        /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(owner.passwordHash),
      "Owner bootstrap format",
      "恢复完整的站主初始化文件。",
    );
    const worldReadable = (statSync(ownerPath).mode & 0o004) !== 0;
    if (mode === "docker")
      check(worldReadable, "Compose can read the mounted owner secret", "chmod 700 secrets && chmod 644 secrets/owner.json");
    else warn(!worldReadable, "Owner secret is not world-readable", "chmod 600 " + ownerPath);
  } catch {
    check(false, "Owner bootstrap can be parsed", "恢复完整的站主初始化文件。");
  }
}

const dataDir = dirFromEnv(process.env.DATA_DIR, "data");
try {
  if (existsSync(dataDir)) {
    accessSync(dataDir, constants.W_OK);
    check(true, `Data directory is writable (${dataDir})`);
  } else warn(false, `Data directory does not exist yet (${dataDir})`, "首次启动时会自动创建；请确认上级目录可写。");
} catch {
  check(false, `Data directory is writable (${dataDir})`, `chown -R $(whoami) ${dataDir}`);
}

let origin;
try {
  origin = new URL(process.env.APP_ORIGIN || "");
} catch {
}
check(
  !!origin && (origin.protocol === "https:" || origin.protocol === "http:") && origin.pathname === "/" && !origin.search && !origin.hash,
  "APP_ORIGIN is a bare site origin",
  "在 .env 里设置 APP_ORIGIN=https://你的域名，结尾不要带路径。",
);
const secureCookies = process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false");
check(
  !secureCookies || !origin || origin.protocol === "https:",
  "Secure cookies match the site protocol",
  "站点是 HTTPS 时保持 COOKIE_SECURE=true；确实只能用 HTTP 时，APP_ORIGIN 用 http:// 并设置 COOKIE_SECURE=false，否则无法登录。",
);
warn(
  !origin || origin.protocol === "https:",
  "Site is served over HTTPS",
  "公网站点请配置证书后改用 https://；HTTP 下密码与会话都是明文传输。",
);

if (mode === "docker") {
  const domain = process.env.DOMAIN || "";
  check(
    !!domain && !domain.includes("://") && !domain.includes("your-domain"),
    "DOMAIN is configured",
    "复制 .env.example 为 .env，把 DOMAIN 填成不带 https:// 的域名。",
  );
  check(!!origin && origin.host === domain, "APP_ORIGIN matches DOMAIN", "APP_ORIGIN 应当是 https:// 加上与 DOMAIN 完全相同的域名。");
  check(!!process.env.ADMIN_EMAIL, "ADMIN_EMAIL is configured", "在 .env 里设置 ADMIN_EMAIL。");
}

console.log(
  "本命令只检查本机文件与配置。DNS 解析、端口放行、反向代理、HTTPS 证书和真实服务器上的运行结果，仍需在服务器上验证。",
);
process.exitCode = failed ? 1 : 0;
