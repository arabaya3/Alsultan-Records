/**
 * Records the studio in a real browser (GPU via ANGLE) — the review videos for the PR. Read-only.
 *   node scripts/studio-tour.mjs [baseUrl] [outDir]
 * 1) studio-tour-desktop-1440.webm / studio-tour-mobile-390.webm — slow: the calm approach to the reception, then
 *    the album wall, an album, the next album, a photo in the viewer, Esc, Back, Back; ~3.5 s still at every corner,
 *    every transition shown whole. On the phone the lists are scrolled so the camera's walk along the prints shows.
 * 2) studio-corners-1440.webm — a short pass through the other corners (videos, packages, services, about, contact).
 * Prints each step (URL, corner, camera state) so the run doubles as a functional check.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [BASE = "http://localhost:3700", OUT = "../docs/screenshots/studio/video"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
const HOLD = 3600;

async function record(name, device, script) {
  const browser = await chromium.launch({ args: GPU });
  const ctx = await browser.newContext({ ...device, locale: "ar", recordVideo: { dir: OUT, size: device.viewport } });
  const page = await ctx.newPage();
  const log = [];
  const state = async (label) => {
    const s = await page.evaluate(() => ({
      url: location.pathname + location.search,
      station: document.documentElement.dataset.studioStation ?? null,
      mode: document.documentElement.dataset.studio ?? null,
      stats: window.__studioStats?.() ?? null,
    }));
    log.push({ step: label, url: s.url, station: s.station, mode: s.mode, camera: s.stats?.camera, moving: s.stats?.moving });
    console.log(name, label, s.url, s.station, s.mode);
  };
  await script(page, state, device.viewport.width >= 1024);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const file = path.join(OUT, `${name}.webm`);
  if (video) fs.renameSync(await video.path(), file);
  console.log("video", file);
  return log;
}

const slowScroll = async (page, px, steps = 8) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(260);
  }
};

const mainTour = async (page, state, wide) => {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(4200); // first visit: approach to the reception
  await state("reception");
  if (!wide) {
    await slowScroll(page, 900, 10); // walk past the three prints
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await page.waitForTimeout(1500);
  } else {
    await page.locator("[data-reception-frame='0']").hover();
    await page.waitForTimeout(1200);
  }
  await page.locator("[data-reception-frame='0']").click();
  await page.waitForURL(/tab=photos/);
  await page.waitForTimeout(HOLD);
  await state("album wall");
  if (wide && (await page.locator("[data-wall-next]").isEnabled().catch(() => false))) {
    await page.locator("[data-wall-next]").click();
    await page.waitForTimeout(2200);
    await page.locator("[data-wall-prev]").click();
    await page.waitForTimeout(2200);
  }
  if (!wide) {
    await slowScroll(page, 1400, 14); // the camera follows the card in the middle
    await page.waitForTimeout(1200);
  }
  const card = page.locator("[data-studio-wall] > li:not([hidden]) a").first();
  await card.scrollIntoViewIfNeeded();
  await card.hover().catch(() => {});
  await page.waitForTimeout(900);
  await card.click();
  await page.waitForURL(/\/work\/albums\//);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(HOLD + 400);
  await state("album 1");
  const next = page.locator("[data-album-next]");
  if (await next.count()) {
    await next.click();
    await page.waitForURL((u) => u.pathname.startsWith("/work/albums/"));
    await page.waitForTimeout(HOLD + 400);
    await state("album 2");
  }
  const photo = page.locator("[data-album-photo]").first();
  await photo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await photo.click();
  await page.locator("[data-lightbox-image]").waitFor({ state: "visible" });
  await page.waitForTimeout(2600);
  await state("viewer");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(1000);
  await page.goBack();
  await page.waitForTimeout(HOLD);
  await state("back");
  await page.goBack();
  await page.waitForTimeout(HOLD);
  await state("back again");
};

const cornersTour = async (page, state) => {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(3000);
  for (const href of ["/work", "/packages", "/services", "/about", "/contact", "/"]) {
    const link = href === "/" ? page.locator("header a[href='/']").first() : page.locator(`header nav a[href='${href}']`).first();
    await link.click({ timeout: 5000 }).catch(() => page.goto(BASE + href));
    await page.waitForTimeout(3000);
    await state(href);
  }
};

const logs = {
  desktop: await record("studio-tour-desktop-1440", { viewport: { width: 1440, height: 900 } }, mainTour),
  mobile: await record("studio-tour-mobile-390", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, mainTour),
  corners: await record("studio-corners-1440", { viewport: { width: 1440, height: 900 } }, cornersTour),
};
fs.writeFileSync(path.join(OUT, "tour-log.json"), JSON.stringify(logs, null, 2));
