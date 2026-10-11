import { spawn } from "node:child_process";
const server = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", "--watch", "server/api-server.mjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "3001",
      NODE_ENV: "development",
      COOKIE_SECURE: "false",
      APP_ORIGIN: "http://localhost:5173",
    },
  },
);
const client = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});
const stop = () => {
  server.kill();
  client.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", stop);
client.on("exit", stop);
