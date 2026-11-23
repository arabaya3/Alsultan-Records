import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, db, lockTable, newLoggedIn, refreshAlbumsCache } from "./qa-helpers";

/**
 * Editing a PUBLISHED event in the admin updates its public page at once (updateEvent expires the "projects"
 * cache tag; before the fix the public page kept the old title for the cache lifetime). Restores the title.
 *   BASE_URL=http://localhost:3600 npx playwright test admin-public-cache
 */
const EVENT = "00000000-0000-4000-8000-0000000000e2";
const SLUG = "dev-sample-published-project";

test("PC1: admin edit of a published event is visible on its public page immediately", async ({ browser }) => {
  const original = (await db.from("events").select("title").eq("id", EVENT).single()).data!.title as string;
  const edited = `${original} (تعديل ${Date.now().toString(36)})`;
  const page = await newLoggedIn(browser, "admin", `/admin/events/${EVENT}`);
  try {
    // Warm the public cache with the original title first.
    const pub = await page.context().newPage();
    await pub.goto(`${BASE}/work/${SLUG}`);
    await expect(pub.getByRole("heading", { level: 1 })).toContainText(original);

    const form = page.getByTestId("event-form");
    await form.locator('input[name="title"]').fill(edited);
    await form.getByRole("button", { name: "حفظ التغييرات" }).click();
    await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");

    await pub.reload();
    await expect(pub.getByRole("heading", { level: 1 })).toContainText(edited);
  } finally {
    await db.from("events").update({ title: original }).eq("id", EVENT);
    await page.context().close();
  }
});

/**
 * The same rule when a page REBUILD is already in flight (the HO3 flake: the package form's own «عرض في الموقع» link
 * prefetches /packages, so a rebuild can be running at the moment of the save). /packages and the home page are
 * statically cached: a rebuild that read the old row before the save and finishes after it was stored as fresh, and
 * the page stayed stale until the timed refresh. Staged with a database lock (lockTable) on a table the page reads
 * but the save never writes. ISOLATED STACK ONLY.
 */
/** The setup saves below expire a read through the admin, and an admin save repeats its expiry about 5 s later. Wait
 *  that out, so the only thing left that can replace the stale page is the save under test. */
const SETUP_SETTLE_MS = 6_500;
const html = async (request: APIRequestContext, path: string) => (await request.get(`${BASE}${path}`)).text();

test("PC2: a package saved while /packages is being rebuilt is on the page within seconds, not after the timed refresh", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const pkg = (await db.from("packages").select("id, slug, description").eq("status", "published").order("sort_order").limit(1).single()).data!;
  const stamp = Date.now().toString(36);
  const OLD = `وصف قبل الحفظ ${stamp}`;
  const NEW = `وصف بعد الحفظ ${stamp}`;
  const album = (await db.from("photo_albums").select("id").eq("is_published", true).is("deleted_at", null).limit(1).single()).data!;
  const admin = await newLoggedIn(browser, "owner", `/admin/content/packages/${pkg.id}`);
  const form = admin.getByTestId("package-form");
  const save = async (text: string, wait = true) => {
    await form.locator('textarea[name="description"]').fill(text);
    await form.getByRole("button", { name: "حفظ (منشور)" }).click();
    if (wait) await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  };
  const stored = async () => (await db.from("packages").select("description").eq("id", pkg.id).single()).data!.description;
  try {
    await save(OLD);
    expect(await html(request, "/packages")).toContain(OLD); // cached with the old text
    await admin.reload();
    await expect(form).toBeVisible();

    // The page hero reads the published albums: expire that read, then hold it. The package save never touches albums.
    await refreshAlbumsCache(browser, album.id);
    await new Promise((r) => setTimeout(r, SETUP_SETTLE_MS));
    const lock = await lockTable("photo_albums");
    let inFlight = "";
    try {
      const rebuild = html(request, "/packages"); // reads the packages (OLD), then waits for the albums
      await expect.poll(lock.waiting, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 700)); // the packages read is not behind the lock: let it finish
      await save(NEW, false);
      await expect.poll(stored, { timeout: 20_000, intervals: [200] }).toBe(NEW);
      await new Promise((r) => setTimeout(r, 1_000)); // the action expires the cache right after its last write
      expect(lock.waiting()).toBeGreaterThan(0); // the rebuild is still in flight
      await lock.release();
      inFlight = await rebuild;
    } finally {
      await lock.release();
    }
    // The scenario really happened: the rebuild that was in flight carries the text it read before the save.
    expect(inFlight).toContain(OLD);
    expect(inFlight).not.toContain(NEW);

    // What that rebuild stored must not stay.
    await expect.poll(async () => (await html(request, "/packages")).includes(NEW), { timeout: 20_000, intervals: [1_000] }).toBe(true);
    await new Promise((r) => setTimeout(r, 3_000));
    const final = await html(request, "/packages");
    expect(final).toContain(NEW);
    expect(final).not.toContain(OLD);
  } finally {
    // back to the package's own text, through the same form (so the public page follows)
    await admin.goto(`${BASE}/admin/content/packages/${pkg.id}`);
    await expect(form).toBeVisible();
    await save(pkg.description ?? "");
    expect(await stored()).toBe((pkg.description ?? "").trim() || null);
    await admin.context().close();
  }
});

