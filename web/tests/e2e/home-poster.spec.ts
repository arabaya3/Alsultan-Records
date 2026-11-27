import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { BASE, db, newLoggedIn, overflowPx, refreshPublicCache, SHOTS, skipSiteIntro, watchErrors } from "./qa-helpers";

/**
 * Home page in the owner's poster design, and the admin → home contract behind it:
 *   - «الصفحة الرئيسية» (sections part) decides which sections are on the home page, in which order and under which titles;
 *   - «الصفحة الرئيسية» decides the hero title, the text under it and the WhatsApp button label (empty = the design's text);
 *   - a control the design cannot use is shown disabled, and saving never changes its stored value.
 * The suite first puts the design's own configuration in place THROUGH THE ADMIN (about → services → works → contact,
 * two works), checks the page against the design, then changes one control at a time. Everything is restored at the end.
 *   BASE_URL=http://localhost:3400 npx playwright test home-poster
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const POSTER = ["about", "services", "works", "contact"];
const SERVICES_TITLE = "كيف نوثّق مناسبتكم";
const HERO_COLS = "hero_title, hero_subtitle, hero_primary_label, hero_secondary_label, hero_promo_source, hero_promo_video_id";
const SECTION_COLS = "key, title, intro, is_visible, sort_order, item_limit, featured_ids, stat_value";

type SectionRow = { key: string; title: string | null; intro: string | null; is_visible: boolean; sort_order: number; item_limit: number; featured_ids: string[]; stat_value: number | null };
let sectionsBefore: SectionRow[] = [];
let heroBefore: Record<string, unknown> = {};
let admin: Page;

const section = async (key: string) => (await db.from("site_sections").select(SECTION_COLS).eq("key", key).single()).data as SectionRow;

/** Section order as the home page shows it (stable heading ids → section keys). */
const ID_TO_KEY: Record<string, string> = {
  "hero-title": "hero",
  "about-title": "about",
  "services-title": "services",
  "work-title": "works",
  "contact-title": "contact",
  "offers-title": "offers",
  "albums-title": "albums",
  "stats-title": "stats",
  "steps-title": "process",
  "promos-title": "promos",
};
const homeOrder = (page: Page) => page.locator("main section[aria-labelledby]").evaluateAll((els, map) => els.map((e) => map[e.getAttribute("aria-labelledby") ?? ""] ?? "?"), ID_TO_KEY);

async function open(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
}
/** A fresh visitor's home page, re-read until the admin's save has reached it (the save expires the cache at once). */
async function homeShows<T>(browser: Browser, read: (page: Page) => Promise<T>, expected: T) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar" });
  const page = await ctx.newPage();
  await skipSiteIntro(page);
  try {
    await expect
      .poll(
        async () => {
          await page.goto(`${BASE}/`);
          return read(page);
        },
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toEqual(expected);
  } finally {
    await ctx.close();
  }
}

// ---- the admin, driven like the owner drives it
const NAV = "/admin/content/home"; // home sections are edited on «الصفحة الرئيسية» (moved from the nav page)
const adminOrder = () => admin.locator("[data-testid=sections-order] [data-testid=section-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-key")!));

