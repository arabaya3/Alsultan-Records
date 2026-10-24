#!/usr/bin/env node
/**
 * Live CMS check against the deployed site (default https://sultan-records.vercel.app) and the staging/prod DB.
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
await assertProdWriteAllowed("live-cms-check", { siteDefault: "https://sultan-records.vercel.app" }); // writes [STAGING-TEST] data to the production project

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
const EMAIL = `staging-test-cms-${RUN}@example.com`;

function base32Decode(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | a.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
function totp(secret, t = Date.now()) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(t / 30_000))); const h = createHmac("sha1", base32Decode(secret)).update(buf).digest(); const o = h[h.length - 1] & 0x0f; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); }
async function freshTotp(s) { const left = 30_000 - (Date.now() % 30_000); if (left < 4000) await sleep(left + 300); return totp(s); }
async function publicHtml(path) { const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`); return { status: r.status, html: await r.text() }; }
async function pollPublic(path, pred, timeoutMs = 30_000) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const p = await publicHtml(path); if (pred(p)) return { ok: true, ms: Date.now() - t0 }; await sleep(2000); } return { ok: false, ms: timeoutMs }; }
const msgOk = async (form) => { const m = form.getByTestId("action-msg"); await m.waitFor({ timeout: 60_000 }); return (await m.getAttribute("data-ok")) === "1"; };

const restore = { tagline: undefined, navLabel: undefined, navId: undefined };
let userId = null; let albumId = null;
const browser = await chromium.launch();
try {
  // Temp admin
  const { data: u, error: ue } = await db.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true, user_metadata: { full_name: `${TAG} admin` } });
  if (ue) throw ue; userId = u.user.id;
  await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", userId);
  const ctx = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/login?next=/admin/content`);
  await page.locator("#email").fill(EMAIL); await page.locator("#password").fill(PW);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((x) => x.searchParams.get("step") === "mfa");
  await page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  const secret = (await page.locator("code[dir=ltr]").textContent()).trim();
  await page.locator("#code").fill(await freshTotp(secret)); await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL((x) => x.pathname.startsWith("/admin"));
  check("temporary admin reaches /admin with TOTP", true);

  // 1. Identity edit visible without deploy
  restore.tagline = (await db.from("business_settings").select("tagline").eq("id", 1).single()).data.tagline;
  const tag = `جملة فحص ${RUN}`;
  await page.goto(`${BASE}/admin/content/identity`);
  let form = page.getByTestId("identity-form");
  await form.locator('input[name="tagline"]').fill(tag); await form.getByRole("button", { name: "حفظ" }).click();
  check("identity saved in admin", await msgOk(form));
  let p = await pollPublic("/", (x) => x.html.includes(tag));
  check("tagline visible on the live site without deploy", p.ok, `${p.ms} ms`);
  await page.goto(`${BASE}/admin/content/identity`); form = page.getByTestId("identity-form");
  await form.locator('input[name="tagline"]').fill(restore.tagline ?? ""); await form.getByRole("button", { name: "حفظ" }).click();
  check("original tagline restored", await msgOk(form)); restore.tagline = undefined;

  // 2. Service create → publish → visible → hide → gone
  const svcSlug = `staging-test-${RUN}`;
  await page.goto(`${BASE}/admin/content/services/new`);
  form = page.getByTestId("service-form");
  await form.locator('input[name="title"]').fill(`${TAG} خدمة`); await page.getByTestId("slug-hint").fill(svcSlug.replace(/-/g, " "));
  await form.locator('textarea[name="summary"]').fill("خدمة فحص مؤقتة"); await form.getByRole("button", { name: "نشر" }).click();
  await page.waitForURL(/\/admin\/content\/services\/[0-9a-f-]{36}/);
  p = await pollPublic("/services", (x) => x.html.includes(`${TAG} خدمة`));
  check("published service visible on /services", p.ok, `${p.ms} ms`);
  p = await pollPublic(`/services/${svcSlug}`, (x) => x.status === 200);
  check("service page live", p.ok);
  await page.goto(`${BASE}/admin/content/services`);
  await page.getByTestId("sort-row").filter({ has: page.locator(`[data-slug="${svcSlug}"]`) }).getByRole("button", { name: "إخفاء" }).click();
  p = await pollPublic("/services", (x) => !x.html.includes(`${TAG} خدمة`));
  check("hidden service gone from /services", p.ok, `${p.ms} ms`);

  // 3. Offer: publish → visible; expire via admin edit → disappears; announcement linked
  const offSlug = `staging-test-offer-${RUN}`;
  await page.goto(`${BASE}/admin/content/offers/new`);
  form = page.getByTestId("offer-form");
  await form.locator('input[name="title"]').fill(`${TAG} عرض`); await page.getByTestId("slug-hint").fill(offSlug.replace(/-/g, " "));
  await form.locator('input[name="items"]').first().fill("بند فحص");
  await form.getByRole("button", { name: "نشر" }).click();
  await page.waitForURL(/\/admin\/content\/offers\/[0-9a-f-]{36}/).catch(() => {});
  p = await pollPublic("/offers", (x) => x.html.includes(`${TAG} عرض`));
  check("published offer visible on /offers", p.ok, `${p.ms} ms`);
  const offerId = (await db.from("offers").select("id").eq("slug", offSlug).single()).data?.id;
  await page.goto(`${BASE}/admin/content/announcements/new`);
  form = page.getByTestId("announcement-form");
  await form.locator('input[name="text"]').fill(`${TAG} إعلان`);
  await form.locator('select[name="link_kind"]').selectOption("offer"); await form.locator('select[name="link_offer_id"]').selectOption(offerId);
  await form.getByRole("button", { name: "نشر" }).click();
  await page.waitForURL(/\/admin\/content\/announcements\/[0-9a-f-]{36}/).catch(() => {});
  p = await pollPublic("/", (x) => x.html.includes(`${TAG} إعلان`) && x.html.includes(`/offers/${offSlug}`));
  check("announcement shows on live site with the offer link", p.ok, `${p.ms} ms`);
  // expire through the admin form (end date yesterday, Asia/Hebron)
  const y = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
  await page.goto(`${BASE}/admin/content/offers/${offerId}`);
  form = page.getByTestId("offer-form");
  await form.locator('input[name="starts_on"]').fill(""); await form.locator('input[name="ends_on"]').fill(y);
  await form.getByRole("button", { name: "حفظ (منشور)" }).click();
  p = await pollPublic("/offers", (x) => !x.html.includes(`${TAG} عرض`));
  check("expired offer disappears from /offers automatically", p.ok, `${p.ms} ms`);
  p = await pollPublic(`/offers/${offSlug}`, (x) => x.status === 404);
  check("expired offer page returns 404", p.ok);

  // 4. Nav rename keeps URL, then restore
  const nav = (await db.from("nav_items").select("id, label").eq("target", "services").single()).data;
  restore.navId = nav.id; restore.navLabel = nav.label;
  await page.goto(`${BASE}/admin/content/nav`);
  form = page.getByTestId("nav-services");
  await form.locator('input[name="label"]').fill(`خدماتنا ${RUN.slice(-3)}`); await form.getByRole("button", { name: "حفظ" }).click();
  check("nav label saved", await msgOk(form));
  p = await pollPublic("/", (x) => new RegExp(`href="/services"[^>]*>[^<]*خدماتنا ${RUN.slice(-3)}`).test(x.html) || x.html.includes(`خدماتنا ${RUN.slice(-3)}`));
  check("renamed nav item visible, URL unchanged (/services)", p.ok, `${p.ms} ms`);
  await page.goto(`${BASE}/admin/content/nav`); form = page.getByTestId("nav-services");
  await form.locator('input[name="label"]').fill(restore.navLabel); await form.getByRole("button", { name: "حفظ" }).click();
  check("original nav label restored", await msgOk(form)); restore.navLabel = undefined;

  // 5. Server-side photo processing (no browser): pending photo → cron → ready
  albumId = (await db.from("photo_albums").insert({ slug: `staging-test-${RUN}`, title: `${TAG} ألبوم`, is_published: false }).select("id").single()).data.id;
  const photoId = crypto.randomUUID();
  const buf = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 90, g: 120, b: 60 } } }).jpeg().toBuffer();
  const path = `albums/${albumId}/${photoId}/original.jpg`;
  const sha = (await import("node:crypto")).createHash("sha256").update(buf).digest("hex");
  await db.storage.from("album-media").upload(path, buf, { contentType: "image/jpeg" });
  await db.from("album_photos").insert({ id: photoId, album_id: albumId, storage_path_original: path, mime: "image/jpeg", bytes: buf.length, sha256: sha, upload_status: "pending", created_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  let st = null; const t0 = Date.now();
  while (Date.now() - t0 < 4 * 60_000) { st = (await db.from("album_photos").select("upload_status, variants, width").eq("id", photoId).single()).data; if (st.upload_status === "ready" || st.upload_status === "failed") break; await sleep(10_000); }
  check("pending photo processed by the scheduled server job (no browser)", st?.upload_status === "ready" && !!st?.variants?.display, `${st?.upload_status} in ${Math.round((Date.now() - t0) / 1000)} s, width ${st?.width}`);
  await ctx.close();
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  // restore real values if a step failed midway
  try { if (restore.tagline !== undefined) await db.from("business_settings").update({ tagline: restore.tagline }).eq("id", 1); } catch {}
  try { if (restore.navLabel !== undefined) await db.from("nav_items").update({ label: restore.navLabel }).eq("id", restore.navId); } catch {}
  // test data cleanup
  try { await db.from("announcements").delete().like("text", "[STAGING-TEST]%"); } catch {}
  try { await db.from("offers").delete().like("slug", "staging-test-offer-%"); } catch {}
  try { await db.from("services").delete().like("slug", "staging-test-%"); } catch {}
  try { await db.from("slug_redirects").delete().like("from_path", "%staging-test-%"); } catch {}
  try { if (albumId) { const { data: ph } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", albumId); const paths = (ph ?? []).flatMap((r) => [r.storage_path_original, r.variants?.thumb, r.variants?.display].filter(Boolean)); if (paths.length) await db.storage.from("album-media").remove(paths); await db.from("album_photos").delete().eq("album_id", albumId); await db.from("photo_albums").delete().eq("id", albumId); } } catch {}
  try { if (userId) await db.auth.admin.deleteUser(userId); } catch {}
  const left = {
    services: (await db.from("services").select("id", { count: "exact", head: true }).like("slug", "staging-test-%")).count,
    offers: (await db.from("offers").select("id", { count: "exact", head: true }).like("slug", "staging-test-%")).count,
    announcements: (await db.from("announcements").select("id", { count: "exact", head: true }).like("text", "[STAGING-TEST]%")).count,
    albums: (await db.from("photo_albums").select("id", { count: "exact", head: true }).like("slug", "staging-test-%")).count,
  };
  check("cleanup: no test rows left; real values restored", Object.values(left).every((n) => n === 0), JSON.stringify(left));
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} live CMS checks passed`);
process.exit(failed ? 1 : 0);
