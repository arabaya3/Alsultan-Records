import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { db, newLoggedIn, psql, USERS, revalidatePublic } from "./qa-helpers";

/**
 * Album upload v2 (docs/album-upload-release.md): create + upload from one screen, resumable direct uploads,
 * large JPEG, RAW, real-format checks, cancel/resume/permission loss, 100-file batch. LOCAL STACK ONLY.
 * Real RAW samples: CC0 files from raw.pixls.us in web/.cache/raw-samples (downloaded for testing, gitignored).
 *   BASE_URL=http://localhost:3600 npx playwright test album-upload-v2 --project=chromium
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(10 * 60_000);

const ROOT = path.resolve(__dirname, "../../.cache");
const RAW = path.join(ROOT, "raw-samples");
const FIX = path.join(ROOT, "upload-fixtures");
const GEN = path.join(ROOT, "upload-generated");
const STAMP = Date.now().toString(36);
const created: string[] = [];
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

async function cleanupAlbum(id: string) {
  const { data: ps } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", id);
  const paths = (ps ?? []).flatMap((p) => [p.storage_path_original, ...Object.values((p.variants ?? {}) as Record<string, string>)]);
  for (let i = 0; i < paths.length; i += 100) await db.storage.from("album-media").remove(paths.slice(i, i + 100));
  await db.from("album_photos").delete().eq("album_id", id);
  await db.from("photo_albums").delete().eq("id", id);
}
test.afterAll(async () => {
  for (const id of created) await cleanupAlbum(id);
  await db.from("profiles").update({ role: "admin" }).eq("id", (await adminId())!);
});
async function adminId() {
  return (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === USERS.admin.email)?.id;
}
async function newDraft(title: string) {
  const id = randomUUID();
  await db.from("photo_albums").insert({ id, slug: `e2e-v2-${title}-${STAMP}`, title: `اختبار رفع ${title}`, is_published: false });
  created.push(id);
  return id;
}
const rows = (page: Page) => page.locator('[data-testid="album-upload-row"]');
const row = (page: Page, name: string) => page.locator(`[data-testid="album-upload-row"]:has([data-file-name="${name}"])`);

test.beforeAll(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  // forged: a JPEG renamed .cr2; corrupt: real JPEG header then garbage; oversize: 55 MB with a JPEG header.
  fs.writeFileSync(path.join(GEN, "forged.cr2"), fs.readFileSync(path.join(FIX, "med-01.jpg")).subarray(0, 300_000));
  const corrupt = Buffer.alloc(2_000_000, 0x5a);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]).copy(corrupt);
  fs.writeFileSync(path.join(GEN, "corrupt.jpg"), corrupt);
  const big = Buffer.alloc(55 * 1024 * 1024, 1);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(big);
  fs.writeFileSync(path.join(GEN, "oversize-55mb.jpg"), big);
  // 100 small real JPEGs for the batch test (distinct content → distinct hashes).
  for (let i = 0; i < 100; i++) {
    const f = path.join(GEN, `batch-${String(i).padStart(3, "0")}.jpg`);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: (i * 37) % 255, g: (i * 91) % 255, b: (i * 53) % 255 } } }).jpeg({ quality: 85 }).toBuffer());
    }
  }
});

test("V1: «ألبوم جديد» → details + photos → «إنشاء ورفع»: draft created, upload starts on the same flow, JPEG 25.8 MB + RAW ready, originals byte-identical, web copies whole", async ({ browser }) => {
  // ARW from a Sony ILCE-7M3 (standard compressed). The ILCE-7M5 «compressed HQ» sample is covered in V2 (unsupported).
  const files = [path.join(FIX, "base-01.jpg"), ...["cr3", "nef", "dng"].map((e) => path.join(RAW, `sample.${e}`)), path.join(RAW, "sample-a7m3.arw")];
  const page = await newLoggedIn(browser, "owner", "/admin/albums");
  const form = page.getByTestId("album-create");
  await form.locator('input[name="title"]').fill(`ألبوم رفع جديد ${STAMP}`);
  await form.locator('input[name="slug"]').fill(`e2e-v2-new-${STAMP}`);
  await form.getByTestId("album-create-photos").setInputFiles(files);
  await form.getByRole("button", { name: `إنشاء ورفع (${files.length})` }).click();
  await page.waitForURL(/\/admin\/albums\/[0-9a-f-]{36}$/);
  const albumId = page.url().split("/").pop()!;
  created.push(albumId);
  expect((await db.from("photo_albums").select("is_published").eq("id", albumId).single()).data!.is_published).toBe(false); // never auto-published
  await expect(rows(page)).toHaveCount(files.length);
  await expect(page.getByTestId("album-upload-total")).toBeVisible();
  await expect(page.locator('[data-testid="album-upload-row"][data-state="ready"]')).toHaveCount(files.length, { timeout: 8 * 60_000 });

  const { data: photos } = await db.from("album_photos").select("id, storage_path_original, sha256, bytes, format, width, height, variants, upload_status").eq("album_id", albumId);
  expect(photos).toHaveLength(files.length);
  for (const f of files) {
    const p = photos!.find((x) => x.sha256 === sha(f))!;
    expect(p, path.basename(f)).toBeTruthy();
    expect(p.upload_status).toBe("ready");
    // Original stored byte-for-byte: download and compare checksums.
    const orig = Buffer.from(await (await db.storage.from("album-media").download(p.storage_path_original)).data!.arrayBuffer());
    expect(createHash("sha256").update(orig).digest("hex")).toBe(sha(f));
    expect(orig.length).toBe(fs.statSync(f).size);
    expect(p.format).toBe(path.extname(f).slice(1).replace("jpg", "jpeg").toLowerCase());
    // Display copy: whole frame (same aspect ratio as the decoded image), ≤ 1600 px, sRGB, no metadata.
    const disp = Buffer.from(await (await db.storage.from("album-media").download((p.variants as { display: string }).display)).data!.arrayBuffer());
    const m = await sharp(disp).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(1600);
    expect(Math.abs(m.width! / m.height! - p.width! / p.height!)).toBeLessThan(0.01);
    expect(m.exif).toBeUndefined(); // no EXIF/GPS on public copies
  }

  // Same screen: cover + order + not-ready notice + publish stays manual.
  await page.reload();
  await page.getByTestId("photo-set-cover").first().getByRole("button").click();
  await expect.poll(async () => (await db.from("photo_albums").select("cover_photo_id").eq("id", albumId).single()).data!.cover_photo_id).not.toBeNull();
  await page.context().close();
});

test("V2: wrong or broken files are refused clearly — forged extension, over the limit, corrupt image (stored, not shown)", async ({ browser }) => {
  const albumId = await newDraft("bad");
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  await page.getByTestId("album-upload-input").setInputFiles([...["forged.cr2", "oversize-55mb.jpg", "corrupt.jpg"].map((f) => path.join(GEN, f)), path.join(RAW, "sample.arw")]);
  await page.getByTestId("album-upload-start").click();
  await expect(row(page, "forged.cr2")).toHaveAttribute("data-state", "failed");
  await expect(row(page, "forged.cr2")).toContainText("لا يطابق");
  await expect(row(page, "oversize-55mb.jpg")).toHaveAttribute("data-state", "failed");
  await expect(row(page, "oversize-55mb.jpg")).toContainText("أكبر من الحد");
  // A file whose header looks right but whose data is broken uploads, then fails processing — the original is kept.
  await expect(row(page, "corrupt.jpg")).toHaveAttribute("data-state", "failed", { timeout: 120_000 });
  await expect(row(page, "corrupt.jpg")).toContainText("الصورة تالفة");
  // RAW the decoder cannot read (Sony ILCE-7M5 «compressed HQ»): clear message, original kept byte-for-byte.
  await expect(row(page, "sample.arw")).toHaveAttribute("data-state", "failed", { timeout: 120_000 });
  await expect(row(page, "sample.arw")).toContainText("ملف RAW هذا غير مدعوم");
  const stored = (await db.from("album_photos").select("upload_status, last_error, storage_path_original, sha256").eq("album_id", albumId)).data!;
  expect(stored).toHaveLength(2); // forged + oversize never reserved anything
  for (const p of stored) {
    expect(p.upload_status).toBe("failed");
    expect((await db.storage.from("album-media").info(p.storage_path_original)).data).toBeTruthy(); // original kept
  }
  expect(stored.some((p) => p.sha256 === sha(path.join(RAW, "sample.arw")))).toBe(true);
  // Not ready → cannot be shown publicly.
  expect(Number(psql(`select count(*) from public.album_photos where album_id = '${albumId}' and upload_status = 'ready'`))).toBe(0);
  await page.context().close();
});

test("V3: cancel one file mid-upload; dropped connection resumes; permission removed mid-upload stops with a clear message", async ({ browser }) => {
  const albumId = await newDraft("net");
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, uploadThroughput: (16 * 1e6) / 8, downloadThroughput: (50 * 1e6) / 8 });
  await page.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-02.jpg"), path.join(FIX, "med-03.jpg")]);
  await page.getByTestId("album-upload-start").click();
  // cancel med-03 while it uploads
  await expect(row(page, "med-03.jpg")).toHaveAttribute("data-state", "uploading", { timeout: 60_000 });
  await row(page, "med-03.jpg").getByTestId("album-upload-cancel").click();
  await expect(row(page, "med-03.jpg")).toHaveAttribute("data-state", "canceled");
  // drop the connection for 6 s while med-02 uploads, then restore: TUS retries and resumes from its offset
  await expect(row(page, "med-02.jpg")).toHaveAttribute("data-state", "uploading");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, uploadThroughput: -1, downloadThroughput: -1 });
  await page.waitForTimeout(6000);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, uploadThroughput: (16 * 1e6) / 8, downloadThroughput: (50 * 1e6) / 8 });
  await expect(row(page, "med-02.jpg")).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  const rowsDb = (await db.from("album_photos").select("sha256, upload_status").eq("album_id", albumId)).data!;
  expect(rowsDb.map((r) => r.sha256)).toEqual([sha(path.join(FIX, "med-02.jpg"))]); // canceled reservation removed
  await page.context().close();

  // permission revoked mid-upload (admin demoted): storage refuses the next chunk → clear failure, no retry loop
  const id = (await adminId())!;
  const admin = await newLoggedIn(browser, "admin", `/admin/albums/${albumId}`);
  const cdp2 = await admin.context().newCDPSession(admin);
  await cdp2.send("Network.enable");
  await cdp2.send("Network.emulateNetworkConditions", { offline: false, latency: 40, uploadThroughput: (8 * 1e6) / 8, downloadThroughput: (50 * 1e6) / 8 });
  await admin.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-04.jpg")]);
  await admin.getByTestId("album-upload-start").click();
  await expect(row(admin, "med-04.jpg")).toHaveAttribute("data-state", "uploading", { timeout: 60_000 });
  await db.from("profiles").update({ role: "customer" }).eq("id", id);
  // Either the next chunk is refused (row «فشل» with the permission message) or, if the editor refreshes first, the
  // page itself is replaced by «لا تملك صلاحية» — both are correct. What must never happen: the photo gets accepted.
  await expect(
    row(admin, "med-04.jpg").and(admin.locator('[data-state="failed"]')).or(admin.getByRole("heading", { name: "لا تملك صلاحية فتح هذه الصفحة" })),
  ).toBeVisible({ timeout: 3 * 60_000 });
  await admin.waitForTimeout(3000);
  expect(Number(psql(`select count(*) from public.album_photos where album_id = '${albumId}' and sha256 = '${sha(path.join(FIX, "med-04.jpg"))}' and upload_status <> 'uploading'`))).toBe(0);
  await db.from("profiles").update({ role: "admin" }).eq("id", id);
  expect(Number(psql(`select count(*) from public.album_photos where album_id = '${albumId}' and upload_status = 'ready'`))).toBe(1);
  await admin.context().close();
});

test("V4: 100 photos in one pick — all ready, a few at a time, browser memory stays bounded", async ({ browser }) => {
  const albumId = await newDraft("batch");
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  const files = fs.readdirSync(GEN).filter((f) => f.startsWith("batch-")).sort().map((f) => path.join(GEN, f));
  expect(files).toHaveLength(100);
  await page.getByTestId("album-upload-input").setInputFiles(files);
  await page.getByTestId("album-upload-start").click();
  let maxInFlight = 0;
  let maxHeapMB = 0;
  for (let i = 0; i < 600; i++) {
    const states = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
    maxInFlight = Math.max(maxInFlight, states.filter((s) => s === "uploading" || s === "checking").length);
    const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
    maxHeapMB = Math.max(maxHeapMB, heap / 1048576);
    if (states.length === 100 && states.every((s) => s === "ready")) break;
    await page.waitForTimeout(1000);
  }
  await expect(page.locator('[data-testid="album-upload-row"][data-state="ready"]')).toHaveCount(100);
  expect(maxInFlight).toBeLessThanOrEqual(3);
  expect(maxHeapMB).toBeLessThan(250);
  console.log(JSON.stringify({ maxInFlight, maxHeapMB: Math.round(maxHeapMB) }));
  await page.context().close();
});

// ---------------------------------------------------------------- review fixes (cancel races, previous-session rows)
const throttle = async (page: Page, mbit: number) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, uploadThroughput: (mbit * 1e6) / 8, downloadThroughput: (100 * 1e6) / 8 });
};
const objectExists = async (p: string) => !!(await db.storage.from("album-media").info(p)).data;
/** Rows of this album: none may stay `uploading`, every row's original must exist, no object folder without a row. */
async function noOrphans(albumId: string) {
  const ps = (await db.from("album_photos").select("id, upload_status, storage_path_original").eq("album_id", albumId)).data!;
  expect(ps.filter((p) => p.upload_status === "uploading")).toEqual([]);
  for (const p of ps) expect(await objectExists(p.storage_path_original)).toBe(true);
  const listed = await db.storage.from("album-media").list(`albums/${albumId}`, { limit: 1000 });
  expect((listed.data ?? []).map((o) => o.name).sort()).toEqual(ps.map((p) => p.id).sort());
  return ps;
}
/** A row as an earlier session left it: dead `uploading`, or failed with/without a stored original. */
async function seedRow(albumId: string, file: string, status: "uploading" | "failed", opts: { store?: boolean; error?: string } = {}) {
  const id = randomUUID();
  const p = `albums/${albumId}/${id}/original.jpg`;
  const buf = fs.readFileSync(file);
  if (opts.store) await db.storage.from("album-media").upload(p, buf, { contentType: "image/jpeg" });
  await db.from("album_photos").insert({ id, album_id: albumId, storage_path_original: p, mime: "image/jpeg", bytes: buf.length, sha256: sha(file), upload_status: "uploading", sort_order: 10 });
  if (status === "failed") psql(`update public.album_photos set upload_status = 'failed', attempts = 5, last_error = '${opts.error ?? "original not found in storage"}' where id = '${id}'`);
  return id;
}

