import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}) },
  webServer: {
    command: "npx vite --config vite.config.ts --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173", reuseExistingServer: !process.env.CI,
  },
});
