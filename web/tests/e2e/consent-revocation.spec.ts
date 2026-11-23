import { expect, test } from "@playwright/test";
import { anon, as, BASE, db, EV, newLoggedIn, psql, SB_URL, uiLogin } from "./qa-helpers";

/**
 * Release blocker: publication consent withdrawal (migration 0010, /m route, storage-cleanup).
 * LOCAL STACK + PRODUCTION BUILD ONLY:
 *   npm run build && npx next start -p 3500
 *   npx supabase functions serve   (edge runtime must serve storage-cleanup)
 *   BASE_URL=http://localhost:3500 npx playwright test tests/e2e/consent-revocation.spec.ts
 * Mutates the seeded sample project (A2) and restores it (customer re-grant + admin publish).
 */
const SLUG = "dev-sample-published-project";
const TITLE = "[DEV] Sample published project";

let source: { id: string; path: string; display: string; thumb: string };
let publicId = "";
let pubDisplay = "";
let pubThumb = "";
let privateBefore = 0;

async function poll<T>(fn: () => Promise<T> | T, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1000));
    v = await fn();
  }
  return v;
}

async function objectExists(bucket: string, path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await db.storage.from(bucket).list(dir, { search: name });
  return (data ?? []).some((o) => o.name === name);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // Seed state: A2 published with consent granted, owned by customer A.
  psql(`update public.events set publication_consent = 'granted', is_published = true where id = '${EV.A2}';`);
  const { data: src } = await db
    .from("media_assets")
    .select("id, path, variants")
    .eq("event_id", EV.A2)
    .eq("bucket", "private-media")
    .eq("kind", "image")
    .order("sort_order")
    .limit(1)
    .single();
  const v = src!.variants as Record<string, string>;
  source = { id: src!.id, path: src!.path, display: v.display, thumb: v.thumb };
  pubDisplay = `events/${EV.A2}/${source.id}/display.webp`;
  pubThumb = `events/${EV.A2}/${source.id}/thumb.webp`;
  // Leftovers from a previous run.
  await db.from("media_assets").delete().eq("bucket", "public-media").eq("path", pubDisplay);
  await db.storage.from("public-media").remove([pubDisplay, pubThumb]);
  privateBefore = (await db.from("media_assets").select("id", { count: "exact", head: true }).eq("event_id", EV.A2).eq("bucket", "private-media")).count ?? 0;

  // The admin publishes one image with the real «نشر في الأعمال» button (publishMediaItem): the copy, the public row and
  // the refresh of the public pages are all the product's own.
  const page = await newLoggedIn(browser, "admin", `/admin/events/${EV.A2}/media`);
  const item = page.locator(`[data-testid=media-item]:has(input[name="ids"][value="${source.id}"])`);
  await item.getByRole("button", { name: "نشر في الأعمال" }).click();
  await expect(item.getByRole("button", { name: "إلغاء النشر" })).toBeVisible();
  await page.context().close();
  const row = (await db.from("media_assets").select("id, path, variants, visibility").eq("bucket", "public-media").eq("path", pubDisplay).single()).data!;
  expect(row.visibility).toBe("public");
  expect(row.variants).toEqual({ display: pubDisplay, thumb: pubThumb });
  publicId = row.id;
});

test.afterAll(async () => {
  // Restore seed state if a step failed midway (normal path restores via the UI in the last test).
  psql(`update public.events set consent_revoked_by_customer_at = null, publication_consent = 'granted', is_published = true where id = '${EV.A2}';`);
  psql(`delete from private.storage_cleanup_queue where reason like 'e2e-%';`);
});

test("published media is served through /m with a bounded public cache", async ({ request }) => {
  const url = `${BASE}/m/${publicId}/display`;
  const r = await request.get(url);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("image/webp");
  expect(r.headers()["cache-control"]).toBe("private, max-age=60, stale-while-revalidate=0, stale-if-error=0");
  expect(r.headers()["cdn-cache-control"]).toBe("no-store");
  expect((await r.body()).length).toBeGreaterThan(100);
  expect((await request.get(`${BASE}/m/${publicId}/thumb`)).status()).toBe(200);
  // The bucket itself is not public: the old direct URL shape never works.
  expect((await request.get(`${SB_URL}/storage/v1/object/public/public-media/${pubDisplay}`)).ok()).toBe(false);

  // Project page and listing: the publish action refreshed them, so one request each (no waiting for a timed refresh).
  // Projects are listed on /work («مشاريع مختارة»); since the gallery round the homepage shows videos/albums, not projects.
  const project = await request.get(`${BASE}/work/${SLUG}`);
  expect(project.status()).toBe(200);
  expect(await project.text()).toContain(`/m/${publicId}/`);
  const work = await (await request.get(`${BASE}/work`)).text();
  expect(work).toContain(`/work/${SLUG}`);
  expect(work).toContain(`/m/${publicId}/`);
  expect(work).not.toContain("/storage/v1/object/public/");
});

