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

/**
 * S4 leftovers: the GLOBAL flag app_settings.require_staff_mfa = true (set as postgres, restored to
 * false afterwards) with a real `staff`-role user assigned to one seeded event (B1).
 * Must not run concurrently with other suites (the global flag affects every staff login).
 */
test.describe("global require_staff_mfa + assigned staff", () => {
  const S = { email: `mfa.staff.${STAMP}@dev.local`, password: `MfaStaff!${STAMP}` };
  const ASSIGNED = "00000000-0000-4000-8000-0000000000e3"; // B1 (customer B)
  const A1 = "00000000-0000-4000-8000-0000000000e1";
  const STAFF_ROW = crypto.randomUUID();
  const TITLE = `[MFA QA] ${STAMP}`;
  let staffId = "";
  let staffSecret = "";
  let anonEventIds: string[] = [];

  async function staff1(): Promise<SupabaseClient> {
    const c = client();
    const { error } = await c.auth.signInWithPassword(S);
    if (error) throw error;
    return c;
  }
  async function staff2(): Promise<SupabaseClient> {
    const c = await staff1();
    const { data } = await c.auth.mfa.listFactors();
    const { error } = await c.auth.mfa.challengeAndVerify({ factorId: data!.totp[0].id, code: await freshTotp(staffSecret) });
    if (error) throw error;
    return c;
  }
  /** Event ids visible beyond what anon sees (the staff-only view). */
  async function privateEvents(c: SupabaseClient) {
    const ids = ((await c.from("events").select("id")).data ?? []).map((r) => r.id as string);
    return ids.filter((id) => !anonEventIds.includes(id)).sort();
  }
  async function staffLogin(page: Page) {
    await page.goto(`${BASE}/login?next=/admin`);
    await page.locator("#email").fill(S.email);
    await page.locator("#password").fill(S.password);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("step") === "mfa", { timeout: 60_000 });
  }

  test.beforeAll(async () => {
    anonEventIds = ((await anon().from("events").select("id")).data ?? []).map((r) => r.id as string);
    const { data, error } = await db.auth.admin.createUser({ ...S, email_confirm: true });
    if (error) throw error;
    staffId = data.user.id;
    psql(
      `update public.profiles set role = 'staff', mfa_required = false, full_name = 'MFA Staff QA' where id = '${staffId}';` +
        `insert into public.staff_members (id, profile_id, full_name, specialty, phone) values ('${STAFF_ROW}', '${staffId}', '[MFA QA] Staff', 'photo', '0500000099');` +
        `insert into public.event_staff_assignments (event_id, staff_id, role_label) values ('${ASSIGNED}', '${STAFF_ROW}', 'photographer');` +
        `update public.app_settings set require_staff_mfa = true where id = 1;`,
    );
    expect(psql(`select require_staff_mfa from public.app_settings where id = 1;`)).toBe("t");
  });

  test.afterAll(async () => {
    psql(`update public.app_settings set require_staff_mfa = false where id = 1;`);
    psql(`delete from public.deliverables where title = '${TITLE}';`);
    psql(`delete from public.event_staff_assignments where staff_id = '${STAFF_ROW}'; delete from public.staff_members where id = '${STAFF_ROW}';`);
    if (staffId) {
      const { error } = await db.auth.admin.deleteUser(staffId);
      if (error) psql(`update public.profiles set disabled = true where id = '${staffId}';`);
    }
    expect(psql(`select require_staff_mfa from public.app_settings where id = 1;`)).toBe("f");
  });

  test("6. staff at aal1 (global flag): /admin goes to MFA; API returns no assigned-event data; writes rejected", async ({ page }) => {
    await staffLogin(page);
    expect(await jwtAal(page)).toBe("aal1");
    for (const p of ["/admin", `/admin/events/${ASSIGNED}`, "/admin/production"]) {
      await page.goto(`${BASE}${p}`);
      await expect(page, p).toHaveURL(/[?&]step=mfa/, { timeout: 30_000 });
    }

    const c1 = await staff1();
    expect((await c1.rpc("staff_mfa_required")).data).toBe(true);
    expect(await privateEvents(c1)).toEqual([]);
    expect((await c1.from("event_staff_assignments").select("event_id")).data ?? []).toEqual([]);
    expect((await c1.from("media_assets").select("id").eq("event_id", ASSIGNED)).data ?? []).toEqual([]);
    expect((await c1.from("deliverables").select("id")).data ?? []).toEqual([]);
    // Writes the same user may do at aal2 (positive control in test 7) are rejected at aal1.
    const ins = await c1.from("deliverables").insert({ event_id: ASSIGNED, kind: "video", title: TITLE }).select("id");
    expect(ins.data ?? []).toEqual([]);
    expect(ins.error?.code).toBe("42501");
    const media = await c1.from("media_assets").update({ sort_order: 9999 }).eq("event_id", ASSIGNED).select("id");
    expect(media.data ?? []).toEqual([]);
    const ev = await c1.from("events").update({ venue: "[MFA QA]" }).eq("id", ASSIGNED).select("id");
    expect(ev.data ?? []).toEqual([]);
    expect(psql(`select count(*) from public.deliverables where title = '${TITLE}';`)).toBe("0");
    expect(psql(`select count(*) from public.media_assets where event_id = '${ASSIGNED}' and sort_order = 9999;`)).toBe("0");
  });

  test("7. staff enrolls TOTP -> aal2: only the assigned event; still no finance or users", async ({ page }) => {
    await staffLogin(page);
    await page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
    const secretEl = page.locator("code[dir=ltr]");
    await expect(secretEl).toHaveText(/^[A-Z2-7]{16,}$/);
    staffSecret = (await secretEl.textContent())!.trim();
    await page.locator("#code").fill(await freshTotp(staffSecret));
    await page.getByRole("button", { name: "تحقّق" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
    expect(await jwtAal(page)).toBe("aal2");
    await page.goto(`${BASE}/admin/events/${ASSIGNED}`);
    await expect(page.getByTestId("forbidden")).toHaveCount(0);
    await expect(page.locator("main h1, main h2").first()).toBeVisible();
    for (const p of ["/admin/finance", "/admin/users"]) {
      await page.goto(`${BASE}${p}`);
      await expect(page.getByTestId("forbidden"), p).toBeVisible({ timeout: 30_000 });
    }

    const c2 = await staff2();
    expect(await privateEvents(c2)).toEqual([ASSIGNED]);
    const assigned = ((await c2.from("event_staff_assignments").select("event_id")).data ?? []).map((r) => r.event_id);
    expect([...new Set(assigned)]).toEqual([ASSIGNED]);
    expect((await c2.from("media_assets").select("id").eq("event_id", A1)).data ?? []).toEqual([]);
    expect(((await c2.from("media_assets").select("id").eq("event_id", ASSIGNED)).data ?? []).length).toBeGreaterThan(0);
    const fin = await c2.rpc("admin_financial_summary", { p_from: "2000-01-01", p_to: "2100-01-01" });
    expect(fin.error?.code).toBe("42501");
    expect((await c2.from("payments").select("id")).data ?? []).toEqual([]);
    const profiles = ((await c2.from("profiles").select("id")).data ?? []).map((r) => r.id);
    expect(profiles.filter((id) => id !== staffId)).toEqual([]);
    // Positive control: at aal2 the same write succeeds on the assigned event only.
    const ins = await c2.from("deliverables").insert({ event_id: ASSIGNED, kind: "video", title: TITLE }).select("id");
    expect(ins.error).toBeNull();
    expect(ins.data?.length).toBe(1);
    const other = await c2.from("deliverables").insert({ event_id: A1, kind: "video", title: TITLE }).select("id");
    expect(other.data ?? []).toEqual([]);
  });
});