async function setVisible(key: string, visible: boolean) {
  await admin.goto(`${BASE}${NAV}`);
  const row = admin.locator(`[data-testid=section-row][data-key=${key}]`);
  await expect(row).toBeVisible();
  const on = row.getByRole("button", { name: "إخفاء", exact: true }); // offered while the section is shown
  const off = row.getByRole("button", { name: "إظهار", exact: true });
  if ((await (visible ? on : off).count()) === 0) {
    await (visible ? off : on).click();
    await expect(visible ? on : off).toBeVisible();
  }
  expect((await section(key)).is_visible).toBe(visible);
}
/** Moves sections with the list's own ↑ buttons until `keys` lead the list in this order. */
async function setOrder(keys: string[]) {
  await admin.goto(`${BASE}${NAV}`);
  await expect(admin.locator("[data-testid=sections-order] [data-testid=section-row]").first()).toBeVisible();
  for (let i = 0; i < keys.length; i++) {
    for (let guard = 0; guard < 12; guard++) {
      const order = await adminOrder();
      const at = order.indexOf(keys[i]);
      if (at === i) break;
      expect(at).toBeGreaterThan(i);
      await admin.locator("[data-testid=sections-order] [data-testid=sort-row]").nth(at).getByRole("button", { name: "نقل للأعلى" }).click();
      await expect.poll(async () => (await adminOrder()).indexOf(keys[i])).toBe(at - 1);
      await expect(admin.locator("[data-testid=sections-order] [data-testid=order-msg]")).toHaveAttribute("data-ok", "1");
    }
  }
  expect((await adminOrder()).slice(0, keys.length)).toEqual(keys);
  const saved = ((await db.from("site_sections").select("key").order("sort_order")).data ?? []).map((r) => r.key);
  expect(saved.slice(0, keys.length)).toEqual(keys);
}
async function saveSectionCard(key: string, fill: (form: ReturnType<Page["getByTestId"]>) => Promise<void>) {
  await admin.goto(`${BASE}${NAV}`); // fresh page: no earlier «saved» message on the form
  const form = admin.getByTestId(`section-${key}`);
  await fill(form);
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
}
async function saveHero(fill: (form: ReturnType<Page["getByTestId"]>) => Promise<void>) {
  await admin.goto(`${BASE}/admin/content/home`);
  const form = admin.getByTestId("home-form");
  await fill(form);
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  sectionsBefore = ((await db.from("site_sections").select(SECTION_COLS)).data ?? []) as SectionRow[];
  heroBefore = (await db.from("business_settings").select(HERO_COLS).eq("id", 1).single()).data as unknown as Record<string, unknown>;
  expect(sectionsBefore.length).toBeGreaterThanOrEqual(9);
  admin = await newLoggedIn(browser, "owner", NAV);

  // The design's configuration, set the way the owner would set it.
  for (const k of ["offers", "albums", "stats", "process", "promos"]) await setVisible(k, false);
  for (const k of POSTER) await setVisible(k, true);
  await setOrder(POSTER);
  await saveSectionCard("services", async (f) => f.locator('input[name="title"]').fill(SERVICES_TITLE));
  await saveSectionCard("works", async (f) => {
    await f.locator('input[name="title"]').fill("من أعمالنا");
    await f.locator('input[name="item_limit"]').fill("2");
  });
  await saveSectionCard("about", async (f) => {
    await f.locator('input[name="title"]').fill("من نحن");
    await f.locator('textarea[name="intro"]').fill("");
  });
  await saveHero(async (f) => {
    await f.locator('input[name="hero_title"]').fill("");
    await f.locator('textarea[name="hero_subtitle"]').fill("");
    await f.locator('input[name="hero_primary_label"]').fill("");
  });
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(300_000);
  for (const s of sectionsBefore) {
    const { key, ...rest } = s;
    await db.from("site_sections").update(rest).eq("key", key);
  }
  await db.from("business_settings").update(heroBefore).eq("id", 1);
  await admin?.context().close();
  await refreshPublicCache(browser); // restored with the secret key: the public cache only follows an admin save
});

test("HP1: the design's configuration gives the five sections, in order, with the design's text", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await homeOrder(page)).toEqual(["hero", ...POSTER]);

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1.locator("span.block")).toHaveText(["وراء كل مناسبة حكاية", "تستحق أن تُروى"]);
  const hero = page.locator("[data-home-hero]");
  await expect(hero.locator("[data-hero-sub=default]")).toContainText("ستوديو وتسجيلات السلطان");
  await expect(hero.locator("[data-hero-sub=default]")).toContainText("ميثلون — جنين");
  await expect(hero.locator("img[alt='ستوديو وتسجيلات السلطان']")).toBeVisible(); // the studio's own logo

  await expect(page.locator("#about-title")).toHaveText("من نحن");
  const about = page.locator("[data-home-section=about]");
  await expect(about).toContainText("ستوديو فلسطيني متخصص بتوثيق المناسبات صوتًا وصورة.");
  await expect(about).toContainText("طاقم نسائي منفصل");
  await expect(about).toContainText("طاقم شباب مختص");

  await expect(page.locator("#services-title")).toHaveText(SERVICES_TITLE);
  await expect(page.locator("[data-home-section=services]").getByRole("heading", { level: 3 })).toHaveText(["تصوير فوتوغرافي", "تصوير فيديو"]);
  await expect(page.locator("#work-title")).toHaveText("من أعمالنا");
  await expect(page.locator("[data-home-work]")).toHaveCount(2);
  await expect(page.locator("[data-home-section=contact]")).toContainText("ميثلون — جنين");
  // Ivory sections between the navy hero and the navy bar, as in the design.
  expect(await page.locator("main section[data-home-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tone")))).toEqual(["ivory", "ivory", "ivory", "navy"]);
  expect(errors.errors).toEqual([]);

  // The page as designed, for the before/after comparison in docs/screenshots/home-poster.
  for (const width of [1440, 390]) {
    await open(page, width);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
      window.scrollTo(0, 0);
    });
    await expect.poll(() => page.locator("main img").evaluateAll((is) => is.every((i) => (i as HTMLImageElement).complete))).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, "home-poster", `home-after-${width}.jpg`), type: "jpeg", quality: 80, fullPage: true });
  }
});

