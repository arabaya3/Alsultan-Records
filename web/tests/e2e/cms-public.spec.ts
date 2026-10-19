import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { BASE, db, overflowPx } from "./qa-helpers";

/**
 * Public site rendered from the CMS tables (docs/cms-contract.md).
 * LOCAL STACK + PRODUCTION BUILD:
 *   npm run build && npx next start -p 3600
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/cms-public.spec.ts --project=chromium
 *
 * Fixtures are written with the SECRET key (bypasses the admin UI); public reads are 'use cache' with
 * cacheLife("minutes"), and only admin actions call updateTag — so after writing, the spec polls the
 * page until the background revalidation (≈1 min) shows the change. Every fixture is restored afterwards
 * and the spec waits for the default state again so later specs see today's site.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const NAV_LABEL = "خدماتنا اختبار";
const ANN_TEXT = "إعلان اختبار CMS — اطّلع على الأسئلة الشائعة";
const SVC_OLD = "cms-test-svc";
const SVC_NEW = "cms-test-svc-renamed";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type NavRow = { id: string; label: string; target: string; sort_order: number; is_visible: boolean };
type SectionRow = { key: string; is_visible: boolean };
let navBefore: NavRow[] = [];
let sectionsBefore: SectionRow[] = [];
let annId: string | null = null;
let svcId: string | null = null;

const hebronToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function html(p: string): Promise<string> {
  const r = await fetch(new URL(p, BASE), { redirect: "manual" });
  return r.text();
}
/** Polls until the cached page shows the expected state (background revalidation). */
async function until(p: string, pred: (h: string) => boolean, timeout = 200_000) {
  await expect.poll(async () => pred(await html(p)), { timeout, intervals: [3_000, 5_000, 10_000] }).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  navBefore = ((await db.from("nav_items").select("id, label, target, sort_order, is_visible")).data ?? []) as NavRow[];
  sectionsBefore = ((await db.from("site_sections").select("key, is_visible")).data ?? []) as SectionRow[];
  expect(navBefore.length, "nav_items seeded").toBeGreaterThan(0);

  // Nav: services renamed and moved first, about hidden.
  const svc = navBefore.find((n) => n.target === "services")!;
  const about = navBefore.find((n) => n.target === "about")!;
  expect((await db.from("nav_items").update({ label: NAV_LABEL, sort_order: 1 }).eq("id", svc.id)).error).toBeNull();
  expect((await db.from("nav_items").update({ is_visible: false }).eq("id", about.id)).error).toBeNull();
  // Home: hide «كيف نشتغل».
  expect((await db.from("site_sections").update({ is_visible: false }).eq("key", "process")).error).toBeNull();
  // Announcement (bar) linking to the allow-listed FAQ page, active from today.
  const ann = await db
    .from("announcements")
    .insert({ template: "bar", text: ANN_TEXT, link_kind: "page", link_page: "faq", starts_on: hebronToday(), is_visible: true, dismissible: true, sort_order: 1 })
    .select("id")
    .single();
  expect(ann.error).toBeNull();
  annId = ann.data!.id;
  // Service whose slug gets renamed → slug_redirects row by trigger.
  await db.from("services").delete().in("slug", [SVC_OLD, SVC_NEW]);
  await db.from("slug_redirects").delete().in("from_path", [`/services/${SVC_OLD}`, `/services/${SVC_NEW}`]);
  const s = await db
    .from("services")
    .insert({ slug: SVC_OLD, title: "خدمة اختبار CMS", summary: "ملخّص اختبار.", body: "تفاصيل اختبار.", is_published: true, sort_order: 999 })
    .select("id")
    .single();
  expect(s.error).toBeNull();
  svcId = s.data!.id;
  expect((await db.from("services").update({ slug: SVC_NEW }).eq("id", svcId)).error).toBeNull();

  await until("/", (h) => h.includes(NAV_LABEL) && h.includes("إعلان اختبار CMS") && !h.includes('id="steps-title"'));
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  for (const n of navBefore) await db.from("nav_items").update({ label: n.label, sort_order: n.sort_order, is_visible: n.is_visible }).eq("id", n.id);
  for (const s of sectionsBefore) await db.from("site_sections").update({ is_visible: s.is_visible }).eq("key", s.key);
  if (annId) await db.from("announcements").delete().eq("id", annId);
  if (svcId) await db.from("services").delete().eq("id", svcId);
  await db.from("slug_redirects").delete().in("from_path", [`/services/${SVC_OLD}`]);
  await until("/", (h) => !h.includes(NAV_LABEL) && !h.includes("إعلان اختبار CMS") && h.includes('id="steps-title"'));
  // /services is cached separately: wait until it no longer lists the deleted test service, otherwise its link
  // prefetch 404s and fails later console-error checks (public.spec) — the restore must cover every page it touched.
  await until("/services", (h) => !h.includes(SVC_NEW) && !h.includes(SVC_OLD));
});

