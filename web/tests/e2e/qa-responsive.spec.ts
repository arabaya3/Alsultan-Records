import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { BASE, EV, overflowPx, psql, SHOTS, uiLogin } from "./qa-helpers";

/**
 * Responsive + accessibility. @axe-core/playwright is NOT installed (npm install not allowed for QA),
 * so this file carries a minimal label check, focus-visibility check and a WCAG contrast estimator.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(400_000);

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];

async function settleImages(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((i) => i.loading !== "lazy" || i.getBoundingClientRect().top < innerHeight).filter((i) => !(i.complete && i.naturalWidth > 0)).length), { timeout: 30_000 })
    .toBe(0);
  await page.waitForTimeout(900); // entrance motion ≤600ms
}

const TARGETS: { name: string; url: string; who?: "a" | "admin" }[] = [
  { name: "home", url: "/" },
  { name: "work", url: "/work" },
  { name: "book", url: "/book" },
  { name: "portal-gallery", url: `/portal/events/${EV.A1}/gallery`, who: "a" },
  { name: "admin-overview", url: "/admin", who: "admin" },
];

for (const t of TARGETS) {
  test(`P1/C3/A1 responsive: ${t.name} has no horizontal overflow 320–1440`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar" });
    const page = await ctx.newPage();
    if (t.who) await uiLogin(page, t.who, t.url);
    const results: Record<number, number> = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 1000 : 844 });
      const t0 = Date.now();
      await page.goto(`${BASE}${t.url}`, { waitUntil: "load" });
      await settleImages(page);
      results[w] = await overflowPx(page);
      console.log(t.name, w, "ms", Date.now() - t0);
      if ([390, 1440].includes(w) || t.name === "home") await page.screenshot({ path: path.join(SHOTS, `qa-${t.name}-${w}.png`), fullPage: t.name !== "portal-gallery" });
    }
    test.info().annotations.push({ type: "overflow px by width", description: JSON.stringify(results) });
    for (const w of WIDTHS) expect(results[w], `${t.name} @${w}`).toBeLessThanOrEqual(0);
    await ctx.close();
  });
}

test("P6 a11y: html lang/dir, every form control has an accessible label", async ({ page }) => {
  const misses: string[] = [];
  for (const url of ["/book", "/track", "/contact", "/login"]) {
    await page.goto(`${BASE}${url}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const m = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")]
        .filter((el) => (el as HTMLInputElement).type !== "hidden")
        .filter((el) => {
          const e = el as HTMLInputElement;
          const lbl = (e.labels && e.labels.length > 0) || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.title;
          return !lbl;
        })
        .map((el) => `${el.tagName}#${el.id || ""}[name=${el.getAttribute("name")}]`),
    );
    misses.push(...m.map((x) => `${url}: ${x}`));
  }
  expect(misses).toEqual([]);
});

// SKIPPED: Public booking form and tracking are not rendered in the approved WhatsApp-only scope (code kept, booking RPCs covered by pgTAP; form path covered by turnstile.spec in TURNSTILE_TEST_MODE).
test.skip("P4 a11y: booking form can be completed keyboard-only", async ({ page }) => {
  psql("delete from private.rate_limits;");
  await page.goto(`${BASE}/book`);
  await page.locator("body").focus();
  // Tab until the name field is focused (skip link, header links…)
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.id === "contact_name")) break;
  }
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("contact_name");
  await page.keyboard.type("[QA] Keyboard user");
  await page.keyboard.press("Tab");
  await page.keyboard.type("0591112222");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("event_type");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("event_date");
  const d = new Date(Date.now() + 50 * 86400_000);
  // Chromium date input: type in locale order; we set via keyboard typing of the ISO parts as displayed
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  await page.keyboard.type(`${dd}${mm}${d.getFullYear()}`); // ar locale segment order: day, month, year
  const val = await page.locator("#event_date").inputValue();
  test.info().annotations.push({ type: "date typed", description: val });
  expect(val).toBe(`${d.getFullYear()}-${mm}-${dd}`);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.textContent?.trim() === "التالي")) break;
  }
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("التالي");
  await page.keyboard.press("Enter");
  await expect(page.locator("#city")).toBeVisible();
  // focus after step change: report where it landed
  test.info().annotations.push({ type: "focus after التالي", description: await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`) });
  await page.locator("#city").focus(); // NOTE: see report if focus is not moved automatically
  await page.keyboard.type("[QA] Jenin");
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.textContent?.trim() === "أرسل الطلب")) break;
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "رمز المتابعة" })).toBeVisible({ timeout: 30_000 });
});

test("a11y: focus is visible on interactive elements (home, book)", async ({ page }) => {
  const invisible: string[] = [];
  for (const url of ["/", "/book"]) {
    await page.goto(`${BASE}${url}`);
    await page.locator("body").focus();
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // Chromium focuses the date input's internal picker button (shadow part); not app CSS.
        if ((el as HTMLInputElement).type === "date") return null;
        const cs = getComputedStyle(el);
        const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
        return { id: `${el.tagName} ${el.textContent?.trim().slice(0, 30) ?? ""} ${el.getAttribute("href") ?? ""}`, visible };
      });
      if (r && !r.visible) invisible.push(`${url}: ${r.id}`);
    }
  }
  expect(invisible).toEqual([]);
});

test("a11y: dialogs trap focus and restore it (mobile menu, gallery lightbox)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const opener = page.getByRole("button", { name: "فتح القائمة" });
  await opener.click();
  const dlg = page.getByRole("dialog", { name: "القائمة" });
  await expect(dlg).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await dlg.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.querySelector('[aria-controls]'))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-controls") !== null)).toBe(true);
  // menu works: open and navigate
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.getByRole("dialog", { name: "القائمة" }).getByRole("link", { name: "أعمالنا" }).first().click();
  await page.waitForURL("**/work");
  await expect(page.getByRole("dialog", { name: "القائمة" })).toBeHidden();

  // lightbox
  await page.setViewportSize({ width: 1440, height: 1000 });
  await uiLogin(page, "a", `/portal/events/${EV.A1}/gallery`);
  const open1 = page.getByRole("button", { name: "عرض الصورة 1", exact: true });
  await open1.click();
  const lb = page.getByTestId("lightbox");
  await expect(lb).toBeVisible();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(await lb.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(open1).toBeFocused();
  await ctx.close();
});

