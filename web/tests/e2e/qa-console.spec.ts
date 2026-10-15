import { expect, test } from "@playwright/test";
import { BASE, EV, uiLogin, watchErrors, type Who } from "./qa-helpers";

/** Console errors, CSP violations, failed requests and 5xx on key pages (production build). */
const SETS: { who?: Who; pages: string[] }[] = [
  { pages: ["/", "/work", "/work/dev-sample-published-project", "/services", "/about", "/contact", "/book", "/track", "/faq", "/privacy", "/terms", "/login"] },
  {
    who: "a",
    pages: ["/portal", ...["", "/gallery", "/selection", "/videos", "/files", "/quotes", "/contracts", "/payments"].map((s) => `/portal/events/${EV.A1}${s}`)],
  },
  {
    who: "owner",
    pages: ["/admin", "/admin/bookings", "/admin/customers", "/admin/calendar", "/admin/events", "/admin/media", "/admin/production", "/admin/reviews", "/admin/quotes", "/admin/contracts", "/admin/finance", "/admin/staff", "/admin/equipment", "/admin/support", "/admin/users", "/admin/settings", "/admin/backups"],
  },
  { who: "staff", pages: ["/admin", "/admin/events", "/admin/media", "/admin/production"] },
];

for (const set of SETS) {
  test(`console clean: ${set.who ?? "anon"} pages`, async ({ page }) => {
    test.setTimeout(300_000);
    if (set.who) await uiLogin(page, set.who, set.pages[0]);
    const w = watchErrors(page);
    const csp: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text());
    });
    for (const p of set.pages) {
      await page.goto(`${BASE}${p}`, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(500);
    }
    test.info().annotations.push({ type: "known local https artifacts", description: String(w.known.length) });
    expect(csp, "CSP violations").toEqual([]);
    expect(w.errors).toEqual([]);
  });
}
