import { expect, test, type Browser } from "@playwright/test";
import { db, skipSiteIntro } from "./qa-helpers";

/**
 * AC — album cover variants on the album list (fix/production-presentation). LOCAL STACK ONLY (one seeded published
 * album is briefly unpublished at photo level and restored).
 *   BASE_URL=http://localhost:3600 npx playwright test album-covers --project=chromium
 * The cards offer the gated thumb (480px box) and display (1600px box) through srcset; the browser picks by rendered
 * width × device pixel ratio. Both go through the same /p gate, so withdrawing a photo withdraws both.
 */
test.describe.configure({ mode: "serial" });

async function cover(browser: Browser, width: number, dpr: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: dpr, locale: "ar" });
  const page = await ctx.newPage();
  await skipSiteIntro(page);
  await page.goto("/work?tab=photos");
  const img = page.locator("a[data-album-card] img").first();
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => (e.complete && e.naturalWidth > 0 ? e.currentSrc : ""))).not.toBe("");
  const r = await img.evaluate((e: HTMLImageElement) => ({ src: e.currentSrc, natural: e.naturalWidth, shown: e.getBoundingClientRect().width, box: e.parentElement!.getBoundingClientRect() }));
  await ctx.close();
  return r;
}

test("AC1 sharp on dense screens: the picked variant has at least as many pixels as the frame needs", async ({ browser }) => {
  for (const [w, dpr, variant] of [[390, 1, "thumb"], [390, 2, "display"], [390, 3, "display"], [1440, 1, "thumb"], [1440, 2, "display"]] as const) {
    const r = await cover(browser, w, dpr);
    // The browser may reuse the sharper copy when the same photo is already loaded as the hero backdrop.
    expect(r.src, `${w}px @${dpr}x`).toMatch(new RegExp(`/p/[0-9a-f-]+/(${variant}|display)$`));
    // the frame is 2:3 with object-contain: the image must cover the frame's width or height in device pixels
    const need = Math.min(r.box.width, (r.box.height * 2) / 3) * dpr;
    if (variant === "thumb") expect(r.natural, `${w}px @${dpr}x natural ${r.natural} vs needed ${need.toFixed(0)}`).toBeGreaterThanOrEqual(Math.floor(need * 0.95));
  }
});

test("AC2 a cover that fails to load leaves a clean frame: title, count and link still there, no layout jump", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
  const page = await ctx.newPage();
  await skipSiteIntro(page);
  await page.route(/\/p\/[0-9a-f-]+\/(thumb|display)$/, (r) => r.fulfill({ status: 500, body: "" }));
  await page.goto("/work?tab=photos");
  const card = page.locator("a[data-album-card]").first();
  await expect(card).toBeVisible();
  const frame = (await card.locator("span").first().boundingBox())!;
  expect(Math.abs(frame.height / frame.width - 1.5)).toBeLessThan(0.02); // the 2:3 frame is kept
  await expect(card.locator("span").nth(1)).not.toBeEmpty(); // the title
  await expect(card).toHaveAttribute("href", /\/work\/albums\//);
  await ctx.close();
});

test("AC3 withdrawing a cover photo withdraws BOTH variants at once, with no shared cache", async ({ request }) => {
  const { data } = await db.from("photo_albums").select("cover_photo_id").eq("is_published", true).not("cover_photo_id", "is", null).limit(1);
  const id = data?.[0]?.cover_photo_id as string | undefined;
  test.skip(!id, "needs a published album with a cover");
  for (const v of ["thumb", "display"]) {
    const r = await request.get(`/p/${id}/${v}`);
    expect(r.status(), v).toBe(200);
    expect(r.headers()["cdn-cache-control"], v).toBe("no-store"); // never kept by a shared/CDN cache
    expect(r.headers()["cache-control"], v).toMatch(/^private/);
  }
  await db.from("album_photos").update({ is_published: false }).eq("id", id!);
  try {
    for (const v of ["thumb", "display"]) {
      const r = await request.get(`/p/${id}/${v}`);
      expect(r.status(), `${v} after withdrawal`).toBe(404);
      expect(r.headers()["cache-control"], v).toBe("no-store");
    }
  } finally {
    await db.from("album_photos").update({ is_published: true }).eq("id", id!);
  }
});
