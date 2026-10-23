#!/usr/bin/env node
/**
 * Live admin UX check against the deployed site (default https://sultan-records.vercel.app) and the staging/prod DB.
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
assertProdWriteAllowed("live-admin-ux-check"); // writes [STAGING-TEST] data to the production project

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
const EMAIL = `staging-test-adminux-${RUN}@example.com`;

function base32Decode(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | a.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
function totp(secret, t = Date.now()) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(t / 30_000))); const h = createHmac("sha1", base32Decode(secret)).update(buf).digest(); const o = h[h.length - 1] & 0x0f; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); }
async function freshTotp(s) { const left = 30_000 - (Date.now() % 30_000); if (left < 4000) await sleep(left + 300); return totp(s); }
async function publicHtml(path) { const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`); return { status: r.status, html: await r.text() }; }
async function pollPublic(path, pred, timeoutMs = 30_000) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const p = await publicHtml(path); if (pred(p)) return { ok: true, ms: Date.now() - t0 }; await sleep(2000); } return { ok: false, ms: timeoutMs }; }
const msgOk = async (form) => { const m = form.getByTestId("action-msg"); await m.waitFor({ timeout: 60_000 }); return (await m.getAttribute("data-ok")) === "1"; };
// Read-only check of the reworked admin (overview, sidebar groups, in-page tabs) with a temporary admin.
const SHOTS = "../docs/screenshots/admin-ux";
const { mkdirSync } = await import("node:fs");
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let userId = null;
try {
  const { data: u, error } = await db.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true, user_metadata: { full_name: `${TAG} admin` } });
  if (error) throw error;
  userId = u.user.id;
  await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", userId);
  const page = await (await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } })).newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/login?next=/admin`);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PW);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((x) => x.searchParams.get("step") === "mfa");
  await page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  const secret = (await page.locator("code[dir=ltr]").textContent()).trim();
  await page.locator("#code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((x) => x.pathname.startsWith("/admin"));
  await page.goto(`${BASE}/admin`);
  await page.getByTestId("quick-actions").waitFor();
  check("overview: 6 quick actions", (await page.getByTestId("quick-actions").locator("a").count()) === 6);
  const status = (await page.getByTestId("site-status").innerText()).replace(/\s+/g, " ");
  check("overview: real site status (7 albums, 19 videos)", /ألبومات منشورة ?7/.test(status) && /فيديوهات منشورة ?19/.test(status), status.slice(0, 140));
  check("overview: no stuck-files notice after the cleanup fix", (await page.getByTestId("cleanup-notice").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/overview-1440.png`, fullPage: true });
  const nav = (await page.getByRole("navigation", { name: "أقسام لوحة الإدارة" }).innerText()).replace(/\s+/g, " ");
  check(
    "sidebar: new groups, merged items gone",
    ["الأعمال", "البيع", "صفحات الموقع", "شغل المناسبات", "الإعدادات"].every((g) => nav.includes(g)) && !nav.includes("كل المحتوى") && !nav.includes("تصنيفات الفيديو"),
    nav.slice(0, 170),
  );
  for (const [path, tab] of [["/admin/videos", "التصنيفات"], ["/admin/content/services", "طريقة شغلنا"], ["/admin/content/offers", "الإعلانات"]]) {
    await page.goto(BASE + path);
    await page.getByTestId("page-tabs").waitFor();
    check(`tabs on ${path} reach «${tab}»`, (await page.getByTestId("page-tabs").getByRole("link", { name: tab }).count()) === 1);
  }
  await page.goto(`${BASE}/admin/videos`);
  await page.screenshot({ path: `${SHOTS}/videos-tabs-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin`);
  await page.getByTestId("quick-actions").waitFor();
  check("overview 390: no horizontal overflow", (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await page.screenshot({ path: `${SHOTS}/overview-390.png`, fullPage: true });
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  if (userId) await db.auth.admin.deleteUser(userId);
  check("temporary admin deleted", !(await db.auth.admin.listUsers()).data.users.some((x) => x.email === EMAIL));
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} live admin UX checks passed`);
process.exit(failed ? 1 : 0);
