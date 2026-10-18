import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { resetSeedSelections } from "./qa-helpers";

/**
 * Client portal e2e. LOCAL STACK ONLY (seeded dev users).
 *   npx supabase db reset
 *   npx next dev -p 3200
 *   BASE_URL=http://localhost:3200 npx playwright test tests/e2e/portal.spec.ts
 *
 * beforeAll adds local-only fixtures with the service-role key from .env.local:
 *  - uploads a real image as thumb/display objects for customer A's seeded photos (so tiles render),
 *  - 5 images on customer A's second event (the seed has none there),
 *  - one private document on customer B's event (for the cross-customer signed URL check).
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots");
const A1 = "00000000-0000-4000-8000-0000000000e1";
const A2 = "00000000-0000-4000-8000-0000000000e2";
const B1 = "00000000-0000-4000-8000-0000000000e3";
const A = { email: "customer.a@dev.local", password: "DevCustA!2026" };

function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const file = fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
  const m = file.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim();
}
const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const admin = createClient(URL_, env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const IMG = fs.readFileSync(path.resolve(__dirname, "../../../assets/cover.webp"));
const B_DOC_PATH = `events/${B1}/11111111-1111-4111-8111-111111111111/contract.pdf`;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<unknown>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let t = q.shift(); t !== undefined; t = q.shift()) await fn(t);
  }));
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async () => {
  test.setTimeout(300_000);
  const bucket = admin.storage.from("private-media");
  // A2 images (idempotent)
  const { count } = await admin.from("media_assets").select("id", { count: "exact", head: true }).eq("event_id", A2).eq("kind", "image");
  if (!count) {
    const rows = Array.from({ length: 5 }, (_, i) => {
      const id = crypto.randomUUID();
      return {
        id, event_id: A2, bucket: "private-media", path: `events/${A2}/${id}/display.jpg`, kind: "image", mime: "image/jpeg",
        width: 1600, height: 1067, visibility: "private", sort_order: i + 1, upload_status: "ready",
        variants: { thumb: `events/${A2}/${id}/thumb.webp`, display: `events/${A2}/${id}/display.jpg` },
      };
    });
    const { error } = await admin.from("media_assets").insert(rows);
    if (error) throw error;
  }
  const { data: imgs } = await admin.from("media_assets").select("variants").in("event_id", [A1, A2]).eq("kind", "image");
  const paths = (imgs ?? []).flatMap((r) => {
    const v = r.variants as { thumb?: string; display?: string };
    return [v.thumb, v.display].filter((p): p is string => Boolean(p));
  });
  await pool(paths, 24, (p) => bucket.upload(p, IMG, { contentType: "image/webp", upsert: true }));
  // B's private document
  await bucket.upload(B_DOC_PATH, Buffer.from("%PDF-1.4\n% dev fixture\n"), { contentType: "application/pdf", upsert: true });
  await admin.from("media_assets").upsert(
    { id: "11111111-1111-4111-8111-111111111111", event_id: B1, bucket: "private-media", path: B_DOC_PATH, kind: "document", mime: "application/pdf", visibility: "private", upload_status: "ready" },
    { onConflict: "id" },
  );
});

async function login(page: Page, next = "") {
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("البريد الإلكتروني").fill(A.email);
  await page.getByLabel("كلمة المرور").fill(A.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(next ? `**${next}` : "**/portal");
}

async function loadAll(page: Page) {
  for (let i = 0; i < 40; i++) {
    if (await page.getByTestId("gallery-end").isVisible().catch(() => false)) return;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
}

test("customer A sees only own events (desktop + mobile shots)", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
    await login(page);
    const cards = page.getByTestId("event-card");
    await expect(cards).toHaveCount(2);
    await expect(page.getByText("[DEV] Customer A wedding")).toBeVisible();
    await expect(page.getByText("Customer B")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, `portal-home-${width}.png`), fullPage: true });
    await page.close();
  }
});

test("gallery loads all 200 images with pagination; lightbox keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, `/portal/events/${A1}/gallery`);
  await expect(page.getByTestId("gallery-tile").first()).toBeVisible();
  await expect(page.getByTestId("gallery-tile")).toHaveCount(48);
  await page.screenshot({ path: path.join(SHOTS, "portal-gallery-1440.png") });
  await loadAll(page);
  await expect(page.getByTestId("gallery-tile")).toHaveCount(200);
  // tiles use the thumb variant, never the original
  const src = await page.locator('[data-testid="gallery-tile"] img').first().getAttribute("src");
  expect(src).toContain("thumb.webp");
  // lightbox: open, RTL arrow, Esc returns focus
  const opener = page.getByRole("button", { name: "عرض الصورة 1", exact: true });
  await opener.click();
  const lb = page.getByTestId("lightbox");
  await expect(lb).toBeVisible();
  await expect(lb.getByText("1 من 200")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(lb.getByText("2 من 200")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lb).toHaveCount(0);
  await expect(opener).toBeFocused();
});

async function pick(page: Page, eventId: string, n: number) {
  await page.goto(`${BASE}/portal/events/${eventId}/selection`);
  const toggles = page.getByTestId("select-toggle");
  await expect(toggles.first()).toBeVisible();
  for (let i = 0; i < n; i++) {
    await toggles.nth(i).click();
    await expect(page.getByTestId("selection-count")).toHaveText(String(i + 1));
  }
  await expect(page.locator("[data-save-state=saving]")).toHaveCount(0);
}

