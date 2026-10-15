import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { as, BASE, db, EV, newLoggedIn, psql, SHOTS } from "./qa-helpers";

/** Admin checks beyond admin.spec.ts. Production build, fresh local DB. */
test.describe.configure({ mode: "serial" });

const QA_CONTRACT = crypto.randomUUID(); // versions are immutable (cannot be deleted), so each run uses a new contract

test("A4: contract approval binds the exact version the admin re-sent", async ({ browser }) => {
  const { data: ca } = await db.from("customers").select("id").eq("user_id", "00000000-0000-4000-8000-0000000000b1").single();
  psql(`
    insert into public.contracts (id, customer_id, event_id) values ('${QA_CONTRACT}', '${ca!.id}', '${EV.A2}');
    insert into public.contract_versions (contract_id, body, total, deposit_required) values ('${QA_CONTRACT}', '[QA] contract v1 body', 100000, 20000);
    update public.contracts set status = 'sent' where id = '${QA_CONTRACT}';`);
  const { data: v1 } = await db.from("contract_versions").select("id, content_hash").eq("contract_id", QA_CONTRACT).single();

  const page = await newLoggedIn(browser, "admin", `/admin/contracts/${QA_CONTRACT}`);
  const form = page.locator("form").filter({ has: page.locator('textarea[name="body"]') });
  await form.locator('textarea[name="body"]').fill("[QA] contract v2 body — changed terms");
  await form.locator('input[name="total"]').fill("1,500.00");
  await form.getByRole("button", { name: "حفظ كنسخة جديدة" }).click();
  await expect(page.getByText("النسخة 2").first()).toBeVisible({ timeout: 30_000 });
  const { data: k1 } = await db.from("contracts").select("status, current_version_id").eq("id", QA_CONTRACT).single();
  expect(k1!.status).toBe("draft");
  expect(k1!.current_version_id).not.toBe(v1!.id);

  const a = await as("a");
  // while draft, customer cannot approve anything
  const { data: v2 } = await db.from("contract_versions").select("id, content_hash, version_no, total").eq("id", k1!.current_version_id!).single();
  expect(v2!.version_no).toBe(2);
  expect(v2!.total).toBe(150000);
  expect((await a.rpc("customer_approve_contract", { p_version_id: v2!.id, p_content_hash: v2!.content_hash })).error).not.toBeNull();

  await page.reload();
  await page.getByRole("button", { name: "إرسال النسخة 2 للعميل" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await db.from("contracts").select("status").eq("id", QA_CONTRACT).single()).data!.status).toBe("sent");

  // old version with its own valid hash is rejected (not current)
  expect((await a.rpc("customer_approve_contract", { p_version_id: v1!.id, p_content_hash: v1!.content_hash })).error).not.toBeNull();
  // v2 id with v1 hash is rejected
  expect((await a.rpc("customer_approve_contract", { p_version_id: v2!.id, p_content_hash: v1!.content_hash })).error).not.toBeNull();
  // exact v2
  expect((await a.rpc("customer_approve_contract", { p_version_id: v2!.id, p_content_hash: v2!.content_hash })).error).toBeNull();
  const { data: k2 } = await db.from("contracts").select("status, approved_version_id").eq("id", QA_CONTRACT).single();
  expect(k2).toEqual({ status: "approved", approved_version_id: v2!.id });
  // versions are immutable even for admin
  const ad = await as("admin");
  const mut = await ad.from("contract_versions").update({ body: "tampered" }).eq("id", v2!.id).select("id");
  expect(mut.error !== null || (mut.data ?? []).length === 0).toBe(true);

  await page.reload();
  await expect(page.getByTestId("approved-version")).toContainText("النسخة 2");
  await page.screenshot({ path: path.join(SHOTS, "qa-admin-contract-approved-1440.png"), fullPage: true });
  await page.context().close();
});