test("HP2: desktop layout — photo on the left with the text beside it, services in two equal columns, two works side by side", async ({ page }) => {
  await open(page);
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

  // Contact bar: one row, in the design's reading order (location, phone, WhatsApp from the right), rounded over ivory.
  const bar = page.locator("[data-home-section=contact]");
  const xs = await Promise.all([bar.locator("p").first(), bar.locator("[data-home-phone]"), bar.locator("[data-whatsapp-cta]")].map(async (l) => (await l.boundingBox())!));
  expect(xs[0].x).toBeGreaterThan(xs[1].x);
  expect(xs[1].x).toBeGreaterThan(xs[2].x);
  expect(Math.abs(xs[0].y + xs[0].height / 2 - (xs[2].y + xs[2].height / 2))).toBeLessThan(4);
  expect(parseFloat(await bar.evaluate((e) => getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThan(20);
});

test("HP3: every control works — WhatsApp and phone come from the saved settings, works open real published pages, header nav still there", async ({ page, request }) => {
  const biz = (await db.from("business_settings").select("phone, whatsapp").eq("id", 1).single()).data!;
  await open(page);
  const wa = page.locator("main [data-whatsapp-cta]");
  await expect(wa).toHaveCount(2); // hero + contact bar
  for (const a of await wa.all()) {
    await expect(a).toHaveAttribute("href", new RegExp(`^https://wa\\.me/${String(biz.whatsapp).replace(/\D/g, "")}\\?text=`));
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
    await expect(a).toContainText("تواصل عبر واتساب");
  }
  const phone = page.locator("[data-home-phone]");
  await expect(phone).toHaveAttribute("href", `tel:${String(biz.phone).replace(/[^\d+]/g, "")}`);
  await expect(phone.locator("[dir=ltr]")).toHaveText(String(biz.phone));

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

test("HP4: media rules — hero photo only through /p (small variant under the sharp one), works are real, nothing from YouTube but thumbnails, no iframe", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  await open(page);
  const sharp = page.locator("[data-home-hero-photo] img[data-hero-photo=sharp]");
  const small = page.locator("[data-home-hero-photo] img[data-hero-photo=placeholder]");
  await expect(sharp).toHaveAttribute("src", /^\/p\/[0-9a-f-]{36}\/display$/);
  await expect(small).toHaveAttribute("src", /^\/p\/[0-9a-f-]{36}\/thumb$/);
  expect((await sharp.getAttribute("src"))!.split("/")[2]).toBe((await small.getAttribute("src"))!.split("/")[2]); // the same photo
  for (const img of [sharp, small]) {
    await expect(img).toHaveAttribute("alt", "");
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  // The sharp layer is on top and covers the whole panel.
  expect(await sharp.evaluate((i) => i.compareDocumentPosition(i.parentElement!.querySelector("[data-hero-photo=placeholder]")!) & Node.DOCUMENT_POSITION_PRECEDING)).toBeTruthy();
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

test("HP6: 390px — hero stacked (photo, then text), text legible, touch targets ≥ 44px", async ({ page }) => {
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
  expect(targets.length).toBe(5); // 2 WhatsApp, phone, 2 works (no album label on the hero photo)
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

// Owner change (2026-11): the hero photo is now an album slideshow (soft cross-fade, no label on it); the rest
// of the page stays still: no 3D, nothing waiting on an animation, keyboard order as the page reads.
test("HP8: keyboard order follows the page; reduced motion and normal motion leave the page still at load (no 3D)", async ({ browser }) => {
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
    // Text and buttons are at full opacity from the first paint (nothing waits for an animation).
    const faded = await page.locator("main :is(h1,h2,h3,p,a)").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== "1").length);
    expect(faded).toBe(0);
    if (reducedMotion === "no-preference") {
      const main = page.locator("main");
      const order = await main.locator("a").evaluateAll((els) =>
        els.map((e) => (e.closest("[data-hero-album]") ? "album" : e.getAttribute("data-home-work") ? "work" : e.hasAttribute("data-home-phone") ? "phone" : "wa")),
      );
      expect(order).toEqual(["wa", "work", "work", "phone", "wa"]);
      await main.locator("a").first().focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("[data-home-work]").first()).toBeFocused();
    }
    await ctx.close();
  }
});

test("HP9: phone on a slow connection (4× CPU, 1.6 Mbps, 150 ms) — the photo paints early, sharpens without a layout shift, and is sharp enough for the screen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, locale: "ar" });
  const page = await ctx.newPage();
  await skipSiteIntro(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp: { t: number; url: string; tag: string } | null; __cls: number };
    w.__lcp = null;
    w.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as { startTime: number; url: string; element: Element | null }[]) w.__lcp = { t: Math.round(e.startTime), url: e.url ?? "", tag: e.element?.tagName ?? "" };
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  const sharp = page.locator("[data-home-hero-photo] img[data-hero-photo=sharp]");
  await expect.poll(() => sharp.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const w = window as unknown as { __lcp: { t: number; url: string; tag: string } | null; __cls: number };
    const res = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) => /\/p\//.test(e.name)).map((e) => ({ v: e.name.split("/").pop()!, end: Math.round(e.responseEnd), kb: Math.round(e.transferSize / 1024) }));
    const i = document.querySelector<HTMLImageElement>("[data-home-hero-photo] img[data-hero-photo=sharp]")!;
    return { lcp: w.__lcp, cls: w.__cls, res, natural: i.naturalWidth, shownDevicePx: Math.round(i.getBoundingClientRect().width * devicePixelRatio) };
  });
  test.info().annotations.push({ type: "mobile-hero", description: JSON.stringify(m) });
  const small = m.res.find((r) => r.v === "thumb")!;
  const big = m.res.find((r) => r.v === "display")!;
  expect(m.lcp?.tag).toBe("IMG");
  expect(m.lcp!.url).toMatch(/\/p\/[0-9a-f-]{36}\/thumb$/); // first paint of the photo = the small file…
  expect(small.end).toBeLessThan(big.end); // …which arrives well before the sharp one
  expect(m.lcp!.t).toBeLessThan(big.end);
  expect(m.lcp!.t).toBeLessThan(3000);
  expect(m.cls).toBeLessThan(0.02); // the sharp layer lands in the same box
  expect(m.natural).toBeGreaterThanOrEqual(m.shownDevicePx * 0.95); // not upscaled on this screen: sharp
  await ctx.close();
});

// ------------------------------------------------------------------------------------------- admin → home contract

test("HA1: hero title, text under it and the WhatsApp label saved in the admin are what the home page shows; cleared, the design's text returns", async ({ browser }) => {
  const T = "حكايتكم نرويها كما هي";
  const SUB = "نص تجريبي تحت العنوان\nسطر ثانٍ";
  const LABEL = "احجز موعدك الآن";
  await saveHero(async (f) => {
    await f.locator('input[name="hero_title"]').fill(T);
    await f.locator('textarea[name="hero_subtitle"]').fill(SUB);
    await f.locator('input[name="hero_primary_label"]').fill(LABEL);
  });
  await homeShows(
    browser,
    async (p) => ({
      title: await p.locator("#hero-title [data-hero-title=saved]").innerText().catch(() => null),
      sub: await p.locator("[data-hero-sub=saved]").innerText().catch(() => null),
      labels: await p.locator("main [data-whatsapp-cta]").allInnerTexts(),
      h1s: await p.locator("h1").count(),
    }),
    { title: T, sub: SUB, labels: [LABEL, LABEL], h1s: 1 },
  );
  // A long saved title wraps inside the hero at phone width instead of widening the page.
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const phone = await ctx.newPage();
  await skipSiteIntro(phone);
  await phone.goto(`${BASE}/`);
  expect(await overflowPx(phone)).toBeLessThanOrEqual(0);
  await ctx.close();

  await saveHero(async (f) => {
    await f.locator('input[name="hero_title"]').fill("");
    await f.locator('textarea[name="hero_subtitle"]').fill("");
    await f.locator('input[name="hero_primary_label"]').fill("");
  });
  await homeShows(
    browser,
    async (p) => ({ lines: await p.locator("#hero-title span.block").allInnerTexts(), sub: await p.locator("[data-hero-sub=default]").count(), labels: await p.locator("main [data-whatsapp-cta]").allInnerTexts() }),
    { lines: ["وراء كل مناسبة حكاية", "تستحق أن تُروى"], sub: 1, labels: ["تواصل عبر واتساب", "تواصل عبر واتساب"] },
  );
});

test("HA2: a section's saved title, intro and number of works reach the home page", async ({ browser }) => {
  await saveSectionCard("about", async (f) => {
    await f.locator('input[name="title"]').fill("تعرّف علينا");
    await f.locator('textarea[name="intro"]').fill("نبذة يكتبها صاحب الاستوديو.");
  });
  await saveSectionCard("services", async (f) => f.locator('textarea[name="intro"]').fill("مقدمة قسم الخدمات."));
  await saveSectionCard("works", async (f) => {
    await f.locator('input[name="title"]').fill("آخر ما صوّرنا");
    await f.locator('input[name="item_limit"]').fill("3");
  });
  await homeShows(
    browser,
    async (p) => ({
      about: await p.locator("#about-title").innerText(),
      aboutIntro: await p.locator("[data-home-section=about] [data-section-intro]").innerText(),
      team: await p.locator("[data-home-section=about]").getByText("طاقم نسائي منفصل").count(), // the design's line stays
      servicesIntro: await p.locator("[data-home-section=services] [data-section-intro]").innerText(),
      works: await p.locator("#work-title").innerText(),
      n: await p.locator("[data-home-work]").count(),
    }),
    { about: "تعرّف علينا", aboutIntro: "نبذة يكتبها صاحب الاستوديو.", team: 1, servicesIntro: "مقدمة قسم الخدمات.", works: "آخر ما صوّرنا", n: 3 },
  );
  // Back to the design.
  await saveSectionCard("about", async (f) => {
    await f.locator('input[name="title"]').fill("من نحن");
    await f.locator('textarea[name="intro"]').fill("");
  });
  await saveSectionCard("services", async (f) => f.locator('textarea[name="intro"]').fill(""));
  await saveSectionCard("works", async (f) => {
    await f.locator('input[name="title"]').fill("من أعمالنا");
    await f.locator('input[name="item_limit"]').fill("2");
  });
  await homeShows(browser, async (p) => ({ about: await p.locator("#about-title").innerText(), intros: await p.locator("[data-home-section=services] [data-section-intro]").count(), n: await p.locator("[data-home-work]").count() }), { about: "من نحن", intros: 0, n: 2 });
});

test("HA3: hiding, showing and reordering sections in the admin is exactly what the home page does", async ({ browser }) => {
  await setVisible("services", false);
  await homeShows(browser, homeOrder, ["hero", "about", "works", "contact"]);
  await setVisible("services", true);
  await homeShows(browser, homeOrder, ["hero", ...POSTER]);

  await setOrder(["works", "about", "services", "contact"]);
  await homeShows(browser, homeOrder, ["hero", "works", "about", "services", "contact"]);

  // A section outside the design's four shows up in its saved place, as a navy band with the same heading style;
  // the contact bar after a navy band is a plain bar (no ivory corners showing).
  await setVisible("process", true);
  await setOrder(["works", "about", "services", "process", "contact"]);
  await homeShows(
    browser,
    async (p) => ({
      order: await homeOrder(p),
      tones: await p.locator("main section[data-home-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tone"))),
      steps: (await p.locator("[data-home-section=process] ol > li").count()) > 0,
      barRadius: await p.locator("[data-home-section=contact]").evaluate((e) => getComputedStyle(e).borderTopLeftRadius),
      overflow: await overflowPx(p),
    }),
    { order: ["hero", "works", "about", "services", "process", "contact"], tones: ["ivory", "ivory", "ivory", "navy", "navy"], steps: true, barRadius: "0px", overflow: 0 },
  );

  await setVisible("process", false);
  await setOrder(POSTER);
  await homeShows(browser, homeOrder, ["hero", ...POSTER]);
});