test("customer withdraws consent in the portal: same URL is 404 immediately", async ({ page, request }) => {
  const url = `${BASE}/m/${publicId}/display`;
  // Count only the cleanup jobs THIS withdrawal enqueues (earlier runs on the same stack leave their own rows).
  const since = psql("select now()::text");
  await uiLogin(page, "a", `/portal/events/${EV.A2}`);
  const card = page.getByTestId("consent-card");
  await card.getByRole("button", { name: "سحب الموافقة على النشر" }).click();
  await card.getByRole("button", { name: "تأكيد" }).click();
  await expect(card.getByRole("status")).toContainText("سُحبت الموافقة");
  const t0 = Date.now();
  // The page then refreshes into the «withdrawn» state (the card now offers to grant again): the confirmation must
  // keep saying what the customer did, not turn into the grant message.
  await expect(page.getByTestId("consent-status")).toContainText("سحبت موافقتك على النشر");
  await expect(card.getByRole("status")).toHaveText("سُحبت الموافقة. لم تعد مناسبتك معروضة للعامة.");

  // Same URL, straight to the origin, immediately after the action returned.
  const same = await request.get(url);
  expect(same.status()).toBe(404);
  expect(same.headers()["cache-control"]).toBe("no-store");
  // Cache-busted variant of the same URL (proves no intermediate cache answered).
  const busted = await request.get(`${url}?cb=${Date.now()}`, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  expect(busted.status()).toBe(404);
  expect((await request.get(`${BASE}/m/${publicId}/thumb`)).status()).toBe(404);
  expect(Date.now() - t0).toBeLessThan(10_000);

  // Project page 404, homepage + /work no longer list it.
  expect((await request.get(`${BASE}/work/${SLUG}`)).status()).toBe(404);
  const home = await (await request.get(`${BASE}/`)).text();
  expect(home).not.toContain(`/work/${SLUG}`);
  expect(home).not.toContain(publicId);
  const work = await (await request.get(`${BASE}/work`)).text();
  expect(work).not.toContain(`/work/${SLUG}`);
  expect(work).not.toContain(TITLE);

  // Direct storage API as anon fails (both the public URL shape and an authenticated anon download).
  expect((await request.get(`${SB_URL}/storage/v1/object/public/public-media/${pubDisplay}`)).ok()).toBe(false);
  const dl = await anon().storage.from("public-media").download(pubDisplay);
  expect(dl.data).toBeNull();
  expect(dl.error).not.toBeNull();

  // DB state: withdrawal recorded, copies queued.
  expect(psql(`select consent_revoked_by_customer_at is not null from public.events where id = '${EV.A2}'`)).toBe("t");
  expect(Number(psql(`select count(*) from private.storage_cleanup_queue where bucket = 'public-media' and path in ('${pubDisplay}', '${pubThumb}') and enqueued_at >= '${since}'::timestamptz`))).toBe(2);
});

test("staff cannot republish after the customer withdrew", async () => {
  const admin = await as("admin");
  const g = await admin.rpc("set_publication_consent", { p_event_id: EV.A2, p_status: "granted" });
  expect(g.error?.code).toBe("42501");
  const p = await admin.rpc("set_event_publication", { p_event_id: EV.A2, p_publish: true });
  expect(p.error?.code).toBe("42501");
});

test("scheduled worker (pg_cron -> pg_net -> storage-cleanup) deletes the published copies", async () => {
  test.setTimeout(240_000);
  expect(psql(`select count(*) from cron.job where jobname = 'storage-cleanup' and active`)).toBe("1");
  // The worker takes 100 jobs per call, oldest first. After the upload specs the queue can hold hundreds of older jobs,
  // so it is called again on every check until it has reached these two (each call is the same scheduled path).
  const left = await poll(
    () => {
      psql(`select app.invoke_storage_cleanup('e2e-manual');`);
      return Number(psql(`select count(*) from private.storage_cleanup_queue where bucket = 'public-media' and path in ('${pubDisplay}', '${pubThumb}') and done_at is null`));
    },
    (n) => n === 0,
    180_000,
  );
  expect(left).toBe(0);
  expect(await objectExists("public-media", pubDisplay)).toBe(false);
  expect(await objectExists("public-media", pubThumb)).toBe(false);
  // The stale public row is removed with its object.
  expect((await db.from("media_assets").select("id").eq("id", publicId)).data).toEqual([]);
});

test("forced failure is retried with backoff, then succeeds", async () => {
  const path = `events/${EV.A2}/e2e-fail/${Date.now()}.webp`;
  const up = await db.storage.from("public-media").upload(path, new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" }));
  expect(up.error).toBeNull();
  // Wrong bucket: the worker's allow-list rejects it -> failure path.
  const id = psql(`insert into private.storage_cleanup_queue (bucket, path, reason) values ('public-media-wrong', '${path}', 'e2e-forced-failure') returning id;`).split("\n")[0];
  psql(`select app.invoke_storage_cleanup('e2e-forced');`);
  const failed = await poll(() => psql(`select attempts || '|' || coalesce(last_error, '') || '|' || (next_attempt_at > now()) || '|' || (done_at is null) from private.storage_cleanup_queue where id = '${id}'`), (s) => s.startsWith("1|"));
  const [attempts, err, backoff, pending] = failed.split("|");
  expect(attempts).toBe("1");
  expect(err).toContain("invalid bucket");
  expect(backoff).toBe("true");
  expect(pending).toBe("true");
  expect(await objectExists("public-media", path)).toBe(true);

  // Fix the cause; let the backoff elapse; the next run succeeds.
  psql(`update private.storage_cleanup_queue set bucket = 'public-media', next_attempt_at = now() where id = '${id}';`);
  psql(`select app.invoke_storage_cleanup('e2e-retry');`);
  const done = await poll(() => psql(`select (done_at is not null) || '|' || attempts from private.storage_cleanup_queue where id = '${id}'`), (s) => s.startsWith("true|"));
  expect(done).toBe("true|1");
  expect(await objectExists("public-media", path)).toBe(false);
});

test("private originals stay; owner customer can still download via signed URL; customer re-grants", async ({ page, request, browser }) => {
  const count = (await db.from("media_assets").select("id", { count: "exact", head: true }).eq("event_id", EV.A2).eq("bucket", "private-media")).count;
  expect(count).toBe(privateBefore);
  for (const p of [source.path, source.display, source.thumb]) expect(await objectExists("private-media", p)).toBe(true);
  const a = await as("a");
  const s = await a.storage.from("private-media").createSignedUrl(source.path, 60);
  expect(s.error).toBeNull();
  const got = await request.get(s.data!.signedUrl);
  expect(got.status()).toBe(200);

  // Only the customer can grant again; then staff may publish.
  await uiLogin(page, "a", `/portal/events/${EV.A2}`);
  const card = page.getByTestId("consent-card");
  await card.getByRole("button", { name: "الموافقة على النشر" }).click();
  await card.getByRole("button", { name: "تأكيد" }).click();
  await expect(card.getByRole("status")).toContainText("سُجّلت موافقتك");
  await expect(page.getByTestId("consent-status")).toContainText("وافقت على عرض صور مختارة"); // refreshed into «granted»
  await expect(card.getByRole("status")).toHaveText("شكراً لك، سُجّلت موافقتك."); // and still the grant message
  expect(psql(`select publication_consent || '|' || (consent_revoked_by_customer_at is null) from public.events where id = '${EV.A2}'`)).toBe("granted|true");
  // …through the admin's own «نشر في صفحة الأعمال» (the action also refreshes the public pages).
  const adminPage = await newLoggedIn(browser, "admin", `/admin/events/${EV.A2}`);
  await adminPage.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" }).click();
  await expect(adminPage.getByRole("button", { name: "إيقاف النشر" })).toBeVisible();
  await adminPage.context().close();
  expect(psql(`select is_published from public.events where id = '${EV.A2}'`)).toBe("t");
  const back = await request.get(`${BASE}/work/${SLUG}`);
  expect(back.status()).toBe(200);
  expect(await back.text()).not.toContain(publicId); // the withdrawn photo does not come back with the project
  expect(await (await request.get(`${BASE}/work`)).text()).toContain(`/work/${SLUG}`);
});
