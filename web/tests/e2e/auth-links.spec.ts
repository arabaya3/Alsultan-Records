/**
 * Auth email links across devices. LOCAL STACK ONLY (qa-helpers refuses a non-local Supabase).
 *
 * What it proves:
 *  - token_hash templates (supabase/templates/*.html, declared in config.toml as
 *    [auth.email.template.magic_link|recovery|invite]): a magic link / reset link requested in
 *    browser A works when opened in a FRESH browser B (another device) → /portal, /auth/reset.
 *  - default Supabase templates ({{ .ConfirmationURL }}, PKCE): the same link opened in B fails
 *    (/login?error=link with the "another device" notice) and only works in the requesting browser.
 *
 * Prerequisites (templates load only when the stack starts):
 *  - config.toml `site_url` must be the app origin under test ({{ .SiteURL }} builds the token_hash
 *    link), and the origin + "/**" must be in `additional_redirect_urls` (PKCE emailRedirectTo).
 *  - AUTH_LINK_TEMPLATES=token_hash (default): template sections active, then
 *    `npx supabase stop && npx supabase start`.
 *  - AUTH_LINK_TEMPLATES=default: comment out the three [auth.email.template.*] sections, restart
 *    the stack, run, then restore config.toml and restart again.
 *  - App: production build against the LOCAL stack, e.g. BASE_URL=http://localhost:4100.
 *  - Mail: Mailpit API (MAILPIT_URL, default http://127.0.0.1:54324).
 *
 *   AUTH_LINK_TEMPLATES=token_hash BASE_URL=http://localhost:4100 npx playwright test auth-links
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BASE, db, USERS } from "./qa-helpers";

const MAIL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const MODE = (process.env.AUTH_LINK_TEMPLATES ?? "token_hash") as "token_hash" | "default";
const WHO = USERS.b;
const LINK_NOTICE = /جهاز أو متصفح/;

async function clearMail(email: string) {
  await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, { method: "DELETE" });
}

/** Waits for the newest mail to `email` and returns the first auth link in it. */
async function fetchLink(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`);
    const json = (await res.json()) as { messages?: { ID: string }[] };
    const id = json.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAIL}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
      const body = msg.HTML || msg.Text || "";
      const m = /href="([^"]*(?:\/auth\/callback|\/auth\/v1\/verify)[^"]*)"/.exec(body);
      if (m) return m[1].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no auth mail for ${email}`);
}

function assertShape(link: string) {
  if (MODE === "token_hash") {
    expect(link, "token_hash template must be active").toContain("token_hash=");
    expect(new URL(link).origin).toBe(new URL(BASE).origin);
  } else {
    expect(link, "default (PKCE) template must be active").toContain("/auth/v1/verify");
  }
}

// GoTrue allows one OTP/recovery email per user per 60 s (it answers 429, the app still shows "sent").
let lastRequest = 0;

async function request(page: Page, kind: "magic" | "reset"): Promise<string> {
  const wait = lastRequest + 61_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  await clearMail(WHO.email);
  await page.goto("/login");
  await page.getByRole("button", { name: kind === "magic" ? "الدخول برابط عبر البريد" : "نسيت كلمة المرور؟" }).click();
  await page.getByLabel("البريد الإلكتروني").fill(WHO.email);
  await page.getByRole("button", { name: kind === "magic" ? "أرسل لي رابط الدخول" : "أرسل رابط إعادة التعيين" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const link = await fetchLink(WHO.email);
  assertShape(link);
  return link;
}

async function fresh(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ar" });
  return { ctx, page: await ctx.newPage() };
}

test.describe.configure({ mode: "serial" });

// Precondition, not a flake: in token_hash mode the mailed link is built from config.toml `site_url`, so it can only
// point at the app under test when site_url has the same origin as BASE_URL. Otherwise skip with the reason (a full
// run usually targets another port); run this spec on its own as described in the header.
const SITE_URL = /^site_urls*=s*"([^"]+)"/m.exec(fs.readFileSync(path.resolve(__dirname, "../../supabase/config.toml"), "utf8"))?.[1] ?? "";
const SITE_MATCH = MODE !== "token_hash" || (SITE_URL !== "" && new URL(SITE_URL).origin === new URL(BASE).origin);

test.describe(`auth links — ${MODE} templates`, () => {
  test.skip(!SITE_MATCH, `precondition: config.toml site_url (${SITE_URL}) must have the origin of BASE_URL (${BASE}); see the header of this spec`);
  test.afterAll(async () => {
    // Restore the seed password whatever happened.
    const { data } = await db.auth.admin.listUsers({ perPage: 200 });
    const u = data.users.find((x) => x.email === WHO.email);
    if (u) await db.auth.admin.updateUserById(u.id, { password: WHO.password });
  });

  if (MODE === "token_hash") {
    test("magic link requested in A opens signed-in in fresh context B → /portal", async ({ browser }) => {
      const a = await fresh(browser);
      const link = await request(a.page, "magic");
      const b = await fresh(browser);
      expect((await b.ctx.cookies()).length).toBe(0);
      await b.page.goto(link);
      await expect(b.page).toHaveURL(/\/portal(\/|$|\?)/);
      await a.ctx.close();
      await b.ctx.close();
    });

    test("reset link requested in A works in fresh context B; new password signs in", async ({ browser }) => {
      const a = await fresh(browser);
      const link = await request(a.page, "reset");
      const b = await fresh(browser);
      await b.page.goto(link);
      await expect(b.page).toHaveURL(/\/auth\/reset/);
      const newPw = `LinkProof!${Date.now()}`;
      await b.page.getByLabel("كلمة المرور الجديدة").fill(newPw);
      await b.page.getByLabel("تأكيد كلمة المرور").fill(newPw);
      await b.page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
      await expect(b.page).toHaveURL(/\/portal/);

      const c = await fresh(browser);
      await c.page.goto("/login");
      await c.page.getByLabel("البريد الإلكتروني").fill(WHO.email);
      await c.page.getByLabel("كلمة المرور").fill(newPw);
      await c.page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await expect(c.page).toHaveURL(/\/portal/);
      for (const x of [a, b, c]) await x.ctx.close();
    });
  } else {
    for (const kind of ["magic", "reset"] as const) {
      const okUrl = kind === "magic" ? /\/portal/ : /\/auth\/reset/;

      test(`${kind}: PKCE link opened in fresh context B fails with the other-device notice`, async ({ browser }) => {
        const a = await fresh(browser);
        const link = await request(a.page, kind);
        const b = await fresh(browser);
        await b.page.goto(link);
        await expect(b.page).toHaveURL(/\/login\?error=link/);
        // (Next's route announcer is a second role=alert, so filter by text.)
        await expect(b.page.getByRole("alert").filter({ hasText: LINK_NOTICE })).toBeVisible();
        await a.ctx.close();
        await b.ctx.close();
      });

      test(`${kind}: PKCE link opened in the requesting context A succeeds`, async ({ browser }) => {
        const a = await fresh(browser);
        const link = await request(a.page, kind);
        await a.page.goto(link);
        await expect(a.page).toHaveURL(okUrl);
        if (kind === "reset") await expect(a.page.getByLabel("كلمة المرور الجديدة")).toBeVisible();
        await a.ctx.close();
      });
    }
  }
});
