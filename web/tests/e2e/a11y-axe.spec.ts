import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { BASE, db, EV, uiLogin, type Who } from "./qa-helpers";

/**
 * A11y release blocker, part A: axe-core (WCAG 2.0/2.1 A+AA, 2.2 AA) on representative screens.
 * LOCAL STACK + PRODUCTION BUILD ONLY:
 *   npx supabase db reset && npm run seed:storage
 *   npm run build && npx next start -p 3900
 *   BASE_URL=http://localhost:3900 npx playwright test tests/e2e/a11y-axe.spec.ts --project=chromium
 * Asserts zero serious/critical violations. Writes every scan (all impacts) to docs/a11y/axe-results.json.
 * Scans run with prefers-reduced-motion so scroll-reveal fades (opacity mid-animation) cannot produce
 * transient contrast results; colours are identical in both modes.
 */
// Not serial: every group runs even if an earlier one fails, so the JSON is always complete.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const OUT = path.resolve(__dirname, "../../../docs/a11y/axe-results.json");

type Node = { target: string; html: string; summary: string };
type Viol = { id: string; impact: string; help: string; nodes: Node[] };
type Scan = { page: string; url: string; counts: Record<string, number>; violations: Viol[]; incomplete: number; passes: number };
const scans: Scan[] = [];

async function scan(page: Page, name: string): Promise<Viol[]> {
  await page.waitForTimeout(400);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations: Viol[] = r.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? "unknown",
    help: v.help,
    nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 300), summary: (n.failureSummary ?? "").slice(0, 400) })),
  }));
  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.nodes.length;
  scans.push({ page: name, url: new URL(page.url()).pathname + new URL(page.url()).search, counts, violations, incomplete: r.incomplete.length, passes: r.passes.length });
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

