#!/usr/bin/env node
/**
 * Staging ADMINISTRATION check — run from web/:  node scripts/staging-admin-check.mjs
 * Needs the app on http://localhost:3100 (production build compiled against staging).
 *
 * Creates its own [STAGING-TEST] users (admin, staff, temporary second owner, customers A/B),
 * enrolls TOTP for the staff roles in the browser (/login?step=mfa), drives the admin UI and
 * asserts the DB effects with the secret key, then deletes everything it created.
 * The real owner is never signed in, modified or deleted; it is snapshotted at start and
 * compared at the end. Writes docs/staging-admin-report.json (no secrets, no emails).
 *
 * Known, documented residue (immutable by design, never weakened):
 *   - contract_versions are append-only and contracts.contract_id FK is RESTRICT, so the test
 *     contract, its versions and its customer row stay.
 *   - album_selection_snapshots are append-only and cascade from events, so the album event,
 *     its selection and snapshot stay (its media rows/objects are removed).
 *   - audit_events rows written by triggers are append-only.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTED_REF, FORBIDDEN_REFS, WEB_ROOT, loadStagingEnv, mgmt, parseEnvFile } from "./staging-lib.mjs";

// ------------------------------------------------------------------ target (staging only)
const E = parseEnvFile(resolve(WEB_ROOT, ".env.staging.app.local"));
const URL_ = E.NEXT_PUBLIC_SUPABASE_URL;
if (URL_ !== `https://${EXPECTED_REF}.supabase.co` || FORBIDDEN_REFS.some((r) => URL_.includes(r))) {
  console.error(`✗ .env.staging.app.local does not point at ${EXPECTED_REF}. Refusing.`);
  process.exit(1);
}
const BASE = "http://localhost:3100";
const REPORT = resolve(WEB_ROOT, "..", "docs", "staging-admin-report.json");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(URL_, E.SUPABASE_SECRET_KEY, opts);
const anon = createClient(URL_, E.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, opts);
let sql = async () => null;
try {
  const m = mgmt(loadStagingEnv(resolve(WEB_ROOT, ".env.staging.local")));
  sql = (q) => m.read(q);
} catch (e) {
  console.log(`  ! read-only SQL unavailable (${e.message}); audit counts will be null`);
}

// ------------------------------------------------------------------ recorder
const checks = [];
let area = "setup";
function check(name, pass, note = "") {
  checks.push({ area, name, pass: !!pass, ...(note ? { note: String(note).slice(0, 240) } : {}) });
  console.log(`  ${pass ? "✓" : "✗"} [${area}] ${name}${note ? ` — ${String(note).slice(0, 160)}` : ""}`);
}
async function section(name, fn) {
  area = name;
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (e) {
    check("section completed without exception", false, (e?.message ?? String(e)).split("\n")[0]);
  }
}
const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, timeout = 30000, every = 1000) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return v;
}

// ------------------------------------------------------------------ TOTP (same as tests/e2e/totp.ts)
function base32Decode(s) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0; const out = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    val = (val << 5) | a.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, t = Date.now()) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(t / 30_000)));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function freshTotp(secret) {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 4000) await sleep(left + 300);
  return totp(secret);
}
/** Next window's code (avoids reusing a code the browser just consumed). */
async function nextWindowTotp(secret) {
  await sleep(30_000 - (Date.now() % 30_000) + 300);
  return totp(secret);
}

// ------------------------------------------------------------------ fixtures / tracking
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const TAG = `[STAGING-TEST] ${RUN}`;
const PW = `St-${randomBytes(18).toString("base64url")}`;
const created = {
  users: {}, customers: new Set(), events: new Set(), bookings: new Set(), quotes: new Set(), contracts: new Set(),
  payments: new Set(), staff: new Set(), equipment: new Set(), support: new Set(), reviews: new Set(), backupRuns: new Set(),
};
const residue = [];
const secrets = {};
const F = {}; // ids produced during the run
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const D = plusDays(12); // all test events share this date (same-day conflict checks)

async function mkUser(key, role) {
  const email = `staging-test-admin-${RUN}-${key}@example.com`;
  const r = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `${TAG} ${key}` } });
  const id = must(r, `create user ${key}`).user.id;
  created.users[key] = { id, email };
  const c = await db.from("customers").select("id").eq("user_id", id).maybeSingle();
  if (c.data) created.customers.add(c.data.id);
  if (role) must(await db.from("profiles").update({ role, mfa_required: true }).eq("id", id), `role ${key}`);
  return id;
}
async function apiSignIn(key) {
  const c = createClient(URL_, E.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, opts);
  must(await c.auth.signInWithPassword({ email: created.users[key].email, password: PW }), `sign in ${key}`);
  return c;
}
async function apiAal2(key) {
  const c = await apiSignIn(key);
  const { data } = await c.auth.mfa.listFactors();
  const factorId = data.totp[0].id;
  let r = await c.auth.mfa.challengeAndVerify({ factorId, code: await freshTotp(secrets[key]) });
  if (r.error) r = await c.auth.mfa.challengeAndVerify({ factorId, code: await nextWindowTotp(secrets[key]) });
  must(r, `aal2 ${key}`);
  return c;
}

// ------------------------------------------------------------------ browser helpers
let browser;
const pages = {};
async function uiLogin(key, next) {
  const ctx = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.locator("#email").fill(created.users[key].email);
  await page.locator("#password").fill(PW);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  return page;
}
/** Password login + first-time TOTP enrollment at /login?step=mfa; returns an aal2 page on /admin. */
async function uiLoginStaffRole(key) {
  const page = await uiLogin(key, "/admin");
  await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("step") === "mfa", { timeout: 60_000 });
  check(`${key}: password login → MFA step`, true);
  await page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  const secretEl = page.locator("code[dir=ltr]");
  await secretEl.waitFor();
  secrets[key] = (await secretEl.textContent()).trim();
  await page.locator("#code").fill(await freshTotp(secrets[key]));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
  const aal = await jwtAal(page);
  check(`${key}: TOTP enrolled in browser → /admin with aal2`, aal === "aal2", `aal=${aal}`);
  pages[key] = page;
  return page;
}
async function jwtAal(page) {
  const parts = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!parts.length) return null;
  let raw = parts.map((c) => c.value).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = JSON.parse(raw).access_token;
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).aal;
}
async function go(page, path) {
  const r = await page.goto(`${BASE}${path}`);
  await page.locator("main").first().waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  return r;
}
/**
 * Fills a form (by name), submits via its button (handles the confirm dialog) and returns the
 * inline result {ok, text}. The page must be freshly loaded (no previous message in this form).
 */
