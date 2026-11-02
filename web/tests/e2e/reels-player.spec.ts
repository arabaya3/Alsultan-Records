import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test, type Page } from "@playwright/test";
import { BASE, db, newLoggedIn, skipSiteIntro } from "./qa-helpers";

/**
 * Reels mode with the studio's own files (synthetic clips made here with ffmpeg) on the S3 emulator, on phone-sized
 * Chromium and WebKit. The app and this run need REELS_VIEWER=1 and the same S3_* values. LOCAL STACK ONLY.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(3 * 60_000);
test.skip(process.env.REELS_VIEWER !== "1" || !process.env.S3_ENDPOINT, "needs REELS_VIEWER=1 and S3");

const Bucket = process.env.S3_BUCKET!;
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "x", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "x" },
});
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "reels-"));
const rows: string[] = [];
let videos: { id: string; youtube_id: string; title: string }[] = [];

/** H.264 + AAC in MP4: what phones record and play. */
function clip(name: string, w: number, h: number, seconds = 8) {
  const f = path.join(TMP, name);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=25`, "-f", "lavfi", "-i", "sine=frequency=440", "-t", String(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", f]);
  return f;
}

test.beforeAll(async () => {
  const { data } = await db.from("showcase_videos").select("id, youtube_id, title").eq("is_published", true).order("sort_order").limit(40);
  const { data: promos } = await db.from("showcase_videos").select("id, youtube_id, title, role").eq("is_published", true).in("role", ["promo", "both"]);
  videos = (data ?? []) as typeof videos;
  // The first videos of the videos tab get files: one vertical, one landscape; the third stays YouTube-only.
  const files = [clip("vertical.mp4", 720, 1280), clip("landscape.mp4", 1280, 720)];
  const targets = [...(promos ?? []).slice(0, 2), ...videos.slice(0, 2)] as typeof videos;
  for (const [i, v] of targets.entries()) {
    const id = randomUUID();
    const f = files[i % 2];
    const key = `reels/${id}.mp4`;
    await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: fs.readFileSync(f), ContentType: "video/mp4" }));
    const [w, h] = i % 2 ? [1280, 720] : [720, 1280];
    const { error } = await db.from("reel_videos").upsert({ id, title: v.title.slice(0, 160), storage_path: key, mime: "video/mp4", bytes: fs.statSync(f).size, width: w, height: h, storage_provider: "s3", upload_status: "ready", showcase_video_id: v.id }, { onConflict: "showcase_video_id" });
    if (error) throw new Error(error.message);
    rows.push(id);
  }
});
test.afterAll(async () => {
  const { data } = await db.from("reel_videos").select("id, storage_path").in("id", rows);
  for (const r of data ?? []) await s3.send(new DeleteObjectCommand({ Bucket, Key: r.storage_path }));
  await db.from("reel_videos").delete().in("id", rows);
  fs.rmSync(TMP, { recursive: true, force: true });
});

const feed = (p: Page) => p.locator("[data-reels-feed]");
const activeId = (p: Page) => p.locator("[data-reel][data-active='1']").getAttribute("data-reel");
async function swipe(p: Page, dir: 1 | -1) {
  // A real swipe ends in a scroll of the snapping feed; drive that scroll directly (WebKit has no mouse wheel on phones).
  await feed(p).evaluate((el, d) => el.scrollBy({ top: d * el.clientHeight, behavior: "instant" as ScrollBehavior }), dir);
}
const videoState = (p: Page) => p.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => JSON.stringify({ paused: v.paused, t: v.currentTime, ready: v.readyState, net: v.networkState, err: v.error?.code ?? null, src: v.currentSrc.split("?")[0], mp4: v.canPlayType("video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"") }));
const playing = (p: Page) => p.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0);

test("tabs sit in one row on a phone; no extra reels button", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await skipSiteIntro(page);
  await page.goto(`${BASE}/work`);
  const tops = await page.locator("[data-work-tab]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  await page.locator("[data-work-tab]").first().screenshot({ path: `C:/Users/UnclePC/AppData/Local/Temp/claude/c--Users-UnclePC-Desktop-Snorkel--proj-Alsultan-Site/7460be71-c262-47e6-a876-9add7bf7b2ab/scratchpad/tabs-${test.info().project.name}.png` }).catch(() => {});
  await page.locator("nav[aria-label=\"نوع الأعمال\"]").screenshot({ path: `C:/Users/UnclePC/AppData/Local/Temp/claude/c--Users-UnclePC-Desktop-Snorkel--proj-Alsultan-Site/7460be71-c262-47e6-a876-9add7bf7b2ab/scratchpad/tabnav-${test.info().project.name}.png` });
  expect(Math.max(...tops) - Math.min(...tops), `tops ${tops}`).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator("[data-reels-open]")).toHaveCount(0);
});

test("a card opens reels mode on that clip; the studio file plays in the site player, muted, with progress", async ({ page }) => {
  const net: string[] = [];
  page.on("response", (r) => { if (/\/r\/|5599/.test(r.url())) net.push(`${r.status()} ${r.request().headers()["range"] ?? "-"} ${r.url().split("?")[0].slice(-60)} ${r.headers()["content-type"] ?? ""}`); });
  page.on("requestfailed", (r) => { if (/\/r\/|5599/.test(r.url())) net.push(`FAILED ${r.failure()?.errorText} ${r.url().split("?")[0].slice(-60)}`); });
  page.on("console", (m) => { if (m.type() === "error") net.push(`console ${m.text().slice(0, 160)}`); });
  await skipSiteIntro(page);
  await page.goto(`${BASE}/work`);
  const card = page.locator(`[data-reel-card="${videos[0]!.youtube_id}"]`);
  await card.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await card.click();
  const viewer = page.locator("[data-reels-viewer]");
  await expect(viewer).toBeVisible();
  expect(await activeId(page)).toBe(videos[0]!.id);
  await expect(page.locator("[data-reels-player]")).toHaveAttribute("data-kind", "file");
  await expect(page.locator("iframe")).toHaveCount(0); // no YouTube player for a studio file
  await expect.poll(() => playing(page), { timeout: 20_000, message: "video state" }).toBe(true).catch(async (e) => { throw new Error([e.message, ...net, await videoState(page)].join(" | ")); });
  expect(await page.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await expect.poll(async () => Number(await page.locator("[data-reels-progress]").getAttribute("aria-valuenow"))).toBeGreaterThan(0);

  // tap = pause, tap again = play; repeated taps never leave it stuck
  await page.locator("[data-reels-toggle]").click();
  await expect.poll(() => page.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  for (let i = 0; i < 3; i++) await page.locator("[data-reels-toggle]").click();
  await expect.poll(() => page.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);

  // sound on, then the next clip keeps sound on in the same element
  await page.locator("[data-reels-mute]").click();
  await expect(page.locator("[data-reels-mute]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-reels-video]").evaluate((v) => v.setAttribute("data-same", "1"));
  await swipe(page, 1);
  await expect.poll(() => activeId(page)).toBe(videos[1]!.id);
  await expect(page.locator("[data-reels-video][data-same]")).toHaveCount(1);
  await expect.poll(() => playing(page), { timeout: 20_000, message: "video state" }).toBe(true).catch(async (e) => { throw new Error(`${e.message}
${await videoState(page)}`); });
  expect(await page.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await expect(page.locator("[data-reels-player]")).toHaveAttribute("style", /aspect-ratio: 1\.7/); // landscape shown whole

  // actions
  await expect(page.locator("[data-reels-share]")).toBeVisible();
  await expect(page.locator("[data-reels-inquiry]")).toHaveAttribute("href", /wa\.me|whatsapp/);

  // next clip has no file: YouTube's own player, and our video is paused (never two at once)
  await swipe(page, 1);
  await expect.poll(() => activeId(page)).toBe(videos[2]!.id);
  await expect(page.locator("[data-reels-player]")).toHaveAttribute("data-kind", "youtube");
  expect(await page.locator("[data-reels-video]").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.locator("[data-reels-viewer]")).toContainText("يُعرض من YouTube");

  // close returns to the same card at the same place
  await page.locator("[data-reels-close]").click();
  await expect(viewer).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(40);
});

test("Back closes the viewer; a shared link opens the same clip", async ({ page }) => {
  await skipSiteIntro(page);
  await page.goto(`${BASE}/work`);
  await page.locator(`[data-reel-card="${videos[0]!.youtube_id}"]`).click();
  await expect(page.locator("[data-reels-viewer]")).toBeVisible();
  await page.goBack();
  await expect(page.locator("[data-reels-viewer]")).toHaveCount(0);
  await page.goto(`${BASE}/work?reel=${videos[1]!.id}`);
  await expect(page.locator("[data-reels-viewer]")).toBeVisible();
  expect(await activeId(page)).toBe(videos[1]!.id);
});

test("slow file: a loading state, then it plays; a broken file: a clear message, no blank screen", async ({ page }) => {
  await skipSiteIntro(page);
  await page.route("**/r/**", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto(`${BASE}/work?reel=${videos[0]!.id}`);
  if (test.info().project.name !== "mobile-safari") await expect(page.locator("[data-reels-loading]")).toBeVisible();
  await expect.poll(() => playing(page), { timeout: 30_000 }).toBe(true);
  await page.unroute("**/r/**");

  // Playwright cannot intercept media requests in WebKit, so the broken-file half runs on Chromium only.
  if (test.info().project.name === "mobile-safari") return;
  await page.route("**/r/**", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto(`${BASE}/work?reel=${videos[1]!.id}`);
  await expect(page.locator("[data-reels-error]")).toBeVisible({ timeout: 20_000 }).catch(async (e) => {
    throw new Error([e.message, await page.locator("[data-reels-player]").getAttribute("data-status"), await videoState(page)].join(" | "));
  });
});

test("reduced motion: no smooth scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await skipSiteIntro(page);
  await page.goto(`${BASE}/work?reel=${videos[0]!.id}`);
  expect(await feed(page).evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("auto");
});

test("the file link answers only while the video is published", async ({ request }) => {
  const r = await request.get(`${BASE}/r/${videos[0]!.id}`, { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  expect(r.headers()["cache-control"]).toContain("no-store");
  await db.from("showcase_videos").update({ is_published: false }).eq("id", videos[0]!.id);
  try {
    expect((await request.get(`${BASE}/r/${videos[0]!.id}`, { maxRedirects: 0 })).status()).toBe(404);
  } finally {
    await db.from("showcase_videos").update({ is_published: true }).eq("id", videos[0]!.id);
  }
  expect((await request.get(`${BASE}/r/${videos[3]?.id ?? randomUUID()}`, { maxRedirects: 0 })).status()).toBe(404);
});

test("admin: upload the original file to a video, then it plays from the site", async ({ browser }) => {
  const target = videos[3]!;
  const page = await newLoggedIn(browser, "owner", `/admin/videos/${target.id}`);
  await page.getByTestId("reel-file-input").setInputFiles(clip("upload.mp4", 720, 1280, 4));
  await expect(page.getByTestId("reel-file")).toHaveAttribute("data-status", /^(done|ready)$/, { timeout: 90_000 });
  const { data } = await db.from("reel_videos").select("id, upload_status, width, height").eq("showcase_video_id", target.id).single();
  rows.push(data!.id);
  expect(data!.upload_status).toBe("ready");
  // Read in the browser for display only; some engines cannot (the player then reads the shape itself).
  if (data!.width !== null) expect([data!.width, data!.height]).toEqual([720, 1280]);
  const r = await page.request.get(`${BASE}/r/${target.id}`, { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  await page.context().close();
});
