import { expect, test, type Page } from "@playwright/test";
import { BASE, db, newLoggedIn, psql } from "./qa-helpers";

/**
 * «المناسبات» list: actions column (edit / delete → recoverable trash / restore), price column (agreed price from
 * approved contract > accepted quote, else «غير محدد»), phone layout, staff sees neither. LOCAL STACK ONLY; every
 * change is reverted (seed data restored at the end).
 *   BASE_URL=http://localhost:3600 npx playwright test admin-events-actions
 */
test.describe.configure({ mode: "serial" });

const E1 = "00000000-0000-4000-8000-0000000000e1"; // customer A wedding (has a sent quote 1c1, 12,500)
const E2 = "00000000-0000-4000-8000-0000000000e2"; // published sample project
const E4 = "00000000-0000-4000-8000-0000000000e4";
const Q1 = "00000000-0000-4000-8000-0000000001c1";
const SLUG2 = "dev-sample-published-project";
let e4City = "";
const counts = async (id: string) => {
  const c = async (t: string) => (await db.from(t).select("id", { count: "exact", head: true }).eq("event_id", id)).count;
  return { media: await c("media_assets"), payments: await c("payments"), quotes: await c("quotes"), contracts: await c("contracts"), deliverables: await c("deliverables") };
};
const row = (page: Page, id: string) => page.locator(`[data-testid=event-row][data-event-id="${id}"]`);

test.beforeAll(async () => {
  e4City = (await db.from("events").select("city").eq("id", E4).single()).data!.city ?? "";
});
test.afterAll(async () => {
  // Restore seed state whatever happened (local superuser session; same effect as a db reset for these rows).
  psql(`begin; set local session_replication_role = replica;
    update public.quotes set status = 'sent', accepted_at = null, accepted_by = null where id = '${Q1}';
    update public.events set deleted_at = null, deleted_by = null where id in ('${E1}', '${E2}', '${E4}');
    commit;`);
  await db.from("events").update({ city: e4City }).eq("id", E4);
});

test("A1: price column — «غير محدد» without an agreed price, the accepted quote total in shekels otherwise", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/events");
  await expect(page.getByRole("columnheader", { name: "السعر" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "الإجراءات" })).toBeVisible();
  await expect(row(page, E1).getByTestId("event-price")).toHaveText(/غير محدد/);
  await expect(row(page, E1).getByTestId("event-price")).toHaveAttribute("data-basis", "none");
  // Accept the seeded quote (fixture, restored in afterAll): the list shows exactly its total, no other number.
  psql(`begin; set local session_replication_role = replica; update public.quotes set status = 'accepted', accepted_at = now() where id = '${Q1}'; commit;`);
  await page.reload();
  const price = row(page, E1).getByTestId("event-price");
  await expect(price).toHaveAttribute("data-basis", "quote");
  await expect(price).toContainText("12,500 شيكل");
  await expect(price).toContainText("حسب عرض السعر المقبول");
  // Exactly the stored quote total (no derived or invented number); pgTAP 97 checks it equals event_financials.
  expect((await db.from("quotes").select("total").eq("id", Q1).single()).data!.total).toBe(1250000);
  await page.context().close();
});

test("A2: «تعديل» opens the event form; saving updates the list", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/events");
  await row(page, E4).getByTestId("event-edit").click();
  await expect(page).toHaveURL(new RegExp(`/admin/events/${E4}#edit$`));
  const form = page.getByTestId("event-form");
  await form.locator('input[name="city"]').fill("مدينة اختبار");
  await form.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await page.goto(`${BASE}/admin/events`);
  await expect(row(page, E4)).toContainText("مدينة اختبار");
  await page.context().close();
});

test("A3: «حذف» asks for confirmation naming the event; «تراجع» changes nothing", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/events");
  const title = (await db.from("events").select("title").eq("id", E4).single()).data!.title;
  await row(page, E4).getByTestId("event-trash").getByRole("button", { name: "حذف" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`حذف المناسبة «${title}»؟`);
  await expect(dialog).toContainText("يمكن استرجاعها");
  await dialog.getByRole("button", { name: "تراجع" }).click();
  await expect(dialog).toBeHidden();
  expect((await db.from("events").select("deleted_at").eq("id", E4).single()).data!.deleted_at).toBeNull();
  await expect(row(page, E4)).toBeVisible();
  await page.context().close();
});

test("A4: delete → trash (nothing removed, not public) → restore (public again)", async ({ browser }) => {
  const before = await counts(E2);
  expect((await fetch(`${BASE}/work/${SLUG2}`)).status).toBe(200);
  const page = await newLoggedIn(browser, "admin", "/admin/events");
  await row(page, E2).getByTestId("event-trash").getByRole("button", { name: "حذف" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "نقل إلى سلة المحذوفات" }).click();
  await expect(row(page, E2)).toHaveCount(0);
  const ev = (await db.from("events").select("deleted_at, is_published, publication_consent").eq("id", E2).single()).data!;
  expect(ev.deleted_at).not.toBeNull();
  expect([ev.is_published, ev.publication_consent]).toEqual([true, "granted"]); // publication untouched, just hidden
  expect(await counts(E2)).toEqual(before);
  await expect.poll(async () => (await fetch(`${BASE}/work/${SLUG2}`)).status, { timeout: 15_000 }).toBe(404);

  await page.getByTestId("events-trash-link").click();
  await expect(page).toHaveURL(/view=trash/);
  await row(page, E2).getByTestId("event-restore").getByRole("button", { name: "استرجاع" }).click();
  await expect(row(page, E2)).toHaveCount(0);
  expect((await db.from("events").select("deleted_at").eq("id", E2).single()).data!.deleted_at).toBeNull();
  expect(await counts(E2)).toEqual(before);
  await expect.poll(async () => (await fetch(`${BASE}/work/${SLUG2}`)).status, { timeout: 15_000 }).toBe(200);
  await page.goto(`${BASE}/admin/events`);
  await expect(row(page, E2)).toBeVisible();
  await page.context().close();
});

test("A5: phone 390 — one card per event, price and actions on screen, RTL", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/events");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  const card = page.locator(`[data-testid=event-card][data-event-id="${E4}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("event-price")).toBeVisible();
  for (const b of [card.getByTestId("event-edit"), card.getByTestId("event-trash").getByRole("button", { name: "حذف" })]) {
    const box = (await b.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await card.getByTestId("event-edit").click();
  await expect(page).toHaveURL(new RegExp(`/admin/events/${E4}#edit$`));
  await page.context().close();
});

test("A6: staff sees neither prices nor delete/restore, and cannot open the trash", async ({ browser }) => {
  const page = await newLoggedIn(browser, "staff", "/admin/events");
  await expect(page.getByRole("columnheader", { name: "السعر" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "الإجراءات" })).toHaveCount(0);
  await expect(page.getByTestId("event-trash")).toHaveCount(0);
  await page.goto(`${BASE}/admin/events?view=trash`);
  await expect(page.getByTestId("event-restore")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("سلة المحذوفات");
  await page.context().close();
});
