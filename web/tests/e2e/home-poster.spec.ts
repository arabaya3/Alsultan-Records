import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BASE, overflowPx, skipSiteIntro, watchErrors } from "./qa-helpers";

/**
 * Homepage = the owner's poster design: hero, «من نحن», «كيف نوثّق مناسبتكم», «من أعمالنا», contact bar.
 *   BASE_URL=http://localhost:3400 npx playwright test home-poster --project=chromium
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
}

test("HP1: the five sections, in order, with the design's text", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 1440);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const order = await page.locator("main section[aria-labelledby]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby")));
  expect(order).toEqual(["hero-title", "about-title", "services-title", "work-title", "contact-title"]);

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1.locator("span.block")).toHaveText(["وراء كل مناسبة حكاية", "تستحق أن تُروى"]);
  const hero = page.locator("[data-home-hero]");
  await expect(hero).toContainText("ستوديو وتسجيلات السلطان");
  await expect(hero).toContainText("ميثلون — جنين");
  await expect(hero.locator("img[alt='ستوديو وتسجيلات السلطان']")).toBeVisible(); // the studio's own logo

  await expect(page.locator("#about-title")).toHaveText("من نحن");
  const about = page.locator("[data-home-section=about]");
  await expect(about).toContainText("ستوديو فلسطيني متخصص بتوثيق المناسبات صوتًا وصورة.");
  await expect(about).toContainText("طاقم نسائي منفصل");
  await expect(about).toContainText("طاقم شباب مختص");

  await expect(page.locator("#services-title")).toHaveText("كيف نوثّق مناسبتكم");
  await expect(page.locator("[data-home-section=services]").getByRole("heading", { level: 3 })).toHaveText(["تصوير فوتوغرافي", "تصوير فيديو"]);
  await expect(page.locator("#work-title")).toHaveText("من أعمالنا");
  await expect(page.locator("[data-home-section=contact]")).toContainText("ميثلون — جنين");
  expect(errors.errors).toEqual([]);
});

test("HP2: desktop layout — photo on the left with the text beside it, services in two equal columns, two works side by side", async ({ page }) => {
  await open(page, 1440);
  const photo = (await page.locator("[data-home-hero-photo]").boundingBox())!;
  const title = (await page.locator("#hero-title").boundingBox())!;
  expect(photo.x).toBe(0);
  expect(photo.width).toBeGreaterThan(600);
  expect(title.x).toBeGreaterThan(photo.x + photo.width * 0.76); // clear of the slanted edge
  expect(title.y).toBeGreaterThan(photo.y);
  expect(title.y + title.height).toBeLessThan(photo.y + photo.height);

  const cols = await page.locator("[data-home-section=services] li").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width })));
  expect(cols).toHaveLength(2);
  expect(cols[0].y).toBe(cols[1].y);
  expect(Math.abs(cols[0].w - cols[1].w)).toBeLessThanOrEqual(1);
  expect(cols[0].x).toBeGreaterThan(cols[1].x); // RTL: photography first, on the right

  const works = await page.locator("[data-home-work]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  expect(works).toHaveLength(2);
  expect(works[0].y).toBe(works[1].y);
  expect(works[0].w).toBe(works[1].w);

  // Contact bar: one row, in the design's reading order (location, phone, WhatsApp from the right).
  const bar = page.locator("[data-home-section=contact]");
  const xs = await Promise.all([bar.locator("p").first(), bar.locator("[data-home-phone]"), bar.locator("[data-whatsapp-cta]")].map(async (l) => (await l.boundingBox())!));
  expect(xs[0].x).toBeGreaterThan(xs[1].x);
  expect(xs[1].x).toBeGreaterThan(xs[2].x);
  expect(Math.abs(xs[0].y + xs[0].height / 2 - (xs[2].y + xs[2].height / 2))).toBeLessThan(4);
});

test("HP3: every control works — WhatsApp, phone, works open real published pages, header nav still there", async ({ page, request }) => {
  await open(page, 1440);
  const wa = page.locator("main [data-whatsapp-cta]");
  await expect(wa).toHaveCount(2); // hero + contact bar
  for (const a of await wa.all()) {
    await expect(a).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
    await expect(a).toContainText("تواصل عبر واتساب");
  }
  const phone = page.locator("[data-home-phone]");
  await expect(phone).toHaveAttribute("href", /^tel:\+\d{9,15}$/);
  await expect(phone.locator("[dir=ltr]")).toBeVisible();

  const works = page.locator("[data-home-work]");
  await expect(works).toHaveCount(2);
  for (const w of await works.all()) {
    const href = (await w.getAttribute("href"))!;
    expect(href).toMatch(/^\/work\/(v|albums)\/[\w-]+$/);
    expect((await request.get(`${BASE}${href}`)).status()).toBe(200);
    expect((await w.innerText()).trim().length).toBeGreaterThan(0); // the work's title is the link's name
  }
  const first = works.first();
  const href = (await first.getAttribute("href"))!;
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[/-]/g, "\\$&")}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto(`${BASE}/`);
  await expect(page.locator("header nav a[href='/work']").first()).toBeVisible();
  await expect(page.locator("[data-site-footer]")).toBeVisible();
});

test("HP4: media rules — hero photo only through /p, works are real, nothing from YouTube but thumbnails, no iframe", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  await open(page, 1440);
  const heroImg = page.locator("[data-home-hero-photo] img");
  if (await heroImg.count()) {
    await expect(heroImg).toHaveAttribute("src", /^\/p\/[0-9a-f-]{36}\/display$/);
    await expect(heroImg).toHaveAttribute("alt", "");
    expect(await heroImg.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  for (const img of await page.locator("[data-home-work] img").all()) {
    await img.scrollIntoViewIfNeeded();
    expect(await img.getAttribute("src")).toMatch(/^(\/p\/[0-9a-f-]{36}\/(thumb|display)|https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/hqdefault\.jpg)$/);
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  expect(await page.locator("iframe").count()).toBe(0);
  expect([...hosts].filter((h) => /youtube|googlevideo|doubleclick/.test(h))).toEqual([]);
});

for (const width of [360, 390, 768, 1440, 1920]) {
  test(`HP5: no horizontal scroll and nothing clipped at ${width}px`, async ({ page }) => {
    await open(page, width);
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    // No visible text block reaches past the viewport.
    const wide = await page.locator("main :is(h1,h2,h3,p,a,li):not(.sr-only)").evaluateAll((els, w) => els.filter((e) => e.getBoundingClientRect().right > w + 0.5 || e.getBoundingClientRect().left < -0.5).map((e) => e.textContent?.slice(0, 40)), width);
    expect(wide).toEqual([]);
  });
}

test("HP6 @mobile: 390px — hero stacked (photo, then text), text legible, touch targets ≥ 44px", async ({ page }) => {
  await open(page, 390);
  const photo = (await page.locator("[data-home-hero-photo]").boundingBox())!;
  const title = (await page.locator("#hero-title").boundingBox())!;
  expect(photo.width).toBe(390);
  expect(title.y).toBeGreaterThanOrEqual(photo.y + photo.height * 0.86 - 1);
  const cta = (await page.locator("[data-home-hero] [data-whatsapp-cta]").boundingBox())!;
  expect(cta.y).toBeGreaterThan(title.y + title.height);

  const small = await page.locator("main :is(h1,h2,h3,p,a,span)").evaluateAll((els) =>
    els.filter((e) => e.textContent?.trim() && !e.closest(".sr-only") && getComputedStyle(e).position !== "absolute" && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${e.textContent?.slice(0, 30)} @${getComputedStyle(e).fontSize}`),
  );
  expect(small).toEqual([]);

  const targets = await page.locator("main a").evaluateAll((els) => els.map((e) => ({ t: (e.textContent ?? "").trim().slice(0, 30), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })));
  expect(targets.length).toBeGreaterThanOrEqual(5); // 2 WhatsApp, phone, 2 works
  for (const t of targets) {
    expect(t.h, t.t).toBeGreaterThanOrEqual(44);
    expect(t.w, t.t).toBeGreaterThanOrEqual(44);
  }
  // Services stack on a phone.
  const ys = await page.locator("[data-home-section=services] li").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y));
  expect(ys[1]).toBeGreaterThan(ys[0]);
});

test("HP7: axe clean at 390 and 1440; one h1; headings in order", async ({ page }) => {
  for (const width of [390, 1440]) {
    await open(page, width);
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `axe@${width}`).toEqual([]);
  }
  await expect(page.locator("h1")).toHaveCount(1);
  const levels = await page.locator("main :is(h1,h2,h3)").evaluateAll((els) => els.map((e) => Number(e.tagName[1])));
  expect(levels).toEqual([1, 2, 2, 3, 3, 2, 2]);
});

test("HP8: keyboard order follows the page; reduced motion and normal motion both leave the page still (no carousel)", async ({ browser }) => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    const ctx = await browser.newContext({ reducedMotion, viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await skipSiteIntro(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect)?.target?.closest?.("main")).length);
    expect(running, reducedMotion).toBe(0);
    const transformed = await page.locator("main *").evaluateAll((els) => els.filter((e) => /matrix3d|perspective/.test(getComputedStyle(e).transform)).length);
    expect(transformed).toBe(0);
    if (reducedMotion === "no-preference") {
      const main = page.locator("main");
      const order = await main.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("data-home-work") ? "work" : e.hasAttribute("data-home-phone") ? "phone" : "wa"));
      expect(order).toEqual(["wa", "work", "work", "phone", "wa"]);
      await main.locator("a").first().focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("[data-home-work]").first()).toBeFocused();
    }
    await ctx.close();
  }
});
