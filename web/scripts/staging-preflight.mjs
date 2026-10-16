#!/usr/bin/env node
/**
 * Staging preflight — READ ONLY. Run before any remote write:
 *   node scripts/staging-preflight.mjs
 *
 * Reads web/.env.staging.local (gitignored). Never prints secret values.
 * 1. Verifies the env file is gitignored and holds the required variable names.
 * 2. Confirms the access token can see EXACTLY the expected project ref and that it is not the old project.
 * 3. Inspects remote state (schemas, tables, migrations history, buckets, auth users count, hooks)
 *    through the Management API read-only SQL endpoint, so we know whether the database is empty.
 * Exits non-zero on any mismatch.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_REF = "dyuixzxmmeiypvawzmty";
const FORBIDDEN_REFS = ["peufggxvklpnaytyklgg"]; // old production project — must never be targeted
const REQUIRED = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.staging.local");
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

if (!existsSync(envPath)) fail("web/.env.staging.local not found (see docs/handoff.md → Staging).");
try {
  execFileSync("git", ["check-ignore", "-q", envPath], { cwd: root });
  ok(".env.staging.local is gitignored");
} catch {
  fail(".env.staging.local is NOT gitignored — stop.");
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) fail(`missing variables: ${missing.join(", ")}`);
ok(`required variables present: ${REQUIRED.join(", ")} (values not shown)`);

const ref = env.SUPABASE_PROJECT_REF;
if (FORBIDDEN_REFS.includes(ref)) fail("SUPABASE_PROJECT_REF points at the OLD project. Refusing.");
if (ref !== EXPECTED_REF) fail(`SUPABASE_PROJECT_REF is "${ref}", expected "${EXPECTED_REF}".`);
ok(`project ref matches expected ${EXPECTED_REF}`);

const api = async (path, init = {}, { soft = false } = {}) => {
  const res = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    if (soft) throw new Error(`HTTP ${res.status}`);
    fail(`Management API ${path} → HTTP ${res.status}`);
  }
  return text ? JSON.parse(text) : null;
};

const project = await api(`/v1/projects/${ref}`);
ok(`project: name="${project.name}" region=${project.region} status=${project.status}`);
if (project.status !== "ACTIVE_HEALTHY") fail("project is not ACTIVE_HEALTHY");

const sql = async (query) =>
  api(`/v1/projects/${ref}/database/query/read-only`, { method: "POST", body: JSON.stringify({ query }) }, { soft: true }).catch(
    (e) => `unavailable (${e.message})`,
  );
const report = {
  public_tables: await sql(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
  ),
  custom_schemas: await sql(
    "select nspname from pg_namespace where nspname in ('app','private') order by 1",
  ),
  migrations: await sql(
    "select version from supabase_migrations.schema_migrations order by 1",
  ),
  buckets: await sql("select id, public from storage.buckets order by 1"),
  auth_users: await sql("select count(*)::int as n from auth.users"),
  extensions: await sql(
    "select extname from pg_extension where extname in ('pg_cron','pg_net','btree_gist','pgcrypto','supabase_vault') order by 1",
  ),
};
console.log(JSON.stringify(report, null, 2));

const nonEmpty = (report.public_tables?.length ?? 0) > 0 || (report.auth_users?.[0]?.n ?? 0) > 0;
if (nonEmpty) {
  console.log("! Remote database is NOT empty. Review the report above before `supabase db push`.");
  process.exitCode = 2;
} else {
  ok("remote public schema and auth.users are empty — safe to push migrations");
}
