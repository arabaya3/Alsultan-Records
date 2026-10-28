/**
 * Fixed before/after shots for the studio review (same sizes, same angles, read-only).
 *   node scripts/studio-compare.mjs <label> [baseUrl] [outDir]
 * Writes <outDir>/<label>-<name>.png:
 *   reception-1440, wall-last-1440 (the wall's LAST group), album-1440,
 *   reception-390/430, wall-390, album-390/430 (first screen of each on a phone).
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [label = "run", BASE = "http://127.0.0.1:3700", OUT = "../docs/screenshots/studio/compare/raw"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const shoot = async (name, vp, url, prep, mobile = false) => {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, locale: "ar" });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("sultan-studio-entry", "1"); } catch {} });
  const page = await ctx.newPage();
  await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-studio-backdrop][data-ready]") || document.documentElement.dataset.studio === "static", null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(5000);
  if (prep) await prep(page);
  await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
  console.log(label, name);
  await ctx.close();
};
const lastGroup = async (page) => {
  for (let i = 0; i < 10; i++) {
    const next = page.locator("[data-wall-next]");
    if (!(await next.count()) || !(await next.isEnabled())) break;
    await next.click();
    await page.waitForTimeout(1800);
  }
  await page.waitForTimeout(1500);
};
const probe = await browser.newPage();
await probe.goto(`${BASE}/work?tab=photos`);
const album = await probe.locator("a[data-album-card]").first().getAttribute("href");
await probe.close();

await shoot("reception-1440", { width: 1440, height: 900 }, "/");
await shoot("wall-last-1440", { width: 1440, height: 900 }, "/work?tab=photos", lastGroup);
await shoot("album-1440", { width: 1440, height: 900 }, album);
for (const w of [390, 430]) {
  const vp = { width: w, height: w === 390 ? 844 : 932 };
  await shoot(`reception-${w}`, vp, "/", null, true);
  await shoot(`album-${w}`, vp, album, null, true);
}
await shoot("wall-390", { width: 390, height: 844 }, "/work?tab=photos", null, true);
await browser.close();