async function submit(form, fields, button, { confirm = false, timeout = 60_000 } = {}) {
  for (const [name, value] of Object.entries(fields)) {
    const el = form.locator(`[name="${name}"]`).first();
    const tag = await el.evaluate((n) => `${n.tagName}:${n.type ?? ""}`);
    if (tag.startsWith("SELECT")) await el.selectOption(String(value));
    else if (tag.endsWith(":checkbox")) await (value ? el.check() : el.uncheck());
    else await el.fill(String(value));
  }
  const handle = await form.elementHandle(); // pinned: the button label changes while pending
  await form.getByRole("button", { name: button, exact: true }).first().click();
  if (confirm) await handle.evaluate((f) => f.querySelector("dialog [data-testid=confirm-yes]").click());
  // Many forms are replaced after a successful refresh() (e.g. "publish" becomes "unpublish"),
  // so the inline message may never be visible: wait for the message OR the form node to go away.
  const end = Date.now() + timeout;
  await sleep(300);
  while (Date.now() < end) {
    const st = await handle.evaluate((f) => {
      const btn = f.querySelector("button[type=submit], button");
      const pending = [...f.querySelectorAll("button")].some((x) => x.textContent.includes("جارٍ") || x.textContent.includes("جارِ"));
      const m = f.querySelector("[data-testid=action-msg]");
      return { connected: f.isConnected, pending, msg: m ? { ok: m.getAttribute("data-ok"), text: m.textContent.trim() } : null, btn: !!btn };
    }).catch(() => ({ connected: false }));
    if (!st.connected) return { ok: null, text: "(form replaced after submit)" };
    if (st.msg && !st.pending) return { ok: st.msg.ok === null ? null : st.msg.ok === "1", text: st.msg.text };
    await sleep(250);
  }
  throw new Error(`no result for "${button}" within ${timeout} ms`);
}
const formWith = (page, sel) => page.locator("form").filter({ has: page.locator(sel) }).first();
const formBtn = (page, label, sel) => {
  let l = page.locator("form");
  if (sel) l = l.filter({ has: page.locator(sel) });
  return l.filter({ has: page.getByRole("button", { name: label, exact: true }) }).first();
};
async function forbidden(page, path) {
  await page.goto(`${BASE}${path}`);
  return page.getByTestId("forbidden").waitFor({ timeout: 30_000 }).then(() => true, () => false);
}
async function pngFile(name, color, w = 1200, h = 800) {
  return { name, mimeType: "image/png", buffer: await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer() };
}

// ------------------------------------------------------------------ owner snapshot (read only)
async function ownerSnapshot(excludeIds = []) {
  const { data, error } = await db.from("profiles").select("id, role, disabled, mfa_required, updated_at").eq("role", "owner");
  if (error) throw new Error(`owner snapshot: ${error.message}`);
  const owners = (data ?? []).filter((p) => !excludeIds.includes(p.id));
  const out = [];
  for (const o of owners) {
    const f = await db.auth.admin.mfa.listFactors({ userId: o.id });
    const u = await db.auth.admin.getUserById(o.id);
    out.push({
      id: o.id, role: o.role, disabled: o.disabled, mfa_required: o.mfa_required, profile_updated_at: o.updated_at,
      factors: (f.data?.factors ?? []).length, verified_factors: (f.data?.factors ?? []).filter((x) => x.status === "verified").length,
      auth_updated_at: u.data?.user?.updated_at ?? null,
    });
  }
  return out;
}

// ================================================================== flows
async function setup() {
  area = "setup";
  console.log(`\n[setup] run ${RUN} on ${new URL(URL_).host}`);
  F.ownerBefore = await ownerSnapshot();
  check("exactly one real owner found (snapshot taken, not touched)", F.ownerBefore.length === 1, `${F.ownerBefore.length} owner(s)`);
  // Second owner allowed? Schema: no unique/one-owner constraint; admin_set_user_role can grant 'owner';
  // the guard trigger only blocks API roles, so the service role may set it (same as staging-verify).
  await mkUser("admin", "admin");
  await mkUser("staff", "staff");
  await mkUser("owner", "owner");
  await mkUser("a");
  await mkUser("b");
  const cs = must(await db.from("customers").select("id, user_id").in("user_id", [created.users.a.id, created.users.b.id]), "customers A/B");
  F.custA = cs.find((c) => c.user_id === created.users.a.id).id;
  F.custB = cs.find((c) => c.user_id === created.users.b.id).id;
  const roles = must(await db.from("profiles").select("id, role").in("id", Object.values(created.users).map((u) => u.id)), "roles");
  const r = (k) => roles.find((x) => x.id === created.users[k].id)?.role;
  check("test users created with roles admin/staff/owner(temp)/customer×2", r("admin") === "admin" && r("staff") === "staff" && r("owner") === "owner" && r("a") === "customer" && r("b") === "customer");
  const owners = must(await db.from("profiles").select("id").eq("role", "owner"), "owners");
  check("schema allows a temporary second owner (service-role role set, no trigger/constraint weakened)", owners.length === 2, `${owners.length} owners now`);
}

async function loginAll() {
  for (const k of ["admin", "staff", "owner"]) await uiLoginStaffRole(k);
  const pa = await uiLogin("a", "/portal");
  await pa.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 60_000 });
  check("customer A: password login → /portal", true);
  pages.a = pa;
}

async function customersFlow() {
  const p = pages.admin;
  await go(p, "/admin/customers/new");
  const name = `${TAG} ui-customer`;
  const form = formWith(p, 'input[name="full_name"]');
  await form.locator('[name="full_name"]').fill(name);
  await form.locator('[name="phone"]').fill("0599000001");
  await form.locator('[name="email"]').fill(`staging-test-admin-${RUN}-ui@example.com`);
  await form.locator('[name="city"]').fill("Test City");
  await form.locator('[name="notes"]').fill(`${TAG} note at create`);
  await form.getByRole("button", { name: "حفظ العميل" }).click();
  await p.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  F.custUi = p.url().split("/").pop();
  created.customers.add(F.custUi);
  const row = await db.from("customers").select("full_name, city, user_id").eq("id", F.custUi).single();
  check("create customer via UI → row exists, no portal user", row.data?.full_name === name && row.data.user_id === null);

  await go(p, `/admin/customers?q=${encodeURIComponent(RUN)}`);
  const link = p.locator(`a[href="/admin/customers/${F.custUi}"]`);
  check("search by run id lists the customer", (await link.count()) === 1);
  await link.click();
  await p.waitForURL(new RegExp(`/admin/customers/${F.custUi}$`));
  await p.locator("main h1").first().waitFor();
  check("open customer detail from search", (await p.locator("main h1").first().textContent()).includes(RUN));

  const res = await submit(formWith(p, "#cust-notes"), { notes: `${TAG} internal note` }, "حفظ الملاحظات");
  const n = await db.from("customers").select("notes").eq("id", F.custUi).single();
  check("internal note saved (DB customers.notes)", res.ok && n.data?.notes === `${TAG} internal note`, res.text);
  // customer A must not see internal notes of own record
  const ca = await apiSignIn("a");
  const own = await ca.from("customers").select("notes").eq("id", F.custA);
  check("customer cannot read customers.notes column", !!own.error || own.data?.every((x) => x.notes == null), own.error?.code ?? "null");
  await ca.auth.signOut();
}

async function eventsFlow() {
  const p = pages.admin;
  const mk = async (cust, title) => {
    await go(p, `/admin/events/new?customer=${cust}`);
    const form = formWith(p, 'select[name="customer_id"]');
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="event_type"]').selectOption("wedding");
    await form.locator('[name="event_date"]').fill(D);
    await form.locator('[name="venue"]').fill("Test Hall");
    await form.locator('[name="city"]').fill("Test City");
    await form.getByRole("button", { name: "إنشاء المناسبة" }).click();
    await p.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const id = p.url().split("/").pop();
    created.events.add(id);
    return id;
  };
  F.E1 = await mk(F.custA, `${TAG} E1 wedding`);
  F.E2 = await mk(F.custB, `${TAG} E2 same-day`);
  const ev = await db.from("events").select("customer_id, event_date, title").in("id", [F.E1, F.E2]);
  check("create 2 events via UI (customers A and B, same date)", ev.data?.length === 2 && ev.data.every((e) => e.event_date === D));

  await go(p, `/admin/events/${F.E1}`);
  const res = await submit(p.getByTestId("event-form"), { city: "Edited City", venue: "Edited Hall", production_note: `${TAG} prod note`, status: "shooting" }, "حفظ التغييرات");
  const e1 = await db.from("events").select("city, venue, status").eq("id", F.E1).single();
  const notes = await db.from("events").select("production_note").eq("id", F.E1).maybeSingle(); // view is auth-scoped; read the column with the secret key
  check("edit event fields via UI → DB updated (city/venue/status/production note)",
    res.ok && e1.data?.city === "Edited City" && e1.data.venue === "Edited Hall" && e1.data.status === "shooting" && notes.data?.production_note === `${TAG} prod note`, `${res.text} ${JSON.stringify(e1.data)} note=${notes.data?.production_note === `${TAG} prod note`} ${notes.error?.message ?? ""}`);
  const an = await anon.from("events").select("id").eq("id", F.E1);
  check("anon cannot see unpublished event", !an.data?.length);
}