test("V5: earlier-session rows merge with the re-chosen file — reload mid-upload, the 67-photo case, failed processing, late list", async ({ browser }) => {
  // a) reload while uploading, choose the same file again: one row in the UI and in the DB, ends ready (admin role)
  const a = await newDraft("reload");
  const page = await newLoggedIn(browser, "admin", `/admin/albums/${a}`);
  await throttle(page, 12);
  await page.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-05.jpg")]);
  await page.getByTestId("album-upload-start").click();
  await expect(row(page, "med-05.jpg")).toHaveAttribute("data-state", "uploading", { timeout: 60_000 });
  await page.waitForTimeout(3000);
  page.once("dialog", (d) => void d.accept()); // «leave the page?» while uploading
  await page.reload();
  await expect(rows(page)).toHaveCount(1); // the unfinished row from the earlier session
  await expect(rows(page).first()).toHaveAttribute("data-state", "failed");
  await page.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-05.jpg")]);
  await page.getByTestId("album-upload-start").click();
  await expect(rows(page).first()).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  await expect(rows(page)).toHaveCount(1);
  expect((await noOrphans(a)).map((p) => p.upload_status)).toEqual(["ready"]);
  await page.context().close();

  // b) the 67-photo case: failed, original never stored → the same row is reopened and completed
  // c) original stored but processing failed → choosing it again merges into that row; «إعادة المحاولة» finishes it
  const b = await newDraft("dead");
  const dead = await seedRow(b, path.join(FIX, "med-06.jpg"), "failed");
  const stuck = await seedRow(b, path.join(FIX, "med-07.jpg"), "failed", { store: true, error: "variant upload failed" });
  const p2 = await newLoggedIn(browser, "admin", `/admin/albums/${b}`);
  await expect(rows(p2)).toHaveCount(2);
  await p2.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-06.jpg"), path.join(FIX, "med-07.jpg")]);
  await p2.getByTestId("album-upload-start").click();
  await expect(p2.locator(`[data-testid="album-upload-row"][data-photo-id="${dead}"]`)).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  const stuckRow = p2.locator(`[data-testid="album-upload-row"][data-photo-id="${stuck}"]`);
  await expect(stuckRow).toHaveAttribute("data-state", "failed");
  await expect(rows(p2)).toHaveCount(2);
  await stuckRow.getByTestId("album-upload-retry").click();
  await expect(stuckRow).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  await expect(rows(p2)).toHaveCount(2);
  expect((await noOrphans(b)).map((p) => p.id).sort()).toEqual([dead, stuck].sort());
  await p2.context().close();

  // d) the earlier-session list arrives late (after the re-upload started): still one row
  const d = await newDraft("late");
  const dId = await seedRow(d, path.join(FIX, "med-09.jpg"), "uploading");
  const p3 = await newLoggedIn(browser, "admin", `/admin`);
  let delayed = false;
  await p3.route("**/admin/albums/**", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    // the page's first server action is getUnfinishedPhotos(albumId) — the only one carrying just the album id
    if (!delayed && req.method() === "POST" && req.headers()["next-action"] && body.includes(d) && !body.includes("sha256")) {
      delayed = true;
      await new Promise((r) => setTimeout(r, 8000));
    }
    await route.continue();
  });
  await p3.goto(`/admin/albums/${d}`);
  await p3.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-09.jpg")]);
  await p3.getByTestId("album-upload-start").click();
  await expect(rows(p3).first()).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  await p3.waitForTimeout(9000); // the delayed list has arrived by now
  expect(delayed).toBe(true);
  await expect(rows(p3)).toHaveCount(1);
  expect((await noOrphans(d)).map((p) => p.id)).toEqual([dId]);
  await p3.context().close();
});