test("HA4: controls the design cannot use are disabled with a reason, and saving keeps their stored values", async () => {
  const svc = ((await db.from("services").select("id").limit(1)).data ?? [])[0]?.id as string | undefined;
  await db.from("site_sections").update({ item_limit: 5, featured_ids: svc ? [svc] : [] }).eq("key", "services");
  await db.from("site_sections").update({ title: "عنوان محفوظ", intro: "نص محفوظ", item_limit: 7 }).eq("key", "contact");
  await db.from("site_sections").update({ item_limit: 9 }).eq("key", "about");
  await db.from("business_settings").update({ hero_secondary_label: "زر قديم محفوظ" }).eq("id", 1);
  const promoBefore = (await db.from("business_settings").select("hero_promo_source, hero_promo_video_id").eq("id", 1).single()).data!;

  await admin.goto(`${BASE}${NAV}`);
  await expect(admin.getByTestId("poster-note")).toBeVisible();
  // services: title and intro editable; number of items and featured services are not offered
  const services = admin.getByTestId("section-services");
  await expect(services.getByTestId("section-why")).toContainText("عمودين ثابتين");
  await expect(services.locator('input[name="title"]')).toBeEditable();
  await expect(services.locator('input[name="item_limit"]')).toHaveAttribute("type", "hidden");
  await expect(services.locator('input[type="checkbox"][name="featured_ids"]')).toHaveCount(0);
  // contact: only show/hide
  const contact = admin.getByTestId("section-contact");
  await expect(contact.getByTestId("off-title")).toBeDisabled();
  await expect(contact.getByTestId("off-title")).toHaveValue("عنوان محفوظ");
  await expect(contact.getByTestId("off-intro")).toBeDisabled();
  await expect(contact.locator('input[name="is_visible"]')).toBeEnabled();
  // about: no number of items
  await expect(admin.getByTestId("section-about").locator('input[name="item_limit"]')).toHaveAttribute("type", "hidden");
  // offers: shown in the strip under the hero instead (owner change), so the card explains why and offers nothing to set
  const offersCard = admin.getByTestId("section-offers");
  await expect(offersCard.getByTestId("section-why")).toContainText("بشريط تحت الواجهة");
  await expect(offersCard.getByTestId("off-title")).toBeDisabled();
  await expect(offersCard.getByTestId("off-intro")).toBeDisabled();
  await expect(offersCard.locator('input[name="item_limit"]')).toHaveAttribute("type", "hidden");
  // sections that use every control still offer it
  for (const k of ["works", "albums", "process"]) await expect(admin.getByTestId(`section-${k}`).locator('input[name="item_limit"]')).toHaveAttribute("type", "number");

  await saveSectionCard("services", async (f) => f.locator('input[name="title"]').fill(SERVICES_TITLE));
  await saveSectionCard("contact", async () => {});
  await saveSectionCard("about", async () => {});
  expect(await section("services")).toMatchObject({ title: SERVICES_TITLE, item_limit: 5, featured_ids: svc ? [svc] : [] });
  expect(await section("contact")).toMatchObject({ title: "عنوان محفوظ", intro: "نص محفوظ", item_limit: 7, is_visible: true });
  expect(await section("about")).toMatchObject({ item_limit: 9 });

  // hero: the second button and the hero video are not part of the design
  await admin.goto(`${BASE}/admin/content/home`);
  const home = admin.getByTestId("home-form");
  await expect(home.getByTestId("off-secondary-label")).toBeDisabled();
  await expect(home.getByTestId("off-secondary-label")).toHaveValue("زر قديم محفوظ");
  await expect(home.getByTestId("off-hero-video")).toContainText("غير مستخدم");
  await expect(home.locator('input[type="radio"][name="hero_promo_source"]')).toHaveCount(0);
  await expect(home.locator('input[name="hero_title"]')).toBeEditable();
  await saveHero(async () => {});
  expect((await db.from("business_settings").select("hero_secondary_label, hero_promo_source, hero_promo_video_id").eq("id", 1).single()).data).toEqual({ hero_secondary_label: "زر قديم محفوظ", ...promoBefore });
});

test("HA5: a visitor never sees the disabled values, and the page is still the design after all the saves", async ({ page }) => {
  await open(page);
  expect(await homeOrder(page)).toEqual(["hero", ...POSTER]);
  await expect(page.locator("main")).not.toContainText("عنوان محفوظ");
  await expect(page.locator("main")).not.toContainText("زر قديم محفوظ");
  await expect(page.locator("[data-home-section=services] li")).toHaveCount(2);
  await expect(page.locator("#contact-title")).toHaveText("تواصل معنا");
});
