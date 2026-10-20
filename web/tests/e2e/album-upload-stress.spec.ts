import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { db, newLoggedIn } from "./qa-helpers";

/**
 * Representative studio batch (review item 4) — OPT-IN, LOCAL STACK ONLY, never against production:
 *   STRESS=1 BASE_URL=http://localhost:3600 npx playwright test album-upload-stress --project=chromium
 * 100 distinct camera files through the real admin UI (owner session, TUS, server processing):
 *   60 JPEG (20 MP, 14–26 MB) + 40 RAW (11 formats, 7–26 MB, CC0 raw.pixls.us samples).
 * Distinct bytes per copy (the server dedupes by sha256) without touching the image data:
 *   JPEG → a unique COM segment after SOI; TIFF-family RAW → 16 bytes appended; CR3 → a trailing `free` box.
 * Optional upload throttle: STRESS_UP_MBIT=20 (CDP network emulation).
 * Measures: upload vs processing time, concurrency, ready/failed counts, page JS heap (CDP), total browser
 * memory (all Chromium processes) and the Next.js server process (where the processing worker and its RAW decode
 * threads run). Writes docs/album-upload-stress.json.
 */
test.skip(!process.env.STRESS, "opt-in: STRESS=1");
test.setTimeout(90 * 60_000);

const ROOT = path.resolve(__dirname, "../../.cache");
const RAW = path.join(ROOT, "raw-samples");
const FIX = path.join(ROOT, "upload-fixtures");
const OUT = path.join(ROOT, "upload-stress");
const RAWS = ["cr2", "cr3", "nef", "nrw", "dng", "orf", "pef", "rw2", "srw", "raf"].map((e) => `sample.${e}`).concat("sample-a7m3.arw");

function variant(src: string, dst: string, n: number) {
  const b = fs.readFileSync(src);
  const tag = Buffer.from(`sultan-stress-${String(n).padStart(4, "0")}`);
  if (/\.jpe?g$/i.test(src)) {
    const com = Buffer.alloc(4);
    com.writeUInt16BE(0xfffe, 0);
    com.writeUInt16BE(tag.length + 2, 2);
    fs.writeFileSync(dst, Buffer.concat([b.subarray(0, 2), com, tag, b.subarray(2)]));
  } else if (/\.cr3$/i.test(src)) {
    const box = Buffer.alloc(8);
    box.writeUInt32BE(8 + tag.length, 0);
    box.write("free", 4, "latin1");
    fs.writeFileSync(dst, Buffer.concat([b, box, tag]));
  } else fs.writeFileSync(dst, Buffer.concat([b, tag]));
}

/** Working set (MB) of processes matching a PowerShell filter (Windows); null elsewhere. */
function memMB(filter: string): number | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process | Where-Object { ${filter} } | Measure-Object WorkingSetSize -Sum).Sum`], { encoding: "utf8", timeout: 20_000 });
    return Math.round(Number(out.trim() || 0) / 1048576);
  } catch {
    return null;
  }
}
const BROWSER = `$_.CommandLine -like '*ms-playwright*'`;
const SERVER = `$_.CommandLine -like '*next*start*-p 3600*' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*next-server*')`;

let albumId = "";
test.afterAll(async () => {
  if (!albumId) return;
  const { data: ps } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", albumId);
  const paths = (ps ?? []).flatMap((p) => [p.storage_path_original, ...Object.values((p.variants ?? {}) as Record<string, string>)]);
  for (let i = 0; i < paths.length; i += 100) await db.storage.from("album-media").remove(paths.slice(i, i + 100));
  await db.from("album_photos").delete().eq("album_id", albumId);
  await db.from("photo_albums").delete().eq("id", albumId);
});