test("V6: cancelling active uploads frees their slots — 6 files, cancel 1 of 3, then all 3 active, then a new batch; no orphans", async ({ browser }) => {
  const albumId = await newDraft("cancel");
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  await throttle(page, 24);
  const six = ["med-02", "med-03", "med-04", "med-05", "med-06", "med-07"].map((n) => path.join(FIX, `${n}.jpg`));
  await page.getByTestId("album-upload-input").setInputFiles(six);
  await page.getByTestId("album-upload-start").click();
  const uploading = page.locator('[data-testid="album-upload-row"][data-state="uploading"]');
  const canceled = page.locator('[data-testid="album-upload-row"][data-state="canceled"]');
  await expect(uploading).toHaveCount(3, { timeout: 60_000 });
  await uploading.first().getByTestId("album-upload-cancel").click();
  await expect(canceled).toHaveCount(1);
  await expect(uploading).toHaveCount(3, { timeout: 60_000 }); // the 4th file took the freed slot
  for (let i = 0; i < 3; i++) {
    await uploading.first().getByTestId("album-upload-cancel").click();
    await expect(canceled).toHaveCount(2 + i);
  }
  await expect(page.locator('[data-testid="album-upload-row"][data-state="ready"]')).toHaveCount(2, { timeout: 5 * 60_000 }); // the waiting 2 ran
  await page.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-09.jpg"), path.join(FIX, "med-11.jpg")]);
  await page.getByTestId("album-upload-start").click();
  await expect(page.locator('[data-testid="album-upload-row"][data-state="ready"]')).toHaveCount(4, { timeout: 5 * 60_000 });
  await page.waitForTimeout(3000); // late releases of cancelled reservations
  expect((await noOrphans(albumId)).length).toBe(4);
  await page.context().close();
});

