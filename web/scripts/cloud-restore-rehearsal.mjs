#!/usr/bin/env node
/**
 * Isolated CLOUD restore rehearsal: staging (source, read-only) -> a SEPARATE, EMPTY restore project.
 * Never restores over staging, never touches the old production project, never creates/deletes projects.
 *
 *   node scripts/cloud-restore-rehearsal.mjs <command> [--apply] [options]
 *
 * Commands (DRY RUN by default: guards + plan only, no network, no writes; --apply executes):
 *   seed-test-users     create two "[RESTORE-TEST]" customers in STAGING with generated passwords
 *                       (stored only in .cache/cloud-rehearsal/test-users.local.json) for RLS checks.
 *   backup              source = staging, READ-ONLY: schema dump, ONE data-only pg_dump of public+auth+storage,
 *                       storage binaries (backup-storage.mjs), migration versions, counts, sha256 manifest.
 *   cleanup-test-users  delete the [RESTORE-TEST] users from STAGING again (run right after backup).
 *   restore             target = RESTORE_PROJECT_REF (web/.env.restore.local): db push via --db-url, data load
 *                       (backup-restore.mjs --pg-dump, replica mode, FK re-check), storage upload + checksums,
 *                       storage owner metadata, Auth hook + TOTP via the Management API.
 *   verify              verify-restore.mjs in --db-url mode + schema/bucket/object-metadata/auth comparison
 *                       -> docs/cloud-restore-report.json
 *   teardown            PRINTS the steps to pause/delete the rehearsal project (never deletes anything).
 *   sim-up / sim-down   LOCAL simulation only: start/stop a second stack in .cache/restore-sim (distinct ports).
 *
 * Options:
 *   --sim                     local simulation: source = main local stack (read-only dump), target = sim stack
 *   --dir <path>              backup folder (default: the one recorded in .cache/cloud-rehearsal/latest)
 *   --allow-nonempty          restore into a target that already has data (wipes the restored tables). Never staging.
 *   --env-file / --restore-env-file   default web/.env.staging.local / web/.env.restore.local
 *
 * Secrets: never printed (mask()), never in argv. Child processes get PGPASSWORD / SUPABASE_ACCESS_TOKEN /
 * SUPABASE_DB_PASSWORD / VERIFY_*_KEY through their environment; DB URLs passed on argv carry no password.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BACKUP_TABLES, runPsql, splitCopyBlocks, stackStatus } from "./backup-lib.mjs";
import {
  EXPECTED_REF as STAGING_REF, FORBIDDEN_REFS, MGMT, StepError, WEB_ROOT, gitIgnored, info, loadStagingEnv,
  localMigrationVersions, mask, mgmt, ok, parseArgs, parseEnvFile, resolvePath, warn,
} from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const APPLY = args.apply === true;
const SIM = args.sim === true;
const CACHE = path.join(WEB_ROOT, ".cache", "cloud-rehearsal");
const SIM_WORKDIR = path.join(WEB_ROOT, ".cache", "restore-sim");
const MAIN_LOCAL_DB = "postgresql://postgres@127.0.0.1:54322/postgres"; // sim source (read-only dump)
const MAIN_CONTAINER = "supabase_db_alsultan-records";
const REPORT = path.join(WEB_ROOT, "..", "docs", "cloud-restore-report.json");
const TEST_USERS_FILE = path.join(CACHE, "test-users.local.json");
const HOOK_URI = "pg-functions://postgres/app/custom_access_token_hook";
const FREE_UPLOAD_CAP = 50 * 1024 * 1024; // free plan global upload limit
const AUTH_TABLES = ["users", "identities", "mfa_factors"];
const plan = (msg) => info(`[dry-run] would ${msg}`);
const rel = (p) => path.relative(WEB_ROOT, p).split(path.sep).join("/");

// ------------------------------------------------------------------ small helpers
function sh(bin, argv, { env = {}, input, quiet = false } = {}) {
  if (!quiet) info(`$ ${bin} ${argv.join(" ")}`);
  const r = spawnSync(bin, argv, {
    cwd: WEB_ROOT, input, encoding: "utf8", maxBuffer: 1 << 30, shell: process.platform === "win32" && bin === "npx",
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new StepError(`${bin} ${argv[0]} ${argv[1] ?? ""} failed (exit ${r.status}): ${(r.stderr || r.stdout || String(r.error)).slice(-1500)}`);
  return r;
}
const node = (script, argv, env) => {
  const r = spawnSync(process.execPath, [path.join(WEB_ROOT, "scripts", script), ...argv], { cwd: WEB_ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  return r.status;
};
const sha256File = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const linkedRef = () => {
  const p = path.join(WEB_ROOT, "supabase", ".temp", "project-ref");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : null;
};
function writeIgnored(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (gitIgnored(file) !== true) throw new StepError(`${rel(file)} is not gitignored — refusing to write it`);
  fs.writeFileSync(file, content);
}
function psqlOut(target, sql, env) {
  const keys = ["PGPASSWORD", "PGSSLMODE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) if (env[k] !== undefined) process.env[k] = env[k];
  try {
    const r = runPsql(target, sql);
    if (r.status !== 0) throw new StepError(`psql: ${(r.stderr || String(r.error)).slice(0, 500)}`);
    return r.stdout;
  } finally { for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
}
const lines = (s) => s.trim().split("\n").filter(Boolean);

/** Refuses anything that could be staging, the old project or the main local stack as a RESTORE TARGET. */
function assertRestoreRef(ref) {
  if (!ref) throw new StepError("RESTORE_PROJECT_REF is missing in web/.env.restore.local. A separate, empty project is required (see docs/backup-restore.md → Cloud restore rehearsal).");
  if (!/^[a-z]{20}$/.test(ref)) throw new StepError(`RESTORE_PROJECT_REF "${ref}" is not a valid project ref`);
  if (ref === STAGING_REF) throw new StepError("RESTORE_PROJECT_REF equals the STAGING ref. Refusing: the rehearsal never restores over staging.");
  if (FORBIDDEN_REFS.includes(ref)) throw new StepError("RESTORE_PROJECT_REF is the OLD production project. Refusing.");
  ok(`restore target ref ${ref} is neither staging (${STAGING_REF}) nor the old project`);
}

