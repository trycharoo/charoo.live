import { defineConfig } from "@playwright/test";
import { nativeRuntimePort } from "./celld/scripts/ports";
export default defineConfig({
  testDir: "./tests/native",
  testMatch: "*.spec.ts",
  workers: 1,
  use: {
    baseURL:
      process.env.BROWSER_BASE_URL || `http://127.0.0.1:${nativeRuntimePort()}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  reporter: "list",
  timeout: 30000,
});
