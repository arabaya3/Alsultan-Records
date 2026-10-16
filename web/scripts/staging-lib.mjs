/**
 * Shared helpers for the staging scripts (preflight / apply / bootstrap / verify).
 * Never logs secret values: use `mask()` for anything derived from a secret.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_REF = "dyuixzxmmeiypvawzmty";
export const FORBIDDEN_REFS = ["peufggxvklpnaytyklgg"]; // old production project: must never be targeted
export const REQUIRED = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF"];
export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MGMT = "https://api.supabase.com";

export class StepError extends Error {}

export const ok = (msg) => console.log(`  ✓ ${msg}`);
export const info = (msg) => console.log(`  · ${msg}`);
export const warn = (msg) => console.log(`  ! ${msg}`);

/** Shows only length + last 2 chars class, never the value. */
export const mask = (v) => (v ? `<set, ${String(v).length} chars>` : "<empty>");

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) out[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function parseEnvFile(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const k = l.slice(0, l.indexOf("=")).trim();
        let v = l.slice(l.indexOf("=") + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        return [k, v];
      }),
  );
}

export const resolvePath = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));

/** True when git ignores the path (paths outside the repo, e.g. a temp dir, return null). */
export function gitIgnored(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: WEB_ROOT, stdio: "ignore" });
    return true;
  } catch (e) {
    return e.status === 1 ? false : null; // 128 = outside repository
  }
}

/** Loads + validates the operator env file. Throws StepError (names only, never values). */
export function loadStagingEnv(envPath) {
  if (!existsSync(envPath)) throw new StepError(`env file not found: ${envPath} (see docs/staging.md)`);
  const ig = gitIgnored(envPath);
  if (ig === false) throw new StepError(`${envPath} is NOT gitignored. Stop.`);
  ok(ig ? "env file is gitignored" : "env file is outside the repository (not committable)");
  const env = parseEnvFile(envPath);
  // Non-secret: the shell may supply the site URL (e.g. a local test origin) without editing the file.
  if (process.env.STAGING_SITE_URL) env.STAGING_SITE_URL = process.env.STAGING_SITE_URL;
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new StepError(`missing variables: ${missing.join(", ")}`);
  ok(`required variables present: ${REQUIRED.join(", ")} (values not shown)`);
  const ref = env.SUPABASE_PROJECT_REF;
  if (FORBIDDEN_REFS.includes(ref)) throw new StepError("SUPABASE_PROJECT_REF points at the OLD project. Refusing.");
  if (ref !== EXPECTED_REF) throw new StepError(`SUPABASE_PROJECT_REF is "${ref}", expected "${EXPECTED_REF}".`);
  ok(`project ref matches expected ${EXPECTED_REF}`);
  return env;
}

/** Management API client bound to the access token. */
export function mgmt(env) {
  const ref = env.SUPABASE_PROJECT_REF;
  if (FORBIDDEN_REFS.includes(ref) || ref !== EXPECTED_REF) throw new StepError("refusing: unexpected project ref");
  const api = async (path, init = {}) => {
    let res;
    try {
      res = await fetch(`${MGMT}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json", ...init.headers },
      });
    } catch (e) {
      throw new StepError(`Management API ${init.method ?? "GET"} ${path.split("?")[0]} → network error (${e.message})`);
    }
    const text = await res.text();
    if (!res.ok) {
      // Error bodies never contain our secrets, but trim them anyway.
      throw new StepError(`Management API ${init.method ?? "GET"} ${path.split("?")[0]} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  };
  return {
    ref,
    api,
    /** Read-only SQL (separate endpoint that enforces a read-only transaction). */
    read: (query, parameters) =>
      api(`/v1/projects/${ref}/database/query/read-only`, {
        method: "POST",
        body: JSON.stringify(parameters ? { query, parameters } : { query }),
      }),
    /** Write SQL; values ALWAYS go through `parameters` ($1, $2 ...), never interpolated. */
    write: (query, parameters = []) =>
      api(`/v1/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query, parameters }) }),
  };
}

export function localMigrationVersions() {
  return readdirSync(resolve(WEB_ROOT, "supabase/migrations"))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .map((f) => f.split("_")[0])
    .sort();
}

/**
 * Read-only preflight. Returns { project, report, state } where state is
 * "empty" | "ours-partial" | "ours-complete" | "foreign".
 */
export async function runPreflight(env) {
  const m = mgmt(env);
  const project = await m.api(`/v1/projects/${m.ref}`);
  ok(`project: name="${project.name}" region=${project.region} status=${project.status}`);
  if (project.ref && project.ref !== EXPECTED_REF) throw new StepError("API returned a different project ref");
  if (project.status !== "ACTIVE_HEALTHY") throw new StepError(`project is not ACTIVE_HEALTHY (${project.status})`);
  const q = (sql) => m.read(sql).catch((e) => `unavailable (${e.message})`);
  const report = {
    public_tables: await q(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
    ),
    custom_schemas: await q("select nspname from pg_namespace where nspname in ('app','private') order by 1"),
    migrations: await q(
      "select version from supabase_migrations.schema_migrations order by 1",
    ),
    buckets: await q("select id, public from storage.buckets order by 1"),
    auth_users: await q("select count(*)::int as n from auth.users"),
    extensions: await q(
      "select extname from pg_extension where extname in ('pg_cron','pg_net','btree_gist','pgcrypto','supabase_vault') order by 1",
    ),
  };
  const tables = Array.isArray(report.public_tables) ? report.public_tables : [];
  const users = Array.isArray(report.auth_users) ? report.auth_users[0]?.n ?? 0 : 0;
  const remoteVersions = Array.isArray(report.migrations) ? report.migrations.map((r) => String(r.version)) : [];
  const local = localMigrationVersions();
  let state;
  if (!tables.length && !users && !remoteVersions.length) state = "empty";
  else if (remoteVersions.length && remoteVersions.every((v) => local.includes(v)) && remoteVersions.join() === local.slice(0, remoteVersions.length).join())
    state = remoteVersions.length === local.length ? "ours-complete" : "ours-partial";
  else state = "foreign";
  return { project, report, state, remoteVersions, local };
}
