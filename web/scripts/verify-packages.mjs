#!/usr/bin/env node
/**
 * Verifies the owner's packages on a running site against scripts/seed-packages.mjs data.
 *   BASE_URL=http://localhost:3600 node scripts/verify-packages.mjs --target local
 *   node scripts/verify-packages.mjs --target staging            (BASE_URL defaults to the live site)
 * Public checks (as a visitor): every package with its group, price «N شيكل», items, gift, WhatsApp text naming the
 * package, no internal note, no strike-through/discount/end date, mobile layout without overflow, no offers created.
 * Admin check (temporary [STAGING-TEST] admin with TOTP): the owner can edit a package — price changed through the
 * admin form shows on the site without a deploy, then the original price is restored the same way. Never prints secrets.
 */
import { readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertProdWriteAllowed } from "./prod-write-guard.mjs";

const argv = process.argv.slice(2);
const target = argv[argv.indexOf("--target") + 1];
if (target === "staging") await assertProdWriteAllowed("verify-packages", { siteDefault: "https://sultan-records.vercel.app" }); // the staging target is the production project
if (!["local", "staging"].includes(target)) { console.error("--target local|staging"); process.exit(2); }
const BASE = process.env.BASE_URL ?? (target === "staging" ? "https://sultan-records.vercel.app" : "http://localhost:3600");
const env = Object.fromEntries(readFileSync(target === "staging" ? ".env.staging.app.local" : ".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
if (target === "local" && !["127.0.0.1", "localhost"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)) { console.error("✗ --target local refuses a non-local NEXT_PUBLIC_SUPABASE_URL"); process.exit(3); }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { PACKAGES } = await import("./seed-packages-data.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, note = "") => { results.push({ name, pass }); console.log(`${pass ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`); };
const norm = (s) => s.replace(/\s+/g, " ").trim();

const browser = await chromium.launch();
let userId = null;
try {
  // ---- public, desktop
  const ctx = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    await page.goto(`${BASE}/packages?_=${Date.now()}`, { waitUntil: "domcontentloaded" });
    ok = (await page.locator("[data-package-card]").count()) >= PACKAGES.length;
    if (!ok) await sleep(5000);
  }
  check(`all ${PACKAGES.length} packages on /packages`, ok);
  const groups = await page.locator("[data-package-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-package-group")));
  check("grouped: العرسان, مناسبات الرجال, السهرات, DJ (in that order)", JSON.stringify(groups) === JSON.stringify(["العرسان", "مناسبات الرجال", "السهرات", "DJ"]), groups.join(" | "));
  for (const p of PACKAGES) {
    const card = page.locator(`[data-package-card="${p.slug}"]`);
    const inGroup = await card.evaluate((el, g) => el.closest("[data-package-group]")?.getAttribute("data-package-group") === g, p.group).catch(() => false);
    const title = norm(await card.locator("h3 bdi").innerText().catch(() => ""));
    const price = norm(await card.locator("[data-package-price]").innerText().catch(() => ""));
    const items = (await card.locator("[data-package-items] li").allInnerTexts().catch(() => [])).map(norm);
    const gift = await card.locator("[data-package-gift]").count() ? norm(await card.locator("[data-package-gift]").innerText()) : null;
    const desc = norm(await card.locator("p").first().innerText().catch(() => ""));
    const href = await card.locator('a[href^="https://wa.me/"]').getAttribute("href").catch(() => null);
    const wa = href ? new URL(href).searchParams.get("text") : null;
    const text = await card.innerText();
    const issues = [];
    if (!inGroup) issues.push("group");
    if (title !== p.title) issues.push(`title «${title}»`);
    if (price !== `${p.price.toLocaleString("en-US")} شيكل`) issues.push(`price «${price}»`);
    if (JSON.stringify(items) !== JSON.stringify(p.items)) issues.push(`items ${items.length}/${p.items.length}`);
    if ((p.gift ? `الهدية: ${p.gift}` : null) !== gift) issues.push(`gift «${gift}»`);
    if (desc !== p.description) issues.push(`description «${desc}»`);
    if (wa !== `مرحباً، بدي أستفسر عن بكج: ${p.title}`) issues.push(`whatsapp «${wa}»`);
    if (/خصم|%|بدلاً من|ينتهي|حتى \d/.test(text) || (await card.locator("s, del").count())) issues.push("discount/strike/end-date text");
    if (/فلاشة 2|فلاشتان/.test(text)) issues.push("flash count shown");
    if (p.slug === "men-engagement-publish" && /فلاشة/.test(text)) issues.push("flash added to 250 package");
    if (["wedding-hall-print-album", "wedding-hall-basic"].includes(p.slug) && /جلسة/.test(text)) issues.push("outdoor session added");
    check(`${p.slug}: title, group, ${p.price} شيكل, ${p.items.length} items, gift, WhatsApp`, issues.length === 0, issues.join("; "));
  }
  check("internal note never in the public page", !(await page.content()).includes("للاستفسار من صاحب الاستوديو"));
  const anonNote = await anon.from("packages").select("internal_note").limit(1);
  check("anon cannot read internal_note (column grant)", anonNote.error !== null);
  const anonPrice = await anon.from("packages").select("price_minor").limit(1);
  check("anon cannot read raw price_minor", anonPrice.error !== null);
  check("no offers were created", ((await db.from("offers").select("id", { count: "exact", head: true })).count ?? -1) === 0 || target === "local");
  check("no package featured / no image (clean text cards)", ((await db.from("packages").select("id").in("slug", PACKAGES.map((p) => p.slug)).or("featured.eq.true,image_photo_id.not.is.null")).data ?? []).length === 0);
  await ctx.close();

  // ---- public, mobile
  const m = await browser.newContext({ locale: "ar", viewport: { width: 390, height: 844 } });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/packages`, { waitUntil: "networkidle" });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const cardsFit = await mp.locator("[data-package-card]").evaluateAll((els) => els.every((e) => e.getBoundingClientRect().right <= innerWidth + 1));
  check("mobile 390: no horizontal overflow, every card fits", overflow <= 0 && cardsFit, `overflow ${overflow}`);
  await mp.screenshot({ path: `../docs/screenshots/packages/owner-packages-${target}-390.png`, fullPage: true });
  await m.close();
  const d = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const dp = await d.newPage();
  await dp.goto(`${BASE}/packages`, { waitUntil: "networkidle" });
  await dp.screenshot({ path: `../docs/screenshots/packages/owner-packages-${target}-1440.png`, fullPage: true });
  await d.close();

  // ---- admin round-trip (owner can edit from the admin; change visible without deploy; restored)
  const RUN = randomBytes(3).toString("hex");
  const EMAIL = `staging-test-pkgverify-${RUN}@example.com`;
  const PW = `Tmp-${randomBytes(12).toString("base64url")}`;
  const u = await db.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true, user_metadata: { full_name: `[STAGING-TEST] ${RUN} admin` } });
  if (u.error) throw u.error;
  userId = u.data.user.id;
  await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", userId);
  const a = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const ap = await a.newPage();
  ap.setDefaultTimeout(60_000);
  await ap.goto(`${BASE}/login?next=/admin/content/packages`);
  await ap.locator("#email").fill(EMAIL);
  await ap.locator("#password").fill(PW);
  await ap.getByRole("button", { name: "تسجيل الدخول" }).click();
  await ap.waitForURL((x) => x.searchParams.get("step") === "mfa");
  await ap.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  const secret = (await ap.locator("code[dir=ltr]").textContent()).trim();
  const b32 = (s) => { const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { v = (v << 5) | al.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
  if (30000 - (Date.now() % 30000) < 4000) await sleep(4500);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", b32(secret)).update(buf).digest(); const k = h[h.length - 1] & 15;
  await ap.locator("#code").fill(String((((h[k] & 127) << 24) | (h[k + 1] << 16) | (h[k + 2] << 8) | h[k + 3]) % 1e6).padStart(6, "0"));
  await ap.getByRole("button", { name: "تحقّق" }).click();
  await ap.waitForURL((x) => x.pathname.startsWith("/admin"));
  const P = PACKAGES[9];
  const id = (await db.from("packages").select("id").eq("slug", P.slug).single()).data.id;
  await ap.goto(`${BASE}/admin/content/packages/${id}`);
  await ap.screenshot({ path: `../docs/screenshots/packages/owner-package-admin-${target}-1440.png`, fullPage: true });
  const setPrice = async (v) => {
    await ap.goto(`${BASE}/admin/content/packages/${id}`);
    const f = ap.getByTestId("package-form");
    await f.locator('input[name="price"]').fill(String(v));
    await f.getByRole("button", { name: "حفظ (منشور)" }).click();
    const msg = f.getByTestId("action-msg");
    await msg.waitFor();
    return (await msg.getAttribute("data-ok")) === "1";
  };
  const priceOn = async (v) => { for (let i = 0; i < 15; i++) { const html = await (await fetch(`${BASE}/packages?_=${Date.now()}`)).text(); if (html.includes(`${v.toLocaleString("en-US")} شيكل`)) return true; await sleep(2000); } return false; };
  check("admin: price edit saved", await setPrice(351));
  check("edited price visible on the site without deploy", await priceOn(351));
  check("admin: original price restored", await setPrice(P.price));
  check("restored price visible on the site", await priceOn(P.price));
  const row = (await db.from("packages").select("price_minor, status, internal_note, group_label").eq("id", id).single()).data;
  check("package row back to the owner's data", row.price_minor === P.price * 100 && row.status === "published" && row.internal_note === P.note && row.group_label === P.group);
  await a.close();
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  if (userId) await db.auth.admin.deleteUser(userId);
  check("temporary admin deleted", !userId || !(await db.auth.admin.listUsers()).data.users.some((x) => x.id === userId));
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} package checks passed (${BASE})`);
process.exit(failed ? 1 : 0);
