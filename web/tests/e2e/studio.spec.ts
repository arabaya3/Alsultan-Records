import { expect, test, type Page } from "@playwright/test";

/**
 * Immersive studio (src/features/studio). Read-only: navigation, clicks, history, resizing — no data writes.
 *   BASE_URL=http://localhost:3700 npx playwright test studio --project=chromium
 * Scene tests launch Chromium with the GPU (ANGLE/D3D11 on Windows); on a machine without one the scene may
 * fall back to the static studio by design — those tests then assert the fallback instead of skipping silently.
 */
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
test.use({ launchOptions: { args: GPU } });

const html = (page: Page, attr: string) => page.evaluate((a) => document.documentElement.getAttribute(a), attr);
const stats = (page: Page) => page.evaluate(() => (window as Window & { __studioStats?: () => { station: string | null; moving: boolean; tier: string } }).__studioStats?.() ?? null);
const settled = (page: Page, station: string) =>
  expect
    .poll(async () => {
      const s = await stats(page);
      return s ? `${s.station}:${s.moving}` : (await html(page, "data-studio")) === "static" ? `${station}:false` : "pending";
    }, { timeout: 20_000 })
    .toBe(`${station}:false`);

async function firstAlbum(page: Page) {
  await page.goto("/work?tab=photos");
  return (await page.locator("a[data-album-card]").first().getAttribute("href"))!;
}

test("ST1 every corner opens directly from its link, with its content in HTML and a decorative, unfocusable room", async ({ page }) => {
  const album = await firstAlbum(page);
  const corners: [string, string | null][] = [
    ["/", "reception"],
    ["/work?tab=photos", "albums"],
    [album, "album"],
    ["/work?tab=videos", "videos"],
    ["/work", "videos"],
    ["/packages", "packages"],
    ["/offers", "packages"],
    ["/about", "about"],
    ["/services", "services"],
    ["/contact", "contact"],
    ["/privacy", null],
    ["/terms", null],
  ];
  for (const [url, station] of corners) {
    await page.goto(url);
    expect(await html(page, "data-studio-station"), url).toBe(station);
    await expect(page.locator("h1:visible"), url).toHaveCount(1);
    const backdrop = page.locator("[data-studio-backdrop]");
    await expect(backdrop).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("[data-studio-canvas]")).toHaveAttribute("tabindex", "-1");
    if (!station) await expect(backdrop).toBeHidden(); // reading pages: no room, no tour
    if (station) await settled(page, station); // a direct link lands on its corner (no detour through the entrance)
  }
});

test("ST2 reception → wall → album → next album → photo → Back/Forward keep URL, corner and content in step", async ({ page }) => {
  await page.goto("/");
  await settled(page, "reception");
  await page.locator("[data-reception-frame='0']").click();
  await expect(page).toHaveURL(/\/work\?tab=photos$/);
  await settled(page, "albums");
  const card = page.locator("[data-studio-wall] > li:not([hidden]) a[data-album-card]").first();
  const slug = await card.getAttribute("data-album-card");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/work/albums/${slug}$`));
  await settled(page, "album");
  await expect(page.locator("[data-album-photo]").first()).toBeVisible();
  const next = page.locator("[data-album-next]");
  let nextSlug: string | null = null;
  if (await next.count()) {
    nextSlug = await next.getAttribute("data-album-next");
    await expect(next).toContainText("الألبوم التالي");
    await next.click();
    await expect(page).toHaveURL(new RegExp(`/work/albums/${nextSlug}$`));
    await settled(page, "album");
    await expect(page.locator(`[data-album-page='${nextSlug}']`)).toBeVisible();
    await expect(page.locator("[data-album-prev]")).toHaveAttribute("data-album-prev", slug!);
  }
  // the viewer is the existing one: full photo, Esc closes, focus returns
  await page.locator("[data-album-photo]").first().click();
  await expect(page.locator("[data-lightbox-image]")).toBeVisible();
  await expect(page.locator("[data-studio-backdrop] :focus")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-lightbox-image]")).toHaveCount(0);
  // history: every step is one entry (the scene adds none)
  if (nextSlug) {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/work/albums/${slug}$`));
    await settled(page, "album");
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/work\?tab=photos$/);
  await settled(page, "albums");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await settled(page, "reception");
  await page.goForward();
  await expect(page).toHaveURL(/tab=photos/);
  await settled(page, "albums");
  // refresh keeps the corner
  await page.reload();
  await settled(page, "albums");
});