test("A6: refund recorded by owner reduces net totals correctly", async ({ browser }) => {
  const ownerApi = await as("owner");
  const fin = async () => (await ownerApi.rpc("event_financials", { p_event_id: EV.A1 })).data![0];
  const sum = async () => (await ownerApi.rpc("admin_financial_summary", { p_from: "2000-01-01", p_to: "2100-01-01" })).data!.find((r: { currency: string }) => r.currency.trim() === "ILS");
  const before = await fin();
  const sBefore = await sum();

  const page = await newLoggedIn(browser, "owner", "/admin/finance");
  const form = page.getByTestId("payment-form");
  await form.locator('select[name="customer_id"]').selectOption({ label: "[DEV] Customer A" });
  await form.locator('select[name="event_id"]').selectOption({ label: "[DEV] Customer A wedding" });
  await form.locator('input[name="amount"]').fill("1,000.00");
  await form.locator('select[name="kind"]').selectOption("refund");
  await form.locator('input[name="reference"]').fill("[QA] refund");
  await form.getByRole("button", { name: "تسجيل" }).click();
  await expect(form.getByTestId("action-msg")).toHaveText(/سُجّل/, { timeout: 60_000 });

  const after = await fin();
  const sAfter = await sum();
  test.info().annotations.push({ type: "before/after", description: JSON.stringify({ before, after, sBefore, sAfter }) });
  expect(after.paid).toBe(before.paid);
  expect(after.refunded).toBe(before.refunded + 100000);
  expect(after.balance).toBe(before.balance + 100000);
  expect(sAfter.refunded).toBe(sBefore.refunded + 100000);
  expect(sAfter.net_cash).toBe(sBefore.net_cash - 100000);

  // customer sees the same totals in the portal
  const cust = await newLoggedIn(browser, "a", `/portal/events/${EV.A1}/payments`);
  const fmt = (m: number) => new Intl.NumberFormat("ar-PS", { style: "currency", currency: "ILS" }).format(m / 100).replace(/\s/g, "");
  await expect(cust.getByTestId("financials").locator("dd")).toHaveCount(4);
  const dds = (await cust.getByTestId("financials").locator("dd").allInnerTexts()).map((s) => s.replace(/\s/g, ""));
  // Display follows balance_basis: agreed total = contract | accepted quote | "not agreed yet";
  // a negative balance is shown as customer credit, and "—" when nothing is agreed.
  const agreed = after.balance_basis === "contract" ? fmt(after.contracted) : after.balance_basis === "quote" ? fmt(after.quoted) : "لميُتفقبعد";
  const last = after.balance < 0 ? fmt(-after.balance) : after.balance_basis === "none" ? "—" : fmt(after.balance);
  expect(dds).toEqual([agreed, fmt(after.paid), fmt(after.refunded), last]);
  await page.context().close();
  await cust.context().close();
});

async function expectForbiddenOrRedirect(page: Page, url: string) {
  await page.goto(`${BASE}${url}`);
  await expect(page.getByTestId("forbidden").or(page.locator("body[data-never]"))).toBeVisible({ timeout: 60_000 });
}

test("A8: role boundaries by direct URL (staff / admin / owner / customer)", async ({ browser }) => {
  const matrix: Record<"staff" | "admin" | "owner", { deny: string[]; allow: string[] }> = {
    staff: {
      deny: ["/admin/finance", "/admin/users", "/admin/backups", "/admin/settings", "/admin/quotes", "/admin/contracts", "/admin/customers", "/admin/bookings"],
      allow: ["/admin", "/admin/events", "/admin/media", "/admin/production"],
    },
    admin: { deny: ["/admin/users", "/admin/backups"], allow: ["/admin/finance", "/admin/settings", "/admin/quotes", "/admin/contracts"] },
    owner: { deny: [], allow: ["/admin/users", "/admin/backups", "/admin/finance", "/admin/settings"] },
  };
  for (const who of ["staff", "admin", "owner"] as const) {
    const page = await newLoggedIn(browser, who, "/admin");
    for (const u of matrix[who].deny) await expectForbiddenOrRedirect(page, u);
    for (const u of matrix[who].allow) {
      const r = await page.goto(`${BASE}${u}`);
      expect(r!.status(), `${who} ${u}`).toBeLessThan(400);
      await expect(page.getByTestId("forbidden"), `${who} ${u}`).toHaveCount(0);
    }
    await page.context().close();
  }
  // staff sees only the assigned event
  const st = await as("staff");
  const { data: evs } = await st.from("events").select("id");
  const ids = evs!.map((e) => e.id);
  test.info().annotations.push({ type: "staff visible events", description: ids.join(",") });
  expect(ids).toContain(EV.A1);
  expect(ids).not.toContain(EV.B1);
  expect(ids).not.toContain(EV.B2);
  // customer cannot use the admin area
  const cust = await newLoggedIn(browser, "a", "/portal");
  await cust.goto(`${BASE}/admin/finance`);
  await expect(cust.getByTestId("forbidden").or(cust.locator("[data-testid=event-card]")).first()).toBeVisible({ timeout: 30_000 });
  test.info().annotations.push({ type: "customer /admin/finance lands on", description: cust.url() });
  expect(await cust.getByText("سجل الدفعات").count()).toBe(0);
  await cust.context().close();
});

test("A4: admin can create a quote (FAILS today: app.random_code not granted to authenticated)", async () => {
  const ad = await as("admin");
  const { data: cb } = await db.from("customers").select("id").eq("user_id", "00000000-0000-4000-8000-0000000000b2").single();
  const r = await ad.from("quotes").insert({ customer_id: cb!.id, event_id: EV.B1 }).select("id");
  if (r.data?.length) await ad.from("quotes").delete().eq("id", r.data[0].id);
  // EXPECTED to pass once fixed; currently fails with 42501 "permission denied for function random_code".
  expect(r.error, JSON.stringify(r.error)).toBeNull();
});
