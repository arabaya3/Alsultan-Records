import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BASE, PUB_KEY, SB_URL, USERS, anon, db, psql } from "./qa-helpers";
import { freshTotp, wrongCode } from "./totp";

/**
 * MFA release blocker (S4). LOCAL STACK ONLY.
 * Uses a dedicated, freshly created admin user with profiles.mfa_required = true, which
 * app.require_mfa() ORs with app_settings.require_staff_mfa. The global flag is not toggled
 * because other suites share the local DB concurrently (the dev seed keeps it off).
 */
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const MFA_USER = { email: `mfa.admin.${STAMP}@dev.local`, password: `MfaAdmin!${STAMP}` };
let userId = "";
let secret = "";
const PRIVATE_OBJ = "events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000001a1/original.jpg";

function client(): SupabaseClient {
  return createClient(SB_URL, PUB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function aal1(): Promise<SupabaseClient> {
  const c = client();
  const { error } = await c.auth.signInWithPassword(MFA_USER);
  if (error) throw error;
  return c;
}

async function aal2(): Promise<SupabaseClient> {
  const c = await aal1();
  const { data } = await c.auth.mfa.listFactors();
  const factorId = data!.totp[0].id;
  const { error } = await c.auth.mfa.challengeAndVerify({ factorId, code: await freshTotp(secret) });
  if (error) throw error;
  return c;
}

/** Results of every staff-privileged call; ok = data returned. */
async function probe(c: SupabaseClient) {
  const events = await c.from("events").select("id");
  const bookings = await c.from("booking_requests").select("id");
  const fin = await c.rpc("admin_financial_summary", { p_from: "2000-01-01", p_to: "2100-01-01" });
  const signed = await c.storage.from("private-media").createSignedUrl(PRIVATE_OBJ, 60);
  return {
    events: events.data?.length ?? 0,
    bookings: bookings.data?.length ?? 0,
    finOk: !fin.error,
    finCode: fin.error?.code,
    signedOk: Boolean(signed.data?.signedUrl) && !signed.error,
  };
}

async function passwordLogin(page: Page, next = "/admin") {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.locator("#email").fill(MFA_USER.email);
  await page.locator("#password").fill(MFA_USER.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("step") === "mfa", { timeout: 60_000 });
}

async function jwtAal(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const parts = cookies.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!parts.length) return null;
  let raw = parts.map((c) => c.value).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = JSON.parse(raw).access_token as string;
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).aal;
}

