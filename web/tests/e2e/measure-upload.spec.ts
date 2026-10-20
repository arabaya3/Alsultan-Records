import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { db, newLoggedIn } from "./qa-helpers";

/**
 * Upload timing (docs/album-upload-release.md). Same files, same emulated connection, old vs new uploader.
 * Only runs with MEASURE=1 (not part of the regular suite). LOCAL STACK ONLY.
 *   MEASURE=1 MEASURE_LABEL=before MEASURE_SET=med BASE_URL=http://localhost:3600 npx playwright test measure-upload --project=chromium
 * Emulated link: 20 Mbit/s up, 50 Mbit/s down, 40 ms latency (CDP Network.emulateNetworkConditions).
 * Records per file: when it started uploading, finished uploading (left «uploading»), and became ready.
 */
test.skip(process.env.MEASURE !== "1", "set MEASURE=1");
test.setTimeout(30 * 60_000);

const SET = process.env.MEASURE_SET ?? "med";
const LABEL = process.env.MEASURE_LABEL ?? "run";
const DIR = path.resolve(__dirname, "../../.cache/upload-fixtures");
const ALBUM = { id: randomUUID(), slug: `measure-${LABEL}-${Date.now().toString(36)}` };

test.afterAll(async () => {
  const { data: ps } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", ALBUM.id);
  const paths = (ps ?? []).flatMap((p) => [p.storage_path_original, ...Object.values((p.variants ?? {}) as Record<string, string>)]);
  for (let i = 0; i < paths.length; i += 100) await db.storage.from("album-media").remove(paths.slice(i, i + 100));
  await db.from("album_photos").delete().eq("album_id", ALBUM.id);
  await db.from("photo_albums").delete().eq("id", ALBUM.id);
});

test("measure upload", async ({ browser }) => {
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith(`${SET}-`)).sort();
  const totalBytes = files.reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
  await db.from("photo_albums").insert({ id: ALBUM.id, slug: ALBUM.slug, title: `قياس ${LABEL}`, is_published: false });
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${ALBUM.id}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, uploadThroughput: (20 * 1e6) / 8, downloadThroughput: (50 * 1e6) / 8 });

  await page.getByTestId("album-upload-input").setInputFiles(files.map((f) => path.join(DIR, f)));
  const t0 = Date.now();
  await page.getByTestId("album-upload-start").click();
  const seen: Record<string, { uploading?: number; uploaded?: number; ready?: number; failed?: number; state?: string }> = {};
  for (;;) {
    const rows = await page.locator('[data-testid="album-upload-row"]').evaluateAll((els) =>
      els.map((e) => ({ name: (e.querySelector("[data-file-name]") as HTMLElement | null)?.dataset.fileName ?? e.textContent?.slice(0, 40) ?? "", state: e.getAttribute("data-state") ?? "" })),
    );
    const now = Date.now() - t0;
    for (const r of rows) {
      const s = (seen[r.name] ??= {});
      s.state = r.state;
      if (r.state === "uploading" && s.uploading === undefined) s.uploading = now;
      if (["pending", "processing", "ready"].includes(r.state) && s.uploaded === undefined) s.uploaded = now;
      if (r.state === "ready" && s.ready === undefined) s.ready = now;
      if (r.state === "failed" && s.failed === undefined) s.failed = now;
    }
    const done = rows.length >= files.length && rows.every((r) => ["ready", "failed", "skipped"].includes(r.state));
    if (done || now > 28 * 60_000) break;
    await page.waitForTimeout(250);
  }
  const vals = Object.values(seen);
  const max = (k: "uploading" | "uploaded" | "ready") => Math.max(...vals.map((v) => v[k] ?? NaN).filter(Number.isFinite));
  const min = (k: "uploading" | "uploaded" | "ready") => Math.min(...vals.map((v) => v[k] ?? NaN).filter(Number.isFinite));
  const result = {
    label: LABEL,
    set: SET,
    files: files.length,
    totalMB: +(totalBytes / 1048576).toFixed(1),
    link: "20 Mbit/s up, 50 Mbit/s down, 40 ms",
    firstUploadStartMs: min("uploading"),
    allUploadedMs: max("uploaded"),
    allReadyMs: max("ready"),
    ready: vals.filter((v) => v.ready !== undefined).length,
    failed: vals.filter((v) => v.failed !== undefined).length,
    perFile: seen,
  };
  fs.writeFileSync(path.resolve(__dirname, `../../.cache/measure-${LABEL}-${SET}.json`), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ...result, perFile: undefined }));
  await page.context().close();
});
