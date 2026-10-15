import { defineConfig, devices } from "@playwright/test";

/**
 * QA config. LOCAL STACK ONLY.
 *   npx supabase db reset && npm run seed:storage
 *   npm run build && npx next start -p 3400
 *   BASE_URL=http://localhost:3400 npx playwright test
 * Set PW_WEBSERVER=1 to let Playwright start `next start -p 3400` itself (needs a prior build).
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3400";
process.env.BASE_URL = BASE_URL; // older specs read BASE_URL directly

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, locale: "ar", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }, grepInvert: /@mobile/ },
    // Mobile project only runs specs tagged @mobile.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.PW_WEBSERVER
    ? { command: "npx next start -p 3400", url: BASE_URL, reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
