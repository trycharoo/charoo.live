import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/worker-base.ts", import.meta.url),
      ),
    },
  },
  plugins: [
    {
      name: "sql-text",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".sql"))
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))}`;
      },
    },
  ],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 15000 },
});
