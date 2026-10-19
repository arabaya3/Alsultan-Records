/**
 * Design-audit measurements + screenshots (docs/design-audit.md). Read-only.
 *   node scripts/design-audit-measure.mjs <label> [baseUrl]
 * Writes docs/screenshots/design-audit/fixes/<label>-<page>-<width>.png and .cache/design-<label>.json
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [label = "run", BASE = "http://localhost:3600"] = process.argv.slice(2);
const OUT = "../docs/screenshots/design-audit/fixes";
const PAGES = { home: "/", work: "/work", album: "/work/albums/wedding-dawood-nairat-2026", packages: "/packages", offers: "/offers", services: "/services", about: "/about" };
const WIDTHS = [320, 390, 768, 1440, 1920];
const b = await chromium.launch();
const res = {};
for (const w of WIDTHS) {
  const c = await b.newContext({ viewport: { width: w, height: w < 800 ? 844 : 900 }, locale: "ar" });
  await c.addInitScript(() => { try { sessionStorage.setItem("sultan-intro-v1", "1"); } catch {} });
  const p = await c.newPage();
  for (const [name, url] of Object.entries(PAGES)) {
    await p.goto(BASE + url, { waitUntil: "networkidle" });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${label}-${name}-${w}.png` });
    res[`${name}@${w}`] = await p.evaluate(() => {
      const r = {};
      r.overflow = document.documentElement.scrollWidth - innerWidth;
      const hero = document.querySelector(".hero-flow");
      if (hero && !hero.querySelector("#hero-title")) {
        const leaves = [...hero.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.getBoundingClientRect().height > 0 && !e.closest("[aria-hidden=true]"));
        const textBottom = Math.max(...leaves.map((e) => e.getBoundingClientRect().bottom));
        let next = hero.nextElementSibling; while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
        const firstTop = next ? Math.min(...[...next.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.getBoundingClientRect().height > 0 && !e.closest(".sr-only")).map((e) => e.getBoundingClientRect().top)) : null;
        r.heroGap = Math.round(firstTop - textBottom);
      }
      const photos = [...document.querySelectorAll("main img")].map((i) => i.getBoundingClientRect()).filter((x) => x.width > 100 && x.top > 150);
      if (location.pathname.startsWith("/work/albums/")) { r.firstPhotoTop = Math.round(photos[0]?.top); r.photosStartedInFold = photos.filter((x) => x.top < innerHeight).length; r.photosFullyInFold = photos.filter((x) => x.bottom <= innerHeight).length; }
      const chips = document.querySelector("[data-cat-chip]")?.closest("ul");
      if (chips) { const cr = chips.getBoundingClientRect(); r.chipsH = Math.round(cr.height); const media = [...document.querySelectorAll("main img, main button, main a")].map((e) => e.getBoundingClientRect()).filter((x) => x.height > 120 && x.top > cr.bottom); r.firstMediaTop = media.length ? Math.round(Math.min(...media.map((x) => x.top))) : null; }
      if (location.pathname === "/") { r.heroTitleTop = Math.round(document.querySelector("#hero-title").getBoundingClientRect().top); r.heroMarkVisible = (() => { const m = document.querySelector("[data-hero-mark]"); return !!m && m.getBoundingClientRect().height > 0; })(); }
      const tag = document.querySelector("[data-footer-tagline]"); if (tag) r.footerTagline = getComputedStyle(tag).fontSize;
      if (location.pathname === "/packages") {
        const cards = [...document.querySelectorAll("[data-package-card]")];
        r.packageCards = cards.length;
        r.cardsClipped = cards.filter((c) => c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll("*")].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible")).length;
        r.priceTexts = cards.slice(0, 3).map((c) => c.querySelector("[data-package-price]")?.textContent?.trim() ?? null);
      }
      return r;
    });
  }
  await c.close();
}
await b.close();
fs.writeFileSync(`.cache/design-${label}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
