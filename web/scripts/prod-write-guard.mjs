// Guard for every script that WRITES test data to the hosted (production) project dyuixzxmmeiypvawzmty.
// Such scripts create [STAGING-TEST] users/customers/rows; a run by mistake leaves records in the owner's admin lists.
// A write run needs ALL of:
//   1. the flag  --allow-prod-writes
//   2. the env   CONFIRM_PROD_WRITES=dyuixzxmmeiypvawzmty   (typed on purpose, never stored in an env file)
//   3. the service URL the script will use (NEXT_PUBLIC_SUPABASE_URL in its env file) = exactly that project
//   4. when the script also drives a site (BASE_URL): that site must be wired to the SAME project — its CSP
//      header must name https://dyuixzxmmeiypvawzmty.supabase.co — and must answer. Otherwise UI writes and
//      service-key writes would land in two different databases.
// Anything missing or mismatched → the script stops (exit 3) BEFORE any write, account creation or upload.
// Read-only scripts do not call this. `checkProdWrite` is the pure rule set (unit-tested without network).
import fs from "node:fs";
import path from "node:path";

export const PROD_REF = "dyuixzxmmeiypvawzmty";
export const PROD_SUPABASE_URL = `https://${PROD_REF}.supabase.co`;

/** Pure decision: returns the list of unmet requirements (empty = allowed). */
export function checkProdWrite({ argv, env, serviceUrl, site }) {
  const problems = [];
  if (!argv.includes("--allow-prod-writes")) problems.push("missing --allow-prod-writes");
  if (env.CONFIRM_PROD_WRITES !== PROD_REF) problems.push(`missing CONFIRM_PROD_WRITES=${PROD_REF}`);
  if (!serviceUrl) problems.push("no service URL (env file missing or without NEXT_PUBLIC_SUPABASE_URL)");
  else if (serviceUrl.replace(/\/+$/, "") !== PROD_SUPABASE_URL) problems.push(`service URL is not the production project (${new URL(serviceUrl).host})`);
  if (site) {
    if (site.error) problems.push(`site ${site.url} did not answer (${site.error})`);
    else if (!site.csp || !site.csp.includes(PROD_SUPABASE_URL)) problems.push(`site ${site.url} is not wired to ${PROD_REF} (its CSP does not name it)`);
  }
  return problems;
}

function readServiceUrl(envFile) {
  try {
    const line = fs
      .readFileSync(path.resolve(envFile), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
    return line ? line.slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim() : null;
  } catch {
    return null;
  }
}

async function probeSite(url) {
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) });
    return { url, csp: r.headers.get("content-security-policy") ?? "" };
  } catch (e) {
    return { url, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @param script   name for messages
 * @param opts.envFile     env file the script reads its service URL/key from (default .env.staging.app.local)
 * @param opts.siteDefault the script's default BASE_URL when it drives a site (null/undefined = no site)
 */
export async function assertProdWriteAllowed(script, { envFile = ".env.staging.app.local", siteDefault } = {}) {
  const serviceUrl = readServiceUrl(envFile);
  const flagged = process.argv.includes("--allow-prod-writes") && process.env.CONFIRM_PROD_WRITES === PROD_REF;
  // Probe the site only once the explicit opt-in is there (no network call just to refuse).
  const siteUrl = siteDefault !== undefined && siteDefault !== null ? (process.env.BASE_URL ?? siteDefault) : null;
  const site = siteUrl && flagged ? await probeSite(siteUrl) : siteUrl ? { url: siteUrl, csp: "" } : null;
  const problems = checkProdWrite({ argv: process.argv, env: process.env, serviceUrl, site: flagged ? site : null });
  if (!problems.length) {
    console.warn(`⚠ ${script}: writing [STAGING-TEST] data to the production project ${PROD_REF} (explicitly allowed for this run${siteUrl ? `, site ${siteUrl}` : ""}).`);
    return;
  }
  console.error(
    [
      `✗ ${script} writes test data to the PRODUCTION project and was not allowed. Nothing was written.`,
      ...problems.map((p) => `  - ${p}`),
      "  Prefer the local stack (npm run e2e:reset + Playwright) for anything that creates data.",
    ].join("\n"),
  );
  process.exit(3);
}
