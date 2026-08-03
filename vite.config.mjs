import { resolve } from "node:path";
import { defineConfig } from "vite";
import { SUPPORTED_ROUTES } from "./scripts/project-config.mjs";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "./",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve("index.html"),
        ...Object.fromEntries(
          SUPPORTED_ROUTES.map((route) => [
            route,
            resolve(route, "index.html"),
          ]),
        ),
      },
    },
  },
});
