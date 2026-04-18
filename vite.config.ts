import { defineConfig } from "vite";

export default defineConfig({
  base: "/wirelessplus-config-editor/",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
  },
  server: {
    port: 5173,
    open: true,
  },
});
