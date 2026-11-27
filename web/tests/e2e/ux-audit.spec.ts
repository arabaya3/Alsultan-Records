import { test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { BASE, db, EV, uiLogin, type Who } from "./qa-helpers";

/**
 * Frontend UX audit sweep (evidence, not a gate): every main route × 360/390/768/1440.
 * Records console errors, failed requests, horizontal overflow, broken/unsized/alt-less images,
 * axe (WCAG 2.2 AA) violations, and a full-page screenshot per route and width.
 * LOCAL ISOLATED STACK + PRODUCTION BUILD ONLY. Seed data only — no customer media.
 *   AUDIT_PHASE=before|after BASE_URL=http://localhost:3401 npx playwright test tests/e2e/ux-audit.spec.ts --project=chromium
 * Output: test-results/ux-audit/<phase>/{report.json,*.png}
 */
const PHASE = process.env.AUDIT_PHASE ?? "before";
const OUT = path.resolve(process.env.AUDIT_OUT ?? path.resolve(__dirname, "../../.cache/ux-audit"), PHASE);
const WIDTHS = [360, 390, 768, 1440];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Row = {
  name: string; url: string; width: number;
  console: string[]; failed: string[]; overflow: number; offenders: string[];
  images: { broken: string[]; noAlt: number; notLazyBelowFold: number; total: number };
  axe: { id: string; impact: string; n: number; sample: string }[];
  smallTargets: number;
};
const rows: Row[] = [];

async function audit(page: Page, name: string, url: string, width: number) {
  const consoleMsgs: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleMsgs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && !u.hostname.includes("youtube") && !u.hostname.includes("google")) failed.push(`${r.status()} ${u.pathname}`);
  });
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE}${url}`, { waitUntil: "load" }));
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > vw + 1 || b.left < -1)) {
        let p: HTMLElement | null = el.parentElement, clipped = false;
        while (p) { const s = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
        if (!clipped && getComputedStyle(el).position !== "fixed") offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
      }
    }
    const imgs = Array.from(document.images);
    const fold = window.innerHeight * 1.5;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("a,button,[role=button],input,select,textarea")).filter((e) => {
      const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && !e.closest(".sr-only") && (b.width < 24 || b.height < 24) && e.tagName !== "A";
    });
    return {
      overflow: document.documentElement.scrollWidth - vw,
      offenders: offenders.slice(0, 5),
      images: {
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => new URL(i.src).pathname).slice(0, 5),
        noAlt: imgs.filter((i) => !i.hasAttribute("alt")).length,
        notLazyBelowFold: imgs.filter((i) => i.getBoundingClientRect().top > fold && i.loading !== "lazy").length,
        total: imgs.length,
      },
      smallTargets: targets.length,
    };
  });
  const r = await new AxeBuilder({ page }).withTags(TAGS).exclude("iframe").analyze();
  const axe = r.violations.map((v) => ({ id: v.id, impact: v.impact ?? "?", n: v.nodes.length, sample: v.nodes[0]?.target.join(" ").slice(0, 120) ?? "" }));
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
  rows.push({ name, url, width, console: consoleMsgs, failed, ...m, axe });
}

async function ctx(browser: Browser, width: number, who?: Who, next = "/") {
  const c = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 800 }, locale: "ar", reducedMotion: "reduce" });
  const page = await c.newPage();
  if (who) await uiLogin(page, who, next);
  return { c, page };
}

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

test("UX sweep: public, admin, portal × 4 widths", async ({ browser }) => {
  const offer = (await db.from("offers").select("slug").limit(1)).data?.[0]?.slug as string | undefined;
  const album = (await db.from("photo_albums").select("slug").not("published_at", "is", null).limit(1)).data?.[0]?.slug as string | undefined;
  const cat = (await db.from("video_categories").select("slug").limit(1)).data?.[0]?.slug as string | undefined;

  const pub: [string, string][] = [
    ["home", "/"], ["work", "/work"], ["offers", "/offers"], ["packages", "/packages"], ["about", "/about"],
    ["book", "/book"], ["contact", "/contact"], ["faq", "/faq"], ["privacy", "/privacy"], ["terms", "/terms"],
    ["track", "/track"], ["login", "/login"], ["404", "/no-such-page"],
  ];
  if (offer) pub.push(["offer-detail", `/offers/${offer}`]);
  if (album) pub.push(["album", `/work/albums/${album}`]);
  if (cat) pub.push(["work-category", `/work?cat=${cat}`]);
  const admin: [string, string][] = [
    ["admin-overview", "/admin/overview"], ["admin-events", "/admin/events"], ["admin-event", `/admin/events/${EV.A1}`],
    ["admin-customers", "/admin/customers"], ["admin-bookings", "/admin/bookings"], ["admin-calendar", "/admin/calendar"],
    ["admin-videos", "/admin/videos"], ["admin-albums", "/admin/albums"], ["admin-content", "/admin/content"],
    ["admin-offers", "/admin/content/offers"], ["admin-packages", "/admin/content/packages"], ["admin-home", "/admin/content/home"],
    ["admin-quotes", "/admin/quotes"], ["admin-contracts", "/admin/contracts"], ["admin-finance", "/admin/finance"],
    ["admin-reviews", "/admin/reviews"], ["admin-support", "/admin/support"], ["admin-settings", "/admin/settings"],
    ["admin-users", "/admin/users"], ["admin-account", "/admin/account"], ["admin-production", "/admin/production"],
    ["admin-media", "/admin/media"], ["admin-equipment", "/admin/equipment"], ["admin-staff", "/admin/staff"], ["admin-backups", "/admin/backups"],
  ];
  const portal: [string, string][] = [
    ["portal", "/portal"], ["portal-event", `/portal/events/${EV.A1}`], ["portal-gallery", `/portal/events/${EV.A1}/gallery`],
    ["portal-videos", `/portal/events/${EV.A1}/videos`], ["portal-files", `/portal/events/${EV.A1}/files`],
    ["portal-quotes", `/portal/events/${EV.A1}/quotes`], ["portal-payments", `/portal/events/${EV.A1}/payments`],
    ["portal-contracts", `/portal/events/${EV.A1}/contracts`], ["portal-selection", `/portal/events/${EV.A1}/selection`],
  ];
  // Detail / edit pages: first seed row of each table (view only — the sweep never submits a form).
  const first = async (table: string, col = "id") => (await db.from(table).select(col).limit(1)).data?.[0]?.[col as never] as string | undefined;
  const detailAdmin: [string, string][] = [];
  const addA = (name: string, id: string | undefined, url: (id: string) => string) => { if (id) detailAdmin.push([name, url(id)]); };
  addA("admin-quote", await first("quotes"), (id) => `/admin/quotes/${id}`);
  addA("admin-quote-new", "x", () => "/admin/quotes/new");
  addA("admin-contract", await first("contracts"), (id) => `/admin/contracts/${id}`);
  addA("admin-customer", await first("customers"), (id) => `/admin/customers/${id}`);
  addA("admin-customer-new", "x", () => "/admin/customers/new");
  addA("admin-event-new", "x", () => "/admin/events/new");
  addA("admin-event-media", EV.A1, (id) => `/admin/events/${id}/media`);
  addA("admin-booking", await first("booking_requests"), (id) => `/admin/bookings/${id}`);
  addA("admin-video", await first("showcase_videos"), (id) => `/admin/videos/${id}`);
  addA("admin-video-categories", "x", () => "/admin/videos/categories");
  addA("admin-album", await first("photo_albums"), (id) => `/admin/albums/${id}`);
  addA("admin-album-preview", await first("photo_albums"), (id) => `/admin/albums/${id}/preview`);
  addA("admin-package", await first("packages"), (id) => `/admin/content/packages/${id}`);
  addA("admin-offer", await first("offers"), (id) => `/admin/content/offers/${id}`);
  addA("admin-announcement", await first("announcements"), (id) => `/admin/content/announcements/${id}`);
  addA("admin-announcements", "x", () => "/admin/content/announcements");
  addA("admin-service", await first("services"), (id) => `/admin/content/services/${id}`);
  addA("admin-services", "x", () => "/admin/content/services");
  addA("admin-identity", "x", () => "/admin/content/identity");
  addA("admin-nav", "x", () => "/admin/content/nav");
  addA("admin-process", "x", () => "/admin/content/process");
  addA("admin-support-item", await first("support_requests"), (id) => `/admin/support/${id}`);
  addA("admin-deliverable", await first("deliverables"), (id) => `/admin/production/${id}`);
  addA("admin-production-albums", "x", () => "/admin/production/albums");
  addA("admin-snapshot", await first("album_selection_snapshots"), (id) => `/admin/production/albums/${id}`);
  const deliv = (await db.from("deliverables").select("id").eq("event_id", EV.A1).limit(1)).data?.[0]?.id as string | undefined;
  const yt = await first("showcase_videos", "youtube_id");
  const detailPortal: [string, string][] = [];
  if (deliv) detailPortal.push(["portal-film", `/portal/events/${EV.A1}/videos/${deliv}`]);
  const detailPub: [string, string][] = [["services", "/services"]];
  const svc = await first("services", "slug");
  if (svc) detailPub.push(["service-detail", `/services/${svc}`]);
  if (yt) detailPub.push(["video-page", `/work/v/${yt}`]);
  detailPub.push(["auth-reset", "/auth/reset"]);

  const only = process.env.AUDIT_ONLY;
  const groups = [
    ["pub", pub, undefined, "/"], ["admin", admin, "owner", "/admin"], ["portal", portal, "a", "/portal"],
    ["detail-pub", detailPub, undefined, "/"], ["detail-admin", detailAdmin, "owner", "/admin"], ["detail-portal", detailPortal, "a", "/portal"],
  ] as const;
  for (const width of WIDTHS) {
    for (const [group, list, who, next] of groups) {
      if (!only && group.startsWith("detail")) continue; // detail pages run only when asked: AUDIT_ONLY=detail
      if (only && !group.startsWith(only)) continue;
      const { c, page } = await ctx(browser, width, who as Who | undefined, next);
      for (const [name, url] of list) {
        try { await audit(page, name, url, width); } catch (e) { rows.push({ name, url, width, console: [`AUDIT FAILED: ${(e as Error).message.slice(0, 200)}`], failed: [], overflow: 0, offenders: [], images: { broken: [], noAlt: 0, notLazyBelowFold: 0, total: 0 }, axe: [], smallTargets: 0 }); }
        page.removeAllListeners("console"); page.removeAllListeners("pageerror"); page.removeAllListeners("response");
      }
      await c.close();
    }
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 1));
});
