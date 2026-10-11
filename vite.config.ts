import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

function rollingNumberMeasure(): Plugin {
  const before = "S={width:M.width/s,height:M.height/o};this.sizes.set(y,S)";
  const after = "S={width:parseFloat(t.getComputedStyle(y).width),height:parseFloat(t.getComputedStyle(y).height)};this.sizes.set(y,S)";
  let found = false;
  return {
    name: "rolling-number-measure",
    transform(code, id) {
      if (!id.includes("@kitlangton/rolling-number")) return;
      if (code.includes(after)) found = true;
      if (!code.includes(before)) return;
      found = true;
      return code.replace(before, after);
    },
    buildEnd() {
      if (!found && !this.meta.watchMode) this.error("@kitlangton/rolling-number changed; update the measurement patch in vite.config.ts.");
    },
  };
}

export default defineConfig({
  plugins: [react(), rollingNumberMeasure()],
  optimizeDeps: { exclude: ["@kitlangton/rolling-number"] },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/uploads": "http://127.0.0.1:3001",
    },
  },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        landing: resolve(__dirname, "landing.html"),
      },
      output: {
        manualChunks: {
          three: ["three"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