test("header nav labels and order come from nav_items; footer uses the same; never admin; login only as the plain /login entry", async ({ page }) => {
  await page.goto("/");
  const header = page.locator("header nav[aria-label='القائمة الرئيسية']").first().locator("a");
  const items = await header.evaluateAll((as) => as.map((a) => ({ text: a.textContent?.trim(), href: a.getAttribute("href") })));
  const expected = navBefore
    .filter((n) => n.is_visible && n.target !== "about")
    .map((n) => (n.target === "services" ? { ...n, label: NAV_LABEL, sort_order: 1 } : n))
    .sort((a, b) => a.sort_order - b.sort_order);
  expect(items.map((i) => i.text)).toEqual(expected.map((n) => n.label));
  expect(items[0]).toEqual({ text: NAV_LABEL, href: "/services" });
  expect(items.some((i) => i.href === "/about")).toBe(false);

  // The footer no longer repeats the site nav (it lives in the header); only the legal links remain there.
  const footer = await page.locator("[data-site-footer] nav a").evaluateAll((as) => as.map((a) => a.textContent?.trim()));
  expect(footer).toEqual(["الخصوصية", "الشروط"]);
  const all = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect(all.filter((h) => /^\/admin/.test(h))).toEqual([]);
  // «تسجيل الدخول» entry (owner request): plain /login only — never a deep link into the admin/portal.
  expect([...new Set(all.filter((h) => /^\/login/.test(h)))]).toEqual(["/login"]);
});

test("hidden home section is not rendered at all; visible ones keep their order", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#steps-title")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "كيف نشتغل" })).toHaveCount(0);
  await expect(page.locator("#services-title")).toBeVisible();
  // Never an empty box: every rendered section has a heading and content.
  for (const s of await page.locator("main > section[aria-labelledby]").all()) {
    expect(((await s.textContent()) ?? "").trim().length).toBeGreaterThan(10); // textContent: scroll-reveal content counts too
  }
});

test("announcement link works and dismissal persists per announcement", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator(`[data-announcement="${annId}"]`);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-template", "bar");
  await bar.locator("[data-announcement-link]").click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.locator(`[data-announcement="${annId}"]`)).toBeVisible();
  await page.locator(`[data-announcement="${annId}"] [data-announcement-dismiss]`).click();
  await expect(page.locator(`[data-announcement="${annId}"]`)).toBeHidden();
  expect(await page.evaluate((id) => localStorage.getItem(`ann-dismissed:${id}`), annId)).toBe("1");
  await page.goto("/");
  await expect(page.locator(`[data-announcement="${annId}"]`)).toBeHidden();
  await page.reload();
  await expect(page.locator(`[data-announcement="${annId}"]`)).toBeHidden();
});

