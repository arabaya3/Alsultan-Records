import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** QA helpers. LOCAL STACK ONLY: refuses to run against a non-local Supabase. */
export const BASE = process.env.BASE_URL ?? "http://localhost:3400";
export const SHOTS = path.resolve(__dirname, "../../../docs/screenshots");

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = path.resolve(__dirname, "../../.env.local");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}
export const E = readEnv();
const host = new URL(E.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`QA specs refuse non-local Supabase host ${host}`);

export const SB_URL = E.NEXT_PUBLIC_SUPABASE_URL;
export const PUB_KEY = E.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
/** Verification-only client (test code, local stack). Never shipped to the browser. */
export const db = createClient(SB_URL, E.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

export const USERS = {
  owner: { email: "owner@dev.local", password: "DevOwner!2026" },
  admin: { email: "admin@dev.local", password: "DevAdmin!2026" },
  staff: { email: "staff@dev.local", password: "DevStaff!2026" },
  a: { email: "customer.a@dev.local", password: "DevCustA!2026" },
  b: { email: "customer.b@dev.local", password: "DevCustB!2026" },
} as const;
export type Who = keyof typeof USERS;

export const EV = {
  A1: "00000000-0000-4000-8000-0000000000e1",
  A2: "00000000-0000-4000-8000-0000000000e2",
  B1: "00000000-0000-4000-8000-0000000000e3",
  B2: "00000000-0000-4000-8000-0000000000e4",
};
export const QUOTE_A = "00000000-0000-4000-8000-0000000001c1";
export const CONTRACT_A = "00000000-0000-4000-8000-0000000001d1";
export const DOC_B = "00000000-0000-4000-8000-0000000001b1";

export function anon(): SupabaseClient {
  return createClient(SB_URL, PUB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function as(who: Who): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword(USERS[who]);
  if (error) throw new Error(`login ${who}: ${error.message}`);
  return c;
}

export async function uiLogin(page: Page, who: Who, next = "/portal") {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.locator("#email").fill(USERS[who].email);
  await page.locator("#password").fill(USERS[who].password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next.split("?")[0]), { timeout: 60_000 });
}

export async function newLoggedIn(browser: Browser, who: Who, next: string, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 1000 : 844 }, locale: "ar" });
  const page = await ctx.newPage();
  await uiLogin(page, who, next);
  return page;
}

/**
 * Known environment artifact: the production CSP contains `upgrade-insecure-requests`, so when the
 * prod build is served over plain http on localhost, the prefetch of the header's /portal link
 * (307 -> /login) is upgraded to https://localhost:3400 and fails with ERR_SSL_PROTOCOL_ERROR.
 * On a real https deployment this cannot happen. Everything else counts as a failure.
 */
export function isKnownLocalHttpsArtifact(text: string, url?: string) {
  return (url ?? "").startsWith("https://localhost:") || /ERR_SSL_PROTOCOL_ERROR/.test(text);
}

export function watchErrors(page: Page) {
  const errors: string[] = [];
  const known: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    (isKnownLocalHttpsArtifact(m.text()) ? known : errors).push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const t = `${r.failure()?.errorText} ${r.url()}`;
    // Aborted RSC prefetches / media range requests on navigation are benign.
    if (/ERR_ABORTED/.test(t)) return;
    (isKnownLocalHttpsArtifact(t, r.url()) ? known : errors).push(`requestfailed: ${t}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return { errors, known };
}

export async function overflowPx(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Runs SQL as postgres inside the LOCAL supabase db container (fixtures/verification only). */
export function psql(sql: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  return execFileSync("docker", ["exec", "-i", "supabase_db_alsultan-records", "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
}
