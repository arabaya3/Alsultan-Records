import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { BASE, db, EV, lockTable, newLoggedIn, psql } from "./qa-helpers";

/**
 * Public pages and a project's published photos (day-long public cache, refreshed by cache tags).
 *
 *   PM1  the REAL admin flow: «نشر في الأعمال» / «إلغاء النشر» on one photo reaches /work and the project page on the very
 *        next request — and the photo's bytes are 404 the moment it is unpublished;
 *   PM2  project «إيقاف النشر» / «نشر في صفحة الأعمال» from the admin, same rule;
 *   PM3  the race, for a customer's consent withdrawal: a page rebuild that read the project BEFORE the withdrawal and
 *        finishes AFTER it must not stay in the cache;
 *   PM4  the same for the admin stopping (and restarting) a project's publication;
 *   PM5  the same for a visitor's project-page render during an admin save.
 *
 * How the race is made deterministic (PM3, PM4): /sitemap.xml is the statically cached page that carries the list of
 * published projects. Its rebuild reads the projects and the active offers. The test expires the offers read, then
 * holds a database lock on `offers`: the rebuild reads the projects and waits; the action under test (which never
 * touches `offers`) runs to completion and expires the cache; the lock is released and the rebuild finishes and is
 * stored with the list it read earlier. Without the second expiry in expirePublicProjects() that stale sitemap stays
 * until the timed refresh (measured while writing this: still stale 27 s later); with it, it is replaced within seconds.
 * PM5 holds the project page's own read between its two queries (lock on `media_assets`) during an event save.
 * A single photo is not on any statically cached page, so its publish/unpublish is covered by the real flow (PM1).
 * ISOLATED STACK ONLY (psql refuses the shared database).
 * Restores the seeded project (published, consent granted, no public photo, its original highlight).
 *   BASE_URL=http://localhost:3400 E2E_DB_CONTAINER=supabase_db_<isolated> npx playwright test project-media-cache
 */
test.describe.configure({ mode: "serial", timeout: 180_000 });

const SLUG = "dev-sample-published-project";
const TITLE = "[DEV] Sample published project";
const PROJECT = `${BASE}/work/${SLUG}`;
const MEDIA_ADMIN = `${BASE}/admin/events/${EV.A2}/media`;
const EVENT_ADMIN = `${BASE}/admin/events/${EV.A2}`;

let sourceId = "";
let highlightBefore: string | null = null;
let admin: Page;

const publicRow = async () =>
  (await db.from("media_assets").select("id, path, visibility").eq("bucket", "public-media").eq("event_id", EV.A2).like("path", `events/${EV.A2}/${sourceId}/%`).maybeSingle()).data;
const item = (page: Page) => page.locator(`[data-testid=media-item]:has(input[name="ids"][value="${sourceId}"])`);
const body = async (request: APIRequestContext, url: string) => {
  const r = await request.get(url);
  return { status: r.status(), html: await r.text() };
};
const eventState = () => psql(`select publication_consent || '|' || is_published from public.events where id = '${EV.A2}'`);
const highlight = () => psql(`select coalesce(highlight, '') from public.events where id = '${EV.A2}'`);

async function publishPhoto(page: Page): Promise<string> {
  await page.goto(MEDIA_ADMIN);
  await expect(item(page)).toBeVisible();
  await item(page).getByRole("button", { name: "نشر في الأعمال" }).click();
  await expect(item(page).getByRole("button", { name: "إلغاء النشر" })).toBeVisible();
  const row = await publicRow();
  expect(row?.visibility).toBe("public");
  return row!.id;
}
async function unpublishPhoto(page: Page) {
  await item(page).getByRole("button", { name: "إلغاء النشر" }).click();
  await expect(item(page).getByRole("button", { name: "نشر في الأعمال" })).toBeVisible();
  expect(await publicRow()).toBeNull();
}
async function saveHighlight(page: Page, text: string, waitForMessage = true) {
  const form = page.getByTestId("event-form");
  await form.locator('input[name="highlight"]').fill(text);
  await form.getByRole("button", { name: "حفظ التغييرات" }).click();
  if (waitForMessage) await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
}
/** Seed state for the sample project, through the same actions the owner and the customer use. */
async function restore(browser: Browser) {
  if (!eventState().startsWith("granted")) {
    const c = await newLoggedIn(browser, "a", `/portal/events/${EV.A2}`);
    const card = c.getByTestId("consent-card");
    await card.getByRole("button", { name: "الموافقة على النشر" }).click();
    await card.getByRole("button", { name: "تأكيد" }).click();
    await expect(card.getByRole("status")).toContainText("سُجّلت موافقتك");
    await c.context().close();
  }
  await admin.goto(EVENT_ADMIN);
  await expect(admin.getByTestId("publish-form")).toBeVisible();
  if ((await admin.getByRole("button", { name: "إيقاف النشر" }).count()) === 0) {
    await admin.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" }).click();
    await expect(admin.getByRole("button", { name: "إيقاف النشر" })).toBeVisible();
  }
  if (highlightBefore !== null && highlight() !== highlightBefore) {
    await admin.goto(EVENT_ADMIN);
    await expect(admin.getByTestId("event-form")).toBeVisible();
    await saveHighlight(admin, highlightBefore);
  }
  await admin.goto(MEDIA_ADMIN);
  await expect(item(admin)).toBeVisible();
  if ((await item(admin).getByRole("button", { name: "إلغاء النشر" }).count()) > 0) await unpublishPhoto(admin);
  expect(eventState()).toBe("granted|true");
}