test("ST3 rapid clicks mid-move end on the LAST destination, content usable, no stuck state", async ({ page }) => {
  await page.goto("/");
  await settled(page, "reception");
  await page.locator("header nav a[href='/services']").first().click();
  await page.locator("header nav a[href='/about']").first().click();
  await page.locator("header nav a[href='/packages']").first().click();
  await expect(page).toHaveURL(/\/packages$/);
  await settled(page, "packages");
  // Next keeps the previous route hidden (display:none, effects cleaned up): one VISIBLE h1 — the last page
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.locator("h1:visible")).toContainText("بكج");
  await expect(page.locator("[data-package-card]").first()).toBeVisible();
  expect(await html(page, "data-studio-moving")).toBeNull();
});

test("ST4 resize and rotation re-solve the camera; hotspots leave the prints on narrow screens", async ({ page }) => {
  await page.goto("/work?tab=photos");
  await settled(page, "albums");
  const card = page.locator("[data-studio-wall] > li").first();
  if ((await html(page, "data-studio")) === "scene") await expect(card).toHaveAttribute("data-projected", "1");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await expect(card).not.toHaveAttribute("data-projected", "1");
  await expect(page.locator("[data-studio-wall] > li[hidden]")).toHaveCount(0); // phones: the whole list
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settled(page, "albums");
  await expect(card).toBeVisible();
});

test("ST5 without WebGL the static studio is complete: same links, visible covers, nothing blank", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar" });
  await ctx.addInitScript(() => {
    // @ts-expect-error simulate a browser without WebGL
    delete window.WebGLRenderingContext;
    // @ts-expect-error same
    delete window.WebGL2RenderingContext;
  });
  const page = await ctx.newPage();
  await page.goto("/");
  expect(await html(page, "data-studio")).toBe("static");
  await expect(page.locator("[data-studio-canvas]")).toBeHidden();
  const frames = page.locator("[data-reception-frame]");
  await expect(frames).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(frames.nth(i)).toBeVisible();
  await expect(page.locator("[data-reception-frame] img").first()).toBeVisible();
  await page.goto("/work?tab=photos");
  await expect(page.locator("[data-studio-wall] > li[hidden]")).toHaveCount(0);
  await expect(page.locator("[data-wall-pager]")).toBeHidden();
  await expect(page.locator("[data-studio-wall] img").first()).toBeVisible();
  await page.locator("a[data-album-card]").first().click();
  await expect(page).toHaveURL(/\/work\/albums\//);
  await expect(page.locator("[data-album-photo]").first()).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/studio/fallback/static-album-1440.png" });
  await ctx.close();
});