// ------------------------------------------------------------------ contexts
/** Source: staging (cloud) or the main local stack (sim). Read-only use only. */
function sourceCtx() {
  if (SIM) {
    return {
      kind: "local-main", label: "main local stack (read-only)", dbUrl: MAIN_LOCAL_DB, env: { PGPASSWORD: "postgres", PGSSLMODE: "disable" },
      dumpArgs: ["--db-url", MAIN_LOCAL_DB], storageArgs: ["--env-file", ".env.local"],
      versions: () => lines(psqlOut({ container: MAIN_CONTAINER }, "select version from supabase_migrations.schema_migrations order by 1;", {})),
    };
  }
  const envPath = args["env-file"] ? resolvePath(args["env-file"]) : path.join(WEB_ROOT, ".env.staging.local");
  const env = loadStagingEnv(envPath); // validates ref == staging, never the old ref
  const appEnvPath = path.join(WEB_ROOT, ".env.staging.app.local");
  if (!fs.existsSync(appEnvPath)) throw new StepError("web/.env.staging.app.local missing (needed for the storage copy: URL + secret key)");
  const appEnv = parseEnvFile(appEnvPath);
  if (!String(appEnv.NEXT_PUBLIC_SUPABASE_URL).includes(STAGING_REF)) throw new StepError(".env.staging.app.local does not point at staging");
  return {
    kind: "staging", label: `staging ${STAGING_REF} (read-only)`, env: { SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD },
    staging: env, url: appEnv.NEXT_PUBLIC_SUPABASE_URL,
    dumpArgs: ["--linked"],
    storageArgs: ["--env-file", ".env.staging.app.local", "--target-url", appEnv.NEXT_PUBLIC_SUPABASE_URL, "--i-understand-remote"],
    versions: async () => (await mgmt(env).read("select version from supabase_migrations.schema_migrations order by 1")).map((r) => String(r.version)),
  };
}

