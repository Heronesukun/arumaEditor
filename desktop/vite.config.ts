import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const desktopRoot = path.resolve(__dirname, "renderer");

export default defineConfig({
  root: desktopRoot,
  base: "./",
  publicDir: path.resolve(__dirname, "..", "public"),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "..", "desktop-dist"),
    emptyOutDir: true,
  },
});