async function calendarFlow() {
  const p = pages.admin;
  await go(p, `/admin/calendar?month=${D.slice(0, 7)}`);
  const n = await p.locator(`a[href="/admin/events/${F.E1}"]`).count();
  check("calendar month view renders the test event", n >= 1, `${n} link(s)`);
}

async function bookingsFlow() {
  const p = pages.admin;
  const ins = await db.from("booking_requests").insert({
    contact_name: `${TAG} booking`, contact_phone: "0599000002", event_type: "engagement", event_date: D, city: "Test City",
    message: `${TAG} inquiry`, idempotency_key: `staging-test-admin-${RUN}-bk`,
  }).select("id, status").single();
  F.booking = must(ins, "insert booking").id;
  created.bookings.add(F.booking);
  check("inquiry row inserted with secret key (public form is Turnstile-gated)", ins.data.status === "new");

  await go(p, `/admin/bookings?q=${encodeURIComponent(RUN)}`);
  check("booking listed in admin with search", (await p.locator(`a[href="/admin/bookings/${F.booking}"]`).count()) === 1);
  await go(p, `/admin/bookings/${F.booking}`);
  const offered = await p.getByTestId("transition-to").locator("option").evaluateAll((o) => o.map((x) => x.value));
  check("only valid transitions offered from 'new'", JSON.stringify(offered.sort()) === JSON.stringify(["cancelled", "contacted", "declined"]), offered.join(","));
  const r1 = await submit(p.getByTestId("transition-form"), { to: "contacted", note: `${TAG} called` }, "نقل الطلب");
  const s1 = (await db.from("booking_requests").select("status").eq("id", F.booking).single()).data?.status;
  const h = await db.from("booking_stage_history").select("to_status").eq("booking_request_id", F.booking);
  check("valid transition new→contacted applied (+history row)", r1.ok && s1 === "contacted" && h.data?.some((x) => x.to_status === "contacted"), r1.text);

  await go(p, `/admin/bookings/${F.booking}`);
  await p.getByTestId("transition-to").evaluate((sel) => {
    const o = document.createElement("option"); o.value = "confirmed"; o.textContent = "forced"; sel.appendChild(o); sel.value = "confirmed";
  });
  const forcedVal = await p.getByTestId("transition-to").inputValue();
  const r2 = await submit(p.getByTestId("transition-form"), {}, "نقل الطلب");
  const s2 = (await db.from("booking_requests").select("status").eq("id", F.booking).single()).data?.status;
  check("forced invalid transition contacted→confirmed rejected (DB unchanged)", r2.ok === false && s2 === "contacted", `${r2.text} db=${s2} forced=${forcedVal}`);

  await go(p, `/admin/bookings/${F.booking}`);
  const conv = formWith(p, 'input[name="title"]');
  await conv.locator('[name="title"]').fill(`${TAG} converted event`);
  await conv.getByRole("button", { name: "إنشاء العميل والمناسبة" }).click();
  await p.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  F.Econv = p.url().split("/").pop();
  created.events.add(F.Econv);
  const ce = await db.from("events").select("customer_id, booking_request_id, event_date").eq("id", F.Econv).single();
  if (ce.data?.customer_id) created.customers.add(ce.data.customer_id);
  const bk = await db.from("booking_requests").select("customer_id").eq("id", F.booking).single();
  const cc = await db.from("customers").select("full_name").eq("id", ce.data?.customer_id ?? randomUUID()).maybeSingle();
  check("convert booking → new customer + event linked to booking",
    ce.data?.booking_request_id === F.booking && bk.data?.customer_id === ce.data.customer_id && cc.data?.full_name === `${TAG} booking` && ce.data.event_date === D);
}

async function staffEquipmentFlow() {
  const p = pages.admin;
  // staff member linked to the staff login
  await go(p, "/admin/staff");
  const addForm = p.locator("form").filter({ has: p.getByRole("button", { name: "إضافة", exact: true }) }).first();
  const r = await submit(addForm, { full_name: `${TAG} staff member`, specialty: "Photographer", phone: "0599000003", profile_id: created.users.staff.id }, "إضافة");
  const sm = await db.from("staff_members").select("id, profile_id, active").eq("full_name", `${TAG} staff member`);
  if (sm.data?.[0]) { F.staffMember = sm.data[0].id; created.staff.add(F.staffMember); }
  check("create staff member via UI linked to staff login", r.ok && sm.data?.length === 1 && sm.data[0].profile_id === created.users.staff.id && sm.data[0].active, r.text);

  // equipment item + maintenance
  await go(p, "/admin/equipment");
  const eqForm = p.locator("form").filter({ has: p.getByRole("button", { name: "إضافة", exact: true }) }).first();
  const r2 = await submit(eqForm, { name: `${TAG} camera`, serial: `SN-${RUN}` }, "إضافة");
  const eq = await db.from("equipment").select("id, status").eq("name", `${TAG} camera`);
  if (eq.data?.[0]) { F.equipment = eq.data[0].id; created.equipment.add(F.equipment); }
  check("create equipment item via UI", r2.ok && eq.data?.length === 1 && eq.data[0].status === "available", r2.text);

  // staff assignment (+ same-day conflict)
  await go(p, `/admin/events/${F.E1}`);
  const a1 = await submit(p.getByTestId("assign-staff"), { staff_id: F.staffMember, role_label: "Photographer" }, "تكليف");
  check("assign staff to E1", a1.ok, a1.text);
  await go(p, `/admin/events/${F.E2}`);
  const a2 = await submit(p.getByTestId("assign-staff"), { staff_id: F.staffMember }, "تكليف");
  const asg = await db.from("event_staff_assignments").select("event_id").eq("staff_id", F.staffMember);
  check("same-day staff conflict on E2 rejected with conflict message", a2.ok === false && a2.text.includes("تعارض") && asg.data?.length === 1 && asg.data[0].event_id === F.E1, a2.text);

  // equipment assignment (+ overlap)
  await go(p, `/admin/events/${F.E1}`);
  const q1 = await submit(formWith(p, 'select[name="equipment_id"]'), { equipment_id: F.equipment }, "تسليم معدّة");
  const st1 = (await db.from("equipment").select("status").eq("id", F.equipment).single()).data?.status;
  check("assign equipment to E1 (status → assigned)", q1.ok && st1 === "assigned", `${q1.text} status=${st1}`);
  await go(p, `/admin/events/${F.E2}`);
  const q2 = await submit(formWith(p, 'select[name="equipment_id"]'), { equipment_id: F.equipment }, "تسليم معدّة");
  const ea = await db.from("equipment_assignments").select("event_id").eq("equipment_id", F.equipment);
  check("overlapping equipment assignment on E2 rejected with overlap message", q2.ok === false && q2.text.includes("تعارض") && ea.data?.length === 1, q2.text);

  // maintenance
  await go(p, "/admin/equipment");
  const mform = formWith(p, `input[name="equipment_id"][value="${F.equipment}"]`);
  await mform.evaluate((f) => { const d = f.closest("details"); if (d) d.open = true; });
  const m1 = await submit(mform, { description: `${TAG} sensor clean`, cost: "120" }, "تسجيل صيانة");
  const mt = await db.from("equipment_maintenance").select("id, cost, finished_at").eq("equipment_id", F.equipment);
  const st2 = (await db.from("equipment").select("status").eq("id", F.equipment).single()).data?.status;
  check("record maintenance via UI (row + status maintenance, cost in minor units)", m1.ok && mt.data?.length === 1 && mt.data[0].cost === 12000 && st2 === "maintenance", `${m1.text} cost=${mt.data?.[0]?.cost} status=${st2}`);
  await go(p, "/admin/equipment");
  const fform = formWith(p, `input[name="id"][value="${mt.data?.[0]?.id}"]`);
  await fform.evaluate((f) => { const d = f.closest("details"); if (d) d.open = true; });
  const m2 = await submit(fform, {}, "انتهت");
  const mt2 = await db.from("equipment_maintenance").select("finished_at").eq("equipment_id", F.equipment).single();
  check("finish maintenance via UI", m2.ok !== false && !!mt2.data?.finished_at, m2.text);
}

