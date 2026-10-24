// Read-only screenshots of public pages for the UI audit follow-up (before/after) — docs/ui-audit-followup.md.
//   node scripts/ui-audit-shots.mjs <before|after> [BASE]
// Public pages only (no login), so no customer data is captured. Writes docs/screenshots/ui-audit/<label>/.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const label = process.argv[2] ?? "before";
const BASE = (process.argv[3] ?? "https://sultan-records.vercel.app").replace(/\/+$/, "");
const OUT = path.resolve(import.meta.dirname, "../../docs/screenshots/ui-audit", label);
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["home", "/"],
  ["offers", "/offers"],
  ["offer-detail", "/offers/wedding-complete"],
  ["work-videos", "/work"],
  ["work-photos", "/work?tab=photos"],
  ["work-promos", "/work?tab=promos"],
  ["video", "/work/v/y0-ajKb7Umw"],
  ["album", "/work/albums/wedding-yousef-farah-2026"],
  ["services", "/services"],
  ["contact", "/contact"],
];
const WIDTHS = [390, 1440];

const browser = await chromium.launch();
const report = [];
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "ar", reducedMotion: "reduce" });
  // skip the one-time intro so pages are captured as a returning visitor sees them
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("sultan-intro-seen", "1");
      sessionStorage.setItem("sultan-intro-seen", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  for (const [name, p] of PAGES) {
    const res = await page.goto(BASE + p, { waitUntil: "networkidle" }).catch(() => null);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = `${name}-${w}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: w <= 390 ? false : true });
    report.push({ page: p, width: w, status: res?.status() ?? 0, overflowPx: overflow, file });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, report }, null, 1));
console.log(report.map((r) => `${r.status} ${r.width} ${r.page} overflow=${r.overflowPx}`).join("\n"));
