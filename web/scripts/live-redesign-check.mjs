#!/usr/bin/env node
/**
 * Live check of the public redesign (read-only: no login, no writes).
 *   node scripts/live-redesign-check.mjs [--shots ../docs/screenshots/redesign/live]
 * Journeys: home → category → video plays (iframe only after click); works → album → lightbox shows the whole
 * photo (contain, natural ratio), Esc closes, focus returns; packages → WhatsApp text names the package.
 * Every page at 320/390/768/1440/1920: HTTP 200, no horizontal overflow, no storage/original URLs, no YouTube iframe
 * before a click. Saves desktop + mobile screenshots.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://sultan-records.vercel.app";
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : "../docs/screenshots/redesign/live";
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, pass, note = "") => { results.push({ name, pass }); console.log(`${pass ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`); };
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ locale: "ar", viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  // Journey 1: home → category → video
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  check("home: no YouTube iframe on load", (await p.locator('iframe[src*="youtube"]').count()) === 0);
  await p.goto(BASE + "/work", { waitUntil: "networkidle" });
  const all = await p.locator("[data-video-grid] [data-youtube-card], [data-video-grid] [data-work-card]").count();
  const chip = p.locator("a[data-cat-chip]:not([data-cat-chip=''])").first();
  const chipHref = await chip.getAttribute("href");
  await chip.click();
  await p.waitForURL((u) => u.search.includes("cat="));
  await p.waitForLoadState("networkidle");
  const filtered = await p.locator("[data-video-grid] [data-youtube-card], [data-video-grid] [data-work-card]").count();
  check("works: category chip filters the grid", filtered > 0 && filtered <= all, `${chipHref}: ${all} → ${filtered}`);
  const vhref = await p.locator("a[href^='/work/v/']").first().getAttribute("href");
  await p.goto(BASE + vhref, { waitUntil: "networkidle" });
  const before = await p.locator('iframe[src*="youtube"]').count();
  await p.locator("[data-inline-player] button, button[aria-label^='تشغيل']").first().click();
  await p.locator('iframe[src*="youtube"]').first().waitFor({ timeout: 15_000 });
  const title = (await p.locator("[data-video-title]").innerText()).trim();
  check("video: YouTube iframe only after click; original title shown", before === 0 && title.length > 0, `${vhref} «${title.slice(0, 40)}»`);
  await p.screenshot({ path: `${SHOTS}/video-playing-1440.png` });

  // Journey 2: works → album → lightbox
  await p.goto(BASE + "/work?tab=photos", { waitUntil: "networkidle" });
  const ahref = await p.locator("a[href^='/work/albums/']").first().getAttribute("href");
  await p.goto(BASE + ahref, { waitUntil: "networkidle" });
  const opener = p.locator("[data-album-photo]").first();
  await opener.click();
  const img = p.locator('[data-testid="lightbox"] img').first();
  await img.waitFor();
  await p.waitForFunction(() => { const i = document.querySelector('[data-testid="lightbox"] img'); return i && i.complete && i.naturalWidth > 0; });
  const m = await img.evaluate((i) => {
    const r = i.getBoundingClientRect(); const fit = getComputedStyle(i).objectFit;
    const nat = i.naturalWidth / i.naturalHeight; const box = r.width / r.height;
    // rendered content box ratio for contain = natural ratio; a contain box may be wider/taller with bars
    return { fit, nat: +nat.toFixed(3), box: +box.toFixed(3), inView: r.top >= -1 && r.bottom <= innerHeight + 1, src: i.getAttribute("src") };
  });
  check("lightbox: whole photo (contain or exact natural ratio), display variant only", (m.fit === "contain" || Math.abs(m.nat - m.box) < 0.02) && m.inView && /\/p\/[0-9a-f-]+\/display/.test(m.src) && !/original/.test(m.src), JSON.stringify(m));
  await p.screenshot({ path: `${SHOTS}/lightbox-1440.png` });
  await p.keyboard.press("Escape");
  await p.locator('[data-testid="lightbox"]').waitFor({ state: "detached" });
  check("lightbox: Esc closes and focus returns to the opener", await opener.evaluate((e) => e === document.activeElement || e.contains(document.activeElement)));

  // Journey 3: packages → WhatsApp
  await p.goto(BASE + "/packages", { waitUntil: "networkidle" });
  const cards = await p.locator("[data-package-card]").evaluateAll((els) => els.map((e) => {
    const t = e.querySelector("h3 bdi")?.textContent?.trim(); const a = e.querySelector('a[href^="https://wa.me/"]');
    return { t, text: a ? new URL(a.href).searchParams.get("text") : null };
  }));
  check("packages: 10 cards, each WhatsApp message names its package", cards.length === 10 && cards.every((c) => c.text === `مرحباً، بدي أستفسر عن بكج: ${c.t}`), `${cards.length} cards`);
  await ctx.close();

  // Every page × width
  const pages = ["/", "/work", "/work?tab=photos", ahref, vhref, "/services", "/packages", "/offers", "/about", "/contact", "/privacy", "/faq"];
  const bad = [];
  for (const w of [320, 390, 768, 1440, 1920]) {
    const c = await b.newContext({ locale: "ar", viewport: { width: w, height: w < 800 ? 844 : 900 }, reducedMotion: "reduce" });
    const pg = await c.newPage();
    for (const path of pages) {
      const res = await pg.goto(BASE + path, { waitUntil: "networkidle" });
      const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const html = await pg.content();
      const leak = /\/storage\/v1\/object\/|\/original\.|supabase\.co\/storage/.test(html);
      const ifr = await pg.locator('iframe[src*="youtube"]').count();
      if (res.status() !== 200 || ov > 0 || leak || ifr) bad.push(`${path}@${w}: status ${res.status()} overflow ${ov} leak ${leak} iframes ${ifr}`);
      if (w === 1440 || w === 390) {
        const name = path === "/" ? "home" : path.replace(/^\//, "").replace(/[/?=]/g, "-");
        await pg.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
      }
    }
    await c.close();
  }
  check(`all pages × 5 widths: 200, no overflow, no storage URLs, no preloaded YouTube`, bad.length === 0, bad.slice(0, 5).join(" | "));
  const r404 = await (await fetch(BASE + "/work/albums/no-such-album-xyz")).status;
  check("unknown album → 404", r404 === 404);
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  await b.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} live redesign checks passed (${BASE})`);
process.exit(failed ? 1 : 0);