async function mediaFlow() {
  const p = pages.admin;
  await go(p, `/admin/events/${F.E1}/media`);
  const files = [await pngFile(`st-${RUN}-1.png`, "#e9b949"), await pngFile(`st-${RUN}-2.png`, "#3f7a4f")];
  await p.getByTestId("upload-input").setInputFiles(files);
  await p.getByTestId("upload-start").click();
  await p.getByTestId("upload-summary").filter({ hasText: "اكتمل 2 من 2." }).waitFor({ timeout: 180_000 });
  const rows = must(await db.from("media_assets").select("id, path, variants, upload_status, bucket, width").eq("event_id", F.E1), "media rows");
  let variantsOk = rows.length === 2;
  for (const a of rows) {
    const v = a.variants ?? {};
    if (a.bucket !== "private-media" || a.upload_status !== "ready" || !/thumb\.webp$/.test(v.thumb ?? "") || !/display\.webp$/.test(v.display ?? "")) variantsOk = false;
    for (const path of [a.path, v.thumb, v.display]) if (path && (await db.storage.from("private-media").exists(path)).data !== true) variantsOk = false;
  }
  check("upload 2 images via admin UI → rows ready + thumb/display variants in private-media", variantsOk, `${rows.length} rows`);
  F.media = rows.map((r) => r.id);

  // publishing blocked without consent
  await go(p, `/admin/events/${F.E1}`);
  const ef = p.getByTestId("event-form");
  await ef.getByText("صفحة العمل العامة والظهور في البحث").click();
  const slug = `staging-test-admin-${RUN}`;
  const s = await submit(ef, { public_slug: slug }, "حفظ التغييرات");
  check("save public slug", s.ok, s.text);
  await go(p, `/admin/events/${F.E1}`);
  const blocked = await p.getByTestId("publish-blocked").isVisible();
  const btn = p.getByTestId("publish-form").getByRole("button", { name: "نشر في صفحة الأعمال" });
  const disabled = await btn.isDisabled();
  await btn.evaluate((b) => b.removeAttribute("disabled"));
  await btn.click();
  const msg = p.getByTestId("publish-form").getByTestId("action-msg");
  await msg.waitFor();
  const pubAfter = (await db.from("events").select("is_published").eq("id", F.E1).single()).data?.is_published;
  check("publish blocked without consent (notice + disabled + forced submit refused)", blocked && disabled && (await msg.getAttribute("data-ok")) === "0" && pubAfter === false, (await msg.textContent()).trim());
  await go(p, `/admin/events/${F.E1}/media`);
  check("media 'publish' button disabled while event not publishable", await p.getByTestId("media-item").first().getByRole("button", { name: "نشر في الأعمال" }).isDisabled());

  // customer consent (as customer A, API) then admin publishes the event
  const ca = await apiSignIn("a");
  const cons = await ca.rpc("set_publication_consent", { p_event_id: F.E1, p_status: "granted" });
  check("customer A grants publication consent", !cons.error, cons.error?.message);
  await ca.auth.signOut();
  await go(p, `/admin/events/${F.E1}`);
  const pub = await submit(p.getByTestId("publish-form"), {}, "نشر في صفحة الأعمال");
  const ev = (await db.from("events").select("is_published, publication_consent").eq("id", F.E1).single()).data;
  check("admin publishes event after consent", pub.ok && ev?.is_published && ev.publication_consent === "granted", pub.text);

  // publish one image
  await go(p, `/admin/events/${F.E1}/media`);
  const item = p.getByTestId("media-item").first();
  const pm = await submit(item.locator("form").filter({ has: p.getByRole("button", { name: "نشر في الأعمال" }) }), {}, "نشر في الأعمال");
  const pubRows = must(await db.from("media_assets").select("id, path, variants").eq("event_id", F.E1).eq("bucket", "public-media"), "public rows");
  const exists = pubRows[0] ? (await db.storage.from("public-media").exists(pubRows[0].path)).data : false;
  check("publish one image → public-media copy + public row", pm.ok !== false && pubRows.length === 1 && exists === true, pm.text);
  const mUrl = pubRows[0] ? `${BASE}/m/${pubRows[0].id}/display` : `${BASE}/m/${randomUUID()}/display`;
  const r200 = await fetch(mUrl);
  check("/m/<id>/display serves the published image (200)", r200.status === 200 && (r200.headers.get("content-type") ?? "").includes("image"), String(r200.status));

  // unpublish → 404 + copy removed
  await go(p, `/admin/events/${F.E1}/media`);
  const un = await submit(p.locator("form").filter({ has: p.getByRole("button", { name: "إلغاء النشر" }) }).first(), {}, "إلغاء النشر");
  const r404 = await fetch(mUrl);
  const goneObj = pubRows[0] ? await poll(async () => (await db.storage.from("public-media").exists(pubRows[0].path)).data === false, 60_000) : false;
  const left = await db.from("media_assets").select("id").eq("event_id", F.E1).eq("bucket", "public-media");
  check("unpublish image → /m 404 + public row and object removed", un.ok !== false && r404.status === 404 && goneObj && left.data?.length === 0, `${un.text} status=${r404.status} cache=${r404.headers.get("cache-control")}`);
}

