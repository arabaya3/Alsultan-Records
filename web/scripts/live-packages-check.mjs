#!/usr/bin/env node
/**
 * Live packages/offers check against the deployed site (default https://sultan-records.vercel.app) and the staging/prod DB.
 *   node scripts/live-cms-check.mjs            (BASE_URL overrides the site)
 * Uses a temporary [STAGING-TEST] admin (TOTP enrolled in the browser), never the owner. Every change is made
 * through the admin UI (so updateTag runs) and is verified on the public site WITHOUT a deploy. Real values
 * (tagline, nav label) are restored; all test rows/objects are deleted. Never prints secrets.
 */
import { readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { assertProdWriteAllowed } from "./prod-write-guard.mjs";
assertProdWriteAllowed("live-packages-check"); // writes [STAGING-TEST] data to the production project

const BASE = process.env.BASE_URL ?? "https://sultan-records.vercel.app";
const env = Object.fromEntries(readFileSync(".env.staging.app.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("dyuixzxmmeiypvawzmty")) throw new Error("not the approved project");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, note = "") => { results.push({ name, pass, note }); console.log(`${pass ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`); };
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const TAG = `[STAGING-TEST] ${RUN}`;
const PW = `Tmp-${randomBytes(12).toString("base64url")}`;
const EMAIL = `staging-test-pkg-${RUN}@example.com`;

function base32Decode(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | a.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
function totp(secret, t = Date.now()) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(t / 30_000))); const h = createHmac("sha1", base32Decode(secret)).update(buf).digest(); const o = h[h.length - 1] & 0x0f; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); }
async function freshTotp(s) { const left = 30_000 - (Date.now() % 30_000); if (left < 4000) await sleep(left + 300); return totp(s); }
async function publicHtml(path) { const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`); return { status: r.status, html: await r.text() }; }
async function pollPublic(path, pred, timeoutMs = 30_000) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const p = await publicHtml(path); if (pred(p)) return { ok: true, ms: Date.now() - t0 }; await sleep(2000); } return { ok: false, ms: timeoutMs }; }
const msgOk = async (form) => { const m = form.getByTestId("action-msg"); await m.waitFor({ timeout: 60_000 }); return (await m.getAttribute("data-ok")) === "1"; };

const SHOTS = "../docs/screenshots/packages";
const OFF = [
  { key: "sep", title: `${TAG} عرض شهر 9`, month: "9", year: "2026" },
  { key: "oct", title: `${TAG} عرض شهر 10`, month: "10", year: "2026", pkg: true },
  { key: "pin", title: `${TAG} عرض مثبت`, month: "1", year: "2026", pin: true },
];
const slugOf = (k) => `staging-test-${k}-${RUN}`;
const PKG = { title: `${TAG} بكج`, slug: `staging-test-pkg-${RUN}` };
const ids = {};
let pkgId = null;
let userId = null;
let page = null;
const browser = await chromium.launch();
async function adminDelete(path, label) {
  await page.goto(`${BASE}${path}`);
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(path.split("/").pop()));
}
const waTexts = (html) =>
  [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&")).searchParams.get("text") ?? "");

try {
  const { data: u, error: ue } = await db.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true, user_metadata: { full_name: `${TAG} admin` } });
  if (ue) throw ue;
  userId = u.user.id;
  await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", userId);
  const ctx = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/login?next=/admin/content/packages`);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PW);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((x) => x.searchParams.get("step") === "mfa");
  await page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  const secret = (await page.locator("code[dir=ltr]").textContent()).trim();
  await page.locator("#code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((x) => x.pathname.startsWith("/admin"));
  check("temporary admin reaches /admin with TOTP", true);

  // Package through the admin
  await page.goto(`${BASE}/admin/content/packages/new`);
  let form = page.getByTestId("package-form");
  await form.locator('input[name="title"]').fill(PKG.title);
  await page.getByTestId("slug-hint").fill(PKG.slug.replace(/-/g, " "));
  await form.locator('textarea[name="description"]').fill("بيانات فحص مؤقتة — تُحذف بعد الفحص.");
  await form.locator('input[name="items"]').first().fill("خدمة فحص 1");
  await form.getByRole("button", { name: "+ إضافة بند" }).click();
  await form.locator('input[name="items"]').nth(1).fill("خدمة فحص 2");
  await form.locator('input[name="featured"]').check();
  await form.getByRole("button", { name: "نشر" }).click();
  await page.waitForURL(/\/admin\/content\/packages\/[0-9a-f-]{36}/);
  pkgId = page.url().match(/packages\/([0-9a-f-]{36})/)[1];
  let p = await pollPublic("/packages", (x) => x.html.includes(PKG.slug));
  check("published package visible on live /packages without deploy", p.ok, `${p.ms} ms`);
  p = await pollPublic("/packages", (x) => waTexts(x.html).includes(`مرحباً، بدي أستفسر عن بكج: ${PKG.title}`));
  check("package WhatsApp message names the package", p.ok, `${p.ms} ms`);
  check("package not shown on /offers", !(await publicHtml("/offers")).html.includes(PKG.slug));

  // Offers through the admin
  for (const o of OFF) {
    await page.goto(`${BASE}/admin/content/offers/new`);
    form = page.getByTestId("offer-form");
    await form.locator('input[name="title"]').fill(o.title);
    await page.getByTestId("slug-hint").fill(slugOf(o.key).replace(/-/g, " "));
    await form.locator('input[name="items"]').first().fill("بند فحص");
    await form.getByTestId("offer-target-month").selectOption(o.month);
    await form.getByTestId("offer-target-year").fill(o.year);
    if (o.pin) await form.locator('input[name="pinned_home"]').check();
    if (o.pkg) await form.getByTestId("offer-package").selectOption(pkgId);
    await form.getByRole("button", { name: "نشر" }).click();
    await page.waitForURL(/\/admin\/content\/offers\/[0-9a-f-]{36}/);
    ids[o.key] = page.url().match(/offers\/([0-9a-f-]{36})/)[1];
  }
  const order = async () => [...(await publicHtml("/offers")).html.matchAll(/data-offer-card="(staging-test-[a-z]+-[a-z0-9]+)"/g)].map((m) => m[1]);
  let got = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    got = await order();
    if (got.length === 3) break;
    await sleep(2000);
  }
  check("live order: pinned first, then October 2026 above September 2026", JSON.stringify(got) === JSON.stringify([slugOf("pin"), slugOf("oct"), slugOf("sep")]), got.join(" > "));
  const off = await publicHtml(`/offers/${slugOf("oct")}`);
  check("linked offer page links to the package", off.html.includes(`/packages#${PKG.slug}`));
  check("offer WhatsApp message names the offer", waTexts(off.html).some((t) => t.includes(OFF[1].title)));

  // Screenshots while the clearly labelled test data exists
  await page.goto(`${BASE}/admin/content/packages`);
  await page.screenshot({ path: `${SHOTS}/admin-packages-1440.png`, fullPage: true });
  await page.goto(`${BASE}/admin/content/packages/${pkgId}`);
  await page.screenshot({ path: `${SHOTS}/admin-package-edit-1440.png`, fullPage: true });
  await page.goto(`${BASE}/admin/content/offers`);
  await page.screenshot({ path: `${SHOTS}/admin-offers-1440.png`, fullPage: true });
  await page.goto(`${BASE}/admin/content/offers/${ids.oct}`);
  await page.screenshot({ path: `${SHOTS}/admin-offer-edit-1440.png`, fullPage: true });
  const NAV = ["/work", "/packages", "/offers", "/services", "/about"];
  for (const [w, h, d] of [[1440, 1000, "1440"], [390, 844, "390"]]) {
    const pc = await browser.newContext({ locale: "ar", viewport: { width: w, height: h } });
    const pp = await pc.newPage();
    for (const path of ["packages", "offers"]) {
      await pp.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
      await sleep(1500);
      await pp.screenshot({ path: `${SHOTS}/public-${path}-${d}.png`, fullPage: true });
    }
    await pp.goto(`${BASE}/`);
    if (d === "390") {
      await pp.getByRole("button", { name: "فتح القائمة" }).click();
      await sleep(800);
      await pp.screenshot({ path: `${SHOTS}/mobile-menu-390.png` });
      const items = await pp.getByRole("dialog", { name: "القائمة" }).locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      const idx = NAV.map((x) => items.indexOf(x));
      check("live mobile menu: أعمالنا | البكجات | العروض | الخدمات | من نحن", idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), items.join(" "));
    } else {
      const items = await pp.locator("header nav[aria-label='القائمة الرئيسية']").first().locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      check("live desktop nav: أعمالنا | البكجات | العروض | الخدمات | من نحن", JSON.stringify(items) === JSON.stringify(NAV), items.join(" "));
      await pp.screenshot({ path: `${SHOTS}/desktop-nav-1440.png` });
    }
    await pc.close();
  }

  // Expire the linked offer through the admin: offer gone, package unchanged
  const before = (await db.from("packages").select("title, status, featured, updated_at").eq("id", pkgId).single()).data;
  const y = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
  await page.goto(`${BASE}/admin/content/offers/${ids.oct}`);
  form = page.getByTestId("offer-form");
  await form.locator('input[name="ends_on"]').fill(y);
  await form.getByRole("button", { name: "حفظ (منشور)" }).click();
  check("offer expired via admin", await msgOk(form));
  p = await pollPublic("/offers", (x) => !x.html.includes(slugOf("oct")));
  check("expired offer gone from live /offers", p.ok, `${p.ms} ms`);
  const after = (await db.from("packages").select("title, status, featured, updated_at").eq("id", pkgId).single()).data;
  check("package unchanged by the offer's edit/expiry", JSON.stringify(before) === JSON.stringify(after) && (await publicHtml("/packages")).html.includes(PKG.slug));

  // Permissions: anon cannot write packages
  const anonDb = (await import("@supabase/supabase-js")).createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const w = await anonDb.from("packages").insert({ slug: `staging-test-anon-${RUN}`, title: "x x" });
  check("anon cannot create packages on production", w.error !== null);
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  let viaAdmin = true;
  for (const k of Object.keys(ids)) await adminDelete(`/admin/content/offers/${ids[k]}`, "حذف العرض نهائياً").catch((e) => { viaAdmin = false; console.log("admin delete offer failed:", String(e.message).slice(0, 160)); });
  if (pkgId) await adminDelete(`/admin/content/packages/${pkgId}`, "حذف البكج نهائياً").catch((e) => { viaAdmin = false; console.log("admin delete package failed:", String(e.message).slice(0, 160)); });
  check("test data deleted through the admin (cache invalidated)", viaAdmin);
  try { await db.from("offers").delete().like("slug", "staging-test-%"); await db.from("packages").delete().like("slug", "staging-test-%"); } catch {}
  try { if (userId) await db.auth.admin.deleteUser(userId); } catch {}
  const left = {
    offers: (await db.from("offers").select("id", { count: "exact", head: true })).count,
    packages: (await db.from("packages").select("id", { count: "exact", head: true })).count,
    users: (await db.auth.admin.listUsers()).data.users.length,
  };
  check("cleanup: 0 offers, 0 packages, owner only (as before)", left.offers === 0 && left.packages === 0 && left.users === 1, JSON.stringify(left));
  const pc = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const pp = await pc.newPage();
  for (const path of ["packages", "offers"]) {
    const r = await pollPublic(`/${path}`, (x) => !x.html.includes("staging-test-"));
    await pp.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
    await pp.screenshot({ path: `${SHOTS}/public-${path}-real-1440.png` });
    check(`live /${path} back to real state (no test data)`, r.ok);
  }
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} live packages/offers checks passed`);
process.exit(failed ? 1 : 0);
