#!/usr/bin/env node
/**
 * Restores an independent export (backup-export.mjs) into an ISOLATED local Supabase stack — never into
 * staging, production or the main local stack.
 *   node scripts/backup-restore-export.mjs --from <export dir> --target local-isolated [up|restore|down|all]
 *
 *   up       create web/.cache/export-restore/supabase (config.toml from the repo, project_id
 *            "alsultan-export-restore", ports 563xx, seed off, the repo's migrations) and start it
 *   restore  load data/*.json (one transaction, session_replication_role=replica, so FK cycles such as cover
 *            photo ids load in any order; then an FK re-check query), auth users (ids/emails only; no
 *            passwords), bucket config, and every storage object (upload + read-back sha256)
 *   down     stop the isolated stack and delete its volumes (nothing else is touched)
 *   all      up + restore (default). Run verify-export.mjs afterwards, then `down`.
 * Same isolation approach as cloud-restore-rehearsal.mjs sim-up (distinct project id + ports).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runPsql, stackStatus } from "./backup-lib.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const cmd = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "all";
const FROM = opt("--from") && path.resolve(opt("--from"));
if (opt("--target") !== "local-isolated") { console.error("--target local-isolated is required (the only allowed target)"); process.exit(2); }
export const WORKDIR = path.join(WEB, ".cache", "export-restore");
export const PROJECT_ID = "alsultan-export-restore";
export const CONTAINER = `supabase_db_${PROJECT_ID}`;
const relw = path.relative(WEB, WORKDIR).split(path.sep).join("/");
const PORTS = { 54321: 56321, 54322: 56322, 54320: 56320, 54329: 56329, 54323: 56323, 54324: 56324, 54327: 56327, 8083: 56383 };

function npx(args) {
  console.log(`$ npx ${args.join(" ")}`);
  const r = spawnSync("npx", args, { cwd: WEB, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`npx ${args.slice(0, 2).join(" ")} failed (${r.status})`);
}
function psql(sql) {
  const r = runPsql({ container: CONTAINER }, sql);
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr || String(r.error)).slice(0, 1500)}`);
  return r.stdout;
}

/** Resolves the isolated stack and refuses anything that is not it. */
export function isolatedStack() {
  const st = stackStatus(relw);
  const u = new URL(st.url);
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "56321") throw new Error(`isolated stack API is ${st.url}, expected 127.0.0.1:56321`);
  return st;
}

