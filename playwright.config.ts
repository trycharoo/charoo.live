import { defineConfig } from "@playwright/test";
import { devWebPort } from "./celld/scripts/ports";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: process.env.BROWSER_BASE_URL || `http://127.0.0.1:${devWebPort()}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  reporter: "list",
});