test("ST6 a lost GPU context switches to the static studio without losing the page", async ({ page }) => {
  await page.goto("/work?tab=photos");
  await settled(page, "albums");
  test.skip((await html(page, "data-studio")) !== "scene", "no GPU scene on this machine (fallback covered by ST5)");
  await page.evaluate(() => {
    const c = document.querySelector("canvas[data-studio-canvas]") as HTMLCanvasElement;
    (c.getContext("webgl2") ?? c.getContext("webgl"))?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect.poll(() => html(page, "data-studio")).toBe("static");
  await expect(page.locator("[data-studio-wall] > li[hidden]")).toHaveCount(0);
  await page.locator("a[data-album-card]").first().click();
  await expect(page).toHaveURL(/\/work\/albums\//);
});

test("ST7 reduced motion: corners change instantly (no camera journey), nothing animates in the room", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await settled(page, "reception");
  await page.locator("header nav a[href='/about']").first().click();
  await expect(page).toHaveURL(/\/about$/);
  // instant: never observed moving
  for (let i = 0; i < 6; i++) {
    const s = await stats(page);
    if (s) expect(s.moving).toBe(false);
    await page.waitForTimeout(80);
  }
  await settled(page, "about");
  await ctx.close();
});

test("ST8 the room only ever loads public, gated variants (no originals, no storage URLs)", async ({ page }) => {
  const images: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "image" || /\.(webp|jpe?g|png)(\?|$)/.test(r.url())) images.push(r.url());
  });
  await page.goto("/");
  await settled(page, "reception");
  await page.goto("/work?tab=photos");
  await settled(page, "albums");
  await page.locator("a[data-album-card]").first().click();
  await settled(page, "album");
  expect(images.length).toBeGreaterThan(0);
  for (const u of images) {
    expect(u, u).not.toMatch(/\/storage\/v1\//);
    expect(u, u).not.toMatch(/original/i);
    const p = new URL(u);
    expect(p.hostname === new URL(page.url()).hostname || p.hostname === "i.ytimg.com", u).toBe(true);
    if (p.pathname.startsWith("/p/")) expect(p.pathname, u).toMatch(/^\/p\/[0-9a-f-]{36}\/(thumb|display)$/);
  }
});

// /work streams its lists through Suspense (as on master): without JS they stay in the hidden stream segment —
// a pre-existing limitation of that page, not of the studio. The home and album pages render fully.
test("ST9 without JavaScript the home and an album keep their content and links (no room, no hidden items)", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 }, locale: "ar" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("#hero-title")).toBeVisible();
  await expect(page.locator("[data-reception-frame]")).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(page.locator("[data-reception-frame]").nth(i)).toBeVisible();
  const js = await browser.newContext();
  const href = await firstAlbum(await js.newPage());
  await js.close();
  await page.goto(href);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("[data-album-photo]").first()).toBeVisible();
  await expect(page.locator("[data-album-nav] a").first()).toBeVisible();
  await expect(page.locator("[data-studio-backdrop]")).toBeHidden();
  await ctx.close();
});

test("ST10 keyboard: wall cards and pager are reachable with Arabic names; hidden groups are not focusable", async ({ page }) => {
  await page.goto("/work?tab=photos");
  await settled(page, "albums");
  test.skip((await html(page, "data-studio")) !== "scene", "wall groups only exist with the scene");
  const pager = page.locator("[data-wall-pager]");
  const total = await page.locator("[data-studio-wall] > li").count();
  if (total > 5) {
    await expect(page.locator("[data-wall-prev]")).toBeDisabled(); // bounded: no wrap-around
    await expect(pager).toContainText(`من`);
    await expect(page.locator("[data-studio-wall] > li[hidden]")).toHaveCount(total - 5);
    await page.locator("[data-wall-next]").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-studio-wall] > li:not([hidden])").first().locator("a")).toBeFocused();
  }
  const visible = page.locator("[data-studio-wall] > li:not([hidden]) a").first();
  await visible.focus();
  await expect(visible).toBeFocused();
  const ring = await visible.evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(ring).not.toBe("none");
  await expect(visible).toHaveAccessibleName(/.+/);
});

test("ST11 home keeps its film, booking and phone actions next to the reception @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hero-cta='work']")).toBeVisible();
  await expect(page.locator("[data-hero-intro] [data-promo-trigger], [data-hero-intro] [data-promo-cover]").first()).toBeAttached();
  const frames = page.locator("[data-reception-frame]");
  await expect(frames).toHaveCount(3);
  await frames.nth(0).scrollIntoViewIfNeeded();
  const box = await frames.nth(0).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); // large touch targets
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