async function up() {
  const sup = path.join(WORKDIR, "supabase");
  fs.mkdirSync(path.join(sup, "migrations"), { recursive: true });
  let toml = fs.readFileSync(path.join(WEB, "supabase", "config.toml"), "utf8");
  toml = toml.replace(/^project_id = .*$/m, `project_id = "${PROJECT_ID}"`);
  toml = toml.replace(/^(\s*(?:port|shadow_port|inspector_port) = )(\d+)/gm, (m, k, p) => (PORTS[p] ? `${k}${PORTS[p]}` : m));
  toml = toml.replace(/(\[db\.seed\][^[]*?enabled = )true/, "$1false");
  toml = toml.replace(/\n\[functions\.storage-cleanup\][\s\S]*?(?=\n\[|$)/, "\n");
  fs.writeFileSync(path.join(sup, "config.toml"), toml);
  for (const f of fs.readdirSync(path.join(sup, "migrations"))) fs.rmSync(path.join(sup, "migrations", f));
  for (const f of fs.readdirSync(path.join(WEB, "supabase", "migrations"))) fs.copyFileSync(path.join(WEB, "supabase", "migrations", f), path.join(sup, "migrations", f));
  const tpl = path.join(WEB, "supabase", "templates");
  if (fs.existsSync(tpl)) fs.cpSync(tpl, path.join(sup, "templates"), { recursive: true });
  npx(["supabase", "start", "--workdir", relw, "-x", "studio,imgproxy,vector,logflare,edge-runtime,supavisor,realtime,mailpit,inbucket"]);
  console.log(`isolated stack up: ${isolatedStack().url}`);
}

async function restore() {
  if (!FROM || !fs.existsSync(path.join(FROM, "manifest.json"))) throw new Error("--from <export dir with manifest.json> is required");
  const manifest = JSON.parse(fs.readFileSync(path.join(FROM, "manifest.json"), "utf8"));
  if (manifest.status !== "complete") console.warn(`!! export status is ${manifest.status} — restoring what is there`);
  const st = isolatedStack();
  const t0 = Date.now();

  // ---- database (one transaction, replica mode)
  const cols = new Map();
  for (const line of psql(`select table_name, string_agg(column_name, ',') from information_schema.columns where table_schema='public' and is_generated='NEVER' and coalesce(identity_generation,'') <> 'ALWAYS' group by 1;`).trim().split("\n")) {
    const [t, c] = line.split("|");
    if (t) cols.set(t, new Set(c.split(",")));
  }
  const tag = `j${randomBytes(6).toString("hex")}`;
  let sql = "begin;\nset local session_replication_role = replica;\n";
  const loaded = {};
  const order = Object.keys(manifest.tables).filter((t) => manifest.tables[t].rows !== undefined && !t.includes("."));
  for (const t of [...order].reverse()) if (cols.has(t)) sql += `delete from public.${t};\n`;
  for (const t of order) {
    if (!cols.has(t)) { loaded[t] = "table missing in target schema"; continue; }
    const rows = JSON.parse(fs.readFileSync(path.join(FROM, "data", `${t}.json`), "utf8"));
    loaded[t] = rows.length;
    if (!rows.length) continue;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => cols.get(t).has(k));
    const list = keys.map((k) => `"${k}"`).join(", ");
    const json = JSON.stringify(rows);
    if (json.includes(`$${tag}$`)) throw new Error("dollar-quote collision");
    sql += `insert into public.${t} (${list}) select ${list} from json_populate_recordset(null::public.${t}, $${tag}$${json}$${tag}$);\n`;
  }
  // auth users: ids/emails/metadata only (the API export has no password hashes) so profiles keep their FKs.
  const usersFile = path.join(FROM, "auth", "users.json");
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    sql += `delete from auth.users;\n`;
    if (users.length) sql += `insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, coalesce(u.app_metadata,'{}'), coalesce(u.user_metadata,'{}'), coalesce(u.created_at, now()), now()
      from json_to_recordset($${tag}$${JSON.stringify(users)}$${tag}$) as u(id uuid, email text, app_metadata jsonb, user_metadata jsonb, created_at timestamptz);\n`;
    loaded["auth.users"] = users.length;
  }
  sql += "commit;\n";
  psql(sql);
  console.log(`db: loaded ${Object.values(loaded).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0)} rows into ${Object.keys(loaded).length} tables (${Date.now() - t0} ms)`);

  // FK re-check (replica mode skipped the triggers): count orphans for every FK in public.
  const fkSql = `
    do $$ declare r record; n bigint; bad text := ''; begin
      for r in select c.conrelid::regclass as tbl, c.confrelid::regclass as ref, a.attname as col, af.attname as refcol
               from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
               join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1]
               where c.contype='f' and c.connamespace='public'::regnamespace and array_length(c.conkey,1)=1 loop
        execute format('select count(*) from %s t where t.%I is not null and not exists (select 1 from %s x where x.%I = t.%I)', r.tbl, r.col, r.ref, r.refcol, r.col) into n;
        if n > 0 then bad := bad || format('%s.%s->%s: %s; ', r.tbl, r.col, r.ref, n); end if;
      end loop;
      raise notice 'FKCHECK:%', coalesce(nullif(bad,''),'ok');
    end $$;`;
  const fk = runPsql({ container: CONTAINER }, fkSql);
  const fkLine = (fk.stderr.match(/FKCHECK:(.*)/) ?? [])[1] ?? "unknown";
  console.log(`fk re-check: ${fkLine}`);

  // ---- storage
  const sb = createClient(st.url, st.secret, { auth: { persistSession: false } });
  const bucketsFile = path.join(FROM, "buckets.json");
  const want = fs.existsSync(bucketsFile) ? JSON.parse(fs.readFileSync(bucketsFile, "utf8")) : [];
  const have = new Set(((await sb.storage.listBuckets()).data ?? []).map((b) => b.name));
  for (const b of want) if (!have.has(b.name)) {
    const r = await sb.storage.createBucket(b.name, { public: b.public, fileSizeLimit: b.file_size_limit ?? undefined, allowedMimeTypes: b.allowed_mime_types ?? undefined });
    if (r.error) throw new Error(`create bucket ${b.name}: ${r.error.message}`);
  }
  const objs = manifest.files.filter((f) => f.path.startsWith("storage/"));
  const errors = [];
  let done = 0, bytes = 0;
  const queue = [...objs];
  async function worker() {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const [, bucket, ...rest] = f.path.split("/");
      const key = rest.join("/");
      try {
        const buf = fs.readFileSync(path.join(FROM, ...f.path.split("/")));
        if (createHash("sha256").update(buf).digest("hex") !== f.sha256) throw new Error("local file does not match the export manifest");
        const r = await sb.storage.from(bucket).upload(key, buf, { upsert: true, contentType: f.content_type ?? undefined, cacheControl: "31536000" });
        if (r.error) throw new Error(r.error.message);
        done++; bytes += buf.length;
      } catch (e) { errors.push({ path: f.path, error: String(e.message ?? e) }); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const report = { restored_at: new Date().toISOString(), from: FROM, target: st.url, tables: loaded, fk_recheck: fkLine, storage: { objects: done, bytes, errors }, duration_ms: Date.now() - t0 };
  fs.writeFileSync(path.join(FROM, "restore-report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(JSON.stringify({ ...report, tables: undefined }, null, 1));
  if (errors.length) process.exit(1);
}

async function down() {
  npx(["supabase", "stop", "--workdir", relw, "--no-backup"]);
  console.log("isolated stack stopped and its volumes removed");
}

if (cmd === "up") await up();
else if (cmd === "restore") await restore();
else if (cmd === "down") await down();
else if (cmd === "all") { await up(); await restore(); }
else { console.error(`unknown command ${cmd}`); process.exit(2); }
