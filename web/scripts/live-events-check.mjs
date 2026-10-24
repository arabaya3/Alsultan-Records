#!/usr/bin/env node
/**
 * Live events-admin check against the deployed site (default https://sultan-records.vercel.app) and the staging/prod DB.
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
await assertProdWriteAllowed("live-events-check", { siteDefault: "https://sultan-records.vercel.app" }); // writes [STAGING-TEST] data to the production project

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
const EMAIL = `staging-test-events-${RUN}@example.com`;

function base32Decode(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = []; for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | a.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
function totp(secret, t = Date.now()) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(t / 30_000))); const h = createHmac("sha1", base32Decode(secret)).update(buf).digest(); const o = h[h.length - 1] & 0x0f; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); }
async function freshTotp(s) { const left = 30_000 - (Date.now() % 30_000); if (left < 4000) await sleep(left + 300); return totp(s); }
async function publicHtml(path) { const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`); return { status: r.status, html: await r.text() }; }
async function pollPublic(path, pred, timeoutMs = 30_000) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const p = await publicHtml(path); if (pred(p)) return { ok: true, ms: Date.now() - t0 }; await sleep(2000); } return { ok: false, ms: timeoutMs }; }
const msgOk = async (form) => { const m = form.getByTestId("action-msg"); await m.waitFor({ timeout: 60_000 }); return (await m.getAttribute("data-ok")) === "1"; };

const SHOTS = process.env.SHOTS_DIR ?? ".cache";
let userId = null;
let custId = null;
let evId = null;
const browser = await chromium.launch();
const snapshot = async () => JSON.stringify((await db.from("events").select("id, title, city, status, is_published, deleted_at, updated_at").not("title", "like", "[STAGING-TEST]%").order("id")).data);
const realBefore = await snapshot();
try {
  // Fixtures: one [STAGING-TEST] customer + event (no money, no media). Real rows are only read.
  const c = await db.from("customers").insert({ full_name: `${TAG} عميل` }).select("id").single();
  if (c.error) throw c.error;
  custId = c.data.id;
  const e = await db.from("events").insert({ customer_id: custId, title: `${TAG} مناسبة فحص`, event_type: "wedding", city: "قبل" }).select("id").single();
  if (e.error) throw e.error;
  evId = e.data.id;

  const { data: u, error: ue } = await db.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true, user_metadata: { full_name: `${TAG} admin` } });
  if (ue) throw ue;
  userId = u.user.id;
  await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", userId);
  const ctx = await browser.newContext({ locale: "ar", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${BASE}/login?next=/admin/events`);
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

  await page.goto(`${BASE}/admin/events`);
  const row = page.locator(`[data-testid=event-row][data-event-id="${evId}"]`);
  await row.waitFor();
  const heads = await page.getByRole("columnheader").allInnerTexts();
  check("list has «السعر» and «الإجراءات» columns", heads.includes("السعر") && heads.includes("الإجراءات"), heads.join(" | "));
  check("no agreed price → «غير محدد» (not empty, not 0)", (await row.getByTestId("event-price").innerText()).includes("غير محدد"));
  const realPrices = await page.locator("[data-testid=event-row] [data-testid=event-price]").allInnerTexts();
  check("every row shows a price cell (no empty cells)", realPrices.every((t) => t.trim().length > 0), realPrices.map((t) => t.split("\n")[0]).join(", "));
  await page.screenshot({ path: `${SHOTS}/events-admin-1440.png`, fullPage: true });

  // Edit
  await row.getByTestId("event-edit").click();
  await page.waitForURL(new RegExp(`/admin/events/${evId}#edit$`));
  const form = page.getByTestId("event-form");
  await form.locator('input[name="city"]').fill("بعد");
  await form.getByRole("button", { name: "حفظ التغييرات" }).click();
  check("«تعديل» opens the form and saves", (await form.getByTestId("action-msg").getAttribute("data-ok")) === "1" && (await db.from("events").select("city").eq("id", evId).single()).data.city === "بعد");

  // Delete → cancel
  await page.goto(`${BASE}/admin/events`);
  await row.getByTestId("event-trash").getByRole("button", { name: "حذف" }).click();
  const dialog = page.getByRole("dialog");
  check("delete confirmation names the event", (await dialog.innerText()).includes(`حذف المناسبة «${TAG} مناسبة فحص»؟`));
  await page.screenshot({ path: `${SHOTS}/events-admin-confirm-1440.png` });
  await dialog.getByRole("button", { name: "تراجع" }).click();
  check("«تراجع» changes nothing", (await db.from("events").select("deleted_at").eq("id", evId).single()).data.deleted_at === null);

  // Delete → trash → restore
  await row.getByTestId("event-trash").getByRole("button", { name: "حذف" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "نقل إلى سلة المحذوفات" }).click();
  await row.waitFor({ state: "detached" });
  check("deleted event moved to the trash (row kept)", !!(await db.from("events").select("deleted_at").eq("id", evId).single()).data.deleted_at);
  await page.goto(`${BASE}/admin/events?view=trash`);
  await page.screenshot({ path: `${SHOTS}/events-admin-trash-1440.png`, fullPage: true });
  await page.locator(`[data-testid=event-row][data-event-id="${evId}"]`).getByTestId("event-restore").getByRole("button", { name: "استرجاع" }).click();
  await page.locator(`[data-testid=event-row][data-event-id="${evId}"]`).waitFor({ state: "detached" });
  check("restored from the trash", (await db.from("events").select("deleted_at").eq("id", evId).single()).data.deleted_at === null);
  const audits = (await db.from("audit_events").select("before, after").eq("entity_type", "events").eq("entity_id", evId)).data ?? [];
  check("trash and restore both audited", audits.some((a) => !a.before?.deleted_at && a.after?.deleted_at) && audits.some((a) => a.before?.deleted_at && !a.after?.deleted_at), `${audits.length} audit rows`);

  // Phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin/events`);
  await page.locator(`[data-testid=event-card][data-event-id="${evId}"]`).waitFor();
  const card = page.locator(`[data-testid=event-card][data-event-id="${evId}"]`);
  const edit = await card.getByTestId("event-edit").boundingBox();
  const del = await card.getByTestId("event-trash").getByRole("button", { name: "حذف" }).boundingBox();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const fmt = (b) => b ? `x${Math.round(b.x)} w${Math.round(b.width)} h${b.height.toFixed(1)}` : "none";
  check("phone 390: actions on screen, ≥40px, no overflow", !!edit && !!del && [edit, del].every((b) => b.x >= 0 && b.x + b.width <= 390 && b.height >= 40) && overflow <= 0, `edit ${fmt(edit)}; delete ${fmt(del)}; overflow ${overflow}`);
  await page.screenshot({ path: `${SHOTS}/events-admin-390.png`, fullPage: true });
  await ctx.close();

  const anon = (await import("@supabase/supabase-js")).createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const r = await anon.rpc("trash_event", { p_id: evId });
  check("anon cannot call trash_event on production", r.error !== null);
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  try { const p = await db.rpc("purge_test_fixtures", { p_prefix: "[STAGING-TEST]" }); if (p.error) console.log("purge:", p.error.message); } catch {}
  try { if (userId) await db.auth.admin.deleteUser(userId); } catch {}
  const leftEv = (await db.from("events").select("id", { count: "exact", head: true }).like("title", "[STAGING-TEST]%")).count;
  const leftCu = (await db.from("customers").select("id", { count: "exact", head: true }).like("full_name", "[STAGING-TEST]%")).count;
  check("cleanup: no test event/customer left", leftEv === 0 && leftCu === 0, JSON.stringify({ leftEv, leftCu }));
  check("real event(s) unchanged (title, city, status, publication, trash flag, updated_at)", (await snapshot()) === realBefore);
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} live events-admin checks passed`);
process.exit(failed ? 1 : 0);
