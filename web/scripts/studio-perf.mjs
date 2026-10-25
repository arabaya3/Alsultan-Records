/**
 * Lab performance + screenshots for the immersive studio (before/after). Read-only against any site.
 *   node scripts/studio-perf.mjs <label> [baseUrl]
 * Writes .cache/studio-perf-<label>.json and docs/screenshots/studio/perf/<label>-<page>-<width>.png
 *
 * Lab numbers only (local machine, Chromium): LCP, CLS, JS/image/total transfer, long-task total (TBT-like),
 * a click's Event Timing duration (INP proxy) and, on mobile, a 4x CPU throttle. Never field data.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [label = "run", BASE = "http://localhost:3700"] = process.argv.slice(2);
const OUT = "../docs/screenshots/studio/perf";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(".cache", { recursive: true });

// [label] ending in "-gpu" launches with the GPU (ANGLE) so the scene itself is measured; otherwise Chromium's
// software rasterizer is used and the page serves the static studio (both are worth measuring).
const browser = await chromium.launch(label.endsWith("-gpu") ? { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } : {});
const probe = await (await browser.newContext()).newPage();
await probe.goto(`${BASE}/work?tab=photos`, { waitUntil: "domcontentloaded" });
const albumHref = await probe.locator("a[href^='/work/albums/']").first().getAttribute("href");
await probe.close();

const PAGES = { home: "/", albums: "/work?tab=photos", album: albumHref, videos: "/work?tab=videos", packages: "/packages" };
const DEVICES = [
  { name: "390", viewport: { width: 390, height: 844 }, mobile: true },
  { name: "1440", viewport: { width: 1440, height: 900 }, mobile: false },
];

const OBSERVE = () => {
  window.__perf = { lcp: 0, cls: 0, longTasks: 0, events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.events.push({ name: e.name, d: e.duration }); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
};

const result = { label, base: BASE, at: new Date().toISOString(), pages: {} };
for (const d of DEVICES) {
  const ctx = await browser.newContext({ viewport: d.viewport, isMobile: d.mobile, hasTouch: d.mobile, deviceScaleFactor: d.mobile ? 2 : 1, locale: "ar" });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("sultan-intro-v1", "1"); } catch {} });
  await ctx.addInitScript(OBSERVE);
  for (const [name, url] of Object.entries(PAGES)) {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (d.mobile) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const bytes = { js: 0, img: 0, other: 0, three: 0 };
    const types = new Map();
    cdp.on("Network.responseReceived", (e) => types.set(e.requestId, { type: e.type, url: e.response.url }));
    cdp.on("Network.loadingFinished", (e) => {
      const t = types.get(e.requestId);
      if (!t) return;
      const k = t.type === "Script" ? "js" : t.type === "Image" ? "img" : "other";
      bytes[k] += e.encodedDataLength;
      if (k === "js" && /three|studio/i.test(t.url)) bytes.three += e.encodedDataLength;
    });
    const t0 = Date.now();
    await page.goto(BASE + url, { waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500); // let the scene (if any) build and settle
    const loadMs = Date.now() - t0;
    await page.screenshot({ path: `${OUT}/${label}-${name}-${d.name}.png` });
    // an interaction: open the mobile menu, or hover+focus the first nav link (no navigation, no writes)
    const btn = page.locator("header button[aria-expanded]").first();
    if (d.mobile && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
    } else {
      await page.mouse.click(5, d.viewport.height - 5);
    }
    await page.waitForTimeout(300);
    const perf = await page.evaluate(() => ({ ...window.__perf, studio: document.documentElement.dataset.studio ?? null, canvases: document.querySelectorAll("canvas").length }));
    const maxEvent = perf.events.reduce((m, e) => Math.max(m, e.d), 0);
    result.pages[`${name}@${d.name}`] = {
      url,
      lcpMs: Math.round(perf.lcp),
      cls: Number(perf.cls.toFixed(4)),
      longTaskMs: Math.round(perf.longTasks),
      maxEventMs: Math.round(maxEvent),
      loadMs,
      kb: { js: Math.round(bytes.js / 1024), three: Math.round(bytes.three / 1024), img: Math.round(bytes.img / 1024), other: Math.round(bytes.other / 1024) },
      studio: perf.studio,
      canvases: perf.canvases,
    };
    console.log(name, d.name, JSON.stringify(result.pages[`${name}@${d.name}`]));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`.cache/studio-perf-${label}.json`, JSON.stringify(result, null, 2));
console.log(`wrote .cache/studio-perf-${label}.json`);