test("V7: cancel while the reservation is in flight — the late reservation is released, the next file still runs, no orphan row", async ({ browser }) => {
  const albumId = await newDraft("cancel-reserve");
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  let held = 0;
  await page.route("**/admin/albums/**", async (route) => {
    const req = route.request();
    // hold the first reservation (the only action carrying a sha256) for 5 s
    if (held === 0 && req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes("sha256")) {
      held++;
      await new Promise((r) => setTimeout(r, 5000));
    }
    await route.continue();
  });
  await page.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-02.jpg")]);
  await page.getByTestId("album-upload-start").click();
  await expect(row(page, "med-02.jpg")).toHaveAttribute("data-state", "checking");
  await page.waitForTimeout(1500); // hash done, reservation held
  await row(page, "med-02.jpg").getByTestId("album-upload-cancel").click();
  await expect(row(page, "med-02.jpg")).toHaveAttribute("data-state", "canceled");
  await page.getByTestId("album-upload-input").setInputFiles([path.join(FIX, "med-03.jpg")]);
  await page.getByTestId("album-upload-start").click();
  await expect(row(page, "med-03.jpg")).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  await page.waitForTimeout(6000); // the held reservation has landed and been released
  expect(held).toBe(1);
  await expect(row(page, "med-02.jpg")).toHaveAttribute("data-state", "canceled");
  expect((await noOrphans(albumId)).length).toBe(1);
  await page.context().close();
});

