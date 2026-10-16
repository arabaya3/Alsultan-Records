#!/usr/bin/env node
/**
 * Staging apply — prepares project dyuixzxmmeiypvawzmty from web/supabase/migrations.
 *
 *   node scripts/staging-apply.mjs                      # DRY RUN (default): read-only checks + plan
 *   node scripts/staging-apply.mjs --apply              # perform writes
 *   node scripts/staging-apply.mjs --apply --from auth-config   # resume at a step
 *   options: --env-file <path> (default web/.env.staging.local), --allow-nonempty, --only <step>
 *
 * Every step is idempotent. Secrets are never printed and never passed on a command line:
 *  - CLI gets SUPABASE_ACCESS_TOKEN / SUPABASE_DB_PASSWORD through the child environment;
 *  - STORAGE_CLEANUP_SECRET is set through the Management API (request body), Vault through
 *    parameterized SQL; generated values live only in gitignored files under web/.cache and
 *    web/.env.staging.app.local.
 * Exit codes: 0 ok, 1 failure.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  EXPECTED_REF, StepError, WEB_ROOT, gitIgnored, info, loadStagingEnv, localMigrationVersions, mask, mgmt,
  ok, parseArgs, resolvePath, runPreflight, warn,
} from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true;
const envPath = args["env-file"] ? resolvePath(args["env-file"]) : resolve(WEB_ROOT, ".env.staging.local");
const SECRETS_FILE = resolve(WEB_ROOT, ".cache/staging-secrets.local.json");
const APP_ENV_FILE = resolve(WEB_ROOT, ".env.staging.app.local");
const TOKEN_FILE = resolve(WEB_ROOT, ".cache/bootstrap-token.local.txt");

const EXPECTED_BUCKETS = {
  "public-media": { public: false, file_size_limit: 52428800 },
  "private-media": { public: false, file_size_limit: 2147483648 },
  backups: { public: false, file_size_limit: 2147483648 },
};
const HOOK_URI = "pg-functions://postgres/app/custom_access_token_hook";

let env, m, siteUrl;

// ------------------------------------------------------------------ helpers
function ensureIgnored(path) {
  if (gitIgnored(path) !== true) throw new StepError(`${path} would not be gitignored — refusing to write a secret there`);
}
function writeSecretFile(path, content) {
  ensureIgnored(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function loadSecrets() {
  return existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, "utf8")) : {};
}
function secret(name, gen = () => randomBytes(32).toString("base64url")) {
  const s = loadSecrets();
  if (!s[name]) {
    if (!APPLY) return null;
    s[name] = gen();
    writeSecretFile(SECRETS_FILE, JSON.stringify(s, null, 2));
    ok(`generated ${name} ${mask(s[name])} → .cache/staging-secrets.local.json`);
  }
  return s[name];
}
/** Runs the Supabase CLI. Secrets only in the child env; argv contains no secret. */
function cli(cliArgs) {
  info(`$ npx supabase ${cliArgs.join(" ")}`);
  const r = spawnSync("npx", ["supabase", ...cliArgs], {
    cwd: WEB_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN,
      SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD,
    },
  });
  if (r.status !== 0) throw new StepError(`supabase ${cliArgs[0]} exited with ${r.status}`);
}
function linkedRef() {
  const p = resolve(WEB_ROOT, "supabase/.temp/project-ref");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
}
const plan = (msg) => info(`[dry-run] would ${msg}`);