test("S1: 100 representative camera files (60 large JPEG + 40 RAW) through the admin uploader", async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const jpegs = fs.readdirSync(FIX).filter((f) => /\.jpg$/i.test(f)).sort().map((f) => path.join(FIX, f));
  const files: string[] = [];
  for (let i = 0; i < 60; i++) {
    const src = jpegs[i % jpegs.length];
    const dst = path.join(OUT, `j${String(i).padStart(3, "0")}-${path.basename(src)}`);
    if (!fs.existsSync(dst)) variant(src, dst, i);
    files.push(dst);
  }
  for (let i = 0; i < 40; i++) {
    const src = path.join(RAW, RAWS[i % RAWS.length]);
    const dst = path.join(OUT, `r${String(i).padStart(3, "0")}-${path.basename(src)}`);
    if (!fs.existsSync(dst)) variant(src, dst, 1000 + i);
    files.push(dst);
  }
  // Describe the batch.
  const sizes = files.map((f) => fs.statSync(f).size);
  const byExt: Record<string, { n: number; mb: number }> = {};
  for (const [i, f] of files.entries()) {
    const e = path.extname(f).slice(1).toLowerCase();
    byExt[e] ??= { n: 0, mb: 0 };
    byExt[e].n++;
    byExt[e].mb += sizes[i] / 1048576;
  }
  const jpegDims = await Promise.all(jpegs.slice(0, 2).map(async (f) => { const m = await sharp(f).metadata(); return `${m.width}×${m.height}`; }));

  albumId = randomUUID();
  await db.from("photo_albums").insert({ id: albumId, slug: `e2e-stress-${Date.now().toString(36)}`, title: "اختبار ضغط محلي", is_published: false });
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const mbit = Number(process.env.STRESS_UP_MBIT || 0);
  if (mbit) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, uploadThroughput: (mbit * 1e6) / 8, downloadThroughput: (100 * 1e6) / 8 });
  }

  const mem = { browserMB: 0, serverMB: 0, heapMB: 0 };
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      mem.browserMB = Math.max(mem.browserMB, memMB(BROWSER) ?? 0);
      mem.serverMB = Math.max(mem.serverMB, memMB(SERVER) ?? 0);
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();

  await page.getByTestId("album-upload-input").setInputFiles(files);
  const t0 = Date.now();
  await page.getByTestId("album-upload-start").click();
  const seen = new Map<string, { up?: number; proc?: number; end?: number; state?: string }>();
  let maxInFlight = 0;
  for (;;) {
    const states = await page.locator('[data-testid="album-upload-row"]').evaluateAll((els) => els.map((e) => [e.querySelector("[data-file-name]")?.getAttribute("data-file-name") ?? "", e.getAttribute("data-state") ?? ""]));
    const now = Date.now() - t0;
    for (const [name, s] of states) {
      const r = seen.get(name) ?? {};
      if (s === "uploading" && r.up === undefined) r.up = now;
      if (s === "processing" && r.proc === undefined) r.proc = now;
      if ((s === "ready" || s === "failed" || s === "skipped") && r.end === undefined) r.end = now;
      r.state = s;
      seen.set(name, r);
    }
    maxInFlight = Math.max(maxInFlight, states.filter(([, s]) => s === "uploading" || s === "checking").length);
    const { metrics } = await cdp.send("Performance.getMetrics");
    mem.heapMB = Math.max(mem.heapMB, (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1048576);
    if (states.length === 100 && states.every(([, s]) => ["ready", "failed", "skipped", "canceled"].includes(s))) break;
    if (now > 80 * 60_000) break;
    await page.waitForTimeout(500);
  }
  sampling = false;
  await sampler;

  const rows = [...seen.entries()];
  const uploadTimes = rows.filter(([, r]) => r.up !== undefined && r.proc !== undefined).map(([, r]) => (r.proc! - r.up!) / 1000).sort((a, b) => a - b);
  const lastUploaded = Math.max(...rows.map(([, r]) => r.proc ?? 0));
  const allDone = Math.max(...rows.map(([, r]) => r.end ?? 0));
  const failed = rows.filter(([, r]) => r.state === "failed").map(([n]) => n);
  const db_ = (await db.from("album_photos").select("upload_status, last_error, format").eq("album_id", albumId)).data ?? [];
  const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const report = {
    when: new Date().toISOString(),
    env: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30), node: process.version, stack: "local Supabase (Docker) + next start; Chromium (Playwright)", uploadThrottleMbit: mbit || "none (loopback)" },
    batch: { files: files.length, totalMB: Math.round(sizes.reduce((a, b) => a + b, 0) / 1048576), minMB: +(Math.min(...sizes) / 1048576).toFixed(1), maxMB: +(Math.max(...sizes) / 1048576).toFixed(1), byExt: Object.fromEntries(Object.entries(byExt).map(([k, v]) => [k, { n: v.n, mb: Math.round(v.mb) }])), jpegDims },
    result: {
      ready: rows.filter(([, r]) => r.state === "ready").length,
      failed: failed.length,
      failedFiles: failed,
      dbStatus: db_.reduce<Record<string, number>>((a, r) => ((a[r.upload_status] = (a[r.upload_status] ?? 0) + 1), a), {}),
      maxInFlight,
      uploadPhaseS: Math.round(lastUploaded / 1000),
      allReadyS: Math.round(allDone / 1000),
      processingTailS: Math.round((allDone - lastUploaded) / 1000),
      perFileUploadS: { p50: pct(uploadTimes, 0.5), p90: pct(uploadTimes, 0.9), max: uploadTimes.at(-1) },
    },
    memory: { pageJsHeapPeakMB: Math.round(mem.heapMB), browserAllProcessesPeakMB: mem.browserMB || "n/a", serverProcessPeakMB: mem.serverMB || "n/a" },
  };
  fs.writeFileSync(path.resolve(__dirname, "../../../docs/album-upload-stress.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 1));
  await page.context().close();

  expect(maxInFlight).toBeLessThanOrEqual(3);
  expect(report.result.ready + failed.length).toBe(100);
  expect(failed).toEqual([]);
  expect(db_.filter((r) => r.upload_status === "uploading")).toHaveLength(0);
});
