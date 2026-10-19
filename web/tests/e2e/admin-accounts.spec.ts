import { expect, test, type Browser } from "@playwright/test";
import { BASE, db, newLoggedIn, USERS } from "./qa-helpers";

/**
 * Owner creates accounts with a password + role from /admin/users; everyone changes their own password at
 * /admin/account (current password verified). Non-owners cannot create accounts. LOCAL STACK ONLY.
 *   BASE_URL=http://localhost:3600 npx playwright test admin-accounts
 */
test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const NEW = { email: `e2e-acct-${STAMP}@example.com`, name: `حساب اختبار ${STAMP}`, password: `NewAcct!${STAMP}x` };
const NEW_ADMIN_PW = `Changed!${STAMP}yz`;

async function deleteByEmail(email: string) {
  const u = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === email);
  if (u) await db.auth.admin.deleteUser(u.id);
}
async function passwordLogin(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=/admin`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  // Password accepted → either the MFA step (local seed requires MFA) or the admin.
  const ok = await page
    .waitForURL((u) => u.searchParams.get("step") === "mfa" || u.pathname.startsWith("/admin"), { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await ctx.close();
  return ok;
}

test.afterAll(async () => {
  await deleteByEmail(NEW.email);
  // Restore the seed admin password whatever happened.
  const u = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === USERS.admin.email);
  if (u) await db.auth.admin.updateUserById(u.id, { password: USERS.admin.password });
});

test("A1: owner creates an admin account with a password; it can sign in with it", async ({ browser }) => {
  await deleteByEmail(NEW.email);
  const page = await newLoggedIn(browser, "owner", "/admin/users");
  const form = page.getByTestId("create-account-form");
  await form.locator('input[name="full_name"]').fill(NEW.name);
  await form.locator('input[name="email"]').fill(NEW.email);
  await form.locator('select[name="role"]').selectOption("admin");
  await form.locator('input[name="password"]').fill(NEW.password);
  await form.locator('input[name="confirm"]').fill("mismatch-123456");
  await form.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "0"); // mismatch refused
  await form.locator('input[name="confirm"]').fill(NEW.password);
  await form.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  const u = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === NEW.email)!;
  expect(u.email_confirmed_at).toBeTruthy();
  expect((await db.from("profiles").select("role, full_name").eq("id", u.id).single()).data).toEqual({ role: "admin", full_name: NEW.name });
  expect(await passwordLogin(browser, NEW.email, NEW.password)).toBe(true);
  // Duplicate email is refused with a clear message.
  await form.locator('input[name="full_name"]').fill(NEW.name);
  await form.locator('input[name="email"]').fill(NEW.email);
  await form.locator('input[name="password"]').fill(NEW.password);
  await form.locator('input[name="confirm"]').fill(NEW.password);
  await form.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(form.getByTestId("action-msg")).toContainText("في حساب بهذا الإيميل");
  await page.context().close();
});

test("A2: admin cannot create accounts (owner-only page)", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/users");
  await expect(page.getByTestId("forbidden")).toBeVisible();
  await expect(page.getByTestId("create-account-form")).toHaveCount(0);
  await page.context().close();
});

test("A3: change own password — wrong current refused; new one works, old one stops working", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/account");
  const form = page.getByTestId("change-password-form");
  await form.locator('input[name="current"]').fill("wrong-password-1");
  await form.locator('input[name="password"]').fill(NEW_ADMIN_PW);
  await form.locator('input[name="confirm"]').fill(NEW_ADMIN_PW);
  await form.getByRole("button", { name: "تغيير كلمة السر" }).click();
  await expect(form.getByTestId("action-msg")).toContainText("كلمة السر الحالية غير صحيحة");
  await form.locator('input[name="current"]').fill(USERS.admin.password);
  await form.locator('input[name="password"]').fill(NEW_ADMIN_PW);
  await form.locator('input[name="confirm"]').fill(NEW_ADMIN_PW);
  await form.getByRole("button", { name: "تغيير كلمة السر" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await page.context().close();
  expect(await passwordLogin(browser, USERS.admin.email, NEW_ADMIN_PW)).toBe(true);
  expect(await passwordLogin(browser, USERS.admin.email, USERS.admin.password)).toBe(false);
});

test("A4: owner sets another account's password (audited); admin cannot", async ({ browser }) => {
  const NEW_PW = `OwnerSet!${STAMP}q`;
  const page = await newLoggedIn(browser, "owner", "/admin/users");
  const row = page.locator("tr", { hasText: "[DEV] Admin" });
  await row.getByTestId("set-password").locator("summary").click();
  const box = row.getByTestId("set-password");
  await box.locator('input[name="password"]').fill(NEW_PW);
  await box.locator('input[name="confirm"]').fill(NEW_PW + "x");
  await box.getByRole("button", { name: "حفظ كلمة السر" }).click();
  await expect(box.getByTestId("action-msg")).toHaveAttribute("data-ok", "0");
  await box.locator('input[name="password"]').fill(NEW_PW);
  await box.locator('input[name="confirm"]').fill(NEW_PW);
  await box.getByRole("button", { name: "حفظ كلمة السر" }).click();
  await expect(box.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await page.context().close();
  expect(await passwordLogin(browser, USERS.admin.email, NEW_PW)).toBe(true);
  const u = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === USERS.admin.email)!;
  const audit = (await db.from("audit_events").select("action, after").eq("entity_id", u.id).eq("action", "password_set_by_owner")).data!;
  expect(audit.length).toBeGreaterThan(0);
  expect(JSON.stringify(audit)).not.toContain(NEW_PW);
  await db.auth.admin.updateUserById(u.id, { password: USERS.admin.password });
  // Admin sees the forbidden page, not the control.
  const p2 = await newLoggedIn(browser, "admin", "/admin/users");
  await expect(p2.getByTestId("set-password")).toHaveCount(0);
  await p2.context().close();
});