test.beforeAll(async () => {
  const { data, error } = await db.auth.admin.createUser({ ...MFA_USER, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  // As postgres (not an API role), so the profiles column guard allows it.
  psql(`update public.profiles set role = 'admin', mfa_required = true, full_name = 'MFA QA' where id = '${userId}';`);
});

test.afterAll(async () => {
  if (!userId) return;
  psql(`update public.profiles set disabled = false where id = '${userId}';`);
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) psql(`update public.profiles set disabled = true where id = '${userId}';`); // never leave a live admin behind
});

test("1. first login: password -> MFA step -> enroll TOTP -> /admin with aal2", async ({ page }) => {
  await passwordLogin(page);
  expect(await jwtAal(page)).toBe("aal1");
  await page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  const secretEl = page.locator("code[dir=ltr]");
  await expect(secretEl).toHaveText(/^[A-Z2-7]{16,}$/);
  await expect(page.getByAltText("رمز QR لربط تطبيق المصادقة")).toBeVisible();
  secret = (await secretEl.textContent())!.trim();
  await page.locator("#code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((u) => u.pathname === "/admin" || u.pathname.startsWith("/admin/"), { timeout: 60_000 });
  expect(await jwtAal(page)).toBe("aal2");
  await expect(page.getByTestId("forbidden")).toHaveCount(0);
});

test("2+3. next login is a challenge (not enroll); wrong code stays aal1; logout clears cookies", async ({ page }) => {
  await passwordLogin(page);
  await expect(page.getByRole("button", { name: "إعداد تطبيق المصادقة" })).toHaveCount(0);
  await expect(page.locator("code[dir=ltr]")).toHaveCount(0);

  await page.locator("#code").fill(wrongCode(secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await expect(page.locator("form p[role=alert]")).toHaveText("الرمز غير صحيح أو انتهت صلاحيته.");
  expect(new URL(page.url()).searchParams.get("step")).toBe("mfa");
  expect(await jwtAal(page)).toBe("aal1");

  // aal1 cannot open admin pages directly: every one sends the user back to the MFA step.
  for (const p of ["/admin", "/admin/finance", "/admin/bookings", "/admin/users", "/admin/settings"]) {
    await page.goto(`${BASE}${p}`);
    await expect(page, p).toHaveURL(/[?&]step=mfa/, { timeout: 30_000 });
  }

  await page.locator("#code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
  expect(await jwtAal(page)).toBe("aal2");
  await page.goto(`${BASE}/admin/finance`);
  await expect(page).toHaveURL(/\/admin\/finance/);
  // aal2 session visiting the MFA step is sent on, not shown the form again.
  await page.goto(`${BASE}/login?step=mfa&next=/admin`);
  await page.waitForURL((u) => u.pathname === "/admin");

  await page.getByRole("button", { name: "تسجيل الخروج" }).first().click();
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 60_000 });
  expect(await jwtAal(page)).toBeNull();
  const sb = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(sb).toEqual([]);

  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("step") !== "mfa");
  await expect(page.locator("#password")).toBeVisible();
});

test("4. direct API: aal1 token is denied staff data, aal2 succeeds", async () => {
  const a = anon();
  const anonEvents = (await a.from("events").select("id")).data?.length ?? 0;

  const c1 = await aal1();
  const { data: req1 } = await c1.rpc("staff_mfa_required");
  expect(req1).toBe(true);
  const low = await probe(c1);
  expect(low.events).toBe(anonEvents); // public reads only
  expect(low.bookings).toBe(0);
  expect(low.finOk).toBe(false);
  expect(low.finCode).toBe("42501");
  expect(low.signedOk).toBe(false);
  // aal1 writes are refused as well.
  const ins = await c1.from("app_settings").update({ require_staff_mfa: false }).eq("id", 1).select();
  expect(ins.data ?? []).toEqual([]);

  const c2 = await aal2();
  const high = await probe(c2);
  expect(high.events).toBeGreaterThan(anonEvents);
  expect(high.bookings).toBeGreaterThan(0);
  expect(high.finOk).toBe(true);
  expect(high.signedOk).toBe(true);
});

test("4b. a customer is never forced into MFA", async ({ page }) => {
  await page.goto(`${BASE}/login?next=/portal`);
  await page.locator("#email").fill(USERS.a.email);
  await page.locator("#password").fill(USERS.a.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 60_000 });
  expect(await jwtAal(page)).toBe("aal1");
  await page.goto(`${BASE}/login?step=mfa`);
  await page.waitForURL((u) => u.pathname.startsWith("/portal"));
});

test("5. disabled staff with a valid aal2 session gets nothing (API + UI)", async ({ page }) => {
  const c2 = await aal2();
  expect((await probe(c2)).finOk).toBe(true);

  // UI aal2 session.
  await passwordLogin(page);
  await page.locator("#code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
  expect(await jwtAal(page)).toBe("aal2");

  psql(`update public.profiles set disabled = true where id = '${userId}';`);
  try {
    const off = await probe(c2); // same, still-valid aal2 token
    const anonEvents = (await anon().from("events").select("id")).data?.length ?? 0;
    expect(off.events).toBe(anonEvents);
    expect(off.bookings).toBe(0);
    expect(off.finOk).toBe(false);
    expect(off.signedOk).toBe(false);

    await page.goto(`${BASE}/admin/finance`);
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /تسجيل الدخول/ })).toBeVisible();
  } finally {
    psql(`update public.profiles set disabled = false where id = '${userId}';`);
  }
});