test("V8: a RAW decode that exceeds the timeout fails (original kept, no retry loop) and the next RAW is still processed", async ({ browser }) => {
  // Needs the SERVER started with a tiny limit: ALBUM_RAW_DECODE_TIMEOUT_MS=300 npx next start -p 3600
  test.skip(process.env.ALBUM_RAW_DECODE_TIMEOUT_MS !== "300", "opt-in: server and test with ALBUM_RAW_DECODE_TIMEOUT_MS=300");
  const albumId = await newDraft("raw-timeout");
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  await page.getByTestId("album-upload-input").setInputFiles([path.join(RAW, "sample.raf"), path.join(FIX, "med-11.jpg")]);
  await page.getByTestId("album-upload-start").click();
  await expect(row(page, "sample.raf")).toHaveAttribute("data-state", "failed", { timeout: 5 * 60_000 });
  await expect(row(page, "sample.raf")).toContainText("أخذ وقتاً أطول");
  const ps = (await db.from("album_photos").select("storage_path_original, upload_status, last_error, attempts, sha256").eq("album_id", albumId)).data!;
  const raf = ps.find((p) => p.storage_path_original.endsWith(".raf"))!;
  expect(raf.last_error).toMatch(/RAW decode timed out/);
  expect(raf.attempts).toBe(5); // parked: no automatic retry loop
  const orig = Buffer.from(await (await db.storage.from("album-media").download(raf.storage_path_original)).data!.arrayBuffer());
  expect(createHash("sha256").update(orig).digest("hex")).toBe(raf.sha256); // original intact
  // the queue is not stuck: the next file is processed
  await expect(row(page, "med-11.jpg")).toHaveAttribute("data-state", "ready", { timeout: 5 * 60_000 });
  await page.context().close();
});

// this suite seeds/removes albums directly in the DB: expire the public album cache through the app afterwards, so
// no later page shows an album that no longer exists (what the admin actions do with updateTag)
test.beforeAll(() => revalidatePublic(["photo-albums"]));
test.afterAll(() => revalidatePublic(["photo-albums"]));
