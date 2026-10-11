import { db } from "../server/database.mjs";
const command = process.argv[2];
const email = process.argv[3] || process.env.ADMIN_EMAIL;
if (!["promote", "demote"].includes(command) || !email) {
  console.error(
    "Usage: npm run set-admin-role -- promote|demote email@example.com",
  );
  process.exit(1);
}
const user = db
  .prepare("SELECT id,name,email,demo,role FROM users WHERE email=?")
  .get(email);
if (!user || user.demo || user.role === "owner") {
  console.error(
    "Register a real account first, then run this command from the server.",
  );
  process.exit(1);
}
db.prepare("UPDATE users SET role=? WHERE id=?").run(
  command === "promote" ? "admin" : "member",
  user.id,
);
console.log(
  `${user.name} (${user.email}): ${command === "promote" ? "administrator" : "member"}`,
);
db.close();
