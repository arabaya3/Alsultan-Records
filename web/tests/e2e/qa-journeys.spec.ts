import { expect, test, type Page } from "@playwright/test";
import { BASE, db, E, psql, watchErrors } from "./qa-helpers";

/**
 * Public journeys against the PRODUCTION build (`next start -p 3400`) on a fresh local DB.
 * Booking/track hit the real server actions -> service-role RPCs -> local Postgres.
 */
test.describe.configure({ mode: "serial" });

const SITE = E.NEXT_PUBLIC_SITE_URL;
const PUBLIC = ["/", "/work", "/services", "/about", "/contact", "/book", "/track", "/faq", "/privacy", "/terms", "/work/dev-sample-published-project"];
const PHONE = "0591234567";
let trackingCode = "";

function futureDate(days = 40) {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function fillStep1(page: Page, name: string, phone: string) {
  await page.locator("#contact_name").fill(name);
  await page.locator("#contact_phone").fill(phone);
  await page.locator("#event_type").selectOption({ index: 1 });
  await page.locator("#event_date").fill(futureDate());
}

test.beforeAll(() => {
  psql("delete from private.rate_limits;");
});

test("P1-P6: all public pages return 200, Arabic RTL, no console errors", async ({ page }) => {
  const w = watchErrors(page);
  for (const p of PUBLIC) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    expect(res!.status(), p).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("h1").first(), p).toBeVisible();
  }
  expect(w.errors).toEqual([]);
  test.info().annotations.push({ type: "known-local-artifacts", description: String(w.known.length) });
});

test("P3/P6: unknown slugs render the not-found page (status documented)", async ({ page }) => {
  const r1 = await page.goto(`${BASE}/totally-unknown-page`);
  expect(r1!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /الصفحة مش موجودة/ })).toBeVisible();
  for (const p of ["/work/no-such-project", "/services/no-such-service"]) {
    const r = await page.goto(`${BASE}${p}`);
    // Not-found UI + noindex must render. HTTP status is recorded (streamed PPR routes return 200).
    test.info().annotations.push({ type: `status ${p}`, description: String(r!.status()) });
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await expect(page.getByRole("heading", { name: /مش موجودة/ })).toBeVisible();
  }
});

// SKIPPED: Public booking form and tracking are not rendered in the approved WhatsApp-only scope (code kept, booking RPCs covered by pgTAP; form path covered by turnstile.spec in TURNSTILE_TEST_MODE).
test.skip("P4: booking inquiry end-to-end; double-click submit creates exactly ONE row", async ({ page }) => {
  const name = `[QA] Booking ${Date.now()}`;
  await page.goto(`${BASE}/book`);
  await expect(page.getByText("وليس حجزاً مؤكداً").first()).toBeVisible();
  await fillStep1(page, name, PHONE);
  await page.getByRole("button", { name: "التالي" }).click();
  await page.locator("#city").fill("[QA] Ramallah");
  await page.locator("#message").fill("[QA] message");
  // Two synchronous clicks in the same task (faster than any human double-click) + a real dblclick.
  const submit = page.getByRole("button", { name: "أرسل الطلب" });
  await submit.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  const status = page.getByRole("status").filter({ hasText: "رمز المتابعة" });
  await expect(status).toContainText("وصلنا طلبك", { timeout: 30_000 });
  await expect(status).toContainText("ليس حجزاً مؤكداً");
  trackingCode = (await page.locator("p[dir=ltr].select-all").innerText()).trim();
  expect(trackingCode).toMatch(/^[A-Z0-9]{8,12}$/);
  await page.waitForTimeout(1500); // let any duplicate request land
  const { data } = await db.from("booking_requests").select("id, tracking_code, city, message").eq("contact_name", name);
  expect(data).toHaveLength(1);
  expect(data![0].tracking_code).toBe(trackingCode);
  expect(data![0].city).toBe("[QA] Ramallah");
});

