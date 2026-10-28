/**
 * Screenshots of every studio corner at six widths, with the scene (GPU) and as the static fallback (no WebGL).
 *   node scripts/studio-shots.mjs [baseUrl]
 * Writes docs/screenshots/studio/{scene,fallback}/<width>/<corner>.png and a check report (overflow, one visible
 * h1, canvas state) to docs/screenshots/studio/shots-report.json. Read-only.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [BASE = "http://localhost:3700"] = process.argv.slice(2);
const OUT = "../docs/screenshots/studio";
const WIDTHS = [320, 390, 430, 768, 1024, 1440, 1920];
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];

const browser = await chromium.launch({ args: GPU });
const probe = await browser.newPage();
await probe.goto(`${BASE}/work?tab=photos`);
const album = await probe.locator("a[data-album-card]").first().getAttribute("href");
await probe.close();
const CORNERS = { reception: "/", albums: "/work?tab=photos", album, videos: "/work?tab=videos", packages: "/packages", offers: "/offers", about: "/about", services: "/services", contact: "/contact", privacy: "/privacy" };

const report = {};
for (const variant of ["scene", "fallback"]) {
  for (const w of WIDTHS) {
    const h = w < 800 ? 844 : w === 1024 ? 768 : w === 1920 ? 1080 : 900;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ar", isMobile: w < 800, hasTouch: w < 800, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { sessionStorage.setItem("sultan-studio-entry", "1"); } catch {} });
    if (variant === "fallback") await ctx.addInitScript(() => { delete window.WebGLRenderingContext; delete window.WebGL2RenderingContext; });
    const page = await ctx.newPage();
    fs.mkdirSync(`${OUT}/${variant}/${w}`, { recursive: true });
    for (const [name, url] of Object.entries(CORNERS)) {
      await page.goto(BASE + url, { waitUntil: "load" });
      await page.waitForTimeout(variant === "scene" ? 4200 : 900);
      await page.screenshot({ path: `${OUT}/${variant}/${w}/${name}.png` });
      report[`${variant}/${w}/${name}`] = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - innerWidth,
        visibleH1: [...document.querySelectorAll("h1")].filter((e) => e.offsetParent).length,
        mode: document.documentElement.dataset.studio ?? null,
        station: document.documentElement.dataset.studioStation ?? null,
        tier: document.documentElement.dataset.studioTier ?? null,
        projected: document.querySelectorAll("[data-projected='1']").length,
      }));
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/shots-report.json`, JSON.stringify(report, null, 2));
const bad = Object.entries(report).filter(([, r]) => r.overflowX > 0 || r.visibleH1 !== 1);
console.log(`${Object.keys(report).length} shots; problems: ${bad.length}`);
for (const [k, r] of bad) console.log(k, JSON.stringify(r));
