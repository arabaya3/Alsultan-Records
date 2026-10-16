// Staging app check — run from web/: node scripts/staging-app-check.mjs (needs the app on http://localhost:3100 built against staging).
// Creates [STAGING-TEST] rows/objects with the secret key, exercises the app routes, deletes everything.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const parse = (p) => Object.fromEntries(readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const app = parse(".env.staging.app.local");
if (!app.NEXT_PUBLIC_SUPABASE_URL.includes("dyuixzxmmeiypvawzmty")) throw new Error("not staging");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const sk = createClient(app.NEXT_PUBLIC_SUPABASE_URL, app.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, pass, note = "") => { results.push({ name, pass, note }); console.log(`${pass ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`); };
const stamp = Date.now();
const cleanup = [];

try {
  // Customer + event + published media
  const email = `staging-test-app-${stamp}@example.com`;
  const password = `Tmp-${crypto.randomUUID()}`;
  const { data: u } = await sk.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "[STAGING-TEST] app" } });
  cleanup.push(() => sk.auth.admin.deleteUser(u.user.id));
  const { data: cust } = await sk.from("customers").select("id").eq("user_id", u.user.id).maybeSingle();
  let customerId = cust?.id;
  if (!customerId) {
    const { data: c, error } = await sk.from("customers").insert({ full_name: "[STAGING-TEST] app", user_id: u.user.id, email }).select("id").single();
    if (error) throw error;
    customerId = c.id;
  }
  cleanup.push(() => sk.from("customers").delete().eq("id", customerId));
  const slug = `staging-test-${stamp}`;
  const { data: ev, error: evErr } = await sk.from("events").insert({ customer_id: customerId, title: "[STAGING-TEST] event", event_type: "wedding", public_slug: slug }).select("id").single();
  if (evErr) throw evErr;
  cleanup.unshift(() => sk.from("events").delete().eq("id", ev.id));
  // consent as the customer, publish as service role
  const userClient = createClient(app.NEXT_PUBLIC_SUPABASE_URL, app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email, password });
  const { error: cErr } = await userClient.rpc("set_publication_consent", { p_event_id: ev.id, p_status: "granted" });
  check("customer grants consent", !cErr, cErr?.message);
  const { error: pErr } = await sk.from("events").update({ is_published: true }).eq("id", ev.id);
  check("event published", !pErr, pErr?.message);
  const assetId = crypto.randomUUID();
  const path = `events/${ev.id}/${assetId}/display.webp`;
  const img = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).webp().toBuffer();
  const up = await sk.storage.from("public-media").upload(path, img, { contentType: "image/webp" });
  check("upload published copy to public-media (private bucket)", !up.error, up.error?.message);
  cleanup.push(() => sk.storage.from("public-media").remove([path]));
  const { error: mErr } = await sk.from("media_assets").insert({ id: assetId, event_id: ev.id, bucket: "public-media", path, kind: "image", mime: "image/webp", bytes: img.length, visibility: "public", upload_status: "ready", variants: { display: path } });
  check("public media row created", !mErr, mErr?.message);

  // Direct storage URL must not work (bucket is private)
  const direct = await fetch(`${app.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/public-media/${path}`);
  check("direct public storage URL refused", direct.status >= 400, String(direct.status));

  const mUrl = `${BASE}/m/${assetId}/display`;
  const r1 = await fetch(mUrl);
  check("app /m route serves published media", r1.status === 200 && r1.headers.get("content-type")?.includes("image"), `${r1.status} ${r1.headers.get("cache-control")}`);
  const w1 = await fetch(`${BASE}/work/${slug}`);
  check("project page live", w1.status === 200, String(w1.status));

  // Withdraw consent as the customer through the portal UI
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=/portal/events/${ev.id}`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((x) => x.pathname === `/portal/events/${ev.id}`, { timeout: 60000 });
  check("customer reaches own portal event", true);
  await page.getByRole("button", { name: "سحب الموافقة على النشر" }).click();
  await page.getByTestId("consent-card").getByRole("button", { name: /تأكيد|نعم|متابعة/ }).first().click();
  await page.getByTestId("consent-status").filter({ hasText: "سحبت موافقتك" }).waitFor({ timeout: 30000 }).catch(() => {});
  await browser.close();

  const r2 = await fetch(`${mUrl}?after=${stamp}`);
  const r3 = await fetch(mUrl);
  check("same /m URL → 404 immediately after withdrawal", r2.status === 404 && r3.status === 404, `${r3.status} ${r3.headers.get("cache-control")}`);
  const w2 = await fetch(`${BASE}/work/${slug}`);
  check("project page 404 after withdrawal", w2.status === 404, String(w2.status));

  // Cron removes the object (poll up to ~150 s)
  let gone = false;
  for (let i = 0; i < 30 && !gone; i++) {
    const { data } = await sk.storage.from("public-media").list(`events/${ev.id}/${assetId}`);
    gone = (data ?? []).length === 0;
    if (!gone) await new Promise((r) => setTimeout(r, 5000));
  }
  check("published copy deleted by scheduled cleanup", gone);

  // Booking form: with Turnstile keys → full submission; without → production must refuse (fail closed).
  const turnstileConfigured = !!(app.NEXT_PUBLIC_TURNSTILE_SITE_KEY && app.TURNSTILE_SECRET_KEY);
  const b = await chromium.launch();
  const bp = await (await b.newContext({ locale: "ar" })).newPage();
  await bp.goto(`${BASE}/book`);
  if (!turnstileConfigured) {
    const { count: before } = await sk.from("booking_requests").select("id", { count: "exact", head: true });
    // Approved scope: booking is via WhatsApp only — /book renders no form and links to the verified number.
    const forms = await bp.locator("main form").count();
    const wa = await bp.locator('main a[href^="https://wa.me/970598677477?text="]').count();
    check("/book has no public form and offers WhatsApp booking", forms === 0 && wa > 0, `forms=${forms} whatsapp_links=${wa}`);
    await b.close();
    const { count: after } = await sk.from("booking_requests").select("id", { count: "exact", head: true });
    check("no booking row created by this run (existing real rows untouched)", after === before, `before=${before} after=${after}`);
  } else {
    await bp.locator("#contact_name").fill("[STAGING-TEST] booking");
    await bp.locator("#contact_phone").fill(`059${String(stamp).slice(-7)}`);
    await bp.locator("#event_type").selectOption({ index: 1 });
    await bp.locator("#event_date").fill(new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10));
    await bp.getByRole("button", { name: "التالي" }).click();
    await bp.locator(".cf-turnstile iframe").waitFor({ timeout: 30000 }).catch(() => {});
    await bp.waitForTimeout(4000); // widget issues its token
    await bp.getByRole("button", { name: "أرسل الطلب" }).click();
    await bp.getByRole("status").filter({ hasText: "رمز المتابعة" }).waitFor({ timeout: 30000 }).catch(() => {});
    const code = await bp.locator("p[dir=ltr].select-all").innerText().catch(() => null);
    check("booking inquiry with Turnstile → tracking code", !!code);
    await b.close();
    const { data: rows } = await sk.from("booking_requests").select("id").eq("contact_name", "[STAGING-TEST] booking");
    check("exactly one booking row created", (rows ?? []).length === 1, String((rows ?? []).length));
    cleanup.push(() => sk.from("booking_requests").delete().eq("contact_name", "[STAGING-TEST] booking"));
  }
} catch (e) {
  check("unexpected error", false, String(e?.message ?? e).slice(0, 200));
} finally {
  for (const fn of cleanup) { try { await fn(); } catch { /* best effort */ } }
  // Rows the normal deletes can't remove (immutable/consent history) go through the service-role-only purge.
  try { await sk.rpc("purge_test_fixtures", { p_prefix: "[STAGING-TEST]" }); } catch { /* reported by the checks below */ }
  const { data: list } = await sk.auth.admin.listUsers({ perPage: 200 });
  check("cleanup: no [STAGING-TEST] users left", !list.users.some((x) => x.email?.startsWith("staging-test-")));
  const { count: ev } = await sk.from("events").select("id", { count: "exact", head: true }).like("title", "[STAGING-TEST]%");
  const { count: bk } = await sk.from("booking_requests").select("id", { count: "exact", head: true }).like("contact_name", "[STAGING-TEST]%");
  const { count: cu } = await sk.from("customers").select("id", { count: "exact", head: true }).like("full_name", "[STAGING-TEST]%");
  check("cleanup: no [STAGING-TEST] events/bookings/customers left", (ev ?? 0) === 0 && (bk ?? 0) === 0 && (cu ?? 0) === 0, `events=${ev} bookings=${bk} customers=${cu}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} app checks passed`);
process.exit(failed ? 1 : 0);