test.skip("P4: server error keeps every input (rate-limit forced for this phone)", async ({ page }) => {
  const phone = "0597654321";
  // Pre-load the per-phone daily bucket (5/day) so the next submit is rejected server-side.
  psql(`insert into private.rate_limits (bucket, key, window_start, hits)
        values ('booking_phone', '${phone}', to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 5)
        on conflict (bucket, key, window_start) do update set hits = 5;`);
  const name = `[QA] Error ${Date.now()}`;
  await page.goto(`${BASE}/book`);
  await fillStep1(page, name, phone);
  await page.getByRole("button", { name: "التالي" }).click();
  await page.locator("#city").fill("[QA] Nablus");
  await page.locator("#venue").fill("[QA] Hall");
  await page.locator("#message").fill("[QA] keep me");
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#city")).toHaveValue("[QA] Nablus");
  await expect(page.locator("#venue")).toHaveValue("[QA] Hall");
  await expect(page.locator("#message")).toHaveValue("[QA] keep me");
  await expect(page.locator("#contact_name")).toHaveValue(name);
  await expect(page.locator("#contact_phone")).toHaveValue(phone);
  const { data } = await db.from("booking_requests").select("id").eq("contact_name", name);
  expect(data).toHaveLength(0);
  psql(`delete from private.rate_limits where bucket = 'booking_phone' and key = '${phone}';`);
});

test.skip("P5: tracking with right last4 shows status; wrong last4 is generic not-found", async ({ page }) => {
  expect(trackingCode).not.toBe("");
  await page.goto(`${BASE}/track`);
  await page.locator("#code").fill(trackingCode);
  await page.locator("#last4").fill(PHONE.slice(-4));
  await page.getByRole("button", { name: "اعرض الحالة" }).click();
  await expect(page.getByText("وصلنا طلبك").first()).toBeVisible({ timeout: 20_000 });
  const okText = await page.locator("[aria-live=polite]").last().innerText();
  // must not leak name/phone/city
  expect(okText).not.toContain("[QA]");
  expect(okText).not.toContain(PHONE);

  await page.reload();
  await page.locator("#code").fill(trackingCode);
  await page.locator("#last4").fill("0000");
  await page.getByRole("button", { name: "اعرض الحالة" }).click();
  await page.waitForTimeout(2000);
  const wrong = await page.locator("[aria-live=polite]").last().innerText();
  expect(wrong).not.toContain("وصلنا طلبك");
  expect(wrong.trim().length).toBeGreaterThan(0);
  test.info().annotations.push({ type: "wrong-last4 message", description: wrong.trim() });
});

test("P2: published-project page shows only the consented seeded project", async ({ page }) => {
  await page.goto(`${BASE}/work`, { waitUntil: "networkidle" });
  const body = await page.locator("main").innerText();
  expect(body).toContain("[DEV] Sample published project");
  for (const priv of ["Customer A wedding", "Customer B engagement", "Customer B graduation"]) expect(body).not.toContain(priv);
  const links = await page.locator('main a[href^="/work/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  expect(links).toEqual(["/work/dev-sample-published-project"]);
  const r = await page.goto(`${BASE}/work/dev-sample-published-project`);
  expect(r!.status()).toBe(200);
  // Unpublished event slugs are not reachable even if guessed (none have slugs; use the ids)
  const html = await page.content();
  for (const leak of ["customer_id", "0500000011", "customer.a@dev.local", "production_note", "Customer A"]) expect(html).not.toContain(leak);
});

test("P7: sitemap, robots, canonical from NEXT_PUBLIC_SITE_URL, no private data in metadata", async ({ page, request }) => {
  const robots = await (await request.get(`${BASE}/robots.txt`)).text();
  for (const d of ["/admin", "/portal"]) expect(robots).toContain(`Disallow: ${d}`);
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  const sm = await (await request.get(`${BASE}/sitemap.xml`)).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length).toBeGreaterThan(5);
  for (const l of locs) {
    expect(l.startsWith(SITE)).toBe(true);
    expect(l).not.toMatch(/\/(admin|portal|login|auth|track)/);
  }
  expect(locs).toContain(`${SITE}/work/dev-sample-published-project`);
  for (const p of ["/", "/work", "/book", "/work/dev-sample-published-project"]) {
    await page.goto(`${BASE}${p}`);
    const canon = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(p === "/" ? [SITE, `${SITE}/`] : [`${SITE}${p}`], p).toContain(canon);
    const meta = await page.locator("head").innerHTML();
    for (const leak of ["@dev.local", "0500000", "sb_secret", "Customer B", "customer_id"]) expect(meta, `${p} head`).not.toContain(leak);
  }
});