test("renamed service slug: old URL 308 → new URL, new URL 200, unknown still 404", async () => {
  const red = (await db.from("slug_redirects").select("to_path").eq("from_path", `/services/${SVC_OLD}`).single()).data;
  expect(red?.to_path).toBe(`/services/${SVC_NEW}`);
  const old = await fetch(new URL(`/services/${SVC_OLD}`, BASE), { redirect: "manual" });
  expect(old.status).toBe(308);
  expect(new URL(old.headers.get("location")!, BASE).pathname).toBe(`/services/${SVC_NEW}`);
  const fresh = await fetch(new URL(`/services/${SVC_NEW}`, BASE), { redirect: "manual" });
  expect(fresh.status).toBe(200);
  expect((await fetch(new URL("/services/no-such-service-xyz", BASE), { redirect: "manual" })).status).toBe(404);
});

test("no horizontal overflow 360–1920 on CMS-driven pages", async ({ browser }) => {
  const res: Record<string, number> = {};
  for (const w of [360, 390, 768, 1024, 1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    for (const p of ["/", "/offers", "/services", "/work?tab=promos", "/work?tab=photos", "/faq"]) {
      await page.goto(p);
      res[`${p}@${w}`] = await overflowPx(page);
    }
    await ctx.close();
  }
  test.info().annotations.push({ type: "overflow", description: JSON.stringify(res) });
  expect(Object.entries(res).filter(([, v]) => v > 0)).toEqual([]);
});

async function axe(page: Page, p: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(p);
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${p}: ${v.id} (${v.nodes.length})`);
}

test("axe: /, /offers, /services (with announcement) have no serious/critical violations", async ({ page }) => {
  const bad = [...(await axe(page, "/")), ...(await axe(page, "/offers")), ...(await axe(page, "/services"))];
  expect(bad).toEqual([]);
});

test("active logo: /a/<id> serves only the active logo; header switches; fallback restores the built-in logo", async ({ page }) => {
  test.setTimeout(480_000);
  const before = (await db.from("business_settings").select("active_logo_id").eq("id", 1).single()).data?.active_logo_id ?? null;
  const id = crypto.randomUUID();
  const storagePath = `brand/${id}/logo.webp`;
  const bytes = fs.readFileSync(path.resolve(__dirname, "../../public/brand/logo-main.webp"));
  expect((await db.storage.from("site-media").upload(storagePath, bytes, { contentType: "image/webp", upsert: true })).error).toBeNull();
  expect((await db.from("brand_assets").insert({ id, kind: "logo", storage_path: storagePath, mime: "image/webp", width: 900, height: 748, bytes: bytes.length })).error).toBeNull();
  try {
    // Not active yet → 404 (RPC returns the path only for the active logo).
    expect((await fetch(new URL(`/a/${id}`, BASE))).status).toBe(404);
    expect((await db.from("business_settings").update({ active_logo_id: id }).eq("id", 1)).error).toBeNull();
    const ok = await fetch(new URL(`/a/${id}`, BASE));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toBe("public, max-age=300");
    expect(ok.headers.get("cdn-cache-control")).toBe("no-store");
    expect((await fetch(new URL(`/a/${crypto.randomUUID()}`, BASE))).status).toBe(404);
    expect((await fetch(new URL("/a/not-a-uuid", BASE))).status).toBe(404);

    await until("/", (h) => h.includes(`/a/${id}`));
    await page.goto("/");
    await expect(page.locator(`header img[src="/a/${id}"]`)).toBeVisible();
    await expect(page.locator(`footer img[src="/a/${id}"]`)).toBeVisible();
    await expect(page.locator(`[data-hero-intro] img[src="/a/${id}"]`)).toBeAttached();
  } finally {
    await db.from("business_settings").update({ active_logo_id: before }).eq("id", 1);
  }
  // Rolled back → the old id stops serving immediately; pages return to the built-in logo.
  expect((await fetch(new URL(`/a/${id}`, BASE))).status).toBe(404);
  await until("/", (h) => !h.includes(`/a/${id}`));
  await page.goto("/");
  await expect(page.locator('header img[src*="logo-main"], header img[srcset*="logo-main"]').first()).toBeVisible();
  await db.from("brand_assets").delete().eq("id", id);
  await db.storage.from("site-media").remove([storagePath]);
});
