import { defineConfig } from "vite";
import { resolve } from "node:path";

// base "./" so the build works on GitHub Pages under /<repo>/
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        calibrate: resolve(__dirname, "calibrate.html"),
      },
    },
  },
});