/** An unchanged admin save of the offers heading: the offers read is expired, so the next sitemap build must query it. */
async function expireOffersRead(browser: Browser) {
  const p = await newLoggedIn(browser, "owner", "/admin/content/offers");
  const form = p.getByTestId("section-intro-offers");
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await p.context().close();
}

/**
 * Stages the race on the statically cached /sitemap.xml: its rebuild reads the published projects (the sample project
 * is among them) and then waits for the locked `offers` read; `change` runs to completion meanwhile; the lock is
 * released and the rebuild finishes — and stores — the list it read before the change. Returns that in-flight response.
 */
async function withSitemapRebuildInFlight(browser: Browser, request: APIRequestContext, change: () => Promise<void>): Promise<string> {
  await expireOffersRead(browser);
  const lock = await lockTable("offers");
  try {
    const inFlight = body(request, `${BASE}/sitemap.xml`);
    await expect.poll(lock.waiting, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 700)); // the projects read is not behind the lock: let it finish
    await change();
    await new Promise((r) => setTimeout(r, 1_000)); // the action expires the cache right after its last write
    expect(lock.waiting()).toBeGreaterThan(0); // the rebuild is still in flight
    await lock.release();
    return (await inFlight).html;
  } finally {
    await lock.release();
  }
}
const sitemapListsProject = async (request: APIRequestContext) => (await body(request, `${BASE}/sitemap.xml`)).html.includes(`/work/${SLUG}`);

test.beforeAll(async ({ browser }) => {
  const src = (await db.from("media_assets").select("id, variants").eq("event_id", EV.A2).eq("bucket", "private-media").eq("kind", "image").order("sort_order").limit(1).single()).data!;
  expect(typeof (src.variants as Record<string, unknown>).display).toBe("string");
  sourceId = src.id;
  highlightBefore = highlight();
  admin = await newLoggedIn(browser, "admin", `/admin/events/${EV.A2}/media`);
  await restore(browser); // a clean start whatever an earlier run left: published, consent granted, no public photo
});

test.afterAll(async ({ browser }) => {
  await restore(browser);
  await admin.context().close();
});

test("PM1: publishing and unpublishing one photo in the admin reaches /work and the project page on the next request", async ({ request }) => {
  // Warm both pages first: they are now cached WITHOUT the photo, which is exactly what must not survive the publish.
  expect((await body(request, PROJECT)).status).toBe(200);
  expect((await body(request, `${BASE}/work`)).html).toContain(`/work/${SLUG}`);

  const id = await publishPhoto(admin);
  // one request each, no waiting for a timed refresh
  expect((await body(request, PROJECT)).html).toContain(`/m/${id}/`);
  const work = (await body(request, `${BASE}/work`)).html;
  expect(work).toContain(`/m/${id}/`); // the project card's cover
  expect(work).not.toContain("/storage/v1/object/public/");
  const img = await request.get(`${BASE}/m/${id}/display`);
  expect(img.status()).toBe(200);
  expect(img.headers()["cache-control"]).toBe("private, max-age=60, stale-while-revalidate=0, stale-if-error=0");
  expect(img.headers()["cdn-cache-control"]).toBe("no-store");

  await unpublishPhoto(admin);
  // the bytes are gone at once, and so is every mention of the photo on the pages
  const gone = await request.get(`${BASE}/m/${id}/display`);
  expect(gone.status()).toBe(404);
  expect(gone.headers()["cache-control"]).toBe("no-store");
  expect((await request.get(`${BASE}/m/${id}/thumb`)).status()).toBe(404);
  const after = await body(request, PROJECT);
  expect(after.status).toBe(200); // the project itself stays published
  expect(after.html).not.toContain(id);
  expect((await body(request, `${BASE}/work`)).html).not.toContain(id);
  // …and it stays that way once the later safety expiry has run
  await new Promise((r) => setTimeout(r, 6500));
  expect((await body(request, PROJECT)).html).not.toContain(id);
});

