import { expect, test } from "@playwright/test";
import { BASE } from "./qa-helpers";

/**
 * Installable apps + no stale caching:
 * - public site → /manifest.webmanifest (start "/"); login/admin/portal → /app.webmanifest (start "/login");
 * - the Next app registers NO service worker; /sw.js is a kill switch for the legacy static site's cache-first
 *   worker: it clears every cache and unregisters itself;
 * - admin/auth responses are never cacheable.
 *   BASE_URL=http://localhost:3600 npx playwright test pwa
 */
test("P1: two separate manifests with the right start URLs and ids", async ({ request }) => {
  const pub = await (await request.get(`${BASE}/manifest.webmanifest`)).json();
  const app = await (await request.get(`${BASE}/app.webmanifest`)).json();
  expect([pub.id, pub.start_url, pub.scope, pub.display]).toEqual(["/", "/", "/", "standalone"]);
  expect([app.id, app.start_url, app.display]).toEqual(["/login", "/login", "standalone"]);
  expect(pub.id).not.toBe(app.id);
  for (const m of [pub, app]) for (const i of m.icons) expect((await request.get(`${BASE}${i.src}`)).status(), i.src).toBe(200);
});

test("P2: pages link the right manifest; no service worker is registered by the site", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.goto(`${BASE}/login`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/app.webmanifest");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "لوحة السلطان");
});

test("P3: /sw.js kill switch clears legacy caches and unregisters itself", async ({ page, request }) => {
  const res = await request.get(`${BASE}/sw.js`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  await page.goto(`${BASE}/terms`);
  // Simulate a returning visitor of the legacy site: its cache exists, and its /sw.js gets (re)installed.
  await page.evaluate(async () => {
    const c = await caches.open("sultan-v27-1");
    await c.put("/legacy-probe", new Response("old"));
    await navigator.serviceWorker.register("/sw.js");
  });
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 10_000 }).toBe(0);
});

test("P4: admin, portal, login and auth responses are never cacheable", async ({ request }) => {
  for (const path of ["/admin", "/admin/users", "/portal", "/login", "/auth/reset"]) {
    const r = await request.get(`${BASE}${path}`, { maxRedirects: 0 });
    expect(r.headers()["cache-control"] ?? "", path).toMatch(/no-store/);
  }
});