test("selection counts per event, submit creates snapshot and locks", async ({ page }) => {
  resetSeedSelections([A1, A2]); // qa-portal C4 locks the same seeded selections
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await pick(page, A1, 3);
  await pick(page, A2, 2);
  await page.goto(`${BASE}/portal/events/${A1}/selection`);
  await expect(page.getByTestId("selection-count")).toHaveText("3");
  await page.goto(`${BASE}/portal/events/${A2}/selection`);
  await expect(page.getByTestId("selection-count")).toHaveText("2");

  await page.goto(`${BASE}/portal/events/${A1}/selection`);
  await page.getByRole("checkbox", { name: "المختارة فقط" }).check();
  await expect(page.getByTestId("gallery-tile")).toHaveCount(3);
  await page.screenshot({ path: path.join(SHOTS, "portal-selection-1440.png") });
  await page.getByRole("button", { name: "مراجعة وإرسال" }).click();
  await expect(page.getByTestId("gallery-tile")).toHaveCount(3);
  await page.getByRole("button", { name: "إرسال الاختيار" }).click();
  await page.getByRole("button", { name: "تأكيد الإرسال" }).click();
  await expect(page.getByTestId("snapshot-status")).toBeVisible();
  await expect(page.getByTestId("snapshot-status")).toContainText("3 صورة");
  const { data: snaps } = await admin.from("album_selection_snapshots").select("item_count").eq("event_id", A1);
  expect(snaps?.[0]?.item_count).toBe(3);
  await page.reload();
  await expect(page.getByTestId("select-toggle").first()).toBeDisabled();
});

test("video comment saved on revision 2 with timecode", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, `/portal/events/${A1}/videos`);
  await page.getByTestId("video-deliverable").first().click();
  await expect(page.getByRole("button", { name: /النسخة 2/ })).toHaveAttribute("aria-pressed", "true");
  const body = `ملاحظة اختبار ${Date.now()}`;
  await page.getByLabel("أضف ملاحظة عند اللحظة الحالية من الفيديو").fill(body);
  await page.getByRole("button", { name: "حفظ الملاحظة" }).click();
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByTestId("timecode-chip").first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "portal-video-1440.png") });
  const { data } = await admin.from("video_comments").select("timecode_ms, deliverable_revisions!inner(revision_no)").eq("body", body);
  expect(data?.length).toBe(1);
  expect((data?.[0] as unknown as { deliverable_revisions: { revision_no: number } }).deliverable_revisions.revision_no).toBe(2);
  expect(data?.[0].timecode_ms).toBeGreaterThanOrEqual(0);
  // revision 1 has its own (seeded) comment list
  await page.getByRole("button", { name: /النسخة 1/ }).click();
  await expect(page.getByText("[DEV] Please trim this part")).toBeVisible();
  await expect(page.getByText(body)).toHaveCount(0);
});

test("mobile screenshots", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, `/portal/events/${A1}/gallery`);
  await expect(page.getByTestId("gallery-tile").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, "portal-gallery-390.png") });
  await page.goto(`${BASE}/portal/events/${A1}/selection`);
  await expect(page.getByTestId("gallery-tile").first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "portal-selection-390.png") });
  await page.goto(`${BASE}/portal/events/${A1}/videos`);
  await page.getByTestId("video-deliverable").first().click();
  await expect(page.getByTestId("timecode-chip").first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "portal-video-390.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.close();
});

test("customer A cannot reach customer B's event or files", async ({ page }) => {
  await login(page);
  for (const sub of ["", "/gallery", "/files"]) {
    await page.goto(`${BASE}/portal/events/${B1}${sub}`);
    await expect(page.getByTestId("portal-not-found").first()).toBeVisible();
    await expect(page.getByText("Customer B")).toHaveCount(0);
  }
  // Direct API attempts with A's own session: RLS hides the row, storage policy refuses to sign.
  const a = createClient(URL_, env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { auth: { persistSession: false } });
  const { error: authErr } = await a.auth.signInWithPassword(A);
  expect(authErr).toBeNull();
  const { data: rows } = await a.from("media_assets").select("id").eq("event_id", B1);
  expect(rows ?? []).toHaveLength(0);
  const { data: signed, error } = await a.storage.from("private-media").createSignedUrl(B_DOC_PATH, 60);
  expect(signed?.signedUrl ?? null).toBeNull();
  expect(error).not.toBeNull();
  // Positive control: A can sign its own thumb.
  const { data: own } = await a.from("media_assets").select("variants").eq("event_id", A1).limit(1).single();
  const ownSigned = await a.storage.from("private-media").createSignedUrl((own!.variants as { thumb: string }).thumb, 60);
  expect(ownSigned.data?.signedUrl).toBeTruthy();
});

test("logout clears session and protects portal", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForURL("**/login?signed_out=1");
  await expect(page.getByText("تم تسجيل خروجك بأمان.")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.startsWith("sb-") && c.value)).toHaveLength(0);
  await page.goto(`${BASE}/portal/events/${A1}/gallery`);
  await page.waitForURL(/\/login\?next=/);
  expect(decodeURIComponent(page.url())).toContain(`/portal/events/${A1}/gallery`);
  // login returns to the requested path
  await page.getByLabel("البريد الإلكتروني").fill(A.email);
  await page.getByLabel("كلمة المرور").fill(A.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(`**/portal/events/${A1}/gallery`);
});

test("login rejects open redirects", async ({ page }) => {
  await login(page, "");
  await page.context().clearCookies();
  await page.goto(`${BASE}/login?next=${encodeURIComponent("//evil.example/x")}`);
  await page.getByLabel("البريد الإلكتروني").fill(A.email);
  await page.getByLabel("كلمة المرور").fill(A.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/portal");
  expect(new URL(page.url()).host).toBe(new URL(BASE).host);
});