test("a11y: text contrast estimate (WCAG AA) on public pages", async ({ page }) => {
  const report: string[] = [];
  for (const url of ["/", "/work", "/services", "/book", "/track", "/faq", "/about", "/contact"]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const bad = await page.evaluate(() => {
      const parse = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
        return [Number(r), Number(g), Number(b), Number(a)];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el: Element | null): number[] | null => {
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.backgroundImage !== "none") return null; // over image/gradient: cannot judge
          const c = parse(cs.backgroundColor);
          if (c && c[3] >= 0.99) return c;
        }
        return [255, 255, 255, 1];
      };
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || seen.has(el) || !n.textContent?.trim()) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.visibility === "hidden" || r.width === 0 || r.height === 0 || el.closest("[aria-hidden=true],.sr-only")) continue;
        let op = 1;
        for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        if (op < 0.05) continue; // hover/focus-only overlays (invisible at rest)
        const fg = parse(cs.color);
        const bg = bgOf(el);
        if (!fg || !bg) continue;
        const a = fg[3] * Number(cs.opacity);
        const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
        const L1 = lum(mix), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 40)}" ${cs.color} on rgb(${bg.slice(0, 3).join(",")})`);
      }
      return out;
    });
    report.push(...bad.map((b) => `${url}: ${b}`));
  }
  test.info().annotations.push({ type: "contrast failures", description: report.join("\n") || "none" });
  console.log(report.join("\n") || "contrast: none");
  expect(report).toEqual([]);
});

test("mobile device emulation: home, book, work — no overflow, menu opens @mobile", async ({ page }) => {
  for (const url of ["/", "/book", "/work"]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    expect(await overflowPx(page), url).toBeLessThanOrEqual(0);
  }
  await page.getByRole("button", { name: "فتح القائمة" }).tap();
  await expect(page.getByRole("dialog", { name: "القائمة" })).toBeVisible();
});
