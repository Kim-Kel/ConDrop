import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github-pages",
  base: "./",
  publicDir: "../public",
  plugins: [react()],
  optimizeDeps: {
    noDiscovery: true,
    include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "three", "jszip", "ag-psd", "utif", "openskp", "@comfyorg/fbx-exporter-three"],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