async function quotesContractsFlow() {
  const p = pages.admin;
  await go(p, `/admin/quotes/new?event=${F.E1}`);
  const qf = formWith(p, 'select[name="customer_id"]');
  await qf.locator('[name="customer_id"]').selectOption(F.custA);
  await qf.locator('[name="event_id"]').selectOption(F.E1);
  await qf.getByRole("button", { name: "إنشاء المسودة" }).click();
  await p.waitForURL(/\/admin\/quotes\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  F.quote = p.url().split("/").pop();
  created.quotes.add(F.quote);
  check("create quote draft via UI", true);
  const i1 = await submit(p.getByTestId("add-item"), { description: `${TAG} coverage`, qty: "2", unit_price: "1,500.00" }, "إضافة بند");
  await go(p, `/admin/quotes/${F.quote}`);
  const i2 = await submit(p.getByTestId("add-item"), { description: `${TAG} album`, qty: "1", unit_price: "250.50" }, "إضافة بند");
  await go(p, `/admin/quotes/${F.quote}`);
  const dsc = await submit(formWith(p, 'input[name="discount"]'), { discount: "50" }, "حفظ");
  const q = (await db.from("quotes").select("subtotal, discount, total, status").eq("id", F.quote).single()).data;
  const items = (await db.from("quote_items").select("line_total").eq("quote_id", F.quote)).data ?? [];
  check("quote items + discount → totals computed by backend (325050 − 5000 = 320050 minor)",
    i1.ok && i2.ok && dsc.ok && q?.subtotal === 325050 && q.discount === 5000 && q.total === 320050 && items.map((x) => x.line_total).sort((a, b) => a - b).join() === "25050,300000",
    JSON.stringify(q));
  await go(p, `/admin/quotes/${F.quote}`);
  const send = await submit(formWith(p, 'input[name="to"][value="sent"]'), {}, "إرسال للعميل", { confirm: true });
  const qs = (await db.from("quotes").select("status").eq("id", F.quote).single()).data?.status;
  check("send quote → status sent", send.ok !== false && qs === "sent", send.text);
  const ca = await apiSignIn("a");
  const vis = await ca.from("quotes").select("total").eq("id", F.quote);
  check("customer A sees sent quote with backend total", vis.data?.[0]?.total === 320050);
  const tamper = await ca.from("quotes").update({ discount: 0 }).eq("id", F.quote).select("id");
  check("customer cannot alter quote amounts", !!tamper.error || !tamper.data?.length);

  // contract from quote (v1), new version v2, send
  await go(p, `/admin/quotes/${F.quote}`);
  const cf = p.getByTestId("contract-from-quote");
  await cf.locator('[name="body"]').fill(`${TAG} contract v1 body`);
  await cf.locator('[name="deposit"]').fill("500");
  await cf.getByRole("button", { name: "إنشاء عقد من هذا العرض" }).click();
  await p.waitForURL(/\/admin\/contracts\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  F.contract = p.url().split("/").pop();
  created.contracts.add(F.contract);
  const v1 = (await db.from("contract_versions").select("id, version_no, total, deposit_required, content_hash").eq("contract_id", F.contract)).data ?? [];
  check("create contract from quote → v1 total = quote total", v1.length === 1 && v1[0].total === 320050 && v1[0].deposit_required === 50000);
  const s1 = await submit(formBtn(p, "إرسال النسخة 1 للعميل"), {}, "إرسال النسخة 1 للعميل", { confirm: true });
  check("send contract v1", s1.ok !== false && (await db.from("contracts").select("status").eq("id", F.contract).single()).data?.status === "sent", s1.text);
  await go(p, `/admin/contracts/${F.contract}`);
  const nv = await submit(formWith(p, 'textarea[name="body"]'), { body: `${TAG} contract v2 body — changed terms`, total: "3,300.00", deposit: "600" }, "حفظ كنسخة جديدة");
  const k1 = (await db.from("contracts").select("status, current_version_id").eq("id", F.contract).single()).data;
  const vs = (await db.from("contract_versions").select("id, version_no, total, content_hash").eq("contract_id", F.contract).order("version_no")).data ?? [];
  check("new version v2 becomes current and withdraws contract to draft", nv.ok && vs.length === 2 && k1?.status === "draft" && k1.current_version_id === vs[1].id && vs[1].total === 330000, nv.text);
  const early = await ca.rpc("customer_approve_contract", { p_version_id: vs[1].id, p_content_hash: vs[1].content_hash });
  check("customer cannot approve while contract is draft", !!early.error, early.error?.code);
  await go(p, `/admin/contracts/${F.contract}`);
  const s2 = await submit(formBtn(p, "إرسال النسخة 2 للعميل"), {}, "إرسال النسخة 2 للعميل", { confirm: true });
  check("send contract v2", s2.ok !== false && (await db.from("contracts").select("status").eq("id", F.contract).single()).data?.status === "sent", s2.text);
  const old = await ca.rpc("customer_approve_contract", { p_version_id: vs[0].id, p_content_hash: vs[0].content_hash });
  check("approval of old version v1 (own valid hash) rejected", !!old.error, old.error?.code);
  const tam = await ca.rpc("customer_approve_contract", { p_version_id: vs[1].id, p_content_hash: vs[0].content_hash });
  check("approval of v2 with tampered/mismatched hash rejected", !!tam.error, tam.error?.code);
  const imm = await db.from("contract_versions").update({ body: "tampered" }).eq("id", vs[1].id).select("id");
  check("contract versions immutable even for service role", !!imm.error, imm.error?.code);
  await ca.auth.signOut();

  // customer approves exact current version in portal UI
  const pa = pages.a;
  await go(pa, `/portal/events/${F.E1}/contracts`);
  await pa.getByRole("button", { name: "اعتماد العقد" }).click();
  await pa.getByRole("button", { name: "تأكيد", exact: true }).click();
  await pa.getByText("تم اعتماد العقد. شكراً لك!").waitFor({ timeout: 60_000 });
  const k2 = (await db.from("contracts").select("status, approved_version_id").eq("id", F.contract).single()).data;
  check("customer approves exact current version (v2) in portal", k2?.status === "approved" && k2.approved_version_id === vs[1].id);
  await go(p, `/admin/contracts/${F.contract}`);
  check("admin contract page shows approved version 2", (await p.getByTestId("approved-version").textContent()).includes("النسخة 2"));
  residue.push({ table: "contracts", id: F.contract, why: "contract_versions are append-only (DELETE blocked by trigger) and contract_versions.contract_id is ON DELETE RESTRICT" });
  for (const v of vs) residue.push({ table: "contract_versions", id: v.id, why: "append-only by design" });
}

async function financeFlow() {
  const p = pages.owner;
  const fin = async () => {
    const ca = await apiSignIn("a");
    const r = await ca.rpc("event_financials", { p_event_id: F.E1 });
    await ca.auth.signOut();
    return r.data?.[0];
  };
  await go(p, "/admin/finance");
  const form = p.getByTestId("payment-form");
  await form.waitFor();
  await p.waitForFunction(() => document.querySelector("[data-testid=idem-key]")?.value);
  const key = await p.getByTestId("idem-key").inputValue();
  const fill = async (amount, kind, ref) => {
    await form.locator('select[name="customer_id"]').selectOption(F.custA);
    await form.locator('select[name="event_id"]').selectOption(F.E1);
    await form.locator('input[name="amount"]').fill(amount);
    await form.locator('select[name="kind"]').selectOption(kind);
    await form.locator('input[name="reference"]').fill(ref);
  };
  await fill("1,000.00", "payment", `${TAG} pay`);
  await form.getByRole("button", { name: "تسجيل" }).click();
  await form.getByTestId("action-msg").filter({ hasText: "سُجّلت الدفعة." }).waitFor();
  await fill("1,000.00", "payment", `${TAG} pay`);
  await p.getByTestId("idem-key").evaluate((el, k) => (el.value = k), key);
  await form.getByRole("button", { name: "تسجيل" }).click();
  await form.getByTestId("action-msg").filter({ hasText: "مسجّلة مسبقاً" }).waitFor();
  const rows = (await db.from("payments").select("id, amount, kind").eq("idempotency_key", key)).data ?? [];
  rows.forEach((r) => created.payments.add(r.id));
  check("owner records payment twice with same idempotency key → exactly one row (100000 minor)", rows.length === 1 && rows[0].amount === 100000, `${rows.length} row(s)`);

  await go(p, "/admin/finance");
  await p.waitForFunction(() => document.querySelector("[data-testid=idem-key]")?.value);
  const f2 = p.getByTestId("payment-form");
  await f2.locator('select[name="customer_id"]').selectOption(F.custA);
  await f2.locator('select[name="event_id"]').selectOption(F.E1);
  await f2.locator('input[name="amount"]').fill("200");
  await f2.locator('select[name="kind"]').selectOption("refund");
  await f2.locator('input[name="reference"]').fill(`${TAG} refund`);
  await f2.getByRole("button", { name: "تسجيل" }).click();
  await f2.getByTestId("action-msg").filter({ hasText: "سُجّل الاسترداد." }).waitFor();
  const all = (await db.from("payments").select("id, amount, kind").eq("event_id", F.E1)).data ?? [];
  all.forEach((r) => created.payments.add(r.id));
  check("owner records refund", all.some((x) => x.kind === "refund" && x.amount === 20000));
  const paid = all.filter((x) => x.kind === "payment").reduce((s, x) => s + x.amount, 0);
  const refunded = all.filter((x) => x.kind === "refund").reduce((s, x) => s + x.amount, 0);
  const f = await fin();
  check("event_financials paid/refunded equal payment rows; contracted = approved contract v2", f?.paid === paid && f.refunded === refunded && paid === 100000 && refunded === 20000 && f.contracted === 330000,
    JSON.stringify({ paid: f?.paid, refunded: f?.refunded, contracted: f?.contracted, balance: f?.balance, basis: f?.balance_basis }));
  check("event_financials balance = contracted − paid + refunded", f?.balance === f?.contracted - f?.paid + f?.refunded, `balance=${f?.balance}`);

  // admin read-only, staff forbidden
  const pa = pages.admin;
  await go(pa, "/admin/finance");
  await pa.getByTestId("fin-summary").waitFor().catch(() => {});
  check("admin sees finance read-only (no payment form)", (await pa.getByTestId("payment-form").count()) === 0 && (await pa.getByText("عرض فقط. التسجيل والتعديل للمالك.").count()) === 1);
  const adm = await apiAal2("admin");
  const ar = await adm.rpc("record_payment", { p_customer_id: F.custA, p_amount: 100, p_method: "cash", p_idempotency_key: `staging-test-admin-${RUN}-admin-try`, p_kind: "payment" });
  if (!ar.error && ar.data) created.payments.add(ar.data);
  check("admin (aal2) cannot record payments via API", !!ar.error, ar.error?.code);
  const ad = await adm.from("payments").insert({ customer_id: F.custA, amount: 1, method: "x", idempotency_key: `staging-test-admin-${RUN}-x` }).select("id");
  if (ad.data?.[0]) created.payments.add(ad.data[0].id);
  check("admin (aal2) cannot insert payments directly", !!ad.error);
  await adm.auth.signOut();
}

async function ownerOnlyFlow() {
  const p = pages.owner;
  // users: disable + re-enable test customer B
  await go(p, `/admin/users?q=${encodeURIComponent(RUN)}`);
  const row = () => p.locator("tr").filter({ hasText: `${TAG} b` }).first();
  const d1 = await submit(row().locator("form").filter({ has: p.locator('input[name="disabled"]') }), {}, "تعطيل", { confirm: true });
  const dis = (await db.from("profiles").select("disabled").eq("id", created.users.b.id).single()).data?.disabled;
  check("owner disables a test user via /admin/users", d1.ok && dis === true, d1.text);
  await go(p, `/admin/users?q=${encodeURIComponent(RUN)}`);
  const d2 = await submit(row().locator("form").filter({ has: p.locator('input[name="disabled"]') }), {}, "إعادة تفعيل");
  const dis2 = (await db.from("profiles").select("disabled").eq("id", created.users.b.id).single()).data?.disabled;
  check("owner re-enables the test user", d2.ok && dis2 === false, d2.text);
  const r = await go(p, "/admin/settings");
  check("owner opens /admin/settings (no save performed: global config)", r.status() < 400 && (await p.getByTestId("forbidden").count()) === 0);
  // admin is denied owner-only pages
  for (const u of ["/admin/users", "/admin/backups"]) check(`admin forbidden on ${u}`, await forbidden(pages.admin, u));
  // backups: run once, then remove its objects + run row
  await go(p, "/admin/backups");
  const startedAt = new Date().toISOString();
  const b = await submit(p.getByTestId("backup-form"), {}, "بدء النسخ الآن", { timeout: 240_000 });
  const run = (await db.from("backup_runs").select("id, status, location").gte("started_at", startedAt).order("started_at", { ascending: false }).limit(1)).data?.[0];
  if (run) created.backupRuns.add(run.id);
  check("owner backup run completes", b.ok && run?.status === "completed", `${b.text} status=${run?.status}`);
}

async function supportReviewsFlow() {
  const p = pages.admin;
  const sr = must(await db.from("support_requests").insert({ subject: `${TAG} support subject`, contact_name: `${TAG} support`, contact_phone: "0599000004", idempotency_key: `staging-test-admin-${RUN}-sr` }).select("id").single(), "support insert");
  F.support = sr.id;
  created.support.add(F.support);
  must(await db.from("support_messages").insert({ request_id: F.support, body: `${TAG} help please` }), "support msg");
  await go(p, `/admin/support/${F.support}`);
  const rr = await submit(formWith(p, 'textarea[name="body"]'), { body: `${TAG} admin reply`, then_status: "pending" }, "إرسال الرد");
  const msgs = (await db.from("support_messages").select("body, is_staff_reply, author_id").eq("request_id", F.support)).data ?? [];
  const st = (await db.from("support_requests").select("status").eq("id", F.support).single()).data?.status;
  check("support: admin reply saved as staff reply by admin + status updated", rr.ok && msgs.some((m) => m.is_staff_reply && m.author_id === created.users.admin.id && m.body === `${TAG} admin reply`) && st === "pending", `${rr.text} status=${st}`);

  const rv = must(await db.from("reviews").insert({ customer_id: F.custA, event_id: F.E1, display_name: `${TAG} reviewer`, rating: 5, body: `${TAG} review body`, status: "pending" }).select("id").single(), "review insert");
  F.review = rv.id;
  created.reviews.add(F.review);
  check("pending review not visible publicly (anon)", !(await anon.from("reviews").select("id").eq("id", F.review)).data?.length);
  await go(p, "/admin/reviews?status=pending");
  const ap = await submit(formBtn(p, "نشر", `input[name="ids"][value="${F.review}"]`), {}, "نشر");
  const s1 = (await db.from("reviews").select("status, moderated_by").eq("id", F.review).single()).data;
  const vis = (await anon.from("reviews").select("id").eq("id", F.review)).data?.length === 1;
  check("approve review via admin → visible publicly (anon RLS)", ap.ok !== false && s1?.status === "approved" && vis, ap.text);
  await go(p, "/admin/reviews?status=approved");
  const rj = await submit(formBtn(p, "رفض", `input[name="ids"][value="${F.review}"]`), {}, "رفض");
  const hid = !(await anon.from("reviews").select("id").eq("id", F.review)).data?.length;
  check("reject review → hidden from public again", rj.ok !== false && hid, rj.text);
}

async function albumFlow() {
  // dedicated event for the album (its snapshot is immutable and blocks event deletion)
  const ev = must(await db.from("events").insert({ customer_id: F.custA, title: `${TAG} album event (residue)`, event_type: "wedding", event_date: D }).select("id").single(), "album event");
  F.Ealb = ev.id;
  created.events.add(F.Ealb);
  const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#777" } }).webp().toBuffer();
  F.albMedia = [];
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    const base = `events/${F.Ealb}/${id}`;
    for (const v of ["original", "thumb", "display"]) must(await db.storage.from("private-media").upload(`${base}/${v}.webp`, img, { contentType: "image/webp", upsert: true }), "upload");
    must(await db.from("media_assets").insert({ id, event_id: F.Ealb, bucket: "private-media", path: `${base}/original.webp`, kind: "image", mime: "image/webp", bytes: img.length, width: 640, height: 480, visibility: "private", upload_status: "ready", variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` } }), "media row");
    F.albMedia.push(id);
  }
  const pa = pages.a;
  await go(pa, `/portal/events/${F.Ealb}/selection`);
  const toggles = pa.getByTestId("select-toggle");
  await toggles.first().waitFor();
  for (let i = 0; i < 2; i++) {
    await toggles.nth(i).click();
    await pa.getByTestId("selection-count").filter({ hasText: String(i + 1) }).first().waitFor();
  }
  await pa.waitForFunction(() => !document.querySelector("[data-save-state=saving]"));
  await pa.getByRole("button", { name: "مراجعة وإرسال" }).click();
  await pa.getByRole("button", { name: "إرسال الاختيار" }).click();
  await pa.getByRole("button", { name: "تأكيد الإرسال" }).click();
  await pa.getByTestId("snapshot-status").waitFor({ timeout: 60_000 });
  const snap = (await db.from("album_selection_snapshots").select("id, item_count, selection_id").eq("event_id", F.Ealb)).data ?? [];
  check("customer submits album selection in portal → snapshot with 2 items", snap.length === 1 && snap[0].item_count === 2);
  F.snapshot = snap[0]?.id;
  const p = pages.admin;
  await go(p, "/admin/production/albums");
  const link = p.locator(`a[href="/admin/production/albums/${F.snapshot}"]`);
  check("admin album list shows the submission", (await link.count()) === 1);
  await go(p, `/admin/production/albums/${F.snapshot}`);
  const lead = await p.locator("main").first().textContent();
  check("admin sees snapshot detail (2 photos)", lead.includes("2 صورة") && (await p.locator("main ul li").count()) >= 2);
  residue.push({ table: "events", id: F.Ealb, why: "album_selection_snapshots are append-only and cascade from events (event DELETE blocked)" });
  residue.push({ table: "album_selections", id: snap[0]?.selection_id, why: "parent of immutable snapshot" });
  residue.push({ table: "album_selection_snapshots", id: F.snapshot, why: "append-only by design" });
}

async function staffFlow() {
  const p = pages.staff;
  await go(p, "/admin/events");
  const s1 = await p.locator(`a[href="/admin/events/${F.E1}"]`).count();
  const s2 = await p.locator(`a[href="/admin/events/${F.E2}"]`).count() + await p.locator(`a[href="/admin/events/${F.Econv}"]`).count();
  check("staff events list shows only the assigned event", s1 === 1 && s2 === 0, `assigned=${s1} others=${s2}`);
  const sapi = await apiAal2("staff");
  const ids = ((await sapi.from("events").select("id")).data ?? []).map((e) => e.id);
  check("staff aal2 API: assigned event visible, other test events not", ids.includes(F.E1) && ![F.E2, F.Econv, F.Ealb].some((x) => ids.includes(x)), `${ids.length} visible`);
  const fin = await sapi.rpc("admin_financial_summary", { p_from: "2000-01-01", p_to: "2100-01-01" });
  check("staff API: financial summary refused", !!fin.error, fin.error?.code);
  await sapi.auth.signOut();
  const r = await go(p, `/admin/events/${F.E1}`);
  check("staff opens assigned event detail (read-only, no edit form)", r.status() < 400 && (await p.getByTestId("event-form").count()) === 0 && (await p.getByTestId("forbidden").count()) === 0);
  const r2 = await p.goto(`${BASE}/admin/events/${F.E2}`);
  const hidden = r2.status() === 404 || (await p.getByTestId("forbidden").count()) > 0 || (await p.getByText(`${TAG} E2`).count()) === 0;
  check("staff cannot open an unassigned event by URL", hidden, `HTTP ${r2.status()}`);
  for (const u of ["/admin/finance", "/admin/users", "/admin/customers", "/admin/bookings", "/admin/quotes", "/admin/backups"]) check(`staff forbidden on ${u}`, await forbidden(p, u));
}

// ------------------------------------------------------------------ cleanup
async function listAll(bucket, prefix) {
  const out = [];
  const walk = async (pre) => {
    const { data, error } = await db.storage.from(bucket).list(pre, { limit: 1000 });
    if (error || !data) return;
    for (const o of data) {
      const full = `${pre}/${o.name}`;
      if (o.id === null) await walk(full); else out.push(full);
    }
  };
  await walk(prefix);
  return out;
}
async function cleanup() {
  area = "cleanup";
  console.log("\n[cleanup]");
  const errs = [];
  const step = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) errs.push(`${what}: ${r.error.code ?? ""} ${r.error.message}`.slice(0, 200));
      return r;
    } catch (e) {
      errs.push(`${what}: ${e.message}`.slice(0, 200));
    }
  };
  for (const pg of Object.values(pages)) await step("close context", async () => { await pg.context().close(); });
  if (browser) await step("close browser", async () => { await browser.close(); });

  const evIds = [...created.events];
  // Discover anything else attached to test customers/events
  const cust = [...created.customers];
  if (cust.length) {
    const more = await db.from("events").select("id").in("customer_id", cust);
    (more.data ?? []).forEach((e) => created.events.add(e.id));
    const pays = await db.from("payments").select("id").in("customer_id", cust);
    (pays.data ?? []).forEach((x) => created.payments.add(x.id));
    const qs = await db.from("quotes").select("id").in("customer_id", cust);
    (qs.data ?? []).forEach((x) => created.quotes.add(x.id));
    const rvs = await db.from("reviews").select("id").in("customer_id", cust);
    (rvs.data ?? []).forEach((x) => created.reviews.add(x.id));
  }
  for (const id of created.events) if (!evIds.includes(id)) evIds.push(id);
  // Anything tagged with this run that was created through the UI but not captured (e.g. after a failure)
  for (const [t, col, set] of [["staff_members", "full_name", created.staff], ["equipment", "name", created.equipment], ["booking_requests", "contact_name", created.bookings],
    ["support_requests", "subject", created.support], ["reviews", "body", created.reviews], ["payments", "reference", created.payments]]) {
    const r = await db.from(t).select("id").like(col, `%${RUN}%`);
    (r.data ?? []).forEach((x) => set.add(x.id));
  }
  {
    const r = await db.from("events").select("id").like("title", `%${RUN}%`);
    (r.data ?? []).forEach((x) => { if (!evIds.includes(x.id)) evIds.push(x.id); });
    const c = await db.from("customers").select("id").like("full_name", `%${RUN}%`);
    (c.data ?? []).forEach((x) => created.customers.add(x.id));
  }

  // storage objects of test events in all buckets, then backups of the test run
  for (const bucket of ["private-media", "public-media"]) {
    for (const e of evIds) {
      const paths = await listAll(bucket, `events/${e}`);
      for (let i = 0; i < paths.length; i += 100) await step(`remove ${bucket}`, () => db.storage.from(bucket).remove(paths.slice(i, i + 100)));
    }
  }
  for (const id of created.backupRuns) {
    const paths = await listAll("backups", id);
    for (let i = 0; i < paths.length; i += 100) await step("remove backups", () => db.storage.from("backups").remove(paths.slice(i, i + 100)));
    await step("backup_runs", () => db.from("backup_runs").delete().eq("id", id));
  }
  if (created.payments.size) await step("payments", () => db.from("payments").delete().in("id", [...created.payments]));
  if (created.reviews.size) await step("reviews", () => db.from("reviews").delete().in("id", [...created.reviews]));
  if (created.support.size) await step("support", () => db.from("support_requests").delete().in("id", [...created.support]));
  if (evIds.length) await step("media rows", () => db.from("media_assets").delete().in("event_id", evIds));
  if (created.quotes.size) await step("quotes", () => db.from("quotes").delete().in("id", [...created.quotes]));
  // events one by one so the immutable album event does not block the others
  for (const e of evIds) {
    const r = await db.from("events").delete().eq("id", e);
    if (r.error && e !== F.Ealb) errs.push(`event: ${r.error.code} ${r.error.message}`.slice(0, 200));
  }
  if (created.bookings.size) await step("bookings", () => db.from("booking_requests").delete().in("id", [...created.bookings]));
  if (created.equipment.size) await step("equipment", () => db.from("equipment").delete().in("id", [...created.equipment]));
  if (created.staff.size) await step("staff", () => db.from("staff_members").delete().in("id", [...created.staff]));
  for (const c of created.customers) {
    const r = await db.from("customers").delete().eq("id", c);
    if (r.error && c !== F.custA) errs.push(`customer: ${r.error.code} ${r.error.message}`.slice(0, 200));
  }
  for (const [k, u] of Object.entries(created.users)) await step(`user ${k}`, () => db.auth.admin.deleteUser(u.id));

  // Residue: what is still there by design
  const stillCustA = (await db.from("customers").select("id").eq("id", F.custA ?? randomUUID())).data?.length;
  if (stillCustA) residue.push({ table: "customers", id: F.custA, why: "contracts.customer_id and events.customer_id are ON DELETE RESTRICT (immutable contract + album event)" });
  const stillAlb = F.Ealb ? (await db.from("events").select("id").eq("id", F.Ealb)).data?.length : 0;
  const allowed = new Set(residue.map((r) => r.id));

  // Leftover verification
  const left = {};
  const tagged = async (t, col) => ((await db.from(t).select("id").like(col, `%${RUN}%`)).data ?? []).filter((r) => !allowed.has(r.id)).length;
  left.customers = await tagged("customers", "full_name");
  left.events = await tagged("events", "title");
  left.staff_members = await tagged("staff_members", "full_name");
  left.equipment = await tagged("equipment", "name");
  left.booking_requests = await tagged("booking_requests", "contact_name");
  left.support_requests = await tagged("support_requests", "subject");
  left.reviews = await tagged("reviews", "body");
  left.payments = await tagged("payments", "reference");
  left.quotes = created.quotes.size ? (await db.from("quotes").select("id").in("id", [...created.quotes])).data?.length ?? 0 : 0;
  left.media_assets = evIds.length ? (await db.from("media_assets").select("id").in("event_id", evIds)).data?.length ?? 0 : 0;
  left.backup_runs = created.backupRuns.size ? (await db.from("backup_runs").select("id").in("id", [...created.backupRuns])).data?.length ?? 0 : 0;
  let users = 0;
  for (const u of Object.values(created.users)) if (!(await db.auth.admin.getUserById(u.id)).error) users++;
  left.auth_users = users;
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  left.auth_users_with_prefix = (list?.users ?? []).filter((u) => u.email?.startsWith(`staging-test-admin-${RUN}`)).length;
  let objects = 0;
  for (const bucket of ["private-media", "public-media"]) for (const e of evIds) objects += (await listAll(bucket, `events/${e}`)).length;
  for (const id of created.backupRuns) objects += (await listAll("backups", id)).length;
  left.storage_objects = objects;
  const total = Object.values(left).reduce((a, b) => a + b, 0);
  check("zero leftovers except documented immutable residue", total === 0 && errs.length === 0, `${JSON.stringify(left)} ${errs.join("; ")}`);
  check("residue limited to the documented immutable chain", residue.every((r) => ["contracts", "contract_versions", "events", "album_selections", "album_selection_snapshots", "customers"].includes(r.table)) && (!F.Ealb || stillAlb === 1),
    residue.map((r) => r.table).join(","));
  // Remove the immutable residue through the service-role-only purge (migration 0012), then require zero.
  const purge = await db.rpc("purge_test_fixtures", { p_prefix: "[STAGING-TEST]" });
  check("purge_test_fixtures removed the immutable test residue", !purge.error, purge.error ? purge.error.message : JSON.stringify(purge.data));
  // global [STAGING-TEST] scan (other runs) — must be zero after the purge
  const glob = {};
  for (const [t, c] of [["customers", "full_name"], ["events", "title"], ["staff_members", "full_name"], ["equipment", "name"], ["booking_requests", "contact_name"], ["support_requests", "subject"], ["reviews", "body"]]) {
    glob[t] = (await db.from(t).select("id", { count: "exact", head: true }).like(c, "[STAGING-TEST]%")).count ?? null;
  }
  check("no [STAGING-TEST] rows remain anywhere after purge", Object.values(glob).every((n) => n === 0), JSON.stringify(glob));
  const allIds = [...Object.values(created.users).map((u) => u.id), ...evIds, ...created.quotes, ...created.payments, ...created.contracts, ...created.staff, ...created.equipment, ...created.customers, ...created.bookings]
    .filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const audit = allIds.length ? await sql(`select count(*)::int as n from public.audit_events where entity_id in (${allIds.map((i) => `'${i}'`).join(",")})`).catch(() => null) : null;
  const queue = evIds.length ? await sql(`select count(*)::int as n from private.storage_cleanup_queue where done_at is null and (${evIds.map((e) => `path like 'events/${e}/%'`).join(" or ")})`).catch(() => null) : null;

  // Owner unchanged
  const after = await ownerSnapshot([created.users.owner?.id].filter(Boolean));
  const b = F.ownerBefore?.[0], a = after.find((x) => x.id === b?.id);
  check("real owner still exists, unchanged (role, disabled, mfa_required, factor count, profile/auth updated_at)",
    !!a && after.length === 1 && a.role === "owner" && a.disabled === b.disabled && a.mfa_required === b.mfa_required && a.factors === b.factors && a.verified_factors === b.verified_factors && a.profile_updated_at === b.profile_updated_at && a.auth_updated_at === b.auth_updated_at,
    a ? `factors ${b.factors}→${a.factors}, verified ${b.verified_factors}→${a.verified_factors}` : "owner missing");
  return {
    leftovers: left, errors: errs, residue, global_staging_test_rows: glob,
    audit_rows_retained: audit?.[0]?.n ?? null, cleanup_queue_pending_for_test_paths: queue?.[0]?.n ?? null,
    owner: { count_after: after.length, factors_before: b?.factors ?? null, factors_after: a?.factors ?? null, unchanged: checks.at(-1).pass },
  };
}

// ------------------------------------------------------------------ main
const startedAt = new Date().toISOString();
let cleanupResult = null;
try {
  await setup();
  browser = await chromium.launch();
  await section("login+mfa", loginAll);
  await section("customers", customersFlow);
  await section("events", eventsFlow);
  await section("calendar", calendarFlow);
  await section("bookings", bookingsFlow);
  await section("staff+equipment", staffEquipmentFlow);
  await section("media+publishing", mediaFlow);
  await section("quotes+contracts", quotesContractsFlow);
  await section("finance", financeFlow);
  await section("owner-only", ownerOnlyFlow);
  await section("support+reviews", supportReviewsFlow);
  await section("album-submissions", albumFlow);
  await section("staff-role", staffFlow);
} catch (e) {
  check("run completed without fatal error", false, (e?.message ?? String(e)).split("\n")[0]);
} finally {
  try { cleanupResult = await cleanup(); } catch (e) { area = "cleanup"; check("cleanup completed", false, e?.message ?? e); }
}
const passed = checks.filter((c) => c.pass).length;
const byArea = {};
for (const c of checks) { byArea[c.area] ??= { passed: 0, failed: 0 }; byArea[c.area][c.pass ? "passed" : "failed"]++; }
writeFileSync(REPORT, JSON.stringify({
  target: "staging", host: new URL(URL_).host, app: BASE, run_id: RUN, started_at: startedAt, finished_at: new Date().toISOString(),
  totals: { checks: checks.length, passed, failed: checks.length - passed }, by_area: byArea, cleanup: cleanupResult, checks,
}, null, 2) + "\n");
console.log(`\n${passed}/${checks.length} checks passed → ${REPORT}`);
process.exit(checks.length - passed === 0 ? 0 : 1);
