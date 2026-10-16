import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * Admin e2e. Run against a dev server on a fresh local DB:
 *   npx supabase db reset && npm run seed:storage && npx next dev -p 3300
 *   BASE_URL=http://localhost:3300 npx playwright test tests/e2e/admin.spec.ts
 * Uses the dev users from supabase/seed.sql (local stack only).
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3300";
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots");

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = path.resolve(__dirname, "../../.env.local");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}
const E = env();
// Test-only verification client (local stack): reads rows to assert DB effects.
const db = createClient(E.NEXT_PUBLIC_SUPABASE_URL, E.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const USERS = {
  owner: ["owner@dev.local", "DevOwner!2026"],
  admin: ["admin@dev.local", "DevAdmin!2026"],
  staff: ["staff@dev.local", "DevStaff!2026"],
} as const;
const EVENT_B1 = "00000000-0000-4000-8000-0000000000e3"; // [DEV] Customer B engagement, consent none

async function login(browser: Browser, who: keyof typeof USERS, width = 1440): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 1000 : 844 }, locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=/admin`);
  await page.locator("#email").fill(USERS[who][0]);
  await page.locator("#password").fill(USERS[who][1]);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
  return page;
}

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

test("admin logs in and lands on the overview", async ({ browser }) => {
  const page = await login(browser, "admin");
  await expect(page.getByRole("heading", { name: "نظرة عامة" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("navigation", { name: "أقسام لوحة الإدارة" })).toBeVisible();
  // admin sees finance (read) but not users/backups (owner only)
  await expect(page.getByRole("link", { name: "المالية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "المستخدمون والصلاحيات" })).toHaveCount(0);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "admin-overview-1440.png"), fullPage: true });
  await page.context().close();

  const mobile = await login(browser, "admin", 390);
  await expect(mobile.getByRole("heading", { name: "نظرة عامة" })).toBeVisible({ timeout: 60_000 });
  await mobile.screenshot({ path: path.join(SHOTS, "admin-overview-390.png"), fullPage: true });
  await mobile.getByRole("button", { name: "القائمة" }).click();
  await mobile.screenshot({ path: path.join(SHOTS, "admin-nav-390.png"), fullPage: true });
  await mobile.context().close();
});

test("staff cannot open finance or users, even by direct URL", async ({ browser }) => {
  const page = await login(browser, "staff");
  await expect(page.getByRole("link", { name: "المالية" })).toHaveCount(0);
  for (const url of ["/admin/finance", "/admin/users", "/admin/backups", "/admin/customers"]) {
    await page.goto(`${BASE}${url}`);
    await expect(page.getByTestId("forbidden")).toBeVisible({ timeout: 60_000 });
  }
  await page.screenshot({ path: path.join(SHOTS, "admin-staff-forbidden-1440.png") });
  await page.context().close();
});

test("owner records a payment twice with the same idempotency key -> one row", async ({ browser }) => {
  const page = await login(browser, "owner");
  await page.goto(`${BASE}/admin/finance`);
  const form = page.getByTestId("payment-form");
  await expect(form).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("idem-key")).not.toHaveValue("");
  const key = await page.getByTestId("idem-key").inputValue();

  const fill = async () => {
    await form.locator('select[name="customer_id"]').selectOption({ label: "[DEV] Customer B" });
    await form.locator('input[name="amount"]').fill("1,250.50");
    await form.locator('input[name="reference"]').fill("E2E-IDEMPOTENCY");
  };
  await fill();
  await form.getByRole("button", { name: "تسجيل" }).click();
  await expect(form.getByTestId("action-msg")).toHaveText("سُجّلت الدفعة.", { timeout: 60_000 });

  // Resubmit the SAME key (simulates a retry / double submit).
  await fill();
  await page.getByTestId("idem-key").evaluate((el, k) => ((el as HTMLInputElement).value = k), key);
  await form.getByRole("button", { name: "تسجيل" }).click();
  await expect(form.getByTestId("action-msg")).toContainText("مسجّلة مسبقاً", { timeout: 60_000 });

  const { data, error } = await db.from("payments").select("id, amount").eq("idempotency_key", key);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data?.[0].amount).toBe(125050); // "1,250.50" shekels -> 125050 agorot, no float error
  await page.screenshot({ path: path.join(SHOTS, "admin-finance-1440.png"), fullPage: true });
  await page.context().close();
});

test("publish is blocked without consent, then succeeds after consent", async ({ browser }) => {
  const page = await login(browser, "admin");
  await page.goto(`${BASE}/admin/events/${EVENT_B1}`);
  const eventForm = page.getByTestId("event-form");
  await expect(eventForm).toBeVisible({ timeout: 60_000 });
  // slug is required to publish (field lives in a collapsed section)
  await eventForm.getByText("صفحة العمل العامة والظهور في البحث").click();
  await page.getByTestId("public-slug").fill("dev-e2e-engagement");
  await eventForm.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(eventForm.getByTestId("action-msg")).toHaveText("حُفظت المناسبة.", { timeout: 60_000 });

  await expect(page.getByTestId("publish-blocked")).toBeVisible();
  const publishBtn = page.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" });
  await expect(publishBtn).toBeDisabled();
  await page.screenshot({ path: path.join(SHOTS, "admin-event-publish-blocked-1440.png"), fullPage: true });

  // Forcing the disabled button: the server action + RPC still refuse.
  await publishBtn.evaluate((b) => (b as HTMLButtonElement).removeAttribute("disabled"));
  await publishBtn.click();
  await expect(page.getByTestId("publish-form").getByTestId("action-msg")).toHaveText("لا يمكن النشر بدون موافقة العميل الممنوحة.", { timeout: 60_000 });
  expect((await db.from("events").select("is_published").eq("id", EVENT_B1).single()).data?.is_published).toBe(false);

  const consent = page.getByTestId("consent-form");
  await consent.getByTestId("consent-select").selectOption("granted");
  await consent.getByRole("button", { name: "تحديث الموافقة" }).click();
  await expect(consent.getByTestId("action-msg")).toContainText("حُدّثت حالة الموافقة", { timeout: 60_000 });

  await expect(page.getByTestId("publish-blocked")).toHaveCount(0, { timeout: 30_000 });
  await expect(publishBtn).toBeEnabled();
  await publishBtn.click();
  await expect(page.getByTestId("publish-form").getByTestId("action-msg")).toHaveText("نُشرت المناسبة في صفحة الأعمال.", { timeout: 60_000 });
  const { data } = await db.from("events").select("is_published, publication_consent").eq("id", EVENT_B1).single();
  expect(data).toEqual({ is_published: true, publication_consent: "granted" });
  await page.context().close();
});

test("invalid booking transition is not offered and is rejected when forced", async ({ browser }) => {
  const { data: booking } = await db.from("booking_requests").select("id, status").eq("idempotency_key", "dev-seed-booking-0001").single();
  expect(booking?.status).toBe("new");
  const page = await login(browser, "admin");
  await page.goto(`${BASE}/admin/bookings/${booking!.id}`);
  const form = page.getByTestId("transition-form");
  await expect(form).toBeVisible({ timeout: 60_000 });
  const offered = await page.getByTestId("transition-to").locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(offered.sort()).toEqual(["cancelled", "contacted", "declined"]);
  expect(offered).not.toContain("confirmed");

  // Force new -> confirmed by tampering with the form.
  await page.getByTestId("transition-to").evaluate((sel) => {
    const o = document.createElement("option");
    o.value = "confirmed";
    o.textContent = "forced";
    sel.appendChild(o);
    (sel as HTMLSelectElement).value = "confirmed";
  });
  await form.getByRole("button", { name: "نقل الطلب" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "0", { timeout: 60_000 });
  await expect(form.getByTestId("action-msg")).toContainText("لا يمكن نقل الطلب");
  const { data: after } = await db.from("booking_requests").select("status").eq("id", booking!.id).single();
  expect(after?.status).toBe("new");
  await page.screenshot({ path: path.join(SHOTS, "admin-booking-1440.png"), fullPage: true });
  await page.context().close();
});

test("media upload of 2 images creates thumb + display variants", async ({ browser }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-e2e-"));
  const files = [];
  for (const [i, color] of [[1, "#e9b949"], [2, "#3f7a4f"]] as const) {
    const p = path.join(dir, `e2e-${i}.png`);
    await sharp({ create: { width: 2400, height: 1600, channels: 3, background: color } }).png().toFile(p);
    files.push(p);
  }
  const page = await login(browser, "admin");
  await page.goto(`${BASE}/admin/events/${EVENT_B1}/media`);
  await expect(page.getByTestId("uploader")).toBeVisible({ timeout: 60_000 });
  const startedAt = new Date().toISOString();
  await page.getByTestId("upload-input").setInputFiles(files);
  await page.getByTestId("upload-start").click();
  await expect(page.getByTestId("upload-summary")).toHaveText("اكتمل 2 من 2.", { timeout: 120_000 });
  await expect(page.locator('[data-testid="upload-row"][data-state="done"]')).toHaveCount(2);

  const { data } = await db
    .from("media_assets")
    .select("id, path, width, height, variants, upload_status")
    .eq("event_id", EVENT_B1)
    .gte("created_at", startedAt);
  expect(data).toHaveLength(2);
  for (const a of data ?? []) {
    expect(a.upload_status).toBe("ready");
    expect(a.path).toBe(`events/${EVENT_B1}/${a.id}/original.png`);
    expect(a.width).toBe(2400);
    const v = a.variants as { thumb: string; display: string };
    expect(v.thumb).toMatch(/thumb\.webp$/);
    expect(v.display).toMatch(/display\.webp$/);
    const thumb = await db.storage.from("private-media").download(v.thumb);
    const meta = await sharp(Buffer.from(await thumb.data!.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(480);
    const display = await db.storage.from("private-media").download(v.display);
    expect((await sharp(Buffer.from(await display.data!.arrayBuffer())).metadata()).width).toBe(1600);
  }
  await page.reload();
  await expect(page.locator('[data-testid="media-item"][data-variants="1"]').first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(SHOTS, "admin-media-1440.png"), fullPage: true });

  // Publishing one image copies it to public-media (event was published in the previous test).
  await page.locator('[data-testid="media-item"]').first().getByRole("button", { name: "نشر في الأعمال" }).click();
  await expect(page.locator('[data-testid="media-item"]').first().getByTestId("action-msg")).toHaveText("نُشرت الصورة.", { timeout: 60_000 });
  const pub = await db.from("media_assets").select("id, path").eq("event_id", EVENT_B1).eq("bucket", "public-media");
  expect(pub.data).toHaveLength(1);
  const pubObj = await db.storage.from("public-media").exists(pub.data![0].path);
  expect(pubObj.data).toBe(true);
  // Served same-origin through the consent-checking /m route (public-media is a private bucket).
  const mUrl = `${BASE}/m/${pub.data![0].id}/display`;
  expect((await page.request.get(mUrl)).status()).toBe(200);
  await page.context().close();

  // Consent revoke removes the public copy (row + storage object).
  const admin = await login(browser, "admin");
  await admin.goto(`${BASE}/admin/events/${EVENT_B1}`);
  const consent = admin.getByTestId("consent-form");
  await consent.getByTestId("consent-select").selectOption("revoked");
  await consent.getByRole("button", { name: "تحديث الموافقة" }).click();
  await expect(consent.getByTestId("action-msg")).toContainText("حُدّثت حالة الموافقة", { timeout: 60_000 });
  // Not served any more, immediately (same transaction as the revoke).
  const gone = await admin.request.get(mUrl);
  expect(gone.status()).toBe(404);
  expect(gone.headers()["cache-control"]).toBe("no-store");
  // Objects removed by whichever worker claimed the queue first (in-app runner or the
  // storage-cleanup Edge Function kicked by the DB): display + thumb objects removed.
  await expect
    .poll(async () => (await db.storage.from("public-media").exists(pub.data![0].path)).data, { timeout: 60_000 })
    .toBe(false);
  const left = await db.from("media_assets").select("id").eq("event_id", EVENT_B1).eq("bucket", "public-media");
  expect(left.data).toHaveLength(0);
  await admin.context().close();
});

test("owner backup run completes with counts", async ({ browser }) => {
  const page = await login(browser, "owner");
  await page.goto(`${BASE}/admin/backups`);
  const form = page.getByTestId("backup-form");
  await expect(form).toBeVisible({ timeout: 60_000 });
  await form.getByRole("button", { name: "بدء النسخ الآن" }).click();
  await expect(form.getByTestId("action-msg")).toContainText("اكتملت النسخة", { timeout: 180_000 });
  const { data } = await db.from("backup_runs").select("id, status, table_counts, object_counts, errors, location").order("started_at", { ascending: false }).limit(1).single();
  expect(data?.status).toBe("completed");
  const counts = data?.table_counts as Record<string, number>;
  expect(Object.keys(counts).length).toBe(33);
  expect(counts.media_assets).toBeGreaterThanOrEqual(202);
  expect(counts.events).toBe(4);
  expect((data?.object_counts as Record<string, number>)["private-media"]).toBeGreaterThanOrEqual(6);
  expect(data?.location).toBe(`backups/${data!.id}/`);
  const files = await db.storage.from("backups").list(`${data!.id}/tables`, { limit: 100 });
  expect(files.data?.length).toBe(33);
  await page.screenshot({ path: path.join(SHOTS, "admin-backups-1440.png"), fullPage: true });
  await page.context().close();
});

test("seeded media renders thumbnails (objects from seed:storage)", async ({ browser }) => {
  const page = await login(browser, "admin");
  await page.goto(`${BASE}/admin/events/00000000-0000-4000-8000-0000000000e2/media`);
  const img = page.locator('[data-testid="media-item"] img').first();
  await expect(img).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.context().close();
});

test("section screenshots at 1440 and 390", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const page = await login(browser, "owner", width);
    for (const [name, url] of [
      ["events", `/admin/events/${EVENT_B1}`],
      ["calendar", "/admin/calendar"],
      ["customers", "/admin/customers"],
      ["production", "/admin/production"],
      ["users", "/admin/users"],
    ] as const) {
      await page.goto(`${BASE}${url}`);
      await expect(page.locator("main h1").first()).toBeVisible({ timeout: 60_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} horizontal overflow at ${width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(SHOTS, `admin-${name}-${width}.png`), fullPage: true });
    }
    await page.context().close();
  }
});
