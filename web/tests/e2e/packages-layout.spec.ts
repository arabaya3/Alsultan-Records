import { expect, test } from "@playwright/test";
import { BASE, overflowPx, skipSiteIntro } from "./qa-helpers";

// Packages page (owner design): ivory content, gold active tab, equal-height cards with the WhatsApp buttons aligned,
// no «0 شيكل», no horizontal scroll, Arabic text not clipped.
for (const width of [1440, 768, 390, 360]) {
  test(`PL1 @${width}: equal cards, aligned buttons, no overflow`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    await skipSiteIntro(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/packages`, { waitUntil: "networkidle" });
    expect(await overflowPx(page)).toBe(0);
    await expect(page.locator("main")).not.toContainText(/(^|\s)0 شيكل/);
    const panel = page.locator("[data-package-panel]:not([hidden])").first();
    const cards = panel.locator("[data-package-card]");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), h: Math.round(r.height) })));
    const btns = await panel.locator("[data-package-card] a[href*='wa.me'], [data-package-card] a[href*='whatsapp']").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
    // cards on the same row: same height, buttons on the same line
    const rows = new Map<number, number[]>();
    boxes.forEach((b, i) => rows.set(b.top, [...(rows.get(b.top) ?? []), i]));
    for (const idx of rows.values()) {
      expect(new Set(idx.map((i) => boxes[i].h)).size, "equal heights in a row").toBe(1);
      if (btns.length === boxes.length) expect(new Set(idx.map((i) => btns[i])).size, "buttons aligned").toBe(1);
    }
    if (width >= 1024) expect(Math.max(...[...rows.values()].map((r) => r.length))).toBe(Math.min(3, n));
    // no clipped text: no element in a card scrolls horizontally
    const clipped = await cards.evaluateAll((els) => els.flatMap((c) => [...c.querySelectorAll("*")]).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible").length);
    expect(clipped).toBe(0);
    // gold active tab
    const tab = page.locator("[data-package-tabs] [aria-selected=true]");
    if (await tab.count()) await expect(tab).toHaveCSS("background-color", /rgb\(2\d\d, 1\d\d, \d+\)/);
    await page.screenshot({ path: test.info().outputPath(`packages-${width}.png`), fullPage: true });
    await ctx.close();
  });
}
