import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { offlineShell } from "./src/offline/swBuild";

// offlineShell writes /sw.js — the app shell's service worker, with the list of every file this build emitted
// (src/offline/swBuild.ts). Build only: `vite dev` neither writes nor registers a worker.
export default defineConfig({
  plugins: [react(), tailwindcss(), offlineShell()],
});
