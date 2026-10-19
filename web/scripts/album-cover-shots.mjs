// Album-cover grid screenshots + per-card fit report (home + /work photos tab, desktop 1440 and mobile 390).
// Usage: node scripts/album-cover-shots.mjs <base-url> <label>  → docs/screenshots/album-covers/<label>-<page>-<w>.png
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const [base = "https://sultan-records.vercel.app", label = "after"] = process.argv.slice(2);
const out = fileURLToPath(new URL("../../docs/screenshots/album-covers/", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const w of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: w < 500 ? 2 : 1 });
  for (const [name, path] of [["home", "/"], ["work", "/work?tab=photos"]]) {
    await page.goto(base + path, { waitUntil: "load", timeout: 60000 });
    const first = page.locator("[data-album-card]").first();
    if (!(await first.count())) { report.push({ w, name, cards: "no album section on this page" }); continue; }
    await first.scrollIntoViewIfNeeded();
    const grid = first.locator("xpath=ancestor::ul[1]");
    // lazy covers: walk the grid so every image loads
    await grid.evaluate(async (ul) => { for (const li of ul.children) { li.scrollIntoView(); await new Promise((r) => setTimeout(r, 150)); } });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-album-card] img")].every((i) => i.complete && i.naturalWidth), null, { timeout: 30000 }).catch(() => {});
    // Landscape check: live covers are all portrait, so the 2nd card gets a generated 3:2 image (CSS check only).
    await page.$$eval("[data-album-card] img", async (imgs) => {
      const c = Object.assign(document.createElement("canvas"), { width: 1600, height: 1067 }), g = c.getContext("2d");
      g.fillStyle = "#3a5a40"; g.fillRect(0, 0, 1600, 1067); g.strokeStyle = "#fff"; g.lineWidth = 24; g.strokeRect(12, 12, 1576, 1043);
      g.fillStyle = "#fff"; g.font = "bold 120px sans-serif"; g.textAlign = "center"; g.fillText("LANDSCAPE 3:2 TEST", 800, 560);
      if (imgs[1]) { imgs[1].src = c.toDataURL(); await imgs[1].decode(); }
    });
    const cards = await page.$$eval("[data-album-card] img", (imgs) => imgs.map((i) => {
      const box = i.parentElement.getBoundingClientRect();
      return { src: i.getAttribute("src").split("/").pop(), fit: getComputedStyle(i).objectFit, natural: `${i.naturalWidth}x${i.naturalHeight}`, frame: `${Math.round(box.width)}x${Math.round(box.height)}` };
    }));
    report.push({ w, name, cards });
    await grid.screenshot({ path: `${out}${label}-${name}-${w}.png` });
  }
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report));
