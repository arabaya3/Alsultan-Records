#!/usr/bin/env node
/**
 * Read-only screenshots of the admin for the owner guide.
 *   node scripts/admin-screenshots.mjs [--out ../docs/screenshots/admin]
 * Temporary [STAGING-TEST] admin (TOTP enrolled in the browser; the enrolment screen is never captured), only
 * navigates (no form is submitted), then the user is deleted. Owner account and data are untouched.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertProdWriteAllowed } from "./prod-write-guard.mjs";
await assertProdWriteAllowed("admin-screenshots", { siteDefault: "https://sultan-records.vercel.app" }); // writes [STAGING-TEST] data to the production project

const BASE = process.env.BASE_URL ?? "https://sultan-records.vercel.app";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "../docs/screenshots/admin";
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.staging.app.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function b32(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { v = (v << 5) | a.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); }
function totp(s) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac("sha1", b32(s)).update(b).digest(); const k = h[h.length - 1] & 15; return String((((h[k] & 127) << 24) | (h[k + 1] << 16) | (h[k + 2] << 8) | h[k + 3]) % 1e6).padStart(6, "0"); }
const RUN = randomBytes(4).toString("hex"), PW = `Tmp-${randomBytes(12).toString("base64url")}`, EMAIL = `staging-test-shots-${RUN}@example.com`;
const PAGES = [
  ["content", "/admin/content"], ["identity", "/admin/content/identity"], ["home", "/admin/content/home"],
  ["services", "/admin/content/services"], ["service-new", "/admin/content/services/new"],
  ["offers", "/admin/content/offers"], ["offer-new", "/admin/content/offers/new"],
  ["announcements", "/admin/content/announcements"], ["announcement-new", "/admin/content/announcements/new"],
  ["albums", "/admin/albums"], ["nav", "/admin/content/nav"], ["videos", "/admin/videos"],
];
let uid = null; const browser = await chromium.launch();
try {
  const { data, error } = await db.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true, user_metadata: { full_name: "[STAGING-TEST] screenshots" } });
  if (error) throw error; uid = data.user.id;
  await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", uid);
  for (const [w, h, dev] of [[1440, 1000, "desktop"], [390, 844, "mobile"]]) {
    const ctx = await browser.newContext({ locale: "ar", viewport: { width: w, height: h }, deviceScaleFactor: dev === "mobile" ? 2 : 1 });
    const page = await ctx.newPage(); page.setDefaultTimeout(60000);
    await page.goto(`${BASE}/login?next=/admin/content`);
    await page.locator("#email").fill(EMAIL); await page.locator("#password").fill(PW);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL((u) => u.searchParams.get("step") === "mfa");
    const enroll = page.getByRole("button", { name: "إعداد تطبيق المصادقة" });
    let secret = globalThis.__secret;
    if (await enroll.isVisible().catch(() => false)) { await enroll.click(); secret = (await page.locator("code[dir=ltr]").textContent()).trim(); globalThis.__secret = secret; }
    if (30000 - (Date.now() % 30000) < 4000) await sleep(4500);
    await page.locator("#code").fill(totp(secret)); await page.getByRole("button", { name: "تحقّق" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/admin"));
    const list = dev === "mobile" ? PAGES.filter(([n]) => ["content", "offer-new", "albums", "nav"].includes(n)) : PAGES;
    for (const [name, path] of list) {
      await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
      await sleep(1200);
      await page.screenshot({ path: `${OUT}/${dev}-${name}.png`, fullPage: dev === "desktop" });
      console.log(`${dev}-${name}`);
    }
    await ctx.close();
  }
} finally {
  if (uid) await db.auth.admin.deleteUser(uid);
  const left = (await db.auth.admin.listUsers()).data.users.filter((u) => u.email.startsWith("staging-test")).length;
  console.log(`temp users left: ${left}`);
  await browser.close();
}