test("PC3: a video title saved while the home page is being rebuilt is on the home page within seconds", async ({ browser, request }) => {
  test.setTimeout(180_000);
  // The first work shown on the home page.
  const first = (await html(request, "/")).match(/data-home-work="([\w-]{11})"/)?.[1];
  expect(first, "the home page shows at least one video work").toBeTruthy();
  const video = (await db.from("showcase_videos").select("id, title").eq("youtube_id", first!).single()).data!;
  const stamp = Date.now().toString(36);
  // Only the added words are searched for: the page shows titles with their separators tidied.
  const OLD = `قبل ${stamp}`;
  const NEW = `بعد ${stamp}`;
  const titled = (mark: string) => `${video.title} ${mark}`.slice(0, 200);
  const admin = await newLoggedIn(browser, "owner", `/admin/videos/${video.id}`);
  const form = admin.getByTestId("video-edit");
  const save = async (text: string, wait = true) => {
    await form.locator('input[name="title"]').fill(text);
    await form.getByRole("button", { name: "حفظ", exact: true }).click();
    if (wait) await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  };
  const stored = async () => (await db.from("showcase_videos").select("title").eq("id", video.id).single()).data!.title;
  try {
    await save(titled(OLD));
    expect(await html(request, "/")).toContain(OLD);
    await admin.reload();
    await expect(form).toBeVisible();

    // The home page also reads the active offers: expire that read (an unchanged save of the offers heading), then
    // hold it. Saving a video never touches offers.
    const owner = await newLoggedIn(browser, "owner", "/admin/content/offers");
    const heading = owner.getByTestId("section-intro-offers");
    await heading.getByRole("button", { name: "حفظ" }).click();
    await expect(heading.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
    await owner.context().close();
    await new Promise((r) => setTimeout(r, SETUP_SETTLE_MS));

    const lock = await lockTable("offers");
    let inFlight = "";
    try {
      const rebuild = html(request, "/");
      await expect.poll(lock.waiting, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 700));
      await save(titled(NEW), false);
      await expect.poll(stored, { timeout: 20_000, intervals: [200] }).toBe(titled(NEW));
      await new Promise((r) => setTimeout(r, 1_000));
      expect(lock.waiting()).toBeGreaterThan(0);
      await lock.release();
      inFlight = await rebuild;
    } finally {
      await lock.release();
    }
    expect(inFlight).toContain(OLD);
    expect(inFlight).not.toContain(NEW);

    await expect.poll(async () => (await html(request, "/")).includes(NEW), { timeout: 20_000, intervals: [1_000] }).toBe(true);
    await new Promise((r) => setTimeout(r, 3_000));
    const final = await html(request, "/");
    expect(final).toContain(NEW);
    expect(final).not.toContain(OLD);
  } finally {
    await admin.goto(`${BASE}/admin/videos/${video.id}`);
    await expect(form).toBeVisible();
    await save(video.title);
    expect(await stored()).toBe(video.title);
    await admin.context().close();
  }
});
