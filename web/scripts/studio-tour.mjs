/**
 * Records the immersive studio tour in a real browser (GPU when available) — the review video for the PR.
 *   node scripts/studio-tour.mjs [baseUrl] [outDir]
 * Desktop 1440×900 and phone 390×844: reception (first-visit approach) → album wall → an album (book opens) →
 * the next album (book swap) → a photo in the viewer → Esc → Back → Back. Read-only: clicks and history only.
 * Prints each step with the URL, the corner and the camera state so the run doubles as a functional check.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [BASE = "http://localhost:3700", OUT = "../docs/screenshots/studio/video"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];

async function tour(name, device) {
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
    log.push({ step: label, ...s });
    console.log(name, label, JSON.stringify(s));
  };
  const settle = (ms = 1900) => page.waitForTimeout(ms);
  const wide = device.viewport.width >= 1024;

  await page.goto(BASE + "/", { waitUntil: "load" });
  await settle(3600); // first visit: the calm approach to the reception
  await state("reception");
  await page.locator("[data-reception-frame='0']").hover().catch(() => {});
  await settle(700);
  await page.locator("[data-reception-frame='0']").click();
  await page.waitForURL(/tab=photos/);
  await settle(2400);
  await state("album wall");
  if (wide && (await page.locator("[data-wall-next]").isEnabled().catch(() => false))) {
    await page.locator("[data-wall-next]").click();
    await settle(1300);
    await state("wall: next group");
    await page.locator("[data-wall-prev]").click();
    await settle(1300);
  }
  const first = page.locator("[data-studio-wall] > li:not([hidden]) a").first();
  await first.hover().catch(() => {});
  await settle(600);
  await first.click();
  await page.waitForURL(/\/work\/albums\//);
  await settle(2600);
  await state("album open");
  const next = page.locator("[data-album-next]");
  if (await next.count()) {
    await next.click();
    await page.waitForURL((u) => u.pathname.startsWith("/work/albums/"));
    await settle(2600);
    await state("next album");
  }
  // a photo → the viewer (same lightbox as before), then close
  const photo = page.locator("[data-album-photo]").first();
  await photo.scrollIntoViewIfNeeded();
  await settle(600);
  await photo.click();
  await page.locator("[data-lightbox-image]").waitFor({ state: "visible" });
  await settle(1500);
  await state("viewer");
  await page.keyboard.press("Escape");
  await settle(800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await settle(500);
  await page.goBack();
  await settle(2400);
  await state("back");
  await page.goBack();
  await settle(2400);
  await state("back again");
  const video = page.video();
  await ctx.close();
  await browser.close();
  const file = path.join(OUT, `studio-tour-${name}.webm`);
  if (video) fs.renameSync(await video.path(), file);
  console.log("video", file);
  return log;
}

const logs = {
  desktop: await tour("desktop-1440", { viewport: { width: 1440, height: 900 } }),
  mobile: await tour("mobile-390", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }),
};
fs.writeFileSync(path.join(OUT, "tour-log.json"), JSON.stringify(logs, null, 2));
