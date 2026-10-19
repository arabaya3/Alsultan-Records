import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests live next to source (src/**/*.test.ts). Playwright specs in tests/e2e are run by Playwright.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"], exclude: ["tests/**", "node_modules/**", ".next/**"] },
});
