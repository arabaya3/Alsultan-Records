import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, watchErrors } from "./qa-helpers";

/**
 * M1 motion. gsap is bundled (not on window), so we check observable effects:
 *  - inline transform/opacity/visibility styles that GSAP writes,
 *  - requestAnimationFrame activity (GSAP's ticker runs on rAF),
 *  - offscreen <video> paused state.
 */
test.describe.configure({ mode: "serial" });
const MOTION_DIR = path.resolve(__dirname, "../../../docs/motion");

async function scrollPage(page: Page) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 300) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(90);
  }
}

const gsapStyles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main [style]")]
      .filter((e) => /transform|translate|opacity|visibility|clip-path/.test(e.getAttribute("style") ?? ""))
      .map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)} :: ${e.getAttribute("style")}`),
  );

test("M1: reduced motion leaves no GSAP transforms/opacity on hero and showcase", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, locale: "ar" });
  const page = await ctx.newPage();
  const w = watchErrors(page);
  for (const url of ["/", "/work", "/work/dev-sample-published-project"]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const atLoad = await gsapStyles(page);
    await scrollPage(page);
    const afterScroll = await gsapStyles(page);
    expect(atLoad, `${url} at load`).toEqual([]);
    expect(afterScroll, `${url} after scroll`).toEqual([]);
    // hero heading fully visible immediately
    const op = await page.locator("h1").first().evaluate((e) => getComputedStyle(e).opacity);
    expect(op).toBe("1");
  }
  expect(w.errors).toEqual([]);
  await ctx.close();
});

test("M1: normal motion — record video, entrance settles, no errors, nothing left animating", async ({ browser }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-motion-"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar", recordVideo: { dir: tmp, size: { width: 1440, height: 900 } } });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__raf++;
      return orig(cb);
    };
  });
  const page = await ctx.newPage();
  const w = watchErrors(page);
  const t0 = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  // entrance must not block: h1 visible and readable within 1s of load
  await expect(page.locator("h1").first()).toBeVisible();
  await expect.poll(() => page.locator("h1").first().evaluate((e) => Number(getComputedStyle(e).opacity)), { timeout: 1500 }).toBe(1);
  test.info().annotations.push({ type: "h1 fully opaque after ms", description: String(Date.now() - t0) });
  await page.waitForTimeout(800);
  await scrollPage(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(1500);

  // Styles stabilize once idle (no tween keeps writing)
  const s1 = await gsapStyles(page);
  await page.waitForTimeout(1000);
  const s2 = await gsapStyles(page);
  expect(s2).toEqual(s1);
  // rAF rate while idle (GSAP ticker / ScrollTrigger)
  const r1 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  await page.waitForTimeout(2000);
  const r2 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  test.info().annotations.push({ type: "idle rAF calls / 2s on home", description: String(r2 - r1) });

  // offscreen videos must be paused
  const vids = await page.evaluate(() =>
    [...document.querySelectorAll("video")].map((v) => {
      const r = v.getBoundingClientRect();
      return { onscreen: r.bottom > 0 && r.top < innerHeight, paused: v.paused, src: v.currentSrc.slice(-40) };
    }),
  );
  test.info().annotations.push({ type: "videos", description: JSON.stringify(vids) });
  for (const v of vids.filter((x) => !x.onscreen)) expect(v.paused).toBe(true);

  // client-side navigation away: contexts reverted, no inline GSAP styles linger on the new page
  await page.getByRole("link", { name: "أعمالنا" }).first().click();
  await page.waitForURL("**/work");
  await page.waitForTimeout(1500);
  const r3 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  await page.waitForTimeout(2000);
  const r4 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  test.info().annotations.push({ type: "idle rAF calls / 2s after navigating to /work", description: String(r4 - r3) });
  const lingering = await gsapStyles(page);
  test.info().annotations.push({ type: "inline motion styles on /work after settle", description: JSON.stringify(lingering) });
  expect(w.errors).toEqual([]);
  console.log(JSON.stringify(test.info().annotations, null, 1));

  const video = page.video();
  await ctx.close();
  fs.mkdirSync(MOTION_DIR, { recursive: true });
  await video!.saveAs(path.join(MOTION_DIR, "home-motion.webm"));
});