test("PM2: stopping and restarting the project's publication in the admin is on the public pages at once", async ({ request }) => {
  const id = await publishPhoto(admin);
  expect((await body(request, PROJECT)).html).toContain(`/m/${id}/`);

  await admin.goto(EVENT_ADMIN);
  await expect(admin.getByTestId("publish-form")).toBeVisible();
  await admin.getByRole("button", { name: "إيقاف النشر" }).click();
  await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect(admin.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" })).toBeVisible();

  expect((await request.get(`${BASE}/m/${id}/display`)).status()).toBe(404);
  expect((await body(request, PROJECT)).status).toBe(404);
  const work = (await body(request, `${BASE}/work`)).html;
  expect(work).not.toContain(`/work/${SLUG}`);
  expect(work).not.toContain(TITLE);
  expect(work).not.toContain(id);
  expect((await body(request, `${BASE}/sitemap.xml`)).html).not.toContain(`/work/${SLUG}`);
  expect(await publicRow()).toBeNull(); // the public copy row went with the publication

  await admin.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" }).click();
  await expect(admin.getByRole("button", { name: "إيقاف النشر" })).toBeVisible();
  const back = await body(request, PROJECT);
  expect(back.status).toBe(200);
  expect(back.html).not.toContain(id); // republishing the project does not bring an unpublished photo back
  expect((await body(request, `${BASE}/work`)).html).toContain(`/work/${SLUG}`);
  expect((await body(request, `${BASE}/sitemap.xml`)).html).toContain(`/work/${SLUG}`);

  // Unpublishing the project deleted the public row; its two files are removed by the cleanup worker, which can lag.
  // Publishing the photo again must not depend on that: plant leftovers at exactly those paths and publish.
  const base = `events/${EV.A2}/${sourceId}`;
  const leftover = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" });
  for (const f of ["display.webp", "thumb.webp"]) expect((await db.storage.from("public-media").upload(`${base}/${f}`, leftover, { upsert: true })).error).toBeNull();
  const again = await publishPhoto(admin);
  const img = await request.get(`${BASE}/m/${again}/display`);
  expect(img.status()).toBe(200);
  expect((await img.body()).length).toBeGreaterThan(100); // the real variant, not the 4-byte leftover
  expect((await body(request, PROJECT)).html).toContain(`/m/${again}/`);
});

test("PM3: a customer's consent withdrawal while the sitemap is being rebuilt does not leave the project listed", async ({ browser, request }) => {
  await restore(browser);
  const id = await publishPhoto(admin);
  expect((await body(request, PROJECT)).html).toContain(`/m/${id}/`);
  expect(await sitemapListsProject(request)).toBe(true);
  const customer = await newLoggedIn(browser, "a", `/portal/events/${EV.A2}`);
  const card = customer.getByTestId("consent-card");
  await expect(card.getByRole("button", { name: "سحب الموافقة على النشر" })).toBeVisible();

  const inFlight = await withSitemapRebuildInFlight(browser, request, async () => {
    await card.getByRole("button", { name: "سحب الموافقة على النشر" }).click();
    await card.getByRole("button", { name: "تأكيد" }).click();
    await expect.poll(eventState, { timeout: 20_000, intervals: [200] }).toBe("revoked|false");
    // withdrawn in the database: the photo is refused from this request on, whatever any cached page still says
    const gone = await request.get(`${BASE}/m/${id}/display`);
    expect(gone.status()).toBe(404);
    expect(gone.headers()["cache-control"]).toBe("no-store");
  });
  // The scenario really happened: the rebuild that was in flight still listed the project.
  expect(inFlight).toContain(`/work/${SLUG}`);
  await expect(customer.getByTestId("consent-status")).toContainText("سحبت موافقتك على النشر"); // the portal shows the new state
  await expect(card.getByRole("status")).toHaveText("سُحبت الموافقة. لم تعد مناسبتك معروضة للعامة."); // and confirms the withdrawal

  // What that rebuild stored must not stay: within a few seconds the sitemap no longer names the withdrawn project.
  await expect.poll(() => sitemapListsProject(request), { timeout: 20_000, intervals: [1_000] }).toBe(false);
  expect((await body(request, PROJECT)).status).toBe(404);
  const work = (await body(request, `${BASE}/work`)).html;
  expect(work).not.toContain(`/work/${SLUG}`);
  expect(work).not.toContain(TITLE);
  await new Promise((r) => setTimeout(r, 3_000)); // and it does not come back
  expect(await sitemapListsProject(request)).toBe(false);
  expect((await body(request, PROJECT)).status).toBe(404);
  await customer.context().close();
});

test("PM4: the admin stopping a project's publication while the sitemap is being rebuilt does not leave it listed; publishing it again lists it", async ({ browser, request }) => {
  await restore(browser);
  expect(await sitemapListsProject(request)).toBe(true);
  await admin.goto(EVENT_ADMIN);
  await expect(admin.getByTestId("publish-form")).toBeVisible();

  const stopped = await withSitemapRebuildInFlight(browser, request, async () => {
    await admin.getByRole("button", { name: "إيقاف النشر" }).click();
    await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
    await expect.poll(eventState, { timeout: 20_000, intervals: [200] }).toBe("granted|false");
  });
  expect(stopped).toContain(`/work/${SLUG}`); // the in-flight rebuild had read it as published
  await expect.poll(() => sitemapListsProject(request), { timeout: 20_000, intervals: [1_000] }).toBe(false);
  expect((await body(request, PROJECT)).status).toBe(404);

  // The other direction: publishing during a rebuild that had read «not published».
  await admin.goto(EVENT_ADMIN);
  await expect(admin.getByTestId("publish-form")).toBeVisible();
  const published = await withSitemapRebuildInFlight(browser, request, async () => {
    await admin.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" }).click();
    await expect.poll(eventState, { timeout: 20_000, intervals: [200] }).toBe("granted|true");
  });
  expect(published).not.toContain(`/work/${SLUG}`);
  await expect.poll(() => sitemapListsProject(request), { timeout: 20_000, intervals: [1_000] }).toBe(true);
  expect((await body(request, PROJECT)).status).toBe(200);
});

test("PM5: a visitor's project-page render in flight during an admin save does not leave the old text in the cache", async ({ browser, request }) => {
  await restore(browser);
  const OLD = `سطر قبل الحفظ ${Date.now().toString(36)}`;
  const NEW = `سطر بعد الحفظ ${Date.now().toString(36)}`;
  const editor = await newLoggedIn(browser, "admin", `/admin/events/${EV.A2}`);
  await expect(editor.getByTestId("event-form")).toBeVisible();
  // This save expires the cached project: the next visitor request has to read it again. Nobody requests it yet.
  await saveHighlight(editor, OLD);
  expect(highlight()).toBe(OLD);
  await editor.reload();
  await expect(editor.getByTestId("event-form").locator('input[name="highlight"]')).toHaveValue(OLD);

  // The cached project read makes two queries, the event row and then its photos: hold it between the two.
  const lock = await lockTable("media_assets");
  let stale = { status: 0, html: "" };
  try {
    const inFlight = body(request, PROJECT); // reads the event row (OLD), then waits for its photos
    await expect.poll(lock.waiting, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0);
    await saveHighlight(editor, NEW, false); // the admin page's own re-render may wait on the lock: watch the database
    await expect.poll(highlight, { timeout: 20_000, intervals: [200] }).toBe(NEW);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(lock.waiting()).toBeGreaterThan(0); // the visitor's render is still in flight
    await lock.release();
    stale = await inFlight;
  } finally {
    await lock.release();
  }
  expect(stale.status).toBe(200);
  expect(stale.html).toContain(OLD); // that one response was rendered from the row it read before the save
  expect(stale.html).not.toContain(NEW);

  await expect.poll(async () => (await body(request, PROJECT)).html.includes(NEW), { timeout: 20_000, intervals: [1_000] }).toBe(true);
  await new Promise((r) => setTimeout(r, 3_000));
  const final = await body(request, PROJECT);
  expect(final.html).toContain(NEW);
  expect(final.html).not.toContain(OLD);
  await editor.context().close();
});