/** Restore target: the rehearsal project (cloud) or the sim stack. `resolve()` performs network reads. */
function targetCtx() {
  if (SIM) {
    return {
      kind: "local-sim", ref: "local-sim",
      async resolve() {
        const st = stackStatus(SIM_WORKDIR);
        const u = new URL(st.dbUrl.replace(/^postgres(ql)?:/, "http:"));
        if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port === "54322") throw new StepError(`sim target ${u.host} is not the isolated sim stack`);
        return { dbUrl: `postgresql://${u.username}@${u.hostname}:${u.port}/postgres`, env: { PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: "disable" }, apiUrl: st.url, publishable: st.publishable, secret: st.secret, remoteFlags: [] };
      },
    };
  }
  const rPath = args["restore-env-file"] ? resolvePath(args["restore-env-file"]) : path.join(WEB_ROOT, ".env.restore.local");
  if (!fs.existsSync(rPath)) throw new StepError(`${rel(rPath)} not found. RESTORE_PROJECT_REF is missing → refusing (see docs/backup-restore.md → Cloud restore rehearsal).`);
  if (gitIgnored(rPath) === false) throw new StepError(`${rel(rPath)} is NOT gitignored. Stop.`);
  const renv = parseEnvFile(rPath);
  assertRestoreRef(renv.RESTORE_PROJECT_REF);
  const sPath = args["env-file"] ? resolvePath(args["env-file"]) : path.join(WEB_ROOT, ".env.staging.local");
  const token = renv.SUPABASE_ACCESS_TOKEN || (fs.existsSync(sPath) ? parseEnvFile(sPath).SUPABASE_ACCESS_TOKEN : null);
  if (!token) throw new StepError("SUPABASE_ACCESS_TOKEN missing (reused from .env.staging.local)");
  if (!renv.RESTORE_DB_PASSWORD) throw new StepError("RESTORE_DB_PASSWORD missing in .env.restore.local");
  if (renv.RESTORE_DB_URL && /:[^/@]*@/.test(renv.RESTORE_DB_URL.replace(/^postgres(ql)?:\/\//, ""))) throw new StepError("RESTORE_DB_URL must not contain the password (it goes in RESTORE_DB_PASSWORD)");
  for (const r of [STAGING_REF, ...FORBIDDEN_REFS]) if (String(renv.RESTORE_DB_URL ?? "").includes(r)) throw new StepError("RESTORE_DB_URL points at staging/old project. Refusing.");
  ok(`token ${mask(token)}, db password ${mask(renv.RESTORE_DB_PASSWORD)}`);
  const ref = renv.RESTORE_PROJECT_REF;
  const api = async (p, init = {}) => {
    const res = await fetch(`${MGMT}${p}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
    const text = await res.text();
    if (!res.ok) throw new StepError(`Management API ${init.method ?? "GET"} ${p.split("?")[0]} → HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    kind: "cloud", ref, api,
    async resolve() {
      const project = await api(`/v1/projects/${ref}`);
      if (project.ref && project.ref !== ref) throw new StepError("API returned a different project ref");
      ok(`target project: name="${project.name}" region=${project.region} status=${project.status}`);
      if (project.status !== "ACTIVE_HEALTHY") throw new StepError(`target is not ACTIVE_HEALTHY (${project.status}); free projects auto-pause — restore it in the dashboard first`);
      let dbUrl = renv.RESTORE_DB_URL;
      if (!dbUrl) {
        // Direct db.<ref>.supabase.co is IPv6-only on free projects; use the session pooler (IPv4, port 5432).
        const pools = await api(`/v1/projects/${ref}/config/database/pooler`);
        const p = (Array.isArray(pools) ? pools : [pools]).find((x) => x.pool_mode === "session" || String(x.db_port) === "5432") ?? pools[0];
        if (!p?.db_host) throw new StepError("could not resolve the session pooler host; set RESTORE_DB_URL (without password)");
        dbUrl = `postgresql://${p.db_user ?? `postgres.${ref}`}@${p.db_host}:5432/${p.db_name ?? "postgres"}`;
      }
      if (!dbUrl.includes(ref)) warn("RESTORE_DB_URL does not mention the restore ref (custom host?) — double-check it");
      const keys = await api(`/v1/projects/${ref}/api-keys?reveal=true`);
      const pick = (type, legacy) => keys.find((k) => k.type === type)?.api_key ?? keys.find((k) => k.name === legacy)?.api_key;
      const publishable = pick("publishable", "anon"), secret = pick("secret", "service_role");
      if (!publishable || !secret) throw new StepError("could not read the target's API keys (token needs read access to the project's API keys)");
      ok(`target keys: publishable ${mask(publishable)}, secret ${mask(secret)}; db ${dbUrl.replace(/\/\/[^@]*@/, "//<user>@")}`);
      const apiUrl = `https://${ref}.supabase.co`;
      return { dbUrl, env: { PGPASSWORD: renv.RESTORE_DB_PASSWORD }, apiUrl, publishable, secret, project, remoteFlags: ["--target-url", null, "--i-understand-remote"] };
    },
  };
}

function backupDir({ create = false } = {}) {
  if (args.dir) return resolvePath(args.dir);
  if (create) return path.join(CACHE, new Date().toISOString().replace(/[:.]/g, "-") + (SIM ? "-sim" : ""));
  const latest = path.join(CACHE, SIM ? "latest-sim" : "latest");
  if (!fs.existsSync(latest)) throw new StepError("no backup folder recorded; run `backup` first or pass --dir");
  return path.join(CACHE, fs.readFileSync(latest, "utf8").trim());
}

// ------------------------------------------------------------------ commands
const commands = {
  async "seed-test-users"() {
    if (SIM) return info("sim mode uses the local dev seed accounts (owner/customer A/customer B); nothing to seed");
    const src = sourceCtx();
    if (fs.existsSync(TEST_USERS_FILE)) warn(`${rel(TEST_USERS_FILE)} exists — users from a previous run may still be in staging (run cleanup-test-users)`);
    const tag = Date.now().toString(36);
    const mk = (k) => ({ email: `restore-test-${k}-${tag}@example.com`, password: randomBytes(18).toString("base64url"), full_name: `[RESTORE-TEST] customer ${k.toUpperCase()}` });
    if (!APPLY) return plan(`create 2 confirmed users in STAGING (${STAGING_REF}) named "[RESTORE-TEST] customer A/B" (signup trigger adds profile + customers rows), passwords → ${rel(TEST_USERS_FILE)}`);
    const sb = createClient(src.url, parseEnvFile(path.join(WEB_ROOT, ".env.staging.app.local")).SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const out = { created_at: new Date().toISOString(), project: STAGING_REF };
    for (const k of ["a", "b"]) {
      const u = mk(k);
      const { data, error } = await sb.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true, user_metadata: { full_name: u.full_name } });
      if (error) throw new StepError(`createUser ${k}: ${error.message}`);
      out[k] = { ...u, id: data.user.id };
      writeIgnored(TEST_USERS_FILE, JSON.stringify(out, null, 2) + "\n");
      ok(`created ${u.full_name} (${data.user.id}); password stored only in ${rel(TEST_USERS_FILE)}`);
    }
  },

  async "cleanup-test-users"() {
    if (SIM) return info("sim mode: nothing to clean up");
    const src = sourceCtx();
    if (!fs.existsSync(TEST_USERS_FILE)) return ok("no test-users file — nothing to delete");
    const tu = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const sb = APPLY ? createClient(src.url, parseEnvFile(path.join(WEB_ROOT, ".env.staging.app.local")).SUPABASE_SECRET_KEY, { auth: { persistSession: false } }) : null;
    for (const k of ["a", "b"]) {
      if (!tu[k]?.id) continue;
      if (!APPLY) { plan(`delete STAGING user ${tu[k].id} (${tu[k].full_name})`); continue; }
      const { data } = await sb.auth.admin.getUserById(tu[k].id);
      if (!String(data?.user?.user_metadata?.full_name ?? "").startsWith("[RESTORE-TEST]")) { warn(`${tu[k].id} is not a [RESTORE-TEST] user (or already gone) — skipped`); continue; }
      const { error } = await sb.auth.admin.deleteUser(tu[k].id);
      if (error) throw new StepError(`deleteUser ${k}: ${error.message}`);
      ok(`deleted ${tu[k].full_name} from staging`);
    }
    if (APPLY) ok(`kept ${rel(TEST_USERS_FILE)} for the verify step (the restored copies of these users live only in the rehearsal project)`);
  },

  async backup() {
    const src = sourceCtx();
    const dir = backupDir({ create: true });
    if (!SIM) {
      if (linkedRef() !== STAGING_REF) throw new StepError(`supabase/.temp/project-ref is "${linkedRef()}", expected staging ${STAGING_REF} (db dump --linked reads from it)`);
      ok(`CLI link points at staging ${STAGING_REF}`);
    }
    if (!APPLY) {
      plan(`read migration versions from ${src.label}`);
      plan(`npx supabase db dump ${src.dumpArgs.join(" ")} -s public -f ${rel(dir)}/schema-public.sql   (schema, for verification)`);
      plan(`npx supabase db dump ${src.dumpArgs.join(" ")} --data-only --use-copy -s public,auth,storage -f ${rel(dir)}/data-full.sql   (ONE snapshot)`);
      plan(`derive ${rel(dir)}/db.sql = auth.{users,identities,mfa_factors} + ${BACKUP_TABLES.length} public tables; storage-meta.json = storage.{buckets,objects} rows`);
      plan(`node scripts/backup-storage.mjs backup --out ${rel(dir)}/storage ${src.storageArgs.filter((a) => !a.startsWith("http")).join(" ")}   (same window)`);
      return plan(`write counts.json + manifest.json (sha256 of every file)`);
    }
    fs.mkdirSync(dir, { recursive: true });
    if (gitIgnored(dir) !== true) throw new StepError(`${rel(dir)} is not gitignored`);
    const versions = await src.versions();
    if (versions.join() !== localMigrationVersions().join()) warn(`source migrations [${versions.at(-1)}] differ from this checkout [${localMigrationVersions().at(-1)}] — restore will refuse until they match`);
    fs.writeFileSync(path.join(dir, "schema-migrations.txt"), versions.join("\n") + "\n");
    ok(`source migrations: ${versions.length} (last ${versions.at(-1)})`);
    const relDir = rel(dir);
    sh("npx", ["supabase", "db", "dump", ...src.dumpArgs, "-s", "public", "-f", `${relDir}/schema-public.sql`], { env: src.env });
    const startedAt = new Date().toISOString();
    sh("npx", ["supabase", "db", "dump", ...src.dumpArgs, "--data-only", "--use-copy", "-s", "public,auth,storage", "-f", `${relDir}/data-full.sql`], { env: src.env });
    const blocks = splitCopyBlocks(fs.readFileSync(path.join(dir, "data-full.sql"), "utf8"));
    const by = Object.fromEntries(blocks.map((b) => [`${b.schema}.${b.table}`, b]));
    const missing = [...AUTH_TABLES.map((t) => `auth.${t}`), ...BACKUP_TABLES.map((t) => `public.${t}`), "storage.buckets", "storage.objects"].filter((k) => !by[k]);
    if (missing.length) throw new StepError(`dump lacks COPY blocks for: ${missing.join(", ")}`);
    const extra = blocks.filter((b) => b.schema === "public" && !BACKUP_TABLES.includes(b.table) && b.rows.length);
    if (extra.length) throw new StepError(`public tables with data not covered by BACKUP_TABLES: ${extra.map((b) => b.table).join(", ")}`);
    const emit = (b) => `COPY ${b.schema}.${b.table} (${b.cols.map((c) => `"${c}"`).join(", ")}) FROM stdin;\n${b.rows.map((r) => r + "\n").join("")}\\.\n\n`;
    let db = `-- Derived from data-full.sql (supabase db dump --data-only --use-copy, one pg_dump snapshot taken ${startedAt}).\n-- Loaded by backup-restore.mjs --pg-dump inside one transaction.\nset local session_replication_role = replica;\n\n`;
    for (const t of AUTH_TABLES) db += emit(by[`auth.${t}`]);
    for (const t of BACKUP_TABLES) db += emit(by[`public.${t}`]);
    fs.writeFileSync(path.join(dir, "db.sql"), db);
    const parseRows = (b) => b.rows.map((l) => Object.fromEntries(b.cols.map((c, i) => { const v = l.split("\t")[i]; return [c, v === "\\N" ? null : v]; })));
    const objects = parseRows(by["storage.objects"]).map((o) => ({ id: o.id, bucket_id: o.bucket_id, name: o.name, owner: o.owner, owner_id: o.owner_id }));
    const buckets = parseRows(by["storage.buckets"]).map((b) => ({ id: b.id, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types }));
    fs.writeFileSync(path.join(dir, "storage-meta.json"), JSON.stringify({ buckets, objects }, null, 2) + "\n");
    const st = node("backup-storage.mjs", ["backup", "--out", path.join(dir, "storage"), ...src.storageArgs]);
    if (st !== 0) throw new StepError("storage backup failed");
    const man = JSON.parse(fs.readFileSync(path.join(dir, "storage", "storage-checksums.json"), "utf8"));
    if (man.objects.length !== objects.length) warn(`storage copy has ${man.objects.length} objects, metadata snapshot ${objects.length} (writes between dump and copy?)`);
    const big = man.objects.filter((o) => o.size > FREE_UPLOAD_CAP);
    if (big.length) warn(`${big.length} object(s) exceed 50 MB (free-plan upload cap) and cannot be restored into a free project: ${big.slice(0, 5).map((o) => `${o.bucket}/${o.path}`).join(", ")}`);
    const counts = {
      source: src.kind, taken_at: startedAt, migrations: versions.length, last_migration: versions.at(-1),
      auth: Object.fromEntries(AUTH_TABLES.map((t) => [t, by[`auth.${t}`].rows.length])),
      public: Object.fromEntries(BACKUP_TABLES.map((t) => [t, by[`public.${t}`].rows.length])),
      storage: { buckets: buckets.length, object_rows: objects.length, objects_copied: man.objects.length, bytes: man.objects.reduce((n, o) => n + o.size, 0), over_50mb: big.length },
    };
    fs.writeFileSync(path.join(dir, "counts.json"), JSON.stringify(counts, null, 2) + "\n");
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== "manifest.json") files.push(p); } };
    walk(dir);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ created_at: new Date().toISOString(), files: files.map((f) => ({ path: path.relative(dir, f).split(path.sep).join("/"), bytes: fs.statSync(f).size, sha256: sha256File(f) })) }, null, 2) + "\n");
    fs.writeFileSync(path.join(CACHE, SIM ? "latest-sim" : "latest"), path.basename(dir) + "\n");
    ok(`backup complete: ${rel(dir)} (${files.length} files, manifest.json)`);
    console.log(JSON.stringify(counts, null, 2));
  },

  async restore() {
    const tgt = targetCtx(); // guards (missing/staging/old ref) before anything else
    let dir;
    try { dir = backupDir(); } catch (e) {
      if (APPLY) throw e;
      warn(`${e.message} — showing the plan without backup checks`);
      dir = path.join(CACHE, "<ts>");
    }
    const refBefore = linkedRef();
    info(`CLI link before: ${refBefore ?? "<none>"} (must stay unchanged; the restore ref is never linked)`);
    if (!SIM && refBefore && refBefore !== STAGING_REF) throw new StepError(`CLI is linked to ${refBefore}, expected staging or nothing`);
    let want = [];
    if (!APPLY && !fs.existsSync(path.join(dir, "manifest.json"))) {
      plan(`verify ${rel(dir)}: schema-migrations.txt == checkout migrations, manifest sha256, no object > 50 MB`);
    } else {
      want = fs.readFileSync(path.join(dir, "schema-migrations.txt"), "utf8").trim().split(/\r?\n/);
      if (want.join() !== localMigrationVersions().join()) throw new StepError(`backup migrations (last ${want.at(-1)}) != this checkout's supabase/migrations (last ${localMigrationVersions().at(-1)}). Check out the matching commit first.`);
      ok(`backup schema = checkout migrations (${want.length})`);
      const man = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      const badFiles = man.files.filter((f) => sha256File(path.join(dir, f.path)) !== f.sha256);
      if (badFiles.length) throw new StepError(`backup files changed since the manifest: ${badFiles.slice(0, 5).map((f) => f.path).join(", ")}`);
      ok(`manifest verified (${man.files.length} files, sha256)`);
      const big = JSON.parse(fs.readFileSync(path.join(dir, "storage", "storage-checksums.json"), "utf8")).objects.filter((o) => o.size > FREE_UPLOAD_CAP);
      if (big.length && !SIM) throw new StepError(`${big.length} object(s) > 50 MB cannot be uploaded to a free project (upgrade the rehearsal project or exclude them)`);
    }
    if (!APPLY) {
      plan(`resolve target (${tgt.kind === "cloud" ? `GET /v1/projects/${tgt.ref}, session pooler, API keys` : "sim stack status"}); check it is EMPTY (refuse otherwise${args["allow-nonempty"] ? "; --allow-nonempty given" : ""})`);
      plan(`PGPASSWORD=<env> npx supabase db push --db-url postgresql://<user>@<host>:5432/postgres --yes   (never 'supabase link')`);
      plan(`node scripts/backup-restore.mjs --from ${rel(dir)} --pg-dump ${rel(dir)}/db.sql --db-url <url> (replica mode, one transaction, FK re-check)`);
      plan(`node scripts/backup-storage.mjs restore-storage --from ${rel(dir)}/storage (upload + read back sha256), then copy storage.objects owner/owner_id from the snapshot`);
      plan(tgt.kind === "cloud" ? `PATCH /v1/projects/${tgt.ref}/config/auth { hook_custom_access_token_enabled, hook_custom_access_token_uri, mfa_totp_enroll_enabled, mfa_totp_verify_enabled }` : "auth hook + TOTP come from the sim stack's config.toml");
      return plan("re-check supabase/.temp/project-ref is unchanged");
    }
    const t = await tgt.resolve();
    const q = (sql) => psqlOut({ dbUrl: t.dbUrl }, sql, t.env);
    // ---- emptiness / resumability
    const [users, pubTables, hasHist] = q("select (select count(*) from auth.users), (select count(*) from information_schema.tables where table_schema='public'), to_regclass('supabase_migrations.schema_migrations') is not null;").trim().split("|");
    const have = hasHist === "t" ? lines(q("select version from supabase_migrations.schema_migrations order by 1;")) : [];
    const SEEDED = new Set(["business_settings", "app_settings", "service_categories"]);
    let dataRows = 0;
    if (have.length) dataRows = lines(q(BACKUP_TABLES.filter((x) => !SEEDED.has(x)).map((x) => `select count(*) from public.${x};`).join("\n"))).reduce((n, v) => n + Number(v), 0);
    const empty = Number(users) === 0 && dataRows === 0 && (have.length ? have.join() === want.slice(0, have.length).join() : Number(pubTables) === 0);
    info(`target: auth.users=${users}, public tables=${pubTables}, migrations=${have.length}, data rows=${dataRows}`);
    if (!empty) {
      if (!args["allow-nonempty"]) throw new StepError("target database is NOT empty. Refusing (use a fresh project; --allow-nonempty wipes the restored tables, never use it on anything but the rehearsal project).");
      warn("--allow-nonempty: restored tables + auth users in the TARGET will be replaced");
    }
    // ---- migrations
    if (have.join() === want.join()) ok("target already has exactly the source migrations — skipping db push");
    else {
      sh("npx", ["supabase", "db", "push", "--db-url", t.dbUrl, "--yes"], { env: t.env });
      const after = lines(q("select version from supabase_migrations.schema_migrations order by 1;"));
      if (after.join() !== want.join()) throw new StepError(`target migrations after push [${after.at(-1)}] != source [${want.at(-1)}]`);
      ok(`db push done: ${after.length} migrations == source`);
    }
    // ---- data
    const remote = t.remoteFlags.length ? ["--target-url", t.dbUrl, "--i-understand-remote"] : [];
    const rc = node("backup-restore.mjs", ["--from", dir, "--pg-dump", path.join(dir, "db.sql"), "--db-url", t.dbUrl, ...remote, ...(empty ? [] : ["--replace"])], t.env);
    if (rc !== 0) throw new StepError("data load failed (see restore-result.json)");
    // ---- storage binaries
    const tmpEnv = path.join(dir, ".target-storage.env.local");
    writeIgnored(tmpEnv, `NEXT_PUBLIC_SUPABASE_URL=${t.apiUrl}\nSUPABASE_SECRET_KEY=${t.secret}\n`);
    let sc;
    try {
      sc = node("backup-storage.mjs", ["restore-storage", "--from", path.join(dir, "storage"), "--env-file", tmpEnv, ...(t.remoteFlags.length ? ["--target-url", t.apiUrl, "--i-understand-remote"] : [])]);
    } finally { fs.rmSync(tmpEnv, { force: true }); }
    if (sc !== 0) throw new StepError("storage restore failed");
    // ---- storage metadata: uploads are made with the secret key, so copy owner/owner_id from the snapshot
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "storage-meta.json"), "utf8"));
    const withOwner = meta.objects.filter((o) => o.owner || o.owner_id);
    if (withOwner.length) {
      const vals = withOwner.map((o) => `(${[o.bucket_id, o.name, o.owner, o.owner_id].map((v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`)).join(", ")})`).join(",\n");
      q(`update storage.objects o set owner = v.owner::uuid, owner_id = v.owner_id from (values ${vals}) v(bucket_id, name, owner, owner_id) where o.bucket_id = v.bucket_id and o.name = v.name;`);
      ok(`storage.objects owner metadata copied for ${withOwner.length} object(s)`);
    } else ok("no storage objects carry an owner in the snapshot (all uploaded server-side)");
    // ---- auth config
    if (tgt.kind === "cloud") {
      const cur = await tgt.api(`/v1/projects/${tgt.ref}/config/auth`);
      const wantAuth = { hook_custom_access_token_enabled: true, hook_custom_access_token_uri: HOOK_URI, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true, password_min_length: 10, jwt_exp: 3600 };
      const diff = Object.keys(wantAuth).filter((k) => String(cur[k] ?? "") !== String(wantAuth[k]));
      if (diff.length) {
        await tgt.api(`/v1/projects/${tgt.ref}/config/auth`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(diff.map((k) => [k, wantAuth[k]]))) });
        const after = await tgt.api(`/v1/projects/${tgt.ref}/config/auth`);
        const bad = diff.filter((k) => String(after[k] ?? "") !== String(wantAuth[k]));
        if (bad.length) throw new StepError(`auth config not applied: ${bad.join(", ")}`);
      }
      ok(`auth hook + TOTP configured on ${tgt.ref} (${diff.length ? diff.join(", ") : "already set"}); site_url/SMTP intentionally untouched`);
    } else {
      const toml = fs.readFileSync(path.join(SIM_WORKDIR, "supabase", "config.toml"), "utf8");
      if (!toml.includes(HOOK_URI) || !/\[auth\.mfa\.totp\][^[]*enroll_enabled = true/.test(toml)) throw new StepError("sim config.toml lacks the access-token hook or TOTP");
      ok("sim stack: access-token hook + TOTP enabled by config.toml");
    }
    const refAfter = linkedRef();
    if (refAfter !== refBefore) throw new StepError(`CLI link changed during restore: ${refBefore} → ${refAfter}`);
    ok(`CLI link unchanged (${refAfter ?? "<none>"})`);
    fs.writeFileSync(path.join(dir, "restore-run.json"), JSON.stringify({ target: tgt.kind === "cloud" ? tgt.ref : "local-sim", restored_at: new Date().toISOString(), target_was_empty: empty, link_before: refBefore, link_after: refAfter }, null, 2) + "\n");
  },

  async verify() {
    const tgt = targetCtx();
    const dir = backupDir();
    let creds;
    if (!SIM) {
      if (!fs.existsSync(TEST_USERS_FILE)) throw new StepError(`${rel(TEST_USERS_FILE)} missing: RLS checks need the [RESTORE-TEST] users seeded before the backup`);
      const tu = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      creds = path.join(dir, ".verify-creds.local.json");
      if (APPLY) writeIgnored(creds, JSON.stringify({ a: { email: tu.a.email, password: tu.a.password }, b: { email: tu.b.email, password: tu.b.password } }));
    }
    const label = SIM ? "local-simulation" : `cloud-${tgt.ref}`;
    if (!APPLY) {
      plan(`node scripts/verify-restore.mjs --label ${label} --db-url <url> --api-url <url> --expected ${rel(dir)} --pg-dump ${rel(dir)}/db.sql --storage ${rel(dir)}/storage ${SIM ? "(dev seed accounts)" : "--creds-file <test users> --allow-no-owner-object"} --report docs/cloud-restore-report.json`);
      return plan("compare: public schema dump, migrations, buckets, storage.objects (bucket,name,owner_id), auth identities/mfa_factors counts, private.bootstrap empty");
    }
    const t = await tgt.resolve();
    const q = (sql) => psqlOut({ dbUrl: t.dbUrl }, sql, t.env);
    const env = { ...t.env, VERIFY_PUBLISHABLE_KEY: t.publishable, VERIFY_SECRET_KEY: t.secret };
    const vargs = ["--label", label, "--db-url", t.dbUrl, "--api-url", t.apiUrl, "--expected", dir, "--pg-dump", path.join(dir, "db.sql"), "--storage", path.join(dir, "storage"), "--report", REPORT];
    if (!SIM) vargs.push("--creds-file", creds, "--allow-no-owner-object", "--i-understand-remote");
    let rc;
    try { rc = node("verify-restore.mjs", vargs, env); } finally { if (creds) fs.rmSync(creds, { force: true }); }
    // ---- extra comparisons (source snapshot vs target)
    const extra = [];
    const chk = (name, okv, detail) => { extra.push({ name, ok: !!okv, ...(detail === undefined ? {} : { detail }) }); console.log(`${okv ? "PASS" : "FAIL"}  ${name}${!okv && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 300)}` : ""}`); };
    const want = fs.readFileSync(path.join(dir, "schema-migrations.txt"), "utf8").trim().split(/\r?\n/);
    const have = lines(q("select version from supabase_migrations.schema_migrations order by 1;"));
    chk(`migrations identical (${want.length})`, have.join() === want.join(), { have: have.at(-1), want: want.at(-1) });
    const tgtSchema = path.join(dir, `.target-schema-public.sql`);
    sh("npx", ["supabase", "db", "dump", "--db-url", t.dbUrl, "-s", "public", "-f", rel(tgtSchema)], { env: t.env });
    const norm = (f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("--") && !/^\\(un)?restrict/.test(l) && !/^SET |^SELECT pg_catalog\.set_config/.test(l)).join("\n");
    const a = norm(path.join(dir, "schema-public.sql")), b = norm(tgtSchema);
    let firstDiff = null;
    if (a !== b) { const al = a.split("\n"), bl = b.split("\n"); const i = al.findIndex((l, k) => l !== bl[k]); firstDiff = { line: i, source: al[i]?.slice(0, 160), target: bl[i]?.slice(0, 160) }; }
    chk("public schema dump identical to source (tables, functions, policies, grants, triggers)", a === b, firstDiff ?? undefined);
    fs.rmSync(tgtSchema, { force: true });
    const counts = JSON.parse(fs.readFileSync(path.join(dir, "counts.json"), "utf8"));
    for (const tname of AUTH_TABLES) {
      const n = Number(q(`select count(*) from auth.${tname};`).trim());
      chk(`auth.${tname} count = ${counts.auth[tname]}`, n === counts.auth[tname], { restored: n });
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "storage-meta.json"), "utf8"));
    const bRows = JSON.parse(q("select coalesce(json_agg(json_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) order by id), '[]') from storage.buckets;").trim());
    const nb = (x) => JSON.stringify(x.map((r) => [r.id, String(r.public).startsWith("t"), r.file_size_limit === null ? null : Number(r.file_size_limit), r.allowed_mime_types ? String(r.allowed_mime_types).replace(/[{}"[\]\s]/g, "") : null]).sort());
    chk(`storage.buckets identical (${meta.buckets.length})`, nb(bRows) === nb(meta.buckets), { target: bRows.map((r) => r.id) });
    const oRows = lines(q("select bucket_id || '/' || name || '|' || coalesce(owner_id, '') from storage.objects order by 1;"));
    const oWant = meta.objects.map((o) => `${o.bucket_id}/${o.name}|${o.owner_id ?? ""}`).sort();
    chk(`storage.objects metadata (bucket, name, owner_id) identical (${oWant.length})`, JSON.stringify(oRows.sort()) === JSON.stringify(oWant), { target: oRows.length });
    const boot = Number(q("select count(*) from private.bootstrap;").trim() || 0);
    chk("private.bootstrap is empty on the restored project (nobody can claim ownership)", boot === 0, { rows: boot });
    // ---- merge into the report
    const all = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    all.generated_by = "web/scripts/cloud-restore-rehearsal.mjs (+ verify-restore.mjs --db-url)";
    const e = all.proofs[label];
    e.rehearsal = { source: counts.source, backup_dir: rel(dir), taken_at: counts.taken_at, counts, extra_checks: extra, restore_run: fs.existsSync(path.join(dir, "restore-run.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "restore-run.json"), "utf8")) : null };
    const extraFailed = extra.filter((x) => !x.ok).length;
    e.summary = { ...e.summary, checks: e.summary.checks + extra.length, passed: e.summary.passed + extra.length - extraFailed, failed: e.summary.failed + extraFailed };
    if (SIM) all.local_simulation = `${e.summary.passed}/${e.summary.checks} checks passed (${e.verified_at})`;
    else all.cloud_restore = `${e.summary.passed}/${e.summary.checks} checks passed on ${tgt.ref} (${e.verified_at})`;
    all.cloud_restore ??= "PENDING: needs user approval to create a second free project (see docs/backup-restore.md → Cloud restore rehearsal)";
    fs.writeFileSync(REPORT, JSON.stringify(all, null, 2) + "\n");
    console.log(`\nTOTAL ${e.summary.passed}/${e.summary.checks} checks passed -> ${rel(REPORT)}`);
    if (rc !== 0 || extraFailed) throw new StepError("verification failed");
  },

  async teardown() {
    if (SIM) return commands["sim-down"]();
    const tgt = targetCtx();
    console.log(`
Teardown of the rehearsal project ${tgt.ref} — DESTRUCTIVE, needs the user's explicit confirmation.
This script never pauses or deletes projects. Steps for the user:
  1. Double-check the ref: ${tgt.ref} (staging is ${STAGING_REF} — never delete that one).
  2. Pause (keeps data, frees the active-project slot):
       Dashboard → Project ${tgt.ref} → Settings → General → Pause project
       or: curl -X POST https://api.supabase.com/v1/projects/${tgt.ref}/pause -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
  3. Delete (irreversible):
       Dashboard → Project ${tgt.ref} → Settings → General → Delete project (type the project name)
       or: npx supabase projects delete ${tgt.ref}
  4. Locally: delete web/.env.restore.local and the backup folders under web/.cache/cloud-rehearsal/
     (they contain real auth hashes and customer data), and test-users.local.json.
  5. Confirm the [RESTORE-TEST] users are gone from staging: node scripts/cloud-restore-rehearsal.mjs cleanup-test-users
`);
  },

  async "sim-up"() {
    const sup = path.join(SIM_WORKDIR, "supabase");
    if (!APPLY) return plan(`create ${rel(SIM_WORKDIR)}/supabase/config.toml (project_id alsultan-restore-sim, ports 565xx, seed off, EMPTY migrations so 'db push' is exercised) and run: npx supabase start --workdir ${rel(SIM_WORKDIR)}`);
    fs.mkdirSync(path.join(sup, "migrations"), { recursive: true });
    let toml = fs.readFileSync(path.join(WEB_ROOT, "supabase", "config.toml"), "utf8");
    const ports = { 54321: 56321, 54322: 56322, 54320: 56320, 54329: 56329, 54323: 56323, 54324: 56324, 54327: 56327, 8083: 56383 };
    toml = toml.replace(/^project_id = .*$/m, 'project_id = "alsultan-restore-sim"');
    toml = toml.replace(/^(\s*(?:port|shadow_port|inspector_port) = )(\d+)/gm, (m, k, p) => (ports[p] ? `${k}${ports[p]}` : m));
    toml = toml.replace(/(\[db\.seed\][^[]*?enabled = )true/, "$1false");
    toml = toml.replace(/\n\[functions\.storage-cleanup\][\s\S]*?(?=\n\[|$)/, "\n");
    fs.writeFileSync(path.join(sup, "config.toml"), toml);
    const tpl = path.join(WEB_ROOT, "supabase", "templates");
    if (fs.existsSync(tpl)) fs.cpSync(tpl, path.join(sup, "templates"), { recursive: true });
    ok(`wrote ${rel(sup)}/config.toml (no migrations: the restore pushes them)`);
    sh("npx", ["supabase", "start", "--workdir", rel(SIM_WORKDIR), "-x", "studio,imgproxy,vector,logflare,edge-runtime,supavisor,realtime"], {});
    const st = stackStatus(SIM_WORKDIR);
    ok(`sim stack up: api ${st.url}`);
  },

  async "sim-down"() {
    if (!APPLY) return plan(`npx supabase stop --workdir ${rel(SIM_WORKDIR)} --no-backup`);
    sh("npx", ["supabase", "stop", "--workdir", rel(SIM_WORKDIR), "--no-backup"], {});
    ok("sim stack stopped and its volumes removed");
  },
};

// ------------------------------------------------------------------ main
if (!commands[cmd]) {
  console.error(`usage: node scripts/cloud-restore-rehearsal.mjs <${Object.keys(commands).join("|")}> [--apply] [--sim] [--dir DIR] [--allow-nonempty]`);
  process.exit(2);
}
console.log(`\n== cloud-restore-rehearsal ${cmd} ${SIM ? "(LOCAL SIMULATION)" : ""} ${APPLY ? "(APPLY)" : "(DRY RUN — pass --apply to execute)"}`);
try {
  await commands[cmd]();
  console.log(`\n${APPLY ? "done" : "dry run complete — nothing was written"}`);
} catch (e) {
  if (e instanceof StepError) { console.error(`\n  ✗ ${e.message}`); process.exit(1); }
  throw e;
}