function fmt(bad: Viol[]) {
  return bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `   ${n.target} :: ${n.html}`).join("\n")}`);
}

async function ctxPage(browser: Browser, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 1000 : 844 }, locale: "ar", reducedMotion: "reduce" });
  return ctx.newPage();
}

async function loggedIn(browser: Browser, who: Who, next: string, width = 1440) {
  const page = await ctxPage(browser, width);
  await uiLogin(page, who, next);
  return page;
}

/** Merges by page name (a failed test restarts the worker, which would drop in-memory scans). */
test.afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  let prev: Scan[] = [];
  try {
    prev = (JSON.parse(fs.readFileSync(OUT, "utf8")) as { scans: Scan[] }).scans ?? [];
  } catch {}
  const mine = new Set(scans.map((s) => s.page));
  const all = [...prev.filter((s) => !mine.has(s.page)), ...scans];
  const summary = all.map((s) => ({ page: s.page, url: s.url, ...s.counts }));
  const totals = summary.reduce<Record<string, number>>((t, s) => {
    for (const k of ["critical", "serious", "moderate", "minor"]) t[k] = (t[k] ?? 0) + (s as unknown as Record<string, number>)[k];
    return t;
  }, {});
  fs.writeFileSync(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, tags: TAGS, axe: "@axe-core/playwright 4.14.0", totals, summary, scans: all }, null, 2),
  );
});

for (const width of [1440, 390]) {
  test(`public pages @${width}`, async ({ browser }) => {
    const page = await ctxPage(browser, width);
    const bad: string[] = [];
    const slug = (await db.from("events").select("public_slug").eq("is_published", true).limit(1).single()).data?.public_slug ?? "dev-sample-published-project";
    for (const [name, url] of [
      ["home", "/"],
      ["work", "/work"],
      ["work-detail", `/work/${slug}`],
      ["services", "/services"],
      ["faq", "/faq"],
      ["contact", "/contact"],
      ["login", "/login"],
      ["404", "/this-page-does-not-exist"],
    ] as const) {
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      bad.push(...fmt(await scan(page, `${name}@${width}`)));
    }

    // /book step 1, step 2, and server-side field errors shown.
    await page.goto(`${BASE}/book`);
    bad.push(...fmt(await scan(page, `book-step1@${width}`)));
    await page.locator("#contact_name").fill("اختبار وصول");
    await page.locator("#contact_phone").fill("0599000000");
    await page.locator("#event_type").selectOption("wedding");
    await page.locator("#event_date").fill("2027-06-01");
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(page.getByRole("heading", { name: /تفاصيل إضافية/ })).toBeVisible();
    bad.push(...fmt(await scan(page, `book-step2@${width}`)));
    // Strip client constraints so the server reports field errors (as it would for a bypassed client).
    await page.evaluate(() => {
      const f = document.querySelector("form")!;
      f.noValidate = true;
      for (const el of Array.from(f.querySelectorAll("input,select"))) {
        el.removeAttribute("required");
        el.removeAttribute("pattern");
        el.removeAttribute("minlength");
      }
    });
    await page.locator("#contact_name").evaluate((el: HTMLInputElement) => (el.value = "x"));
    await page.locator("#contact_phone").evaluate((el: HTMLInputElement) => (el.value = "12"));
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await expect(page.locator("#contact_name-error")).toBeVisible({ timeout: 30_000 });
    bad.push(...fmt(await scan(page, `book-errors@${width}`)));

    // /track with a not-found result.
    await page.goto(`${BASE}/track`);
    await page.locator("#code").fill("ZZZZZZ99");
    await page.locator("#last4").fill("1234");
    await page.getByRole("button", { name: "اعرض الحالة" }).click();
    await expect(page.getByText("لم نجد طلباً بهذه البيانات")).toBeVisible({ timeout: 30_000 });
    bad.push(...fmt(await scan(page, `track-notfound@${width}`)));

    await page.context().close();
    expect(bad, bad.join("\n")).toEqual([]);
  });
}

test("portal (customer A) @1440", async ({ browser }) => {
  const page = await loggedIn(browser, "a", "/portal");
  const bad: string[] = [];
  bad.push(...fmt(await scan(page, "portal-home")));
  const deliv = (await db.from("deliverables").select("id").eq("event_id", EV.A1).limit(1).single()).data!.id;
  for (const [name, url] of [
    ["portal-event", `/portal/events/${EV.A1}`],
    ["portal-video", `/portal/events/${EV.A1}/videos/${deliv}`],
    ["portal-contracts", `/portal/events/${EV.A1}/contracts`],
    ["portal-payments", `/portal/events/${EV.A1}/payments`],
  ] as const) {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    bad.push(...fmt(await scan(page, name)));
  }

  await page.goto(`${BASE}/portal/events/${EV.A1}/gallery`);
  await page.getByRole("button", { name: "عرض الصورة 1", exact: true }).click();
  await expect(page.getByTestId("lightbox")).toBeVisible();
  await page.waitForTimeout(800);
  bad.push(...fmt(await scan(page, "portal-gallery-lightbox")));
  await page.keyboard.press("Escape");

  await page.goto(`${BASE}/portal/events/${EV.A1}/selection`);
  const review = page.getByRole("button", { name: /مراجعة وإرسال|عرض الاختيار المُرسل/ });
  await review.click();
  await expect(page.getByRole("button", { name: "العودة إلى كل الصور" })).toBeVisible();
  bad.push(...fmt(await scan(page, "portal-selection-review")));

  await page.context().close();
  expect(bad, bad.join("\n")).toEqual([]);
});

test("admin (owner) @1440 and nav open @390", async ({ browser }) => {
  const page = await loggedIn(browser, "owner", "/admin");
  const bad: string[] = [];
  const booking = (await db.from("booking_requests").select("id").order("created_at").limit(1).single()).data!.id;
  for (const [name, url] of [
    ["admin-overview", "/admin"],
    ["admin-customers", "/admin/customers"],
    ["admin-booking", `/admin/bookings/${booking}`],
    ["admin-event", `/admin/events/${EV.A1}`],
    ["admin-event-media", `/admin/events/${EV.A1}/media`],
    ["admin-users", "/admin/users"],
    ["admin-settings", "/admin/settings"],
  ] as const) {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    bad.push(...fmt(await scan(page, name)));
  }

  // Open confirmation dialog (event detail: "إزالة" a staff assignment), scan, cancel.
  await page.goto(`${BASE}/admin/events/${EV.A1}`);
  await page.getByRole("button", { name: "إزالة" }).first().click();
  const dlg = page.getByRole("dialog", { name: "إزالة من طاقم المناسبة؟" });
  await expect(dlg).toBeVisible();
  bad.push(...fmt(await scan(page, "admin-confirm-dialog")));
  await dlg.getByRole("button", { name: "تراجع" }).click();

  // Finance with payment form errors (server rejects a non-numeric amount).
  await page.goto(`${BASE}/admin/finance`);
  const form = page.getByTestId("payment-form");
  await form.locator("select[name=customer_id]").selectOption({ index: 1 });
  await form.locator("input[name=amount]").fill("abc");
  await form.getByRole("button", { name: "تسجيل" }).click();
  await expect(form.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  bad.push(...fmt(await scan(page, "admin-finance-errors")));

  // Mobile width with the nav open.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin`);
  await page.getByRole("button", { name: "القائمة" }).click();
  await expect(page.locator("#admin-nav")).toBeVisible();
  bad.push(...fmt(await scan(page, "admin-overview-nav-open@390")));

  await page.context().close();
  expect(bad, bad.join("\n")).toEqual([]);
});
