import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  // .lottie is a binary animation format (zip-based) — Vite doesn't recognise
  // it by default, so ?url imports produce a broken path in production builds.
  assetsInclude: ["**/*.lottie"],
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path so the alias resolves the
    // same way at typecheck time (tsc) and at bundle time (Vite/esbuild).
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    rollupOptions: {
      output: {
        // Split the heaviest vendors out of the single 1.2MB app chunk so they
        // parse in parallel and cache independently across releases. Charts
        // (recharts + its d3 deps) are by far the biggest; motion, the lottie
        // player, and the icon set are the next tier. Everything else (React,
        // query, tauri api) stays in the default vendor chunk.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("victory-vendor")) return "charts";
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "motion";
          if (id.includes("lottiefiles") || id.includes("dotlottie")) return "lottie";
          if (id.includes("lucide-react")) return "icons";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
