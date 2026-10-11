import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fromRoot } from "../server/project-paths.mjs";
const id = process.argv[2];
const email = process.argv[3];
if (
  !id ||
  !email ||
  !/^[a-zA-Z0-9_-]{2,32}$/.test(id) ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
) {
  console.error("Usage: npm run create-site-owner -- ID email@example.com");
  process.exit(1);
}
const target = fromRoot("secrets/owner.json");
if (existsSync(target)) {
  console.error("Owner configuration already exists; refusing to replace it.");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error(
    "Run this command in an interactive terminal. The password will not be echoed.",
  );
  process.exit(1);
}
process.stdout.write("Owner password (hidden): ");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
let password = "";
await new Promise((done) => {
  process.stdin.on("data", function input(chunk) {
    for (const ch of chunk) {
      if (ch === "\u0003") {
        process.stdin.setRawMode(false);
        process.exit(1);
      }
      if (ch === "\r" || ch === "\n") {
        process.stdin.removeListener("data", input);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        done();
        return;
      }
      if (ch === "\u007f") password = password.slice(0, -1);
      else if (ch >= " ") password += ch;
    }
  });
});
process.stdout.write("\n");
if (password.length < 8 || password.length > 128) {
  console.error("Password must be 8–128 characters.");
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = await promisify(scrypt)(password, salt, 64);
password = "";
mkdirSync(fromRoot("secrets"), { recursive: true, mode: 0o700 });
writeFileSync(
  target,
  JSON.stringify(
    {
      id,
      email: email.toLowerCase(),
      passwordHash: salt + ":" + hash.toString("hex"),
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
const { provisionOwner } = await import("../server/site-owner.mjs");
provisionOwner();
console.log("Site owner created. Only a salted password hash is stored.");