// ------------------------------------------------------------------ steps
const steps = [
  {
    name: "preflight",
    desc: "verify ref, token, remote state (read-only)",
    async run() {
      const { report, state, remoteVersions, local } = await runPreflight(env);
      info(`remote state: ${state} (remote migrations ${remoteVersions.length}/${local.length})`);
      if (state === "foreign") {
        console.log(JSON.stringify(report, null, 2));
        if (!args["allow-nonempty"]) throw new StepError("remote database contains objects not created by these migrations. Review the report; re-run with --allow-nonempty only if you are sure.");
        warn("--allow-nonempty given: continuing on a non-empty database");
      } else if (state !== "empty") ok("remote content was created by our own migrations (resumable)");
    },
  },
  {
    name: "link",
    desc: "supabase link --project-ref (password via env)",
    async run() {
      if (linkedRef() === EXPECTED_REF) return ok(`already linked to ${EXPECTED_REF}`);
      if (linkedRef()) warn(`currently linked to another ref (${linkedRef()}) — will relink`);
      if (!APPLY) return plan(`run: npx supabase link --project-ref ${EXPECTED_REF}`);
      cli(["link", "--project-ref", EXPECTED_REF]);
      if (linkedRef() !== EXPECTED_REF) throw new StepError("link did not record the expected ref");
      ok("linked");
    },
  },
  {
    name: "db-push",
    desc: "supabase db push (migrations only, no seed) + verify history",
    async run() {
      if (linkedRef() !== EXPECTED_REF) {
        if (!APPLY) return plan("run db push --dry-run, then db push (needs link first)");
        throw new StepError("not linked to the expected ref");
      }
      cli(["db", "push", "--linked", "--dry-run"]);
      if (!APPLY) return plan("run: npx supabase db push --linked   (no --include-seed)");
      cli(["db", "push", "--linked"]);
      const rows = await m.read("select version from supabase_migrations.schema_migrations order by 1");
      const remote = rows.map((r) => String(r.version));
      const local = localMigrationVersions();
      if (remote.join() !== local.join()) throw new StepError(`migration history mismatch: remote [${remote}] local [${local}]`);
      ok(`remote schema_migrations == local (${local.length} versions)`);
    },
  },
  {
    name: "extensions",
    desc: "pg_cron, pg_net, supabase_vault, btree_gist, pgcrypto present",
    async run() {
      const rows = await m.read("select extname, extversion from pg_extension order by 1");
      const have = new Set(rows.map((r) => r.extname));
      const need = { pg_cron: "migration 0010", pg_net: "migration 0010", btree_gist: "migration 0001", pgcrypto: "migration 0001", supabase_vault: "preinstalled on hosted" };
      const missing = Object.keys(need).filter((e) => !have.has(e));
      for (const e of Object.keys(need)) (have.has(e) ? ok : warn)(`${e}: ${have.has(e) ? "enabled" : "MISSING"} (${need[e]})`);
      if (missing.length) {
        const msg = `missing extensions: ${missing.join(", ")}. Dashboard → Database → Extensions → enable ${missing.join(", ")} (pg_cron in schema pg_catalog, others in schema extensions), then re-run with --from extensions.`;
        if (APPLY) throw new StepError(msg);
        warn(`${msg} (expected before db push)`);
      }
    },
  },
  {
    name: "auth-config",
    desc: "site_url, redirect allow-list, access-token hook, TOTP MFA, jwt_exp, password length",
    async run() {
      const cur = await m.api(`/v1/projects/${m.ref}/config/auth`);
      const allow = new Set((cur.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      for (const p of ["/auth/callback", "/auth/reset"]) allow.add(`${siteUrl}${p}`);
      allow.add(`${siteUrl}/auth/callback**`); // callback carries ?next=...
      const want = {
        site_url: siteUrl,
        uri_allow_list: [...allow].join(","),
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: HOOK_URI,
        mfa_totp_enroll_enabled: true,
        mfa_totp_verify_enabled: true,
        jwt_exp: 3600,
        password_min_length: 10, // matches the app's reset schema (min 10)
      };
      const diff = Object.keys(want).filter((k) => String(cur[k] ?? "") !== String(want[k]));
      if (!diff.length) return ok("auth config already as expected");
      for (const k of diff) info(`${k}: ${JSON.stringify(cur[k] ?? null)} → ${JSON.stringify(want[k])}`);
      if (!APPLY) return plan(`PATCH /v1/projects/${m.ref}/config/auth (${diff.join(", ")})`);
      await m.api(`/v1/projects/${m.ref}/config/auth`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(diff.map((k) => [k, want[k]]))) });
      const after = await m.api(`/v1/projects/${m.ref}/config/auth`);
      const bad = Object.keys(want).filter((k) => String(after[k] ?? "") !== String(want[k]));
      if (bad.length) throw new StepError(`auth config not applied: ${bad.join(", ")}`);
      ok("auth config verified by GET");
      if (!after.smtp_host) warn("no custom SMTP: the built-in mailer is rate limited and only delivers to project team members (see docs/staging.md)");
    },
  },
  {
    name: "storage",
    desc: "buckets public flags / limits (created by migrations)",
    async run() {
      const rows = await m.read("select id, public, file_size_limit from storage.buckets order by 1");
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      let bad = 0;
      for (const [id, exp] of Object.entries(EXPECTED_BUCKETS)) {
        const r = byId[id];
        if (!r) { (APPLY ? warn : info)(`${id}: missing${APPLY ? "" : " (expected before db push)"}`); bad++; continue; }
        const good = r.public === exp.public && Number(r.file_size_limit) === exp.file_size_limit;
        (good ? ok : warn)(`${id}: public=${r.public} limit=${r.file_size_limit}`);
        if (!good) bad++;
      }
      warn("free plan: the project-wide upload limit is 50 MB; private-media/backups objects above that are rejected until the plan allows a higher global limit");
      if (bad && APPLY) throw new StepError("bucket configuration differs from migrations");
    },
  },
  {
    name: "edge-function",
    desc: "deploy storage-cleanup (--no-verify-jwt), STORAGE_CLEANUP_SECRET, Vault url/key",
    async run() {
      const fnUrl = `https://${m.ref}.supabase.co/functions/v1/storage-cleanup`;
      const key = secret("STORAGE_CLEANUP_SECRET");
      if (!APPLY) {
        const fns = await m.api(`/v1/projects/${m.ref}/functions`);
        info(`deployed functions: ${fns.map((f) => f.slug).join(", ") || "none"}`);
        plan(`npx supabase functions deploy storage-cleanup --no-verify-jwt --use-api --project-ref ${m.ref}`);
        plan("POST /v1/projects/{ref}/secrets [STORAGE_CLEANUP_SECRET] (generated locally, value in request body only)");
        return plan("upsert Vault secrets storage_cleanup_url / storage_cleanup_key via parameterized SQL");
      }
      cli(["functions", "deploy", "storage-cleanup", "--no-verify-jwt", "--use-api", "--project-ref", m.ref]);
      await m.api(`/v1/projects/${m.ref}/secrets`, { method: "POST", body: JSON.stringify([{ name: "STORAGE_CLEANUP_SECRET", value: key }]) });
      ok(`function secret STORAGE_CLEANUP_SECRET set ${mask(key)}`);
      for (const [name, value] of [["storage_cleanup_url", fnUrl], ["storage_cleanup_key", key]]) {
        await m.write("select vault.create_secret($2, $1) where not exists (select 1 from vault.secrets where name = $1)", [name, value]);
        await m.write("select vault.update_secret(id, $2) from vault.secrets where name = $1", [name, value]);
      }
      const v = await m.read("select name from vault.secrets where name in ('storage_cleanup_url','storage_cleanup_key') order by 1");
      if (v.length !== 2) throw new StepError("vault secrets not present after upsert");
      ok("Vault secrets storage_cleanup_url / storage_cleanup_key present (values not read back)");
    },
  },
  {
    name: "cron-verify",
    desc: "cron job active + function answers a signed POST",
    async run() {
      const job = await m.read("select jobname, schedule, active from cron.job where jobname = 'storage-cleanup'").catch(() => []);
      if (job[0]?.active) ok(`cron job storage-cleanup schedule="${job[0].schedule}" active`);
      else if (APPLY) throw new StepError("cron job storage-cleanup missing or inactive");
      else info("cron job not present yet (created by migration 0010)");
      const key = loadSecrets().STORAGE_CLEANUP_SECRET;
      if (!APPLY || !key) return plan("POST the function with the secret and expect 2xx");
      const r = await fetch(`https://${m.ref}.supabase.co/functions/v1/storage-cleanup`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: '{"reason":"staging-apply"}',
      });
      const body = await r.text();
      if (!r.ok) throw new StepError(`function returned HTTP ${r.status} ${body.slice(0, 200)}`);
      ok(`function → ${r.status} ${body.slice(0, 120)}`);
      const unauth = await fetch(`https://${m.ref}.supabase.co/functions/v1/storage-cleanup`, { method: "POST", body: "{}" });
      if (unauth.status !== 401) throw new StepError(`function without bearer returned ${unauth.status}, expected 401`);
      ok("function without bearer → 401");
    },
  },
  {
    name: "app-env",
    desc: "write web/.env.staging.app.local from project API keys",
    async run() {
      ensureIgnored(APP_ENV_FILE);
      if (!APPLY) {
        const keys = await m.api(`/v1/projects/${m.ref}/api-keys`); // reveal not requested in dry run
        info(`api keys available: ${keys.map((k) => `${k.type}:${k.name}`).join(", ")}`);
        return plan("write .env.staging.app.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, NEXT_PUBLIC_SITE_URL, IP_HASH_SECRET)");
      }
      const keys = await m.api(`/v1/projects/${m.ref}/api-keys?reveal=true`);
      const pick = (t) => keys.find((k) => k.type === t && k.name === "default") ?? keys.find((k) => k.type === t);
      const pub = pick("publishable")?.api_key;
      const sec = pick("secret")?.api_key;
      if (!pub || !sec) throw new StepError("publishable/secret API keys not found — create them in Dashboard → Project Settings → API Keys, then re-run --from app-env");
      if (!sec.startsWith("sb_secret_") || !pub.startsWith("sb_publishable_")) warn("unexpected key prefix");
      const ip = secret("IP_HASH_SECRET");
      writeSecretFile(APP_ENV_FILE, [
        "# Generated by scripts/staging-apply.mjs — STAGING app env. Never commit, never paste.",
        `NEXT_PUBLIC_SUPABASE_URL=https://${m.ref}.supabase.co`,
        `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${pub}`,
        `SUPABASE_SECRET_KEY=${sec}`,
        `NEXT_PUBLIC_SITE_URL=${siteUrl}`,
        `IP_HASH_SECRET=${ip}`,
        "",
      ].join("\n"));
      ok(`wrote .env.staging.app.local (publishable ${mask(pub)}, secret ${mask(sec)}, IP_HASH_SECRET ${mask(ip)})`);
    },
  },
  {
    name: "bootstrap",
    desc: "one-shot owner bootstrap token (hash in private.bootstrap)",
    async run() {
      const owners = await m.read("select count(*)::int as n from public.profiles where role = 'owner'").catch(() => [{ n: null }]);
      if (owners[0]?.n > 0) return ok("an owner already exists — bootstrap not needed");
      const row = await m.read("select token_hash, used_at from private.bootstrap where id = 1").catch(() => []);
      const tokenOnDisk = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : null;
      const hash = (t) => createHash("sha256").update(t, "utf8").digest("hex"); // == encode(sha256(convert_to(t,'UTF8')),'hex')
      if (tokenOnDisk && row[0] && !row[0].used_at && row[0].token_hash === hash(tokenOnDisk)) {
        return ok(`bootstrap token already armed; plaintext in ${TOKEN_FILE}`);
      }
      if (!APPLY) return plan("generate a 43-char token, store sha256 hex in private.bootstrap, write token to .cache/bootstrap-token.local.txt");
      const token = randomBytes(32).toString("base64url");
      writeSecretFile(TOKEN_FILE, token + "\n");
      await m.write(
        "insert into private.bootstrap (id, token_hash) values (1, $1) on conflict (id) do update set token_hash = excluded.token_hash, used_at = null, used_by = null",
        [hash(token)],
      );
      ok(`bootstrap armed. Token file: ${TOKEN_FILE}`);
      info("next: node scripts/staging-bootstrap-owner.mjs  (creates/signs in the owner, consumes the token, deletes file + row)");
    },
  },
];

