import { expect, test } from "@playwright/test";
import http from "node:http";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, newLoggedIn } from "./qa-helpers";

/**
 * FA — «نشر على فيسبوك» for an album, WITHOUT any real Facebook call. LOCAL STACK ONLY.
 * The app server must be started with META_GRAPH_BASE pointing at the mock below (only a localhost base is accepted):
 *   META_GRAPH_BASE=http://127.0.0.1:57999 npx next start -p 3710
 *   FB_MOCK_PORT=57999 BASE_URL=http://127.0.0.1:3710 npx playwright test facebook-album --project=chromium
 * A fake Page connection (a fake token) is stored through meta_connect and removed afterwards.
 */
test.describe.configure({ mode: "serial" });
const PORT = Number(process.env.FB_MOCK_PORT ?? 0);
test.skip(!PORT, "set FB_MOCK_PORT and start the app with META_GRAPH_BASE=http://127.0.0.1:<port>");

const STAMP = Date.now().toString(36);
const ALBUM = { id: randomUUID(), slug: `qa-fb-${STAMP}`, title: `ألبوم فيسبوك تجريبي ${STAMP}` };
const PHOTOS = [0, 1].map(() => randomUUID());
const uploaded: string[] = [];
type Req = { method: string; path: string; body: string; type: string };
const seen: Req[] = [];
let server: http.Server;
let hadConnection: unknown = null;

function startMock() {
  let photo = 0;
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "").split("?")[0];
      seen.push({ method: req.method ?? "", path, body: body.toString("latin1"), type: String(req.headers["content-type"] ?? "") });
      const send = (o: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(o)));
      if (req.method === "POST" && /\/1234567890\/albums$/.test(path)) return send({ id: "900100" });
      if (req.method === "GET" && /\/1234567890\/albums$/.test(path)) return send({ data: [] });
      if (req.method === "POST" && /\/900100\/photos$/.test(path)) return send({ id: `77${++photo}`, post_id: `1234567890_${photo}` });
      if (req.method === "GET" && /\/900100$/.test(path)) return send({ link: "https://www.facebook.com/media/set/?set=a.900100&type=3" });
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unknown", code: 100 } }));
    });
  });
  return new Promise<void>((ok) => server.listen(PORT, "127.0.0.1", ok));
}

test.beforeAll(async () => {
  await startMock();
  hadConnection = (await db.from("meta_page_connection").select("*").eq("id", 1).maybeSingle()).data;
  const c = await db.rpc("meta_connect", { p_page_id: "1234567890", p_page_name: "صفحة اختبار", p_token: "fake-token-for-local-tests-only" });
  if (c.error) throw new Error(c.error.message);
  const { error } = await db.from("photo_albums").insert({ id: ALBUM.id, slug: ALBUM.slug, title: ALBUM.title, is_published: false, sort_order: 1 });
  if (error) throw new Error(error.message);
  for (const [i, id] of PHOTOS.entries()) {
    const base = `albums/${ALBUM.id}/${id}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="${i ? "#1f2a33" : "#3a2f1e"}"/></svg>`;
    const webp = await sharp(Buffer.from(svg)).webp().toBuffer();
    for (const v of ["original.jpg", "display.webp", "thumb.webp"]) {
      const p = `${base}/${v}`;
      const up = await db.storage.from("album-media").upload(p, webp, { contentType: v.endsWith("jpg") ? "image/jpeg" : "image/webp", upsert: true });
      if (up.error) throw new Error(up.error.message);
      uploaded.push(p);
    }
    const ins = await db.from("album_photos").insert({ id, album_id: ALBUM.id, storage_path_original: `${base}/original.jpg`, variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` }, width: 800, height: 600, mime: "image/jpeg", sort_order: i, is_published: true, upload_status: "ready" });
    if (ins.error) throw new Error(ins.error.message);
  }
});

test.afterAll(async () => {
  server?.close();
  await db.from("facebook_album_posts").delete().eq("album_id", ALBUM.id);
  await db.from("album_photos").delete().eq("album_id", ALBUM.id);
  await db.from("photo_albums").delete().eq("id", ALBUM.id);
  if (uploaded.length) await db.storage.from("album-media").remove(uploaded);
  if (hadConnection) await db.from("meta_page_connection").upsert(hadConnection as Record<string, unknown>);
  else await db.rpc("meta_disconnect").then(() => db.from("meta_page_connection").delete().eq("id", 1));
});

test("FA1 shows the Page name and the chosen photos, then creates ONE real album and adds both photos (as JPEG)", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", `/admin/albums/${ALBUM.id}`);
  await page.getByTestId("album-facebook-link").click();
  await expect(page.getByTestId("fb-album-page-name")).toHaveText("صفحة اختبار");
  await expect(page.getByTestId("fb-album-photo")).toHaveCount(2);
  await page.getByTestId("fb-album-submit").getByRole("button", { name: "نشر على فيسبوك" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "نشر" }).click();
  await expect(page.getByTestId("fb-album-published")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("fb-album-link")).toHaveAttribute("href", "https://www.facebook.com/media/set/?set=a.900100&type=3");

  const creates = seen.filter((r) => r.method === "POST" && r.path.endsWith("/1234567890/albums"));
  expect(creates).toHaveLength(1);
  expect(decodeURIComponent(creates[0].body.replace(/\+/g, " "))).toContain(`name=${ALBUM.title}`);
  const photos = seen.filter((r) => r.method === "POST" && r.path.endsWith("/900100/photos"));
  expect(photos).toHaveLength(2);
  for (const p of photos) {
    expect(p.type).toMatch(/^multipart\/form-data/);
    expect(p.body).toContain("Content-Type: image/jpeg");
  }
  expect(seen.some((r) => /\/feed$/.test(r.path))).toBe(false); // never a multi-photo feed post instead of an album
  const row = (await db.from("facebook_album_posts").select("status, fb_album_id, done").eq("album_id", ALBUM.id).single()).data!;
  expect(row).toMatchObject({ status: "published", fb_album_id: "900100" });
  expect(Object.keys(row.done)).toHaveLength(2);
  // the site album stays a draft: Facebook and the site are separate
  expect((await db.from("photo_albums").select("is_published").eq("id", ALBUM.id).single()).data!.is_published).toBe(false);
  await page.context().close();
});

test("FA2 no duplicate: a published album offers no second publish, and nothing more is sent to Facebook", async ({ browser }) => {
  const before = seen.length;
  const page = await newLoggedIn(browser, "admin", `/admin/albums/${ALBUM.id}/facebook`);
  await expect(page.getByTestId("fb-album-published")).toBeVisible();
  await expect(page.getByTestId("fb-album-submit")).toHaveCount(0);
  expect(seen.length).toBe(before);
  await page.context().close();
});
