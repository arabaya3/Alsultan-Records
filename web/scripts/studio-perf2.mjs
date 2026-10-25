/**
 * Studio lab measurements, round 2 (read-only). Same machine + settings for every build compared.
 *   node scripts/studio-perf2.mjs <label> [baseUrl] [runs=3]
 * Writes .cache/studio-perf2-<label>.json (per-run values + medians).
 *
 * Load (per page, desktop 1440 and phone 390 with 4× CPU throttle, GPU via ANGLE):
 *   - longTaskTotalMs : sum of all long tasks (≥ 50 ms) in the first 8 s
 *   - longTaskMaxMs   : the single longest task
 *   - tbtMs           : Σ(task − 50 ms) — main-thread time blocking input
 *   - inputDelayMaxMs : worst delay before a click is handled while the scene starts (synthetic clicks every 120 ms
 *                       for 6 s, Event Timing processingStart − startTime) — how long the page felt frozen
 *   - lcpMs, cls, jsKb
 * Moves (desktop): frame times during camera moves (reception → wall → album → next album → wall), from the engine's
 *   own frame log: frames, avg, p95, max, frames over 50 ms.
 * Memory (desktop): JS heap + GPU textures/geometries after 1 and after 5 tours.
 * These are LAB numbers (desktop GPU, emulated phone CPU), never field data or a real phone.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [label = "run", BASE = "http://localhost:3700", runsArg = "3"] = process.argv.slice(2);
const RUNS = Number(runsArg);
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info"];
fs.mkdirSync(".cache", { recursive: true });

const OBSERVE = () => {
  const w = window;
  w.__p = { lcp: 0, cls: 0, tasks: [], events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__p.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) w.__p.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__p.tasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "pointerdown" || e.name === "click") w.__p.events.push(e.processingStart - e.startTime); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
};
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const browser = await chromium.launch({ args: GPU });
const probe = await browser.newPage();
await probe.goto(`${BASE}/work?tab=photos`);
const albumHref = await probe.locator("a[data-album-card]").first().getAttribute("href");
await probe.close();
const PAGES = { home: "/", albums: "/work?tab=photos", album: albumHref };
const DEVICES = [
  { name: "1440", viewport: { width: 1440, height: 900 }, mobile: false },
  { name: "390", viewport: { width: 390, height: 844 }, mobile: true },
];

const out = { label, base: BASE, at: new Date().toISOString(), runs: RUNS, load: {}, moves: [], memory: [] };

for (const d of DEVICES) {
  for (const [name, url] of Object.entries(PAGES)) {
    const samples = [];
    for (let r = 0; r < RUNS; r++) {
      const ctx = await browser.newContext({ viewport: d.viewport, isMobile: d.mobile, hasTouch: d.mobile, deviceScaleFactor: d.mobile ? 2 : 1, locale: "ar" });
      await ctx.addInitScript(() => { try { sessionStorage.setItem("sultan-studio-entry", "1"); } catch {} });
      await ctx.addInitScript(OBSERVE);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      if (d.mobile) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      let js = 0;
      const types = new Map();
      cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
      cdp.on("Network.loadingFinished", (e) => { if (types.get(e.requestId) === "Script") js += e.encodedDataLength; });
      await page.goto(BASE + url, { waitUntil: "commit" });
      // synthetic clicks on an inert spot (bottom-left corner of the page) every 120 ms for 6 s
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 3, y: d.viewport.height - 3, button: "left", clickCount: 1 }).catch(() => {});
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 3, y: d.viewport.height - 3, button: "left", clickCount: 1 }).catch(() => {});
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(2000);
      const p = await page.evaluate(() => ({ ...window.__p, studio: document.documentElement.dataset.studio ?? null, tier: document.documentElement.dataset.studioTier ?? null }));
      const tasks = p.tasks.filter(([s]) => s < 8000);
      samples.push({
        longTaskTotalMs: Math.round(tasks.reduce((a, [, dd]) => a + dd, 0)),
        longTaskMaxMs: Math.round(tasks.reduce((a, [, dd]) => Math.max(a, dd), 0)),
        tbtMs: Math.round(tasks.reduce((a, [, dd]) => a + Math.max(0, dd - 50), 0)),
        inputDelayMaxMs: Math.round(p.events.reduce((a, x) => Math.max(a, x), 0)),
        lcpMs: Math.round(p.lcp),
        cls: Number(p.cls.toFixed(4)),
        jsKb: Math.round(js / 1024),
        studio: p.studio,
        tier: p.tier,
      });
      await ctx.close();
    }
    const keys = Object.keys(samples[0]).filter((k) => typeof samples[0][k] === "number");
    const median = Object.fromEntries(keys.map((k) => [k, med(samples.map((s) => s[k]))]));
    out.load[`${name}@${d.name}`] = { url, median, samples };
    console.log(name, d.name, JSON.stringify(median), samples[0].studio, samples[0].tier);
  }
}

// moves + memory (desktop, client navigation, engine frame log)
for (let r = 0; r < RUNS; r++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("sultan-studio-entry", "1"); } catch {} });
  // build-independent frame log: rAF deltas while the camera is moving (html[data-studio-moving])
  await ctx.addInitScript(() => {
    let last = 0;
    let xs = [];
    const tick = (t) => {
      if (document.documentElement.hasAttribute("data-studio-moving") && last) xs.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__mf = () => {
      const s = [...xs].sort((a, b) => a - b);
      const r = s.length ? { frames: s.length, avgMs: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(1), maxMs: +s[s.length - 1].toFixed(1), over50: s.filter((x) => x > 50).length } : { frames: 0 };
      xs = [];
      return r;
    };
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.waitForFunction(() => document.querySelector("[data-studio-backdrop][data-ready]"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const frames = () => page.evaluate(() => window.__mf());
  await frames(); // reset
  const step = async (fn, wait = 2600) => { await fn(); await page.waitForTimeout(wait); return frames(); };
  const tour = async () => {
    const res = {};
    res.toWall = await step(() => page.locator("[data-reception-frame='0']").click());
    res.toAlbum = await step(() => page.locator("[data-studio-wall] > li:not([hidden]) a").first().click(), 3200);
    if (await page.locator("[data-album-next]").count()) res.nextAlbum = await step(() => page.locator("[data-album-next]").click(), 3200);
    res.back = await step(() => page.goBack());
    res.home = await step(() => page.locator("header nav a[href='/']").first().click().catch(() => page.goto(BASE + "/")));
    return res;
  };
  const mem = () => page.evaluate(() => ({ heapMb: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), gpu: window.__studioStats?.() ?? null }));
  const first = await tour();
  const m1 = await mem();
  for (let i = 0; i < 4; i++) await tour();
  const m5 = await mem();
  out.moves.push(first);
  out.memory.push({ after1: { heapMb: m1.heapMb, textures: m1.gpu?.textures, geometries: m1.gpu?.geometries }, after5: { heapMb: m5.heapMb, textures: m5.gpu?.textures, geometries: m5.gpu?.geometries } });
  console.log("moves", JSON.stringify(first));
  console.log("memory", JSON.stringify(out.memory.at(-1)));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`.cache/studio-perf2-${label}.json`, JSON.stringify(out, null, 2));
console.log(`wrote .cache/studio-perf2-${label}.json`);
