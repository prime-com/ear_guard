import { defineConfig } from "vite";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const build = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

// base "./" so the build works on GitHub Pages under /<repo>/
export default defineConfig({
  base: "./",
  define: { __BUILD__: JSON.stringify(build) },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        calibrate: resolve(__dirname, "calibrate.html"),
        health: resolve(__dirname, "health.html"),
      },
    },
  },
});