// ------------------------------------------------------------------ main
async function main() {
  console.log(`staging-apply ${APPLY ? "APPLY" : "DRY RUN (no writes; pass --apply to execute)"} · target ${EXPECTED_REF}`);
  console.log(`steps: ${steps.map((s) => s.name).join(" → ")}`);
  console.log("\n[env]");
  env = loadStagingEnv(envPath);
  siteUrl = (env.STAGING_SITE_URL ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^,\s]+$/.test(siteUrl)) throw new StepError("STAGING_SITE_URL missing or invalid (e.g. http://localhost:3100)");
  ok(`STAGING_SITE_URL=${siteUrl}`);
  m = mgmt(env);

  let start = 0;
  if (args.from) {
    start = steps.findIndex((s) => s.name === args.from);
    if (start < 0) throw new StepError(`unknown step "${args.from}"`);
  }
  const selected = args.only ? steps.filter((s) => s.name === args.only) : steps.slice(start);
  if (!selected.length) throw new StepError(`unknown step "${args.only}"`);
  // The safety checks always run, even when resuming.
  if (selected[0].name !== "preflight") selected.unshift(steps[0]);
  for (const s of selected) {
    console.log(`\n[${s.name}] ${s.desc}`);
    await s.run();
  }
  console.log(`\n${APPLY ? "✓ apply finished" : "✓ dry run finished — nothing was written"}`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof StepError ? e.message : e?.stack ?? e}`);
  console.error("  fix the cause, then resume with --from <step>");
  process.exit(1);
});
